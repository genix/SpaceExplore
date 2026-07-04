// Orchestrates the 7-stage procedural map generation pipeline.
// Returns { grid, w, h, waterType, climate } or null for gas giants.
const MapGen = (() => {
  function generate(width, height, planet, starLuminosity) {
    if (!planet.landable) return null;

    const elevation = Heightmap.generate(width, height, planet);
    if (!elevation) return null;

    // Craters modify the raw elevation first so every downstream stage (hydrology,
    // temperature, biome, vegetation) responds to the impact shape. The metadata is
    // attached to the planet for LandingScreen (ship avoidance) and object seeding.
    planet.craterMeta = CraterGen.modifyElevation(elevation, width, height, planet);

    // Rock formations stamp their spire fields and buttes into the post-crater
    // elevation, keeping clear of crater footprints, before the pipeline continues.
    planet.formationMeta = FormationGen.modifyElevation(elevation, width, height, planet);

    const { waterType } = Hydrology.generate(width, height, elevation, planet);

    const { tileTemp, tempZone, zoneW, zoneH, baseTempK } =
      Temperature.generate(width, height, elevation, planet, starLuminosity);

    const { moisture, rainChance, snowChance, windDir, windSpeed } =
      Moisture.generate(width, height, elevation, waterType, tempZone, zoneW, zoneH, planet);

    const biome = Biome.generate(
      width, height, elevation, waterType, tempZone, moisture, zoneW, zoneH, planet
    );

    const grid = Vegetation.place(width, height, elevation, waterType, biome, tileTemp, tempZone, zoneW, zoneH, planet);

    const climate = _assembleClimate(
      tempZone, rainChance, snowChance, windDir, windSpeed, zoneW, zoneH, baseTempK
    );

    const map = { grid, w: width, h: height, waterType, climate };
    _attachAccessor(map);
    return map;
  }

  function _assembleClimate(tempZone, rainChance, snowChance, windDir, windSpeed, zoneW, zoneH, baseTempK) {
    const zones = new Array(zoneW * zoneH);
    for (let i = 0; i < zones.length; i++) {
      zones[i] = {
        tempK:      tempZone   ? tempZone[i]   : 280,
        rainChance: rainChance ? rainChance[i] : 0.3,
        snowChance: snowChance ? snowChance[i] : 0,
        windDir:    { dx: windDir.dx, dy: windDir.dy },
        windSpeed,
      };
    }
    return {
      zoneSize:          { w: Temperature.ZONE_SIZE, h: Temperature.ZONE_SIZE },
      zoneCount:         { w: zoneW, h: zoneH },
      dominantWindDir:   { dx: windDir.dx, dy: windDir.dy },
      dominantWindSpeed: windSpeed,
      baseTempK,
      zones,
    };
  }

  function _getClimateZone(climate, tileX, tileY) {
    const zx = Math.max(0, Math.min(
      Math.floor(tileX / climate.zoneSize.w), climate.zoneCount.w - 1
    ));
    const zy = Math.max(0, Math.min(
      Math.floor(tileY / climate.zoneSize.h), climate.zoneCount.h - 1
    ));
    return climate.zones[zy * climate.zoneCount.w + zx];
  }

  function _attachAccessor(map) {
    if (map && map.climate) {
      map.climate.getClimateZone = (x, y) => _getClimateZone(map.climate, x, y);
    }
  }

  function reattachClimate(map) {
    _attachAccessor(map);
    return map;
  }

  function isPassable(tile) {
    return TileDefs.GROUND[tile.ground]?.passable ?? true;
  }

  return { generate, isPassable, reattachClimate };
})();
