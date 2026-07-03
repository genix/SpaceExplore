// Places mud pit objects on planets that have water and above-freezing temperatures.
// Pits cluster in groups of 3–8; no pits on scorched or frozen planets.
const MudPitGen = (() => {
  const CLUSTER_COUNT = { scorched: 0, arid: 1, temperate: 4, tundra: 2, frozen: 0 };
  const CLUSTER_RADIUS = 5;
  const CLUSTER_MIN    = 3;
  const CLUSTER_MAX    = 8;

  function place(map, planet) {
    const numClusters = CLUSTER_COUNT[planet.terrain] ?? 2;
    if (numClusters === 0) return [];
    if (!_hasWater(map)) return [];

    const seed = (NoiseGen.seedFrom(planet.id) ^ 0xA1DE) >>> 0;
    const rng  = NoiseGen.mulberry32(seed);

    const candidates = _warmLandTiles(map);
    if (candidates.length === 0) return [];

    const objects  = [];
    const occupied = new Set();
    let   idx      = 0;

    for (let c = 0; c < numClusters; c++) {
      const { cx, cy } = candidates[Math.floor(rng() * candidates.length)];
      const count      = CLUSTER_MIN + Math.floor(rng() * (CLUSTER_MAX - CLUSTER_MIN + 1));
      let   placed     = 0;
      let   attempts   = count * 10;

      while (placed < count && attempts-- > 0) {
        const rx = Math.round((rng() * 2 - 1) * CLUSTER_RADIUS);
        const ry = Math.round((rng() * 2 - 1) * CLUSTER_RADIUS);
        const tx = ((cx + rx) % map.w + map.w) % map.w;
        const ty = ((cy + ry) % map.h + map.h) % map.h;
        const key = `${tx},${ty}`;
        if (occupied.has(key)) continue;
        if (!MapGen.isPassable(map.grid[ty][tx])) continue;
        if (!_isAboveFreezing(map, tx, ty)) continue;
        objects.push(MudPitObject.create(`mp-${planet.id}-${idx++}`, tx, ty));
        occupied.add(key);
        placed++;
      }
    }

    return objects;
  }

  function _hasWater(map) {
    for (let i = 0; i < map.waterType.length; i++) {
      if (map.waterType[i] !== 0) return true;
    }
    return false;
  }

  function _isAboveFreezing(map, x, y) {
    return map.climate.getClimateZone(x, y).tempK > Temperature.FREEZE_THRESHOLD;
  }

  function _warmLandTiles(map) {
    const step  = Math.max(1, Math.floor(Math.min(map.w, map.h) / 24));
    const tiles = [];
    for (let y = 0; y < map.h; y += step) {
      for (let x = 0; x < map.w; x += step) {
        if (MapGen.isPassable(map.grid[y][x]) && _isAboveFreezing(map, x, y)) {
          tiles.push({ cx: x, cy: y });
        }
      }
    }
    return tiles;
  }

  return { place };
})();
