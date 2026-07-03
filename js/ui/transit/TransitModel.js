// Pure journey state for a starlane hop: the single `_speed` knob and the
// progress / ETA / velocity it drives, plus the marker list and the
// closest-contact selection rule. No DOM, no rendering — TransitView reads it
// and StarlaneTransitPopup drives it. A future engine stat or debug control only
// has to scale CRUISE_SPEED.
const TransitModel = (() => {
  // --- tuning knobs (the one place the journey is tuned) ---
  const CRUISE_SPEED  = 0.08;   // progress (0..1) per second at cruise
  const MIN_SPEED     = 0.009;  // floor so progress always advances → guaranteed arrival
  const ACCEL_SPAN    = 0.12;   // progress fraction over which speed ramps up from a standstill
  const DECEL_START   = 0.72;   // progress at which the ramp-down to arrival begins
  const SPEED_EASING  = 3.0;    // how fast `_speed` chases its target (per second)
  const CRUISE_C      = 0.45;   // faux velocity (c) shown at cruise, scaled by speed

  // Target speed as a function of progress: a 0→1 throttle (accel / cruise /
  // decel) mapped onto [MIN_SPEED, CRUISE_SPEED]. The MIN_SPEED floor means the
  // ship always creeps, so `progress` monotonically reaches 1 (no stall).
  function _targetSpeed(p) {
    let t;
    if (p < ACCEL_SPAN)        t = p / ACCEL_SPAN;
    else if (p < DECEL_START)  t = 1;
    else                       t = 1 - (p - DECEL_START) / (1 - DECEL_START);
    t = MathUtils.clamp(t, 0, 1);
    const eased = t * t * (3 - 2 * t);
    return MIN_SPEED + (CRUISE_SPEED - MIN_SPEED) * eased;
  }

  function create({ markers = [], lengthLy = 8 } = {}) {
    const state = {
      progress: 0,
      speed:    0,
      elapsed:  0,            // seconds underway
      lengthLy,
      _markers:  markers.slice(),
      _consumed: new Set(),
      _locked:   false,       // true once cruise is reached — abort no longer allowed
    };

    function update(dt) {
      state.elapsed += dt;
      const target = _targetSpeed(state.progress);
      state.speed += (target - state.speed) * Math.min(1, SPEED_EASING * dt);
      state.progress = Math.min(1, state.progress + state.speed * dt);
      if (state.progress >= ACCEL_SPAN) state._locked = true;
    }

    // Nearest interactive, unconsumed marker that is still ahead of the ship and
    // within `window` lane-units (the field's look-ahead). Pass Infinity for the
    // reduced-motion case where there is no drift-in window. Returns id or null.
    function selectedId(window = Infinity) {
      let bestId = null, best = Infinity;
      for (const m of state._markers) {
        if (!m.onInvestigate || state._consumed.has(m.id)) continue;
        const rel = m.distance - state.progress;
        if (rel > 0 && rel <= window && rel < best) { best = rel; bestId = m.id; }
      }
      return bestId;
    }

    function markerById(id) { return state._markers.find(m => m.id === id) || null; }
    function consume(id)    { state._consumed.add(id); }
    function isConsumed(id)  { return state._consumed.has(id); }

    function arrived()   { return state.progress >= 1; }
    function abortable() { return !state._locked; }

    function phase() {
      if (state.progress < ACCEL_SPAN)  return 'accel';
      if (state.progress >= DECEL_START) return 'decel';
      return 'cruise';
    }

    // Nominal countdown off the cruise rate so the readout falls smoothly to 0
    // rather than spiking while speed ramps through its extremes.
    function etaSeconds() {
      return (1 - state.progress) / CRUISE_SPEED;
    }

    function velocityC() {
      return state.speed / CRUISE_SPEED * CRUISE_C;
    }

    // Persisted on encounter suspend; the marker list is supplied again on
    // re-open and reconciled against the restored consumed-set.
    function serialize() {
      return {
        progress: state.progress,
        speed:    state.speed,
        elapsed:  state.elapsed,
        locked:   state._locked,
        consumed: [...state._consumed],
      };
    }

    function restore(rec) {
      if (!rec) return;
      state.progress = rec.progress ?? state.progress;
      state.speed    = rec.speed    ?? state.speed;
      state.elapsed  = rec.elapsed  ?? state.elapsed;
      state._locked  = rec.locked   ?? state._locked;
      state._consumed = new Set(rec.consumed || []);
    }

    return {
      state,
      update, selectedId, markerById, consume, isConsumed,
      arrived, abortable, phase, etaSeconds, velocityC,
      serialize, restore,
      get markers() { return state._markers; },
      get progress() { return state.progress; },
      get speed() { return state.speed; },
      get elapsed() { return state.elapsed; },
      get lengthLy() { return state.lengthLy; },
      cruiseSpeed: CRUISE_SPEED,
      decelStart:  DECEL_START,
    };
  }

  return { create };
})();
