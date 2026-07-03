// Places lava vent objects on passable land tiles.
// Adjacent vegetation is cleared. Total vents per planet are capped at MAX_VENTS.
const LavaVentGen = (() => {
  const BASE_RATE = { scorched: 0.0015, arid: 0.0006, temperate: 0.0004, tundra: 0.0003, frozen: 0.0001 };
  const MAX_VENTS = 30;

  const DIRS8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

  function place(map, planet) {
    const seed      = (NoiseGen.seedFrom(planet.id) ^ 0xF1A3) >>> 0;
    const rng       = NoiseGen.mulberry32(seed);
    const baseRate  = BASE_RATE[planet.terrain] ?? 0.0004;
    const planetMult = 0.3 + rng() * 0.7;
    const rate      = baseRate * planetMult;

    const objects = [];
    let   idx     = 0;

    for (let y = 0; y < map.h && objects.length < MAX_VENTS; y++) {
      for (let x = 0; x < map.w && objects.length < MAX_VENTS; x++) {
        if (!MapGen.isPassable(map.grid[y][x])) continue;
        if (rng() >= rate) continue;
        _clearAdjacentVegetation(map, x, y);
        objects.push(LavaVentObject.create(`lv-${planet.id}-${idx++}`, x, y));
      }
    }

    return objects;
  }

  function _clearAdjacentVegetation(map, x, y) {
    for (const [dx, dy] of DIRS8) {
      const nx = ((x + dx) % map.w + map.w) % map.w;
      const ny = ((y + dy) % map.h + map.h) % map.h;
      map.grid[ny][nx].vegetation = 'none';
    }
  }

  return { place };
})();
