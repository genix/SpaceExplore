// Shared test fixtures and fingerprints. Big structures (grids, object arrays) are
// compared by FNV-1a hash rather than deep-equal so failures stay fast and readable.

// Deterministic planet with a fixed, globally-unique id and no Math.random in setup.
// Call sites pass a fixed luminosity (e.g. 1.0) so PlanetGen.build(planet, 1.0) is
// fully determined by the planet.
function makeTestPlanet(id = 'star_test:p0', terrain = 'temperate') {
  const metals = ResourceMaterials.buildPlanetProfile(id, terrain, true);
  return Planet.create(id, 'Testworld', terrain, /*landable*/true,
    ['carbon', 'water'], /*dayLength*/24, /*distanceAU*/1.0, /*orbit*/365,
    /*base*/15, /*min*/-10, /*max*/35, metals, /*atmosphere*/0.8);
}

function _fnvFold(h, s) {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Functions (e.g. a lava vent's animated colorFn) don't survive JSON and aren't part
// of the deterministic payload, so drop them before folding.
function _stableJson(o) {
  return JSON.stringify(o, (_, v) => (typeof v === 'function' ? undefined : v));
}

// Fingerprint of the tile grid: w, h, and per-tile ground/vegetation/elevation/water.
function hashGrid(map) {
  let h = _fnvFold(0x811c9dc5, map.w + 'x' + map.h + '|');
  for (let y = 0; y < map.h; y++) {
    const row = map.grid[y];
    for (let x = 0; x < map.w; x++) {
      const t = row[x];
      const water = map.waterType[y * map.w + x];
      h = _fnvFold(h, `${t.ground},${t.vegetation},${Math.round((t.elevation || 0) * 1e5)},${water};`);
    }
  }
  return h >>> 0;
}

// Fingerprint of an object array: sorted by id, folds each record's JSON (functions dropped).
function hashObjects(objs) {
  let h = 0x811c9dc5;
  for (const o of [...objs].sort(_byId)) h = _fnvFold(h, _stableJson(o) + '\n');
  return h >>> 0;
}

// Fingerprint of a deposit array: sorted by id, folds id/x/y/resource/amount/revealed.
function hashDeposits(deps) {
  let h = 0x811c9dc5;
  for (const d of [...deps].sort(_byId)) {
    h = _fnvFold(h, `${d.id}|${d.x},${d.y}|${d.resource}|${d.amount}|${d.revealed}\n`);
  }
  return h >>> 0;
}

function _byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
