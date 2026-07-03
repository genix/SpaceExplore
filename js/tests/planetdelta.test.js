// Suite B — planet-delta preserve & reapply (Phase 3). Guards PlanetPersistence §4.4:
// capture() diffs a mutated planet against a pristine build; apply() rebuilds pristine
// and reapplies the delta so the result is indistinguishable from the state left behind.
// Pure functions — no Datastore, no DOM.
Test.suite('B — Planet delta', () => {
  const LUM = 1.0;
  const _clone = a => JSON.parse(JSON.stringify(a));

  // Mutates a JSON-clone of a pristine build the way a play session would: deplete one
  // deposit, flip another's revealed flag, place a drill and a parts cache, salvage a
  // boulder away. Returns the mutated arrays plus the touched ids for assertions.
  function mutate(pristine) {
    const objects  = _clone(pristine.objects);
    const deposits = _clone(pristine.deposits);

    const boulder   = objects.find(o => o.type.startsWith('boulder'));
    const removedId = boulder.id;
    const drill = AutoDrillObject.create('auto-drill-test', boulder.x, boulder.y);
    const cache = PartsCacheObject.create('parts-cache-test', boulder.x, boulder.y, []);

    objects.splice(objects.findIndex(o => o.id === removedId), 1);
    objects.push(drill, cache);
    deposits[0].amount   = 0;
    deposits[1].revealed = !deposits[1].revealed;

    return { objects, deposits, removedId, placedIds: [drill.id, cache.id] };
  }

  // B1 — capture then apply reproduces the mutated state exactly.
  Test.test('B1 — round-trip equals the mutated state', () => {
    const p = makeTestPlanet('star_delta:p1');
    const pristine = PlanetGen.build(p, LUM);
    const { objects, deposits, removedId, placedIds } = mutate(pristine);

    const delta   = PlanetDelta.capture(p, LUM, objects, deposits);
    const rebuilt = PlanetDelta.apply(p, LUM, delta);

    assertEqual(hashObjects(rebuilt.objects), hashObjects(objects), 'objects differ after round-trip');
    assertEqual(hashDeposits(rebuilt.deposits), hashDeposits(deposits), 'deposits differ after round-trip');
    assert(!rebuilt.objects.some(o => o.id === removedId), 'salvaged boulder reappeared');
    for (const id of placedIds) assert(rebuilt.objects.some(o => o.id === id), `placed object ${id} missing`);
  });

  // B2 — no mutations yields an empty delta; mutations touch only their own ids.
  Test.test('B2 — delta is minimal', () => {
    const p = makeTestPlanet('star_delta:p2');
    const pristine = PlanetGen.build(p, LUM);

    const empty = PlanetDelta.capture(p, LUM, _clone(pristine.objects), _clone(pristine.deposits));
    assertEqual(empty.objects.placed.length, 0, 'placed should be empty');
    assertEqual(empty.objects.removed.length, 0, 'removed should be empty');
    assertEqual(Object.keys(empty.objects.changed).length, 0, 'changed should be empty');
    assertEqual(Object.keys(empty.deposits).length, 0, 'deposit deltas should be empty');

    const boulder = pristine.objects.find(o => o.type.startsWith('boulder'));
    const objects = _clone(pristine.objects).filter(o => o.id !== boulder.id);
    const drill   = AutoDrillObject.create('auto-drill-test', boulder.x, boulder.y);
    objects.push(drill);

    const delta = PlanetDelta.capture(p, LUM, objects, _clone(pristine.deposits));
    assertDeepEqual(delta.objects.placed.map(o => o.id), [drill.id], 'placed must be exactly the drill');
    assertDeepEqual(delta.objects.removed, [boulder.id], 'removed must be exactly the boulder');
    assertEqual(Object.keys(delta.objects.changed).length, 0, 'no natural should be flagged changed');
  });

  // B3 — the delta survives the real save-file boundary (JSON round-trip).
  Test.test('B3 — survives serialization', () => {
    const p = makeTestPlanet('star_delta:p3');
    const pristine = PlanetGen.build(p, LUM);
    const { objects, deposits } = mutate(pristine);

    const delta   = JSON.parse(JSON.stringify(PlanetDelta.capture(p, LUM, objects, deposits)));
    const rebuilt = PlanetDelta.apply(p, LUM, delta);

    assertEqual(hashObjects(rebuilt.objects), hashObjects(objects), 'objects differ after JSON round-trip');
    assertEqual(hashDeposits(rebuilt.deposits), hashDeposits(deposits), 'deposits differ after JSON round-trip');
  });

  // B4 — a scanned deposit marker (id = deposit id, not in pristine objects) is captured
  // as placed, and reapplying leaves the regenerated pristine naturals untouched.
  Test.test('B4 — placed vs. regenerated classification', () => {
    const p = makeTestPlanet('star_delta:p4');
    const pristine = PlanetGen.build(p, LUM);

    const dep = pristine.deposits.find(d => !d.revealed);
    assert(dep, 'expected a hidden deposit to reveal');
    assert(!pristine.objects.some(o => o.id === dep.id), 'hidden deposit id must not be a pristine object');

    const objects  = [...pristine.objects, DepositObject.create(dep.id, dep.x, dep.y, dep.resource)];
    const deposits = pristine.deposits.map(d => d.id === dep.id ? { ...d, revealed: true } : d);

    const delta = PlanetDelta.capture(p, LUM, objects, deposits);
    assert(delta.objects.placed.some(o => o.id === dep.id), 'deposit marker not classified as placed');
    assertEqual(delta.objects.removed.length, 0, 'nothing should be removed');
    assertEqual(delta.deposits[dep.id]?.revealed, true, 'revealed flag not captured');

    const rebuilt = PlanetDelta.apply(p, LUM, delta);
    assert(rebuilt.objects.some(o => o.id === dep.id), 'deposit marker missing after apply');
    assertEqual(rebuilt.objects.length, pristine.objects.length + 1, 'pristine naturals were disturbed');
    assertEqual(rebuilt.deposits.find(d => d.id === dep.id).revealed, true, 'revealed not applied');
  });
});
