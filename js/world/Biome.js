// Assigns a biome to every tile using a temperature × moisture lookup table
// capped by planet.terrain whitelist. BIOME enum is exported for Stage 6.
const Biome = (() => {
  const BIOME = {
    OCEAN: 0, LAKE: 1, RIVER: 2,
    TROPICAL: 3, SAVANNA: 4, DESERT: 5,
    FOREST: 6, GRASSLAND: 7, SHRUBLAND: 8,
    TAIGA: 9, TUNDRA: 10, ROCKY_TUNDRA: 11,
    ICE_SHEET: 12, BARREN_ICE: 13, ALPINE: 14,
  };

  // [tempBand][moistBand]  tempBand: 0=HOT 1=TEMP 2=COLD 3=FROZEN  moistBand: 0=HIGH 1=MED 2=LOW
  const BIOME_TABLE = [
    [BIOME.TROPICAL,  BIOME.SAVANNA,   BIOME.DESERT      ],
    [BIOME.FOREST,    BIOME.GRASSLAND, BIOME.SHRUBLAND    ],
    [BIOME.TAIGA,     BIOME.TUNDRA,    BIOME.ROCKY_TUNDRA ],
    [BIOME.ICE_SHEET, BIOME.ICE_SHEET, BIOME.BARREN_ICE   ],
  ];

  const TERRAIN_WHITELIST = {
    scorched:  [BIOME.DESERT, BIOME.ROCKY_TUNDRA, BIOME.BARREN_ICE, BIOME.ALPINE],
    arid:      [BIOME.DESERT, BIOME.SHRUBLAND, BIOME.SAVANNA, BIOME.ROCKY_TUNDRA, BIOME.ALPINE],
    temperate: [BIOME.TROPICAL, BIOME.SAVANNA, BIOME.DESERT, BIOME.FOREST,
                BIOME.GRASSLAND, BIOME.SHRUBLAND, BIOME.TAIGA, BIOME.TUNDRA,
                BIOME.ROCKY_TUNDRA, BIOME.ALPINE],
    tundra:    [BIOME.TAIGA, BIOME.TUNDRA, BIOME.ROCKY_TUNDRA,
                BIOME.ICE_SHEET, BIOME.BARREN_ICE, BIOME.ALPINE],
    frozen:    [BIOME.ICE_SHEET, BIOME.BARREN_ICE, BIOME.ROCKY_TUNDRA, BIOME.ALPINE],
  };

  const BIOME_TEMP_BAND = {
    [BIOME.TROPICAL]: 0, [BIOME.SAVANNA]: 0, [BIOME.DESERT]: 0,
    [BIOME.FOREST]:   1, [BIOME.GRASSLAND]: 1, [BIOME.SHRUBLAND]: 1,
    [BIOME.TAIGA]:    2, [BIOME.TUNDRA]: 2, [BIOME.ROCKY_TUNDRA]: 2,
    [BIOME.ICE_SHEET]:3, [BIOME.BARREN_ICE]: 3,
    [BIOME.ALPINE]:  -1,
  };

  const MOUNTAIN_PEAK = 0.85;
  const MOISTURE_HIGH = 0.55;
  const MOISTURE_LOW  = 0.25;
  const TEMP_HOT       = 310;
  const TEMP_TEMPERATE = 260;
  const TEMP_COLD      = 200;

  // Bilinearly interpolate a per-zone array at fractional zone coordinates.
  function _bilinear(arr, zoneW, zoneH, zx, zy, tx, ty) {
    const zx1 = Math.min(zx + 1, zoneW - 1);
    const zy1 = Math.min(zy + 1, zoneH - 1);
    return MathUtils.lerp(
      MathUtils.lerp(arr[zy  * zoneW + zx], arr[zy  * zoneW + zx1], tx),
      MathUtils.lerp(arr[zy1 * zoneW + zx], arr[zy1 * zoneW + zx1], tx),
      ty
    );
  }

  function _nearest(candidate, whitelist, tempBand) {
    let best = whitelist[0], bestDist = Infinity;
    for (const b of whitelist) {
      const bt   = BIOME_TEMP_BAND[b];
      const dist = Math.abs((bt === -1 ? tempBand : bt) - tempBand);
      if (dist < bestDist) { bestDist = dist; best = b; }
    }
    return best;
  }

  function generate(w, h, elevation, waterType, tempZone, moisture, zoneW, zoneH, planet) {
    const ZONE_SIZE   = Temperature.ZONE_SIZE;
    const WATER_OCEAN = Hydrology.WATER_OCEAN;
    const WATER_LAKE  = Hydrology.WATER_LAKE;
    const WATER_RIVER = Hydrology.WATER_RIVER;

    const biome      = new Uint8Array(w * h);
    const whitelist  = TERRAIN_WHITELIST[planet.terrain] ?? TERRAIN_WHITELIST.temperate;
    const wlSet      = new Set(whitelist);
    const seed       = NoiseGen.seedFrom(planet.id);
    const biomeNoise = NoiseGen.makeGradientNoise((seed ^ 0xB10E) >>> 0);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i  = y * w + x;
        const wt = waterType[i];
        if (wt === WATER_OCEAN) { biome[i] = BIOME.OCEAN; continue; }
        if (wt === WATER_LAKE)  { biome[i] = BIOME.LAKE;  continue; }
        if (wt === WATER_RIVER) { biome[i] = BIOME.RIVER; continue; }

        if (elevation[i] > MOUNTAIN_PEAK) { biome[i] = BIOME.ALPINE; continue; }

        const zxf = x / ZONE_SIZE;
        const zyf = y / ZONE_SIZE;
        const zx  = Math.min(Math.floor(zxf), zoneW - 1);
        const zy  = Math.min(Math.floor(zyf), zoneH - 1);
        const tx  = zxf - Math.floor(zxf);
        const ty  = zyf - Math.floor(zyf);
        const tempK = _bilinear(tempZone, zoneW, zoneH, zx, zy, tx, ty);
        const moist = MathUtils.clamp(
          _bilinear(moisture, zoneW, zoneH, zx, zy, tx, ty) +
          (biomeNoise.sample(x / 6, y / 6) - 0.5) * 0.16,
          0, 1
        );

        const tempBand  = tempK > TEMP_HOT ? 0 : tempK > TEMP_TEMPERATE ? 1 : tempK > TEMP_COLD ? 2 : 3;
        const moistBand = moist > MOISTURE_HIGH ? 0 : moist > MOISTURE_LOW ? 1 : 2;
        let candidate   = BIOME_TABLE[tempBand][moistBand];

        if (!wlSet.has(candidate)) candidate = _nearest(candidate, whitelist, tempBand);

        biome[i] = candidate;
      }
    }

    return biome;
  }

  return { generate, BIOME };
})();
