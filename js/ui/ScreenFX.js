// ScreenFX — the transition framework that brackets ScreenManager's screen swaps.
//
// A transition runs in three phases so it survives a slow/heavy incoming screen and
// lets the screen the player is leaving actually leave before the next one arrives:
//
//     OUT (animate the outgoing .screen off) -> doSwap() -> IN (animate the incoming .screen in)
//
// Only one .screen is mounted at a time (ScreenManager hides the old before showing
// the new), so the handoff is sequential, not a co-resident push. See
// design/ScreenTransitions.md.
//
// Adding a new effect: register a named { out, in } pair. `out(el, ctx)` and
// `in(el, ctx)` each return a Web-Animations Animation (or null) that animates the
// given .screen container; ScreenFX owns the phase sequencing, the lock, the input
// block, motion preferences and the guaranteed teardown around it. Nothing else
// needs to change to add a transition — register it and pass `{ type: 'name' }`.
const ScreenFX = (() => {
  // --- Tuning knobs (see design/ScreenTransitions.md §4.6) ---
  const TRANSITION_MS   = 180;   // default per-phase duration of a full-motion transition
  const CROSSFADE_MS    = 120;   // reduced-motion: total quick fade (split across OUT+IN)
  const FALLBACK_PAD_MS = 400;   // slack over the expected duration before a force teardown
  const SLIDE_PCT       = 6;     // handoff translate distance, % of screen height
  const SCALE_MIN       = 0.96;  // handoff collapse scale
  const FLARE           = 1.35;  // brief CRT brightness flare on power-down / power-up
  const DEFAULT_TYPE    = 'handoff';

  const _canAnimate = typeof Element !== 'undefined' &&
    typeof Element.prototype.animate === 'function';

  const _transitions = {};

  let _overlay     = null;
  let _motion      = 'auto';   // 'auto' | 'full' | 'reduced' | 'off'
  let _locked      = false;
  let _current     = null;     // in-flight transition state, or null
  let _keyBlocker  = null;

  function init() {
    _overlay = document.getElementById('screen-fx');
  }

  function register(name, def) { _transitions[name] = def; }

  // --- Motion preference (shared source of truth, incl. StarlaneTransitPopup) ---

  function setMotion(mode) { _motion = mode; }
  function getMotion() { return _motion; }
  function prefersReducedMotion() { return _effectiveMotion() !== 'full'; }

  // Resolved motion level ('full' | 'reduced' | 'off') for ambient effects to gate
  // themselves the same way transitions do. Ambient effects keep running under
  // 'reduced' (they are low-frequency/low-amplitude) and stop only under 'off'.
  function effectiveMotion() { return _effectiveMotion(); }

  function _effectiveMotion() {
    if (!_canAnimate) return 'off';
    if (_motion === 'full' || _motion === 'reduced' || _motion === 'off') return _motion;
    return _systemReducedMotion() ? 'reduced' : 'full';
  }

  function _systemReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // --- The transition runner ---

  // toId is informational (dedupe + future telemetry); the swap itself is doSwap().
  function transition(toId, opts, doSwap) {
    if (typeof doSwap !== 'function') return;

    if (_locked) {
      const sameTarget = _current && _current.toId === toId;
      _forceComplete();          // snap the in-flight transition straight to its end
      if (sameTarget) return;    // already arriving there — the snap was the whole job
    }

    const motion = _effectiveMotion();
    if (motion === 'off') { doSwap(); return; }

    const reduced  = motion === 'reduced';
    const def      = _transitions[opts && opts.type] || _transitions[DEFAULT_TYPE];
    const duration = reduced ? CROSSFADE_MS / 2
                             : ((opts && opts.duration) || def.duration || TRANSITION_MS);

    const state = {
      toId, doSwap, def, reduced,
      ctx: Object.assign({ direction: 'down' }, opts, { duration, reduced, overlay: _overlay }),
      done: false, swapped: false, anim: null, fallback: null,
    };
    _current = state;
    _lock(true);

    // Hard safety: force the whole sequence to its end if an animation never settles.
    state.fallback = setTimeout(() => _forceCompleteState(state),
      duration * 2 + FALLBACK_PAD_MS);

    _run(state);
  }

  async function _run(state) {
    try {
      const outEl = _visibleScreen();
      let outAnim = null;
      if (outEl) {
        outAnim   = state.reduced ? _fade(outEl, 1, 0, state.ctx.duration)
                                  : state.def.out(outEl, state.ctx);
        state.anim = outAnim;
        await _settle(outAnim);
      }
      if (state.done) return;

      _swap(state);
      // Drop any forwards-fill the OUT phase left on the (now hidden) outgoing screen
      // so it reverts to its base styles unseen, ready for its next show. A no-op for
      // transitions that paint into the overlay rather than animating the .screen
      // itself (e.g. the static dissolve), whose teardown is the def's cleanup().
      if (outEl) _cancelAnims(outEl);

      const inEl = _visibleScreen();
      if (inEl) {
        const inAnim = state.reduced ? _fade(inEl, 0, 1, state.ctx.duration)
                                     : state.def.in(inEl, state.ctx);
        state.anim = inAnim;
        await _settle(inAnim);
      }
      if (state.done) return;

      _complete(state);
    } catch (err) {
      console.error('ScreenFX transition error', err);
      _forceCompleteState(state);
    }
  }

  // Resolve when the animation finishes OR is cancelled (cancel rejects `finished`).
  function _settle(anim) {
    if (!anim || !anim.finished) return Promise.resolve();
    return anim.finished.catch(() => {});
  }

  function _forceComplete() { if (_current) _forceCompleteState(_current); }

  // Collapse a transition to its end state immediately: snap the live animation,
  // guarantee the swap has happened, strip any leftover transform from the screen
  // now on display, and release the lock. The in-flight _run() unwinds harmlessly
  // because every phase boundary re-checks state.done.
  function _forceCompleteState(state) {
    if (state.done) return;
    state.done = true;
    if (state.fallback) { clearTimeout(state.fallback); state.fallback = null; }
    if (state.anim) {
      try { state.anim.finish(); } catch (_) {}
      try { state.anim.cancel(); } catch (_) {}
    }
    _swap(state);

    const inEl = _visibleScreen();
    if (inEl) _cancelAnims(inEl);

    _teardown(state);
    _release(state);
  }

  function _complete(state) {
    if (state.done) return;
    state.done = true;
    if (state.fallback) { clearTimeout(state.fallback); state.fallback = null; }
    _teardown(state);
    _release(state);
  }

  function _swap(state) {
    if (state.swapped) return;
    state.swapped = true;
    try { state.doSwap(); } catch (err) { console.error('ScreenFX swap error', err); }
  }

  // Optional per-transition teardown (e.g. removing an overlay ghost). Runs exactly
  // once per transition, on every terminal path, so a def can own DOM it created.
  function _teardown(state) {
    if (state.def && typeof state.def.cleanup === 'function') {
      try { state.def.cleanup(state.ctx); } catch (err) { console.error('ScreenFX cleanup error', err); }
    }
  }

  function _release(state) {
    if (_current === state) { _current = null; _lock(false); }
  }

  // --- Lock + input blocking ---

  function _lock(on) {
    _locked = on;
    if (_overlay) _overlay.style.pointerEvents = on ? 'auto' : 'none';
    if (on) _addKeyBlocker(); else _removeKeyBlocker();
  }

  // The outgoing screen stays mounted (and key-listening) through the OUT phase;
  // swallow keydowns so it can't fire a competing instant navigation mid-transition.
  function _addKeyBlocker() {
    if (_keyBlocker) return;
    _keyBlocker = e => e.stopPropagation();
    document.addEventListener('keydown', _keyBlocker, true);
  }

  function _removeKeyBlocker() {
    if (!_keyBlocker) return;
    document.removeEventListener('keydown', _keyBlocker, true);
    _keyBlocker = null;
  }

  // --- Helpers ---

  function _visibleScreen() {
    const container = document.getElementById('screen-container');
    if (!container) return null;
    for (const el of container.querySelectorAll('.screen')) {
      if (getComputedStyle(el).display !== 'none') return el;
    }
    return null;
  }

  function _animationsOn(el) {
    return el.getAnimations ? el.getAnimations() : [];
  }

  function _cancelAnims(el) {
    for (const a of _animationsOn(el)) { try { a.cancel(); } catch (_) {} }
  }

  function _fade(el, from, to, duration) {
    return el.animate(
      [{ opacity: from }, { opacity: to }],
      { duration, easing: 'linear', fill: to < from ? 'forwards' : 'backwards' }
    );
  }

  // --- Built-in transitions ---

  // Slide / power-down handoff: the outgoing screen recedes and powers down in the
  // travel direction, then the incoming one boots up arriving from the far side, so
  // both phases read as a single consistent gesture (downward = descend, up = back).
  register('handoff', {
    duration: TRANSITION_MS,
    out(el, ctx) {
      const dir = ctx.direction === 'up' ? -1 : 1;
      return el.animate([
        { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'brightness(1)' },
        { transform: `translateY(${dir * 1.5}%) scale(0.985)`, opacity: 1,
          filter: `brightness(${FLARE})`, offset: 0.45 },
        { transform: `translateY(${dir * SLIDE_PCT}%) scale(${SCALE_MIN})`, opacity: 0,
          filter: 'brightness(0.65)' },
      ], { duration: ctx.duration, easing: 'cubic-bezier(.45,0,.65,.2)', fill: 'forwards' });
    },
    in(el, ctx) {
      const dir = ctx.direction === 'up' ? -1 : 1;
      return el.animate([
        { transform: `translateY(${-dir * SLIDE_PCT}%) scale(${SCALE_MIN})`, opacity: 0,
          filter: `brightness(${FLARE})` },
        { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'brightness(1)' },
      ], { duration: ctx.duration, easing: 'cubic-bezier(.2,.6,.35,1)', fill: 'backwards' });
    },
  });

  return {
    init, register, transition,
    setMotion, getMotion, prefersReducedMotion, effectiveMotion,
  };
})();
