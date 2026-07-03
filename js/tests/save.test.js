// Suite C — save snapshot/restore round-trip (Phase 4). Guards LoadAndSave §4.5 and
// PlanetPersistence §4.5: a Strategy-B save stores galaxy + player/cycle keys + one
// per-planet delta (never the grid), and restore regenerates the world, reapplies the
// delta, and re-links the alias keys by reference. Exercises the real JSON boundary.
Test.suite('C — Save round-trip', () => {
  Test.beforeEach(() => { Datastore.clear(); PlanetGrids.reset(); });

  const _wire = save => JSON.parse(JSON.stringify(save));

  // Builds a minimal live game the way the screens would — galaxy, a landed current
  // planet with a resident grid, and the player/cycle/economy keys — so snapshot()
  // sees the actual runtime key set.
  function setupWorld() {
    const galaxy = Galaxy.generate();
    const system = galaxy.systems.find(s => s.id === galaxy.startSystemId);
    const planet = system.planets.find(p => p.landable);
    const lum    = system.star.luminosity;

    Datastore.init('galaxy', galaxy, DatastoreTypes.GALAXY);
    Datastore.init('currentSolarSystem', system, DatastoreTypes.SOLAR_SYSTEM);
    Datastore.init('currentPlanet', planet, DatastoreTypes.PLANET);

    const map = PlanetGrids.ensureResident(planet, lum); // inits planetMap:/objects:/planet.deposits
    Datastore.init('planetMap', map, DatastoreTypes.GAME_MAP);

    Datastore.init('playerPos', { x: 10, y: 12 }, DatastoreTypes.PLAYER);
    Datastore.init('playerSuit', { battery: 800, maxBattery: 1000, modules: ['scanner-module'] }, DatastoreTypes.PLAYER);
    Datastore.init('playerInventory', { maxSize: 50, items: [{ id: 'carbon', qty: 3 }] }, DatastoreTypes.PLAYER);
    Datastore.init('stardate', 42, DatastoreTypes.STARDATE);
    Datastore.init('aetherium', 7, DatastoreTypes.AETHERIUM);
    Datastore.init('dayTurn', 3, DatastoreTypes.CYCLE);
    Datastore.init('dayPhase', 1, DatastoreTypes.CYCLE);
    Datastore.init('currentDay', 2, DatastoreTypes.CYCLE);
    Datastore.init('weatherEvent', null, DatastoreTypes.WEATHER_EVENT);
    Datastore.init('weatherEvents', [], DatastoreTypes.WEATHER_EVENT);

    return { galaxy, system, planet, lum, map };
  }

  // Mutates the resident state like a play session: land a ship, place a drill,
  // salvage a boulder, deplete/reveal deposits. Returns the touched ids.
  function mutate(planet) {
    const objKey  = `objects:${planet.id}`;
    const boulder = Datastore.get(objKey).find(o => o.type && o.type.startsWith('boulder'));
    const ship    = ShipObject.create(8, 8);
    const drill   = AutoDrillObject.create('auto-drill-c', 9, 9);

    Datastore.withLock(objKey, objs =>
      [...objs.filter(o => !boulder || o.id !== boulder.id), ship, drill]);

    if (planet.deposits.length)     planet.deposits[0].amount   = 0;
    if (planet.deposits.length > 1) planet.deposits[1].revealed = !planet.deposits[1].revealed;

    return { removedId: boulder ? boulder.id : null, placedIds: [ship.id, drill.id] };
  }

  // C1 — objects, deposits, and the regenerated grid all come back identical.
  Test.test('C1 — restore reproduces objects, deposits, and grid', () => {
    const { planet, map } = setupWorld();
    const { removedId, placedIds } = mutate(planet);

    const objKey   = `objects:${planet.id}`;
    const objHash  = hashObjects(Datastore.get(objKey));
    const depHash  = hashDeposits(planet.deposits);
    const gridHash = hashGrid(map);

    Save.restore(_wire(Save.snapshot()));

    assertEqual(hashObjects(Datastore.get(objKey)), objHash, 'objects differ after restore');
    assertEqual(hashDeposits(Datastore.get('currentPlanet').deposits), depHash, 'deposits differ after restore');
    assertEqual(hashGrid(Datastore.get('planetMap')), gridHash, 'regenerated grid differs from the one saved');
    if (removedId) assert(!Datastore.get(objKey).some(o => o.id === removedId), 'salvaged boulder returned');
    for (const id of placedIds) assert(Datastore.get(objKey).some(o => o.id === id), `placed ${id} missing after restore`);
  });

  // C2 — the alias keys are re-linked to the SAME objects inside the restored galaxy,
  // not independent copies (LoadAndSave §3.2).
  Test.test('C2 — aliases re-link by reference into the restored galaxy', () => {
    const { planet, system } = setupWorld();
    mutate(planet);

    Save.restore(_wire(Save.snapshot()));

    const galaxy = Datastore.get('galaxy');
    const sysRef = galaxy.systems.find(s => s.id === system.id);
    const pRef   = sysRef.planets.find(p => p.id === planet.id);
    assert(Datastore.get('currentSolarSystem') === sysRef, 'currentSolarSystem is not the nested galaxy system');
    assert(Datastore.get('currentPlanet') === pRef, 'currentPlanet is not the nested galaxy planet');
    assert(Datastore.get('planetMap') === Datastore.get(`planetMap:${planet.id}`), 'planetMap alias not linked to the resident grid');
  });

  // C3 — the file omits the heavy grid/objects blobs but keeps the delta + metadata,
  // and strips regenerable fields from the stored galaxy.
  Test.test('C3 — save omits grids, keeps deltas + metadata', () => {
    const { planet } = setupWorld();
    mutate(planet);
    const snap = Save.snapshot();

    const keys = snap.entries.map(e => e.key);
    assert(!keys.some(k => k.startsWith('planetMap')), 'grids must not be stored');
    assert(!keys.some(k => k.startsWith('objects:')), 'raw object arrays must not be stored');
    assert(keys.includes('galaxy'), 'galaxy metadata must be stored');
    assert(keys.includes('playerSuit') && keys.includes('playerInventory'), 'player keys must be stored');
    assert(snap.planets.some(p => p.id === planet.id), 'per-planet delta missing');

    const gEntry = snap.entries.find(e => e.key === 'galaxy');
    const storedPlanet = gEntry.value.systems.flatMap(s => s.planets).find(p => p.id === planet.id);
    assert(!('deposits' in storedPlanet), 'deposits should be stripped from the stored galaxy (they regenerate)');
    assert(!('craterMeta' in storedPlanet), 'craterMeta should be stripped from the stored galaxy');
  });

  // C4 — player, cycle, and economy scalars round-trip untouched.
  Test.test('C4 — player, cycle, and economy keys survive', () => {
    const { planet } = setupWorld();
    mutate(planet);
    Save.restore(_wire(Save.snapshot()));

    assertEqual(Datastore.get('stardate'), 42, 'stardate lost');
    assertEqual(Datastore.get('aetherium'), 7, 'aetherium lost');
    assertEqual(Datastore.get('dayTurn'), 3, 'dayTurn lost');
    assertEqual(Datastore.get('playerSuit').battery, 800, 'suit battery lost');
    assertDeepEqual(Datastore.get('playerInventory').items, [{ id: 'carbon', qty: 3 }], 'inventory lost');
    assertDeepEqual(Datastore.get('playerPos'), { x: 10, y: 12 }, 'playerPos lost');
  });

  // C5 — a bad header is refused before the live store is cleared (LoadAndSave §3.7).
  Test.test('C5 — restore rejects bad headers without wiping the store', () => {
    setupWorld();
    const good = Save.snapshot();
    assertThrows(() => Save.restore(null),                          'null save should throw');
    assertThrows(() => Save.restore({ ...good, magic: 'NOPE' }),    'bad magic should throw');
    assertThrows(() => Save.restore({ ...good, version: 999 }),     'bad version should throw');
    assertThrows(() => Save.restore({ ...good, worldgenVersion: 999 }), 'bad worldgenVersion should throw');
    assert(Datastore.has('galaxy'), 'store should be intact after a rejected restore');
  });
});
