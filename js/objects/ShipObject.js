// Ship object definition: 2×2 tile footprint, glyphs, and landing-validation helpers.
// Assembled on-screen appearance (4 chars wide × 4 chars tall):
//   /^^\
//   /  \
//   \  /
//   \__/
const ShipObject = (() => {
  const FOOTPRINT = [
    { dx: 0, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 1, dy: 1 },
  ];

  const GLYPHS = {
    '0,0': { chars: ['/^', '/ '], color: '#aaaaaa' },
    '1,0': { chars: ['^\\', ' \\'], color: '#aaaaaa' },
    '0,1': { chars: ['\\ ', '\\_'], color: '#888888' },
    '1,1': { chars: [' /', '_/'], color: '#888888' },
  };

  const MAX_BATTERY    = 10000;
  const INIT_BATTERY   = 5000;
  const CARGO_MAX_SIZE = 600;

  function create(x, y) {
    return {
      id: 'ship-1',
      type: 'ship',
      x, y,
      passable: false,
      interactable: true,
      footprint: FOOTPRINT,
      glyphs: GLYPHS,
      lightRadius: 8,
      battery: INIT_BATTERY,
      maxBattery: MAX_BATTERY,
      power: { role: 'storage', range: 5, powered: true },
      cargo: { items: [], maxSize: CARGO_MAX_SIZE },
    };
  }

  // True if all 4 footprint tiles at (ax, ay) are clear of terrain and object
  // blockers, and at least one adjacent tile exists for the player to spawn on.
  function isValidAnchor(map, ax, ay, planetId) {
    for (const { dx, dy } of FOOTPRINT) {
      const tx = ((ax + dx) % map.w + map.w) % map.w;
      const ty = ((ay + dy) % map.h + map.h) % map.h;
      if (!MapGen.isPassable(map.grid[ty][tx])) return false;
      if (!ObjectManager.isPassableAt(planetId, tx, ty)) return false;
    }
    return findPlayerSpawn(map, ax, ay, planetId) !== null;
  }

  // Returns the first tile adjacent to (but outside) the 2×2 footprint that is
  // clear of both terrain and object blockers, or null if none exists.
  function findPlayerSpawn(map, ax, ay, planetId) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 2; dx++) {
        if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue;
        const tx = ((ax + dx) % map.w + map.w) % map.w;
        const ty = ((ay + dy) % map.h + map.h) % map.h;
        if (!MapGen.isPassable(map.grid[ty][tx])) continue;
        if (!ObjectManager.isPassableAt(planetId, tx, ty)) continue;
        return { x: tx, y: ty };
      }
    }
    return null;
  }

  return { create, isValidAnchor, findPlayerSpawn, FOOTPRINT };
})();
