// Bounds resident terrain grids to cap RAM. A planet's grid (planetMap:${id}) is the
// only large per-world structure — its objects/deposits are small and stay resident.
// ensureResident() makes a grid resident (full-building on first visit, or regenerating
// only the grid from seed on return after eviction), then evicts the least-recently-used
// grids beyond MAX_RESIDENT — never the current planet's. Relies on deterministic
// worldgen: a regenerated grid is byte-identical, so the kept objects/deposits still
// line up by coordinate. See PlanetPersistence.md §5.
const PlanetGrids = (() => {
  const MAX_RESIDENT = 3;   // resident grids kept (LRU). Open question 1: 1 vs a small window.
  const _order = [];        // planet ids, least-recently-used first

  // Ensures planetMap:${planet.id} is resident and returns the map. Objects/deposits are
  // created on first visit and left untouched on every return.
  function ensureResident(planet, luminosity) {
    const mapKey = `planetMap:${planet.id}`;
    const objKey = `objects:${planet.id}`;
    let map;

    if (Datastore.has(mapKey)) {
      map = Datastore.get(mapKey);
    } else if (Datastore.has(objKey)) {
      // Return after eviction: rebuild the grid only; the mutated objects/deposits we
      // kept resident already reference matching coordinates. Discard the rebuild's.
      map = PlanetGen.build(planet, luminosity).map;
      Datastore.init(mapKey, map, DatastoreTypes.GAME_MAP);
    } else {
      // First visit: persist the grid, objects, and deposits.
      const built = PlanetGen.build(planet, luminosity);
      map = built.map;
      Datastore.init(mapKey, map, DatastoreTypes.GAME_MAP);
      Datastore.init(objKey, built.objects, DatastoreTypes.OBJECT);
      planet.deposits = built.deposits;
    }

    _touch(planet.id);
    _evictExcept(planet.id);
    return map;
  }

  function _touch(id) {
    const i = _order.indexOf(id);
    if (i !== -1) _order.splice(i, 1);
    _order.push(id);
  }

  // Drops least-recently-used grids beyond the cap, never the protected (current) one.
  function _evictExcept(keepId) {
    while (_order.length > MAX_RESIDENT) {
      const victim = _order.find(id => id !== keepId);
      if (victim === undefined) break;
      _order.splice(_order.indexOf(victim), 1);
      _drop(victim);
    }
  }

  function _drop(id) {
    const key = `planetMap:${id}`;
    if (Datastore.has(key)) Datastore.remove(key);
  }

  // New-game cleanup: drop every tracked grid and clear the LRU.
  function reset() {
    for (const id of _order) _drop(id);
    _order.length = 0;
  }

  return { ensureResident, reset, MAX_RESIDENT };
})();
