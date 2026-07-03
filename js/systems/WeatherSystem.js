// Weather event framework: plugin registry, per-plugin spawn rolls, per-turn dispatch,
// and shared 5fps visual ticking. Lifecycle managed by PlanetView.
const WeatherSystem = (() => {
  const BASE_CHANCE   = 0.035;
  const REF_AREA      = 256 * 256;  // smallest world = 1x instance budget
  const MAX_INSTANCES = 8;          // hard ceiling to bound clutter and per-tick cost

  const _plugins = new Map();
  let _active         = false;
  let _unsubTurn      = null;
  let _activeLayers   = new Map();
  let _visualInterval = null;

  function registerPlugin(plugin) {
    for (const type of plugin.types) {
      if (_plugins.has(type)) console.warn(`WeatherSystem: type '${type}' already registered - overwriting`);
      _plugins.set(type, plugin);
    }
  }

  function start() {
    if (_active) return;
    _ensureStores();
    _active    = true;
    _unsubTurn = TurnManager.subscribe(_tick);
  }

  function stop() {
    if (!_active) return;
    if (_unsubTurn) { _unsubTurn(); _unsubTurn = null; }
    _endAll();
    _active = false;
  }

  function _ensureStores() {
    if (!Datastore.has('weatherEvent')) Datastore.init('weatherEvent', null, DatastoreTypes.WEATHER_EVENT);
    if (!Datastore.has('weatherEvents')) {
      const event = Datastore.get('weatherEvent');
      Datastore.init('weatherEvents', event ? [event] : [], DatastoreTypes.WEATHER_EVENT);
    }
  }

  function _tick() {
    const context = _buildContext();
    _tickActive(context);
    _roll(context);
  }

  function _tickActive(context) {
    const events = getEvents();
    if (events.length === 0) return;

    const nextEvents = [];
    for (const event of events) {
      const plugin = _plugins.get(event.type);
      if (!plugin) {
        _removeLayer(event.type);
        continue;
      }
      try {
        const update = plugin.onTick(event, context);
        if (update === null) {
          _endEvent(event);
        } else {
          nextEvents.push({ ...event, ...update });
        }
      } catch (e) {
        console.error('WeatherSystem: plugin.onTick threw:', e);
        _endEvent(event);
      }
    }
    _setEvents(nextEvents);
  }

  function _roll(context) {
    // Atmosphere scales how often any weather can form: airless worlds get
    // none, thin worlds little, thick worlds substantially more.
    const chance = BASE_CHANCE * Atmosphere.weatherFactor(context.planet?.atmosphere);
    if (chance <= 0) return;
    const activePlugins = new Set(getEvents().map(event => _plugins.get(event.type)).filter(Boolean));
    for (const plugin of _uniquePlugins()) {
      if (activePlugins.has(plugin)) continue;
      if (Math.random() >= chance) continue;
      const candidates = plugin.getCandidates(context);
      if (!candidates.length) continue;
      _spawn(_weightedPick(candidates), context);
    }
  }

  function _spawn(type, context) {
    const plugin = _plugins.get(type);
    if (!plugin) return;

    const event = plugin.onSpawn(type, context);
    _setEvents([...getEvents(), event]);

    const layer = plugin.getLayer(event);
    if (layer) {
      _activeLayers.set(layer.id, layer);
      MapView.addLayer(layer);
      _ensureVisualInterval();
    }
  }

  function _endEvent(event) {
    const plugin = _plugins.get(event.type);
    _removeLayer(event.type);
    if (plugin && typeof plugin.reset === 'function') plugin.reset();
  }

  function _endAll() {
    for (const event of getEvents()) {
      const plugin = _plugins.get(event.type);
      if (plugin && typeof plugin.reset === 'function') plugin.reset();
    }
    if (_visualInterval) { clearInterval(_visualInterval); _visualInterval = null; }
    for (const layer of _activeLayers.values()) {
      MapView.removeLayer(layer.id);
      if (typeof layer.destroy === 'function') layer.destroy();
    }
    _activeLayers.clear();
    _setEvents([]);
  }

  function _removeLayer(id) {
    const layer = _activeLayers.get(id);
    if (!layer) return;
    MapView.removeLayer(layer.id);
    if (typeof layer.destroy === 'function') layer.destroy();
    _activeLayers.delete(id);
    if (_activeLayers.size === 0 && _visualInterval) {
      clearInterval(_visualInterval);
      _visualInterval = null;
    }
  }

  function _ensureVisualInterval() {
    if (_visualInterval) return;
    _visualInterval = setInterval(_runVisualTick, 200);
  }

  function _runVisualTick() {
    if (_activeLayers.size === 0) return;
    const viewport = MapView.getViewport();
    for (const layer of _activeLayers.values()) {
      if (typeof layer.visualTick === 'function') layer.visualTick(viewport);
    }
    MapView.refresh('weather');
  }

  function _buildContext() {
    const pos    = Datastore.get('playerPos');
    const map    = Datastore.get('planetMap');
    const planet = Datastore.get('currentPlanet');
    return {
      zone:      map.climate.getClimateZone(pos.x, pos.y),
      terrain:   planet.terrain,
      dayPhase:  Datastore.get('dayPhase'),
      climate:   map.climate,
      planet,
      playerPos: pos,
    };
  }

  // Scales a localized pattern's base instance cap by world area and atmospheric
  // density, so big, dense worlds host proportionally more simultaneous systems.
  // Planet-wide weather (ion storms, ash fall) is uniform and ignores this.
  function maxInstances(baseCap, map, planet) {
    if (!map) return Math.max(1, Math.round(baseCap));
    const sizeFactor = (map.w * map.h) / REF_AREA;
    const atmoFactor = MathUtils.clamp(Atmosphere.weatherFactor(planet?.atmosphere), 0.5, 1.6);
    return MathUtils.clamp(Math.round(baseCap * sizeFactor * atmoFactor), 1, MAX_INSTANCES);
  }

  function _weightedPick(candidates) {
    const total = candidates.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * total;
    for (const c of candidates) {
      r -= c.weight;
      if (r <= 0) return c.type;
    }
    return candidates[candidates.length - 1].type;
  }

  function _uniquePlugins() {
    return [...new Set(_plugins.values())];
  }

  function _setEvents(events) {
    _ensureStores();
    Datastore.withLock('weatherEvents', () => events);
    _syncLegacyWeatherEvent();
  }

  function _syncLegacyWeatherEvent() {
    if (!Datastore.has('weatherEvent')) return;
    const events = getEvents();
    const legacy = events.reduce((best, event) => {
      if (!best) return event;
      return (event.intensity ?? 0) > (best.intensity ?? 0) ? event : best;
    }, null);
    Datastore.withLock('weatherEvent', () => legacy);
  }

  function advanceTicks(n) {
    if (!_active) return;
    for (let i = 0; i < n; i++) _tick();
  }

  function getPlugin(type) {
    return _plugins.get(type) ?? null;
  }

  function getEvents() {
    if (Datastore.has('weatherEvents')) return Datastore.get('weatherEvents') ?? [];
    const event = Datastore.has('weatherEvent') ? Datastore.get('weatherEvent') : null;
    return event ? [event] : [];
  }

  function getEvent(type) {
    return getEvents().find(event => event.type === type) ?? null;
  }

  return { registerPlugin, start, stop, advanceTicks, getPlugin, getEvents, getEvent, maxInstances };
})();
