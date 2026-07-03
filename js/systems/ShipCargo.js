// Read/write helpers for the ship's cargo hold. The cargo lives on the ship
// object record (objects:<planetId>) so it persists across PlanetView visits.
// The ship is resolved straight from the Datastore rather than via ObjectManager
// so cargo stays reachable while inside the ship interior, where ObjectManager is
// unmounted (the interior fixtures — Cargo Hold / Salvage / Fabricate — depend on
// this). On the surface this writes the same `objects:<planetId>` key ObjectManager
// subscribes to, so its spatial index still refreshes.
const ShipCargo = (() => {
  function _objectsKey() {
    if (!Datastore.has('currentPlanet')) return null;
    return `objects:${Datastore.get('currentPlanet').id}`;
  }

  function _findShip() {
    const key = _objectsKey();
    if (!key || !Datastore.has(key)) return null;
    return Datastore.get(key).find(o => o.type === 'ship') ?? null;
  }

  function _writeCargo(ship, cargo) {
    const key = _objectsKey();
    if (!key || !Datastore.has(key)) return;
    Datastore.withLock(key, objs => objs.map(o => o.id === ship.id ? { ...o, cargo } : o));
  }

  const _store = ContainerStore.fromObjectField('SHIP', _findShip, 'cargo', _writeCargo);

  return {
    getMaxSize: _store.getMaxSize,
    getUsedSize: _store.getUsedSize,
    getRemainingSize: _store.getRemainingSize,
    canAdd: _store.canAdd,
    add: _store.add,
    remove: _store.remove,
    removeByUid: _store.removeByUid,
    getByUid: _store.getByUid,
    getItems: _store.getItems,
  };
})();
