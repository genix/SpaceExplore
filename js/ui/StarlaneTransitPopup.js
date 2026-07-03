// Starlane Transit — a.k.a. the "hyperspace popup": the galaxy-screen travel
// popup opened from GalaxyScreen._travelTo. Plays while the ship is in transit.
// Wraps the existing Scanner instrument in a porthole border and drives one rAF
// loop: the TransitModel advances the journey (the single `_speed` knob), the
// TransitStarfield scrolls, and TransitView paints the instrument each frame.
// Galaxy state is committed only on arrival (onArrive); abort during the accel
// ramp returns to the origin untouched. See design/StarlaneTransit.md.
const StarlaneTransitPopup = (() => {
  const FRAME_MS        = 1000 / 24;   // repaint cap — chunky terminal cadence, cheap
  const STAR_RATE_GAIN  = 80;          // model speed (progress/s) → field scroll (cells/s)
  const STAR_DENSITY    = 0.10;
  const FALLBACK_MAX_MS = 60000;       // hard safety: force-arrive if the loop ever dies
  const BORDER          = 'porthole';

  // Spectral-class tints so the approaching destination star (and its corner
  // label) match its real colour on the galaxy map.
  const STAR_COLORS = { M: '#ff6644', K: '#ff9944', G: '#ffee44', F: '#ccddff' };
  const DEFAULT_DEST_COLOR = '#ffe07a';

  let _model      = null;
  let _starfield  = null;
  let _nebula     = null;
  let _ctx        = null;
  let _selectedId = null;
  let _onArrive   = null;
  let _onAbort    = null;
  let _raf        = null;
  let _fallback   = null;
  let _last       = 0;
  let _done       = false;

  function open({ originSystem, destSystem, lengthLy, markers = [], onArrive, onAbort }) {
    _onArrive = onArrive || null;
    _onAbort  = onAbort  || null;
    _done = false;
    _last = 0;
    _selectedId = null;

    _model = TransitModel.create({ markers, lengthLy: lengthLy || 8 });

    const reducedMotion = _prefersReducedMotion();
    const { width, height } = TransitView.INTERIOR;
    _starfield = TransitStarfield.create(width, height, Math.round(width * height * STAR_DENSITY));
    _nebula    = TransitNebula.create(width, height);

    const destClass = destSystem && destSystem.star ? destSystem.star.spectralClass : null;
    _ctx = {
      reducedMotion,
      originName: originSystem && originSystem.star ? originSystem.star.name : '',
      destName:   destSystem   && destSystem.star   ? destSystem.star.name   : '',
      destColor:  STAR_COLORS[destClass] || DEFAULT_DEST_COLOR,
      get selectedId() { return _selectedId; },
    };

    const border = Borders.get(BORDER);
    PopupManager.show({
      width:  TransitView.W + border.insets.left + border.insets.right,
      height: TransitView.H + border.insets.top + border.insets.bottom,
      border: BORDER,
      borderColor: TransitView.FRAME_COLOR,
      dismissKeys: [],
      render: () => TransitView.render(_model, _starfield, _nebula, _ctx),
      onKey:  _onKey,
      onDismiss: _teardown,
    });

    _startLoop();
  }

  function _startLoop() {
    _last = 0;
    if (_raf) cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(_loop);
    if (_fallback) clearTimeout(_fallback);
    _fallback = setTimeout(() => _complete(_onArrive), FALLBACK_MAX_MS);
  }

  function _stopLoop() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    if (_fallback) { clearTimeout(_fallback); _fallback = null; }
  }

  function _loop(now) {
    _raf = requestAnimationFrame(_loop);
    if (!_last) _last = now;
    let dt = (now - _last) / 1000;
    if (dt < FRAME_MS / 1000) return;
    _last = now;
    dt = Math.min(dt, 0.1);
    try { _step(dt); }
    catch (err) { console.error('StarlaneTransit loop error', err); _complete(_onArrive); }
  }

  function _step(dt) {
    _model.update(dt);
    if (!_ctx.reducedMotion) {
      const rate = _model.speed * STAR_RATE_GAIN;
      _starfield.step(dt, rate);
      _nebula.step(dt, rate);
    }
    _selectedId = _model.selectedId(_ctx.reducedMotion ? Infinity : TransitView.FIELD_LOOKAHEAD);
    PopupManager.redraw();
    if (_model.arrived()) _complete(_onArrive);
  }

  function _onKey(e) {
    if (e.repeat) return true;
    if (e.key === 'Enter') {
      if (_selectedId) _investigate(_selectedId);
      return true;
    }
    if (e.key === 'Escape') {
      if (_model.abortable()) _complete(_onAbort);
      return true;
    }
    return true;   // popup owns input while the hop is in flight
  }

  // Suspend the hop and hand off to the contact's encounter. The future event
  // system opens its own popup/screen and calls resume() (or arriveNow()) when
  // the player returns; the consumed contact never re-arms ahead of the ship.
  function _investigate(id) {
    const m = _model.markerById(id);
    if (!m) return;
    _stopLoop();
    _model.consume(id);
    _selectedId = null;
    const record = _model.serialize();
    const resume = () => { if (_done) return; _startLoop(); };

    if (typeof m.onInvestigate === 'function') {
      try { m.onInvestigate({ marker: m, record, resume, arriveNow: () => _complete(_onArrive) }); }
      catch (err) { console.error('Transit encounter failed', err); resume(); }
    } else {
      resume();   // no dispatcher yet (e.g. a plain eventId): drop the contact and continue
    }
  }

  function _complete(cb) {
    if (_done) return;
    _done = true;
    _stopLoop();
    if (cb) cb();
    if (PopupManager.isOpen()) PopupManager.dismiss();
  }

  // PopupManager.onDismiss. If we get here without having completed (e.g. a screen
  // switch dismissed the stack mid-hop), treat it as an abort so the caller's
  // _traveling guard is always cleared — never commit a half-finished arrival.
  function _teardown() {
    _stopLoop();
    if (!_done) {
      _done = true;
      if (_onAbort) _onAbort();
    }
  }

  // Share ScreenFX's motion preference so the global toggle governs the transit
  // animation too; fall back to the raw media query where ScreenFX isn't loaded.
  function _prefersReducedMotion() {
    if (typeof ScreenFX !== 'undefined' && ScreenFX.prefersReducedMotion) {
      return ScreenFX.prefersReducedMotion();
    }
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  return { open };
})();
