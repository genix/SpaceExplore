// Per-turn power graph resolver. Power-aware objects carry a `power` field with role,
// range, and rate. Conduits and the storage node (ship) extend connectivity; producers
// and consumers connect to the graph but do not relay through it. Each tick: rebuild
// the graph, BFS from the ship, push producer output into the ship battery, then drain
// consumers in deterministic order. Runs before SuitSystem via TurnManager priority.
const PowerSystem = (() => {
  const RELAY_WEAR_PER_TICK = 0.1;
  let _teardown = null;

  function start() {
    _teardown = TurnManager.subscribe(_onTick, 1);
    _resolve(false);
  }

  function stop() {
    if (_teardown) { _teardown(); _teardown = null; }
  }

  function _onTick() { _resolve(true); }

  // Public re-resolve entry point for callers that mutate the objects array
  // outside of TurnManager.tick (e.g. inventory drop / pickup). Re-resolves the
  // power flags without advancing wear, so it stays idempotent.
  function resolve() {
    _resolve(false);
  }

  function _resolve(applyWear) {
    if (!Datastore.has('planetMap')) return;
    if (!Datastore.has('currentPlanet')) return;
    const planet   = Datastore.get('currentPlanet');
    const planetId = planet?.id;
    if (!planetId || !Datastore.has(`objects:${planetId}`)) return;

    const map = Datastore.get('planetMap');

    Datastore.withLock(`objects:${planetId}`, objs => {
      const ledger = _buildLedger(objs, map);
      const nodes = ledger.nodes;
      if (nodes.length === 0) return objs;

      const wear = applyWear ? _wearMap(ledger, planet) : null;

      return objs.map(obj => {
        if (obj.power?.role === 'storage') {
          return { ...obj, battery: ledger.shipBatteryAfter, power: { ...obj.power, powered: true } };
        }
        if (obj.power) {
          const powered  = ledger.connected.has(obj.id);
          const consumed = ledger.consumedSet.has(obj.id);
          const next = { ...obj, power: { ...obj.power, powered, consumedThisTick: consumed } };
          const w = wear ? wear.get(obj.id) : null;
          if (w) Object.assign(next, w);
          return next;
        }
        return obj;
      });
    });
  }

  // objectId -> durability update for this tick. Producers wear per unit of
  // power actually delivered; connected relays take a small flat wear while the
  // graph is delivering. Consumers wear in ExtractionSystem (per unit produced).
  function _wearMap(ledger, planet) {
    const mult = Degradation.terrainMultiplier(planet?.terrain);
    const wear = new Map();
    for (const p of ledger.producers) {
      if (!(p.delivered > 0)) continue;
      const u = Degradation.applyWear(p.node, p.delivered * mult);
      if (u) wear.set(p.node.id, u);
    }
    if (ledger.producerTotal > 0) {
      for (const n of ledger.nodes) {
        if (n.power.role !== 'conduit' || !ledger.connected.has(n.id)) continue;
        const u = Degradation.applyWear(n, RELAY_WEAR_PER_TICK * mult);
        if (u) wear.set(n.id, u);
      }
    }
    return wear;
  }

  function _buildLedger(objs, map) {
    const nodes = objs.filter(o => o.power);
    const edges = new Map();
    nodes.forEach(n => edges.set(n.id, []));
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (!_canConnect(a, b)) continue;
        if (_chebyshevWrapped(a, b, map) > Math.max(a.power.range, b.power.range)) continue;
        edges.get(a.id).push(b.id);
        edges.get(b.id).push(a.id);
      }
    }

    const shipNode = nodes.find(n => n.power.role === 'storage');
    const connected = new Set();
    if (shipNode) {
      const queue = [shipNode.id];
      connected.add(shipNode.id);
      while (queue.length) {
        const cur = queue.shift();
        for (const next of edges.get(cur)) {
          if (!connected.has(next)) { connected.add(next); queue.push(next); }
        }
      }
    }

    let shipBattery = shipNode ? shipNode.battery : 0;
    const maxBattery = shipNode ? shipNode.maxBattery : 0;
    const producers = nodes
      .filter(n => n.power.role === 'producer' && connected.has(n.id))
      .map(n => ({ node: n, rate: _producerRate(n) }));
    let producerTotal = 0;
    for (const p of producers) {
      const before = shipBattery;
      shipBattery = Math.min(maxBattery, shipBattery + p.rate);
      p.delivered = shipBattery - before;
      producerTotal += p.delivered;
    }

    const consumers = nodes
      .filter(n => n.power.role === 'consumer' && connected.has(n.id) && !Degradation.isBroken(n))
      .sort((a, b) => a.id.localeCompare(b.id));
    const consumedSet = new Set();
    let consumerDemand = 0;
    let consumerServed = 0;
    for (const c of consumers) {
      consumerDemand += c.power.rate;
      if (shipBattery >= c.power.rate) {
        shipBattery -= c.power.rate;
        consumerServed += c.power.rate;
        consumedSet.add(c.id);
      }
    }

    return {
      nodes,
      shipNode,
      connected,
      consumedSet,
      producers,
      consumers,
      producerTotal,
      consumerDemand,
      consumerServed,
      shipBatteryAfter: shipBattery,
    };
  }

  function _canConnect(a, b) {
    return _isExtending(a.power.role) || _isExtending(b.power.role);
  }

  function _isExtending(role) {
    return role === 'conduit' || role === 'storage';
  }

  function _chebyshevWrapped(a, b, map) {
    let ddx = Math.abs(a.x - b.x);
    let ddy = Math.abs(a.y - b.y);
    if (ddx > map.w / 2) ddx = map.w - ddx;
    if (ddy > map.h / 2) ddy = map.h - ddy;
    return Math.max(ddx, ddy);
  }

  // Solar arrays scale with day-cycle sunlight and the parent star's luminosity;
  // geothermal taps produce a constant rate.
  function _producerRate(p) {
    let rate = p.power.rate;
    if (p.type === 'solar-array') {
      const phase      = Datastore.has('dayPhase')           ? Datastore.get('dayPhase')           : 0;
      const sunlight   = Math.max(0, Math.cos(2 * Math.PI * phase));
      const luminosity = Datastore.has('currentSolarSystem') ? Datastore.get('currentSolarSystem').star.luminosity : 1;
      rate = p.power.rate * sunlight * luminosity;
    }
    return rate * Degradation.outputFactor(p);
  }

  // True if equipment placed at world tile (x,y) would connect to the ship's
  // power grid — i.e. the tile sits within reach of a connected extender (the
  // ship or a powered relay). `range` is the placed item's own connection range;
  // effective reach is max(item range, extender range), matching the edge rule
  // in _buildLedger. This is purely a connectivity check (independent of whether
  // any producer is currently generating), so the player can decide where a new
  // piece of equipment can be wired in.
  function coverageAt(x, y, range = 0) {
    if (!Datastore.has('planetMap') || !Datastore.has('currentPlanet')) return false;
    const planet = Datastore.get('currentPlanet');
    if (!Datastore.has(`objects:${planet.id}`)) return false;
    const map = Datastore.get('planetMap');
    const ledger = _buildLedger(ObjectManager.all(), map);
    const point = { x, y };
    for (const n of ledger.nodes) {
      if (!_isExtending(n.power.role)) continue;
      if (!ledger.connected.has(n.id)) continue;
      if (_chebyshevWrapped(point, n, map) <= Math.max(range, n.power.range)) return true;
    }
    return false;
  }

  function status() {
    if (!Datastore.has('planetMap') || !Datastore.has('currentPlanet')) {
      return _emptyStatus();
    }
    const planet = Datastore.get('currentPlanet');
    const key = `objects:${planet.id}`;
    if (!Datastore.has(key)) return _emptyStatus();

    const ledger = _buildLedger(ObjectManager.all(), Datastore.get('planetMap'));
    const connectedNodes = ledger.nodes.filter(n => ledger.connected.has(n.id));
    const unpoweredNodes = ledger.nodes.filter(n => n.power.role !== 'storage' && !ledger.connected.has(n.id));
    const biggestLoad = ledger.consumers.reduce((best, n) =>
      !best || n.power.rate > best.power.rate ? n : best, null);

    return {
      ship: ledger.shipNode ? {
        battery:    ledger.shipNode.battery,
        maxBattery: ledger.shipNode.maxBattery,
      } : null,
      graphGen:       ledger.producerTotal,
      graphDemand:    ledger.consumerDemand,
      graphUse:       ledger.consumerServed,
      connectedCount: connectedNodes.length,
      unpoweredCount: unpoweredNodes.length,
      producerCount:  ledger.producers.length,
      consumerCount:  ledger.consumers.length,
      biggestLoad:    biggestLoad ? { type: biggestLoad.type, rate: biggestLoad.power.rate } : null,
    };
  }

  function _emptyStatus() {
    return {
      ship: null,
      graphGen: 0,
      graphDemand: 0,
      graphUse: 0,
      connectedCount: 0,
      unpoweredCount: 0,
      producerCount: 0,
      consumerCount: 0,
      biggestLoad: null,
    };
  }

  return { start, stop, resolve, status, coverageAt };
})();
