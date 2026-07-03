// Generates a Float32Array elevation map using multi-octave value noise.
// SEA_LEVEL and MOUNTAIN_THRESHOLD are exported for use by downstream pipeline stages.
const Heightmap = (() => {
  const SEA_LEVEL           = 0.35;
  const MOUNTAIN_THRESHOLD  = 0.70;
  const MIN_ELEVATION_RANGE = 0.40;

  const TERRAIN_PARAMS = {
    scorched:  { octaves: 5, baseFreq: 1.8, lacunarity: 2.2, persistence: 0.45 },
    arid:      { octaves: 5, baseFreq: 1.4, lacunarity: 2.0, persistence: 0.50 },
    temperate: { octaves: 5, baseFreq: 1.1, lacunarity: 2.0, persistence: 0.55 },
    tundra:    { octaves: 4, baseFreq: 0.9, lacunarity: 1.8, persistence: 0.60 },
    frozen:    { octaves: 4, baseFreq: 0.9, lacunarity: 1.7, persistence: 0.65 },
  };

  function _normalize(arr) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < mn) mn = arr[i];
      if (arr[i] > mx) mx = arr[i];
    }
    const range = mx - mn;
    if (range === 0) return;
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - mn) / range;
  }

  function generate(w, h, planet) {
    if (!planet.landable) return null;

    const params = TERRAIN_PARAMS[planet.terrain] || TERRAIN_PARAMS.temperate;
    const baseSeed = NoiseGen.seedFrom(planet.id);

    const phaseRng = NoiseGen.mulberry32((baseSeed ^ 0xdeadbeef) >>> 0);
    const samplers = [];
    let freq = params.baseFreq;
    for (let o = 0; o < params.octaves; o++) {
      const tiles = Math.max(1, Math.round(freq));
      const phaseX = phaseRng() * tiles;
      const phaseY = phaseRng() * tiles;
      samplers.push({ noise: NoiseGen.makeTileableValueNoise((baseSeed + o * 0x9e3779b9) >>> 0, tiles, tiles), tiles, phaseX, phaseY });
      freq *= params.lacunarity;
    }

    const elevation = new Float32Array(w * h);
    const scaleX = w > 1 ? 1 / (w - 1) : 0;
    const scaleY = h > 1 ? 1 / (h - 1) : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = x * scaleX;
        const ny = y * scaleY;
        let value = 0, amplitude = 1.0;
        for (let o = 0; o < params.octaves; o++) {
          const { noise, tiles, phaseX, phaseY } = samplers[o];
          value     += amplitude * noise.sample(nx * tiles + phaseX, ny * tiles + phaseY);
          amplitude *= params.persistence;
        }
        elevation[y * w + x] = value;
      }
    }

    _normalize(elevation);

    // Contrast stretch if range is too flat
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < elevation.length; i++) {
      if (elevation[i] < mn) mn = elevation[i];
      if (elevation[i] > mx) mx = elevation[i];
    }
    if (mx - mn > 0 && mx - mn < MIN_ELEVATION_RANGE) {
      const mid = (mx + mn) / 2;
      const scale = MIN_ELEVATION_RANGE / (mx - mn);
      for (let i = 0; i < elevation.length; i++) {
        elevation[i] = MathUtils.clamp(mid + (elevation[i] - mid) * scale, 0, 1);
      }
    }

    return elevation;
  }

  return { generate, SEA_LEVEL, MOUNTAIN_THRESHOLD };
})();
