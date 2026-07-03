// Per-turn host for placed beacons. Beacons have no power or extraction role, so
// they need their own tick to age. Each turn every intact beacon takes a tiny
// terrain-scaled wear; once worn out it stops functioning (can no longer recall
// the ship — see BeaconObject.recall). Broken beacons are skipped.
const BeaconSystem = (() => {
  const WEAR_PER_TICK = 0.05;
  let _teardown = null;

  function start() {
    _teardown = TurnManager.subscribe(_tick, 0);
  }

  function stop() {
    if (_teardown) { _teardown(); _teardown = null; }
  }

  function _tick() {
    if (!Datastore.has('currentPlanet')) return;
    const planetId = Datastore.get('currentPlanet')?.id;
    if (!planetId || !Datastore.has(`objects:${planetId}`)) return;

    const beacons = ObjectManager.all().filter(o => o.type === 'beacon' && !Degradation.isBroken(o));
    if (beacons.length === 0) return;

    const mult = Degradation.currentTerrainMultiplier();
    for (const b of beacons) {
      const update = Degradation.applyWear(b, WEAR_PER_TICK * mult);
      if (update) ObjectManager.update(b.id, update);
    }
  }

  return { start, stop };
})();
