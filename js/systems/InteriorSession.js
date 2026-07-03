// Interior-visit coordinator, analogous to PlanetSession but for an enclosed space.
// Mounts the interior MapView + fixture layer over the interior's own Datastore keys
// (interiorMap / interiorPos / interiorId) so the planet-surface keys are untouched.
// Owns the fixture list and the passability/interaction queries InteriorView needs.
//
// First-pass note: entering an interior currently runs through the standard
// PlanetSession.stop()/start() screen lifecycle (PlanetView.hide/show), so the
// planet simulation pauses while inside rather than continuing in the background.
// The file split here matches design/InteriorView.md so the concurrent-simulation
// enterInterior()/exitInterior() variant can be layered in later without churn.
const InteriorSession = (() => {
  const ID = 'ship-interior';

  let _map     = null;
  let _objects = [];
  let _index   = new Map();   // "x,y" -> fixture covering that tile
  let _blocked = new Set();   // "x,y" of impassable fixture tiles

  function start({ mapContainer }) {
    const spec = ShipInteriorMap.build();
    _map     = { grid: spec.grid, w: spec.w, h: spec.h, wrap: false };
    _objects = spec.fixtures.map(f => ShipInteriorObjects.create(f.type, f.x, f.y));
    _buildIndex();

    _put('interiorId',  ID,         DatastoreTypes.UI_STATE);
    _put('interiorMap', _map,       DatastoreTypes.GAME_MAP);
    _put('interiorPos', spec.spawn, DatastoreTypes.PLAYER);

    MapView.init(mapContainer, InteriorRenderer, { map: 'interiorMap', pos: 'interiorPos', phase: null, frame: 'bracket' });
    MapView.addLayer(InteriorObjectLayer);
    MapView.refresh();
  }

  function stop() {
    MapView.destroy();   // unsubscribes from interior keys before they're removed
    _objects = [];
    _index.clear();
    _blocked.clear();
    _map = null;
    if (Datastore.has('interiorPos')) Datastore.remove('interiorPos');
    if (Datastore.has('interiorMap')) Datastore.remove('interiorMap');
    if (Datastore.has('interiorId'))  Datastore.remove('interiorId');
  }

  function _buildIndex() {
    _index.clear();
    _blocked.clear();
    for (const obj of _objects) {
      for (const { dx, dy } of obj.footprint) {
        const key = `${obj.x + dx},${obj.y + dy}`;
        _index.set(key, obj);
        if (!obj.passable) _blocked.add(key);
      }
    }
  }

  function _put(key, value, type) {
    if (Datastore.has(key)) Datastore.withLock(key, () => value);
    else Datastore.init(key, value, type);
  }

  function getObjects() { return _objects; }
  function getMap()     { return _map; }

  function isPassable(x, y) {
    if (!_map) return false;
    if (x < 0 || y < 0 || x >= _map.w || y >= _map.h) return false;
    if (!InteriorTileDefs.isPassable(_map.grid[y][x])) return false;
    return !_blocked.has(`${x},${y}`);
  }

  // The interactable fixture on the player's own tile or any of the 8 neighbours.
  function interactableNear(pos) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const obj = _index.get(`${pos.x + dx},${pos.y + dy}`);
        if (obj && obj.interactable) return obj;
      }
    }
    return null;
  }

  return { ID, start, stop, getObjects, getMap, isPassable, interactableNear };
})();
