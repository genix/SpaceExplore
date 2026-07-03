// Captures the small mutable difference between a planet's current (player-mutated)
// object/deposit state and a freshly regenerated pristine one, and reapplies it.
// Both functions rebuild pristine via PlanetGen.build (a pure function of the seed),
// so only the delta needs storing — the heavy grid/naturals regenerate on the way
// back. capture/apply are pure: no Datastore, no DOM. See PlanetPersistence.md §4.4.
const PlanetDelta = (() => {
  // JSON with functions dropped (e.g. a lava vent's colorFn) — those regenerate with
  // pristine and never belong in a stored delta. Used only for field comparison.
  function _stable(v) {
    return JSON.stringify(v, (_, x) => (typeof x === 'function' ? undefined : x));
  }

  // Fields of `cur` whose serialized value differs from `base`, ignoring id and any
  // function-valued field. Returns null when nothing serializable differs.
  function _fieldPatch(base, cur) {
    const patch = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(cur)])) {
      if (k === 'id') continue;
      if (typeof base[k] === 'function' || typeof cur[k] === 'function') continue;
      if (_stable(cur[k]) !== _stable(base[k])) patch[k] = cur[k];
    }
    return Object.keys(patch).length ? patch : null;
  }

  // Diffs the current object/deposit arrays against a pristine build, classifying
  // objects by id: placed (id not in pristine — ship, equipment, caches, scanned
  // deposit markers), removed (pristine id absent from current — salvaged naturals),
  // changed (a surviving pristine object with mutated fields). Deposits store only
  // amount/revealed for entries that differ from pristine.
  function capture(planet, luminosity, currentObjects, currentDeposits) {
    const pristine  = PlanetGen.build(planet, luminosity);
    const pristById = new Map(pristine.objects.map(o => [o.id, o]));

    const placed  = [];
    const changed = {};
    const seen    = new Set();
    for (const o of currentObjects) {
      seen.add(o.id);
      const base = pristById.get(o.id);
      if (!base) { placed.push(o); continue; }
      const patch = _fieldPatch(base, o);
      if (patch) changed[o.id] = patch;
    }
    const removed = pristine.objects.filter(o => !seen.has(o.id)).map(o => o.id);

    const deposits = {};
    const pristDep = new Map(pristine.deposits.map(d => [d.id, d]));
    for (const d of currentDeposits) {
      const base = pristDep.get(d.id);
      if (base && (d.amount !== base.amount || d.revealed !== base.revealed)) {
        deposits[d.id] = { amount: d.amount, revealed: d.revealed };
      }
    }

    return { id: planet.id, deposits, objects: { placed, removed, changed } };
  }

  // Rebuilds pristine, then reapplies a delta: drop removed naturals, patch changed
  // fields, append placed records, overlay deposit amount/revealed by id. The result
  // is indistinguishable from the planet the player left.
  function apply(planet, luminosity, delta) {
    const pristine = PlanetGen.build(planet, luminosity);
    const removed  = new Set(delta?.objects?.removed ?? []);
    const changed  = delta?.objects?.changed ?? {};

    const objects = pristine.objects
      .filter(o => !removed.has(o.id))
      .map(o => (changed[o.id] ? { ...o, ...changed[o.id] } : o));
    for (const placed of delta?.objects?.placed ?? []) objects.push(placed);

    const depDelta = delta?.deposits ?? {};
    const deposits = pristine.deposits.map(d =>
      depDelta[d.id] ? { ...d, ...depDelta[d.id] } : d
    );

    return { map: pristine.map, objects, deposits };
  }

  return { capture, apply };
})();
