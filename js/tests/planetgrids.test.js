// Suite E — in-RAM grid eviction (Phase 2). Guards PlanetPersistence §5: evicting a
// non-current grid and returning must regenerate a byte-identical grid while the kept
// objects/deposits stay intact, and the LRU must cap resident grids.
Test.suite('E — In-RAM eviction', () => {
  const LUM = 1.0;

  Test.beforeEach(() => { Datastore.clear(); PlanetGrids.reset(); });

  // E1 — Return after eviction: grid regenerates identical, kept objects/deposits survive.
  Test.test('E1 — evicted grid regenerates identical; kept objects/deposits align', () => {
    const p = makeTestPlanet('star_evict:p0');
    const map1 = PlanetGrids.ensureResident(p, LUM);
    const gridHash = hashGrid(map1);

    // Simulate the player mutating the resident (kept) object/deposit state.
    Datastore.withLock(`objects:${p.id}`, objs => objs.slice(1));   // salvage one natural away
    p.deposits[0].amount = 0;
    p.deposits[1].revealed = true;
    const objsHash = hashObjects(Datastore.get(`objects:${p.id}`));
    const depsHash = hashDeposits(p.deposits);

    // Evict the grid the way the LRU does, then return.
    Datastore.remove(`planetMap:${p.id}`);
    assert(!Datastore.has(`planetMap:${p.id}`), 'precondition: grid evicted');

    const map2 = PlanetGrids.ensureResident(p, LUM);
    assertEqual(hashGrid(map2), gridHash, 'regenerated grid differs from pre-eviction grid');
    assertEqual(hashObjects(Datastore.get(`objects:${p.id}`)), objsHash, 'kept objects changed across return');
    assertEqual(hashDeposits(p.deposits), depsHash, 'kept deposits changed across return');
  });

  // E2 — First visit builds objects/deposits; return does not rebuild or duplicate them.
  Test.test('E2 — return does not regenerate objects/deposits', () => {
    const p = makeTestPlanet('star_evict:p1');
    PlanetGrids.ensureResident(p, LUM);
    const objsRef = Datastore.get(`objects:${p.id}`);
    const depsRef = p.deposits;

    Datastore.remove(`planetMap:${p.id}`);
    PlanetGrids.ensureResident(p, LUM);

    assert(Datastore.get(`objects:${p.id}`) === objsRef, 'objects array was replaced on return');
    assert(p.deposits === depsRef, 'deposits array was replaced on return');
  });

  // E3 — The LRU caps resident grids, evicts the oldest, and never the current one.
  Test.test('E3 — LRU caps resident grids and protects the current planet', () => {
    const cap = PlanetGrids.MAX_RESIDENT;
    const planets = [];
    for (let i = 0; i <= cap; i++) {
      const p = makeTestPlanet(`star_lru:p${i}`);
      planets.push(p);
      PlanetGrids.ensureResident(p, LUM);
    }
    assert(!Datastore.has(`planetMap:${planets[0].id}`), 'oldest grid was not evicted past the cap');
    assert(Datastore.has(`planetMap:${planets[cap].id}`), 'current (newest) grid was evicted');
    assert(Datastore.has(`objects:${planets[0].id}`), 'evicted planet lost its resident objects');
  });

  // E4 — reset() drops tracked grids and clears the LRU (new-game cleanup).
  Test.test('E4 — reset drops resident grids', () => {
    const p = makeTestPlanet('star_reset:p0');
    PlanetGrids.ensureResident(p, LUM);
    assert(Datastore.has(`planetMap:${p.id}`), 'precondition: grid resident');
    PlanetGrids.reset();
    assert(!Datastore.has(`planetMap:${p.id}`), 'reset did not drop the grid');
  });
});
