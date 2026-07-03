// Wind-driven moisture advection from water bodies; produces per-zone rain and snow chance.
const Moisture = (() => {
  const ATTEN_BASE     = 0.92;
  const MOUNTAIN_BLOCK = 0.30;
  const MOISTURE_FLOOR = 0.05;
  const TERRAIN_MOISTURE_CAP = {
    scorched: 0.15, arid: 0.30, temperate: 1.0, tundra: 0.8, frozen: 0.7,
  };

  function _sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

  function generate(w, h, elevation, waterType, tempZone, zoneW, zoneH, planet) {
    const ZONE_SIZE         = Temperature.ZONE_SIZE;
    const FREEZE_THRESHOLD  = Temperature.FREEZE_THRESHOLD;
    const MOUNTAIN_THRESHOLD = Heightmap.MOUNTAIN_THRESHOLD;
    const WATER_OCEAN = Hydrology.WATER_OCEAN;
    const WATER_LAKE  = Hydrology.WATER_LAKE;

    const seed = (NoiseGen.seedFrom(planet.id) ^ 0xDEAD) >>> 0;
    const rng  = NoiseGen.mulberry32(seed);
    const windAngle = rng() * 2 * Math.PI;
    const windDx    = Math.cos(windAngle);
    const windDy    = Math.sin(windAngle);
    const dayLen    = Math.max(planet.dayLength ?? 180, 1);
    const windSpeed = MathUtils.clamp(dayLen / 180, 0.5, 2.0);

    // Zone average elevation for mountain-blocking check
    const zoneAvgElev   = new Float32Array(zoneW * zoneH);
    const zoneTileCount = new Uint16Array(zoneW * zoneH);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const zx  = Math.min(Math.floor(x / ZONE_SIZE), zoneW - 1);
        const zy  = Math.min(Math.floor(y / ZONE_SIZE), zoneH - 1);
        const idx = zy * zoneW + zx;
        zoneAvgElev[idx]   += elevation[y * w + x];
        zoneTileCount[idx]++;
      }
    }
    for (let i = 0; i < zoneAvgElev.length; i++) {
      if (zoneTileCount[i] > 0) zoneAvgElev[i] /= zoneTileCount[i];
    }

    // Mark water-body zones as moisture sources
    const moistureSource = new Float32Array(zoneW * zoneH);
    for (let i = 0; i < w * h; i++) {
      if (waterType[i] === WATER_OCEAN || waterType[i] === WATER_LAKE) {
        const zx  = Math.min(Math.floor((i % w) / ZONE_SIZE), zoneW - 1);
        const zy  = Math.min(Math.floor(Math.floor(i / w) / ZONE_SIZE), zoneH - 1);
        moistureSource[zy * zoneW + zx] = 1.0;
      }
    }

    // Sort zones upwind → downwind
    const zoneOrder = [];
    for (let zy = 0; zy < zoneH; zy++) {
      for (let zx = 0; zx < zoneW; zx++) {
        zoneOrder.push({ zx, zy, key: windDx * (zx + 0.5) + windDy * (zy + 0.5) });
      }
    }
    zoneOrder.sort((a, b) => a.key - b.key);

    const moisture    = new Float32Array(zoneW * zoneH);
    const attenScale  = 1.0 + (windSpeed - 1.0) * 0.05;
    for (const { zx, zy } of zoneOrder) {
      const idx   = zy * zoneW + zx;
      let m       = moistureSource[idx];
      const upZx  = zx - _sign(windDx);
      const upZy  = zy - _sign(windDy);
      if (upZx >= 0 && upZx < zoneW && upZy >= 0 && upZy < zoneH) {
        const upIdx = upZy * zoneW + upZx;
        const block = zoneAvgElev[idx] > MOUNTAIN_THRESHOLD ? MOUNTAIN_BLOCK : 1.0;
        m = Math.max(m, moisture[upIdx] * ATTEN_BASE * attenScale * block);
      }
      moisture[idx] = m;
    }

    // Floor, terrain cap, then atmosphere scaling. A thin or absent atmosphere
    // can carry little water vapour (so precipitation falls toward zero), while
    // a thick atmosphere lifts it.
    const cap        = TERRAIN_MOISTURE_CAP[planet.terrain] ?? 1.0;
    const atmoFactor = Atmosphere.weatherFactor(planet.atmosphere);
    for (let i = 0; i < moisture.length; i++) {
      if (moisture[i] < MOISTURE_FLOOR) moisture[i] = MOISTURE_FLOOR;
      moisture[i] = Math.min(moisture[i] * cap * atmoFactor, 1.0);
    }

    // Rain and snow chance — rain only above freezing, snow only below
    const rainChance = new Float32Array(zoneW * zoneH);
    const snowChance = new Float32Array(zoneW * zoneH);
    for (let i = 0; i < zoneW * zoneH; i++) {
      const tempK      = tempZone[i];
      const tempFactor = MathUtils.clamp(1.0 - Math.abs(tempK - 280) / 400, 0.1, 1.0);
      const precip     = MathUtils.clamp(moisture[i] * tempFactor, 0.0, 1.0);
      if (tempK >= FREEZE_THRESHOLD) {
        rainChance[i] = precip;
      } else {
        snowChance[i] = precip * MathUtils.clamp((FREEZE_THRESHOLD - tempK) / 50, 0.0, 1.0);
      }
    }

    return { moisture, rainChance, snowChance, windDir: { dx: windDx, dy: windDy }, windSpeed };
  }

  return { generate };
})();
