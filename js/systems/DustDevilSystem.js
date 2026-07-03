// Dust devils: compact, moving vortexes on arid/scorched worlds that have a
// detectable atmosphere. Standalone system (NOT a WeatherSystem plugin) with its
// own TurnManager subscription, following the same lifecycle as WeatherSystem.
// Atmospheric density governs whether devils exist and their size, lifespan,
// suit drain, and equipment wear. Devils live in the 'dustDevils' Datastore key
// so DustDevilLayer can read them without a direct reference; the key is reset on
// stop() and never persists across planet exits. See design/DustDevils.md.
const DustDevilSystem = (() => {
  const SPAWN_BASE   = 0.025;   // per-turn spawn chance before atmosphere/afternoon scaling
  const DRAIN_CAP    = 3.5;     // max combined suit drain/turn from overlapping devils
  const MEANDER_ODDS = 0.10;    // per-turn chance to re-roll a devil's heading
  const WIND_ALIGN   = 0.70;    // of those re-rolls, share that follow the prevailing wind
  const VISUAL_MS    = 120;     // repaint cadence so the ring spin reads as smooth rotation

  // Per-devil properties fixed at spawn from the planet's atmosphere category.
  // The planet atmosphere is constant, so a session uses a single row throughout.
  const ATMO_SCALE = {
    thin:     { radius: [2, 3], life: [8, 14],  drain: 0.8, wearMult: 1.10 },
    moderate: { radius: [2, 4], life: [12, 20], drain: 1.5, wearMult: 1.25 },
    thick:    { radius: [3, 5], life: [16, 28], drain: 2.5, wearMult: 1.50 },
  };

  const CARDINALS = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

  let _active         = false;
  let _unsub          = null;
  let _visualInterval = null;
  let _mapW           = 0;
  let _mapH           = 0;
  let _cap            = 1;
  let _scale          = null;
  let _weatherFactor  = 0;
  let _idCounter      = 0;

  function start(planet) {
    if (_active) return;
    planet = planet || (Datastore.has('currentPlanet') ? Datastore.get('currentPlanet') : null);
    if (!planet) return;
    if (planet.terrain !== 'arid' && planet.terrain !== 'scorched') return;

    const cat = Atmosphere.category(planet.atmosphere);
    if (cat === 'none' || !ATMO_SCALE[cat]) return;          // no medium for a vortex
    if (!Datastore.has('planetMap')) return;

    const map = Datastore.get('planetMap');
    _mapW = map.w;
    _mapH = map.h;
    _cap  = Math.max(1, Math.min(4, Math.floor((_mapW * _mapH) / 600)));
    _scale         = ATMO_SCALE[cat];
    _weatherFactor = Atmosphere.weatherFactor(planet.atmosphere);
    _idCounter     = 0;

    if (Datastore.has('dustDevils')) Datastore.withLock('dustDevils', () => []);
    else Datastore.init('dustDevils', [], DatastoreTypes.DUST_DEVILS);

    _active = true;
    _unsub  = TurnManager.subscribe(_tick, 2);   // settle devil state before Suit/Extraction read it
    MapView.addLayer(DustDevilLayer);
    _visualInterval = setInterval(_visualRefresh, VISUAL_MS);
  }

  function stop() {
    if (!_active) return;
    _active = false;
    if (_unsub) { _unsub(); _unsub = null; }
    if (_visualInterval) { clearInterval(_visualInterval); _visualInterval = null; }
    MapView.removeLayer('dust-devils');
    if (Datastore.has('dustDevils')) Datastore.remove('dustDevils');
  }

  function _visualRefresh() {
    if (_active && _devils().length > 0) MapView.refresh('animate');
  }

  function _tick() {
    if (!_active || !Datastore.has('planetMap')) return;
    const map     = Datastore.get('planetMap');
    const climate = map.climate;
    const phase   = Datastore.has('dayPhase') ? Datastore.get('dayPhase') : null;

    let devils = _devils().map(d => _moveDevil(d, climate)).filter(d => d.life > 0);

    // dayPhase may not exist on the first tick after landing — skip spawning, don't throw.
    if (phase !== null && devils.length < _cap) {
      const afternoonMult = (phase > 0.10 && phase < 0.40) ? 1.8 : 0.5;
      const chance = SPAWN_BASE * _weatherFactor * afternoonMult;
      if (Math.random() < chance) devils.push(_spawnDevil(climate));
    }

    Datastore.withLock('dustDevils', () => devils);
  }

  function _moveDevil(d, climate) {
    let { dx, dy } = d;
    if (Math.random() < MEANDER_ODDS) {
      const dir = Math.random() < WIND_ALIGN ? _windStep(climate) : _randomCardinal();
      dx = dir.dx;
      dy = dir.dy;
    }
    return {
      ...d,
      x:    _wrap(d.x + dx, _mapW),
      y:    _wrap(d.y + dy, _mapH),
      dx, dy,
      life: d.life - 1,
    };
  }

  function _spawnDevil(climate) {
    const radius = _randInt(_scale.radius[0], _scale.radius[1]);
    const life   = _randInt(_scale.life[0], _scale.life[1]);
    const dir    = _windStep(climate);
    return {
      id:       `dd-${++_idCounter}`,
      x:        _randInt(0, _mapW - 1),
      y:        _randInt(0, _mapH - 1),
      radius,
      life,
      maxLife:  life,
      dx:       dir.dx,
      dy:       dir.dy,
      drain:    _scale.drain,
      wearMult: _scale.wearMult,
    };
  }

  function _windStep(climate) {
    const w = climate && climate.dominantWindDir;
    if (w) {
      const dx = Math.sign(w.dx);
      const dy = Math.sign(w.dy);
      if (dx !== 0 || dy !== 0) return { dx, dy };
    }
    return _randomCardinal();
  }

  function _randomCardinal() {
    return CARDINALS[Math.floor(Math.random() * CARDINALS.length)];
  }

  // Additional suit battery drain/turn while the player stands inside any devil's
  // circular footprint (wrap-aware Euclidean distance <= radius). Additive across
  // overlapping devils but capped so it is punishing, not instantly lethal.
  function getInsideDrain(pos, map) {
    if (!_active || !pos) return 0;
    const devils = _devils();
    if (devils.length === 0) return 0;
    const w = map?.w ?? _mapW;
    const h = map?.h ?? _mapH;
    let total = 0;
    for (const d of devils) {
      const ax = _wrapDelta(pos.x, d.x, w);
      const ay = _wrapDelta(pos.y, d.y, h);
      if (Math.sqrt(ax * ax + ay * ay) <= d.radius) total += d.drain;
    }
    return Math.min(total, DRAIN_CAP);
  }

  // Map<'x,y', wearMult> of every tile inside any devil footprint, carrying the
  // highest wearMult of the devils covering it. ExtractionSystem multiplies an
  // extractor's per-tick wear by this when its tile is in the map.
  function getGritOverlay() {
    const grit = new Map();
    if (!_active) return grit;
    for (const d of _devils()) {
      const r2 = d.radius * d.radius;
      for (let dy = -d.radius; dy <= d.radius; dy++) {
        for (let dx = -d.radius; dx <= d.radius; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const key = `${_wrap(d.x + dx, _mapW)},${_wrap(d.y + dy, _mapH)}`;
          const cur = grit.get(key);
          if (cur === undefined || d.wearMult > cur) grit.set(key, d.wearMult);
        }
      }
    }
    return grit;
  }

  // Debug helper: drop a devil a few tiles from the player, bypassing the spawn
  // cap and afternoon roll. No-op unless the system is running (i.e. the player is
  // on an arid/scorched world with a detectable atmosphere). Returns whether it spawned.
  function debugSpawnNearPlayer() {
    if (!_active || !Datastore.has('playerPos')) return false;
    const pos     = Datastore.get('playerPos');
    const climate = Datastore.has('planetMap') ? Datastore.get('planetMap').climate : null;
    const devil   = _spawnDevil(climate);
    devil.x = _wrap(pos.x + _randInt(-4, 4), _mapW);
    devil.y = _wrap(pos.y + _randInt(-4, 4), _mapH);
    Datastore.withLock('dustDevils', list => [...list, devil]);
    MapView.refresh('animate');
    return true;
  }

  function _devils() {
    return Datastore.has('dustDevils') ? (Datastore.get('dustDevils') ?? []) : [];
  }

  function _wrap(v, size) {
    return ((v % size) + size) % size;
  }

  function _wrapDelta(a, b, size) {
    let d = Math.abs(a - b);
    if (d > size / 2) d = size - d;
    return d;
  }

  function _randInt(lo, hi) {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  return { start, stop, getInsideDrain, getGritOverlay, debugSpawnNearPlayer };
})();
