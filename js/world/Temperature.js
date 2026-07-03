// Computes per-zone average temperature (Kelvin) from stellar physics and elevation lapse rate.
// ZONE_SIZE and FREEZE_THRESHOLD are exported for use by downstream pipeline stages.
const Temperature = (() => {
  const LAPSE_RATE       = 80;
  const LATITUDE_SWING   = 0.20;
  const TEMP_MIN         = 50;
  const TEMP_MAX         = 600;
  const ZONE_SIZE        = 8;
  const FREEZE_THRESHOLD = 273;
  const DEFAULT_DIURNAL  = { swingK: 16 };
  const DIURNAL_BY_TERRAIN = {
    scorched:  { swingK: 48 },
    arid:      { swingK: 38 },
    temperate: { swingK: 12 },
    tundra:    { swingK: 18 },
    frozen:    { swingK: 22 },
    gas:       { swingK: 8 },
  };

  function baseTempK(luminosity, distanceAU) {
    const safeAU  = Math.max(distanceAU ?? 1, 0.01);
    const safeLum = Math.max(luminosity ?? 1, 0.001);
    return 305 * Math.pow(safeLum / (safeAU * safeAU), 0.25);
  }

  function generate(w, h, elevation, planet, starLuminosity) {
    const base = baseTempK(starLuminosity, planet.distanceAU);

    const zoneW = Math.ceil(w / ZONE_SIZE);
    const zoneH = Math.ceil(h / ZONE_SIZE);
    const tileTemp      = new Float32Array(w * h);
    const tempZone      = new Float32Array(zoneW * zoneH);
    const zoneTileCount = new Uint16Array(zoneW * zoneH);
    const SEA_LEVEL     = Heightmap.SEA_LEVEL;

    for (let y = 0; y < h; y++) {
      const latNorm   = y / Math.max(h - 1, 1);
      const latFactor = Math.cos(Math.PI * Math.abs(latNorm - 0.5) * 2);
      const latAdjust = base * LATITUDE_SWING * latFactor;
      for (let x = 0; x < w; x++) {
        const tileTempK = MathUtils.clamp(
          base + latAdjust - (elevation[y * w + x] - SEA_LEVEL) * LAPSE_RATE,
          TEMP_MIN, TEMP_MAX
        );
        tileTemp[y * w + x] = tileTempK;
        const zx  = Math.min(Math.floor(x / ZONE_SIZE), zoneW - 1);
        const zy  = Math.min(Math.floor(y / ZONE_SIZE), zoneH - 1);
        const idx = zy * zoneW + zx;
        tempZone[idx]      += tileTempK;
        zoneTileCount[idx]++;
      }
    }

    for (let i = 0; i < zoneW * zoneH; i++) {
      tempZone[i] = zoneTileCount[i] > 0 ? tempZone[i] / zoneTileCount[i] : base;
    }

    if (planet.terrain === 'frozen' && base > 280) {
      console.warn('WorldGen Temperature: frozen planet baseTempK =', base.toFixed(1), 'K');
    }

    return { tileTemp, tempZone, zoneW, zoneH, baseTempK: base };
  }

  function currentTempK(staticTempK, dayPhase, planet, zone, heatBonus = 0) {
    const base    = Number.isFinite(staticTempK) ? staticTempK : 280;
    const phase   = Number.isFinite(dayPhase) ? dayPhase : 0;
    const terrain = planet?.terrain;
    const cfg     = DIURNAL_BY_TERRAIN[terrain] ?? DEFAULT_DIURNAL;
    const rain    = MathUtils.clamp(zone?.rainChance ?? 0, 0, 1);
    const damping = 1 - rain * 0.35;
    const atmo    = Atmosphere.diurnalFactor(planet?.atmosphere);
    const diurnal = Math.cos(2 * Math.PI * phase) * cfg.swingK * damping * atmo;
    return MathUtils.clamp(base + diurnal + heatBonus, TEMP_MIN, TEMP_MAX);
  }

  return { generate, baseTempK, currentTempK, ZONE_SIZE, FREEZE_THRESHOLD };
})();
