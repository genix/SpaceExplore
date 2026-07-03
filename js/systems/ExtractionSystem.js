// Per-tick host for active extractors (drills, condensers). Runs after
// PowerSystem so `power.consumedThisTick` flags are already resolved. Drills
// pull from the linked deposit in planet.deposits; condensers convert ambient
// resource to buffer over BASE_TICKS at modifier-1.0 weather.
// Producers (geothermal taps, solar arrays) don't need a host — PowerSystem
// reads their rate directly each tick.
const ExtractionSystem = (() => {
  let _teardown = null;

  function start() {
    _teardown = TurnManager.subscribe(_tick, 0);
  }

  function stop() {
    if (_teardown) { _teardown(); _teardown = null; }
  }

  function _tick() {
    if (!Datastore.has('currentPlanet')) return;
    const planet   = Datastore.get('currentPlanet');
    const planetId = planet?.id;
    if (!planetId || !Datastore.has(`objects:${planetId}`)) return;

    const objs    = ObjectManager.all();
    const drills  = objs.filter(o => o.type === 'auto-drill'     && !o.exhausted);
    const conds   = objs.filter(o => o.type === 'atmo-condenser');
    if (drills.length === 0 && conds.length === 0) return;

    let depositsChanged = false;
    const deposits      = planet.deposits ? [...planet.deposits] : [];
    const depBy         = new Map(deposits.map(d => [d.id, d]));
    const wearMult      = Degradation.currentTerrainMultiplier();
    const grit          = DustDevilSystem.getGritOverlay();
    const gritFor       = o => wearMult * (grit.get(`${o.x},${o.y}`) ?? 1);

    for (const drill of drills) {
      if (Degradation.isBroken(drill)) continue;
      if (!drill.power?.consumedThisTick) continue;
      if (drill.buffer >= drill.bufferMax) continue;
      const dep = depBy.get(drill.depositId);
      if (!dep || dep.amount <= 0) {
        ObjectManager.update(drill.id, { exhausted: true });
        continue;
      }
      const newAcc = (drill.tickAccumulator ?? 0) + Degradation.outputFactor(drill);
      if (newAcc >= AutoDrillObject.DRILL_TICKS) {
        dep.amount -= 1;
        depositsChanged = true;
        const updates = { buffer: drill.buffer + 1, tickAccumulator: newAcc - AutoDrillObject.DRILL_TICKS };
        Object.assign(updates, Degradation.applyWear(drill, gritFor(drill)) ?? {});
        if (dep.amount <= 0) updates.exhausted = true;
        ObjectManager.update(drill.id, updates);
      } else {
        ObjectManager.update(drill.id, { tickAccumulator: newAcc });
      }
    }

    for (const cond of conds) {
      if (Degradation.isBroken(cond)) continue;
      if (!cond.power?.consumedThisTick) continue;
      if (cond.buffer >= cond.bufferMax) continue;
      if (!cond.resource) continue;
      const mod = _weatherModifier(cond.resource) * Degradation.outputFactor(cond);
      const newAcc = (cond.tickAccumulator ?? 0) + mod;
      if (newAcc >= AtmoCondenserObject.BASE_TICKS) {
        const updates = {
          buffer: cond.buffer + 1,
          tickAccumulator: newAcc - AtmoCondenserObject.BASE_TICKS,
        };
        Object.assign(updates, Degradation.applyWear(cond, gritFor(cond)) ?? {});
        ObjectManager.update(cond.id, updates);
      } else {
        ObjectManager.update(cond.id, { tickAccumulator: newAcc });
      }
    }

    if (depositsChanged) {
      Datastore.withLock('currentPlanet', p => ({ ...p, deposits }));
    }
  }

  // Returns a per-tick multiplier driven by active weather. Rain doubles water
  // output; dust/sandstorm halve all output; ion storm zeroes it; otherwise 1.0.
  function _weatherModifier(resource) {
    const events = Datastore.has('weatherEvents') ? Datastore.get('weatherEvents') : [];
    let mod = 1;
    for (const e of events) {
      if (!e) continue;
      if (e.type === 'electrical') return 0;
      if ((e.type === 'rain' || e.type === 'heavy_rain') && resource === 'water') mod *= 2;
      if (e.type === 'dust_storm' || e.type === 'sandstorm') mod *= 0.5;
    }
    return mod;
  }

  return { start, stop };
})();
