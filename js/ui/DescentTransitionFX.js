// Cross-instrument terminal effects for touchdown and suit failure. Glyphs never
// translate or scale: impact is conveyed through stepped phosphor overload, and
// the CRT shutdown beam occupies whole character cells in the ScreenFX overlay.
const DescentTransitionFX = (() => {
  const TOUCHDOWN_OUT_MS = 240;
  const TOUCHDOWN_IN_MS  = 360;
  const TOUCHDOWN_MS     = Math.max(TOUCHDOWN_OUT_MS, TOUCHDOWN_IN_MS);
  const CRT_MS           = 280;

  function _group(animations) {
    const live = animations.filter(Boolean);
    return {
      finished: Promise.all(live.map(anim => anim.finished.catch(() => {}))),
      finish() {
        for (const anim of live) {
          try { anim.finish(); } catch (_) {}
        }
      },
      cancel() {
        for (const anim of live) {
          try { anim.cancel(); } catch (_) {}
        }
      },
    };
  }

  function _layer(ctx, className) {
    if (!ctx.overlay) return null;
    const el = document.createElement('div');
    el.className = className;
    ctx.overlay.appendChild(el);
    return el;
  }

  function _remove(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function _scaledDuration(ctx, phaseMs) {
    const total = (ctx && ctx.duration) || TOUCHDOWN_MS;
    return Math.max(1, Math.round(phaseMs * total / TOUCHDOWN_MS));
  }

  const touchdownFx = {
    duration: TOUCHDOWN_MS,

    out(el, ctx) {
      const duration = _scaledDuration(ctx, TOUCHDOWN_OUT_MS);
      ctx._touchdownFlash = _layer(ctx, 'screen-fx-touchdown-flash');
      ctx._touchdownBlackout = _layer(ctx, 'screen-fx-touchdown-blackout');
      const screen = el.animate([
        { opacity: 1,    filter: 'brightness(1)',   offset: 0 },
        { opacity: 1,    filter: 'brightness(1)',   offset: 0.16 },
        { opacity: 1,    filter: 'brightness(2.2)', offset: 0.17 },
        { opacity: 1,    filter: 'brightness(2.2)', offset: 0.32 },
        { opacity: 0.42, filter: 'brightness(0.5)', offset: 0.33 },
        { opacity: 0.42, filter: 'brightness(0.5)', offset: 0.46 },
        { opacity: 0.95, filter: 'brightness(1.6)', offset: 0.47 },
        { opacity: 0.95, filter: 'brightness(1.6)', offset: 0.62 },
        { opacity: 0,    filter: 'brightness(0)',   offset: 0.63 },
        { opacity: 0,    filter: 'brightness(0)',   offset: 1 },
      ], { duration, easing: 'linear', fill: 'forwards' });

      const flash = ctx._touchdownFlash && ctx._touchdownFlash.animate([
        { opacity: 0,    offset: 0 },
        { opacity: 0,    offset: 0.16 },
        { opacity: 0.85, offset: 0.17 },
        { opacity: 0.85, offset: 0.32 },
        { opacity: 0,    offset: 0.33 },
        { opacity: 0,    offset: 0.46 },
        { opacity: 0.38, offset: 0.47 },
        { opacity: 0.38, offset: 0.62 },
        { opacity: 0,    offset: 0.63 },
        { opacity: 0,    offset: 1 },
      ], { duration, easing: 'linear', fill: 'forwards' });

      const blackout = ctx._touchdownBlackout && ctx._touchdownBlackout.animate([
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.62 },
        { opacity: 1, offset: 0.63 },
        { opacity: 1, offset: 1 },
      ], { duration, easing: 'linear', fill: 'forwards' });

      return _group([screen, flash, blackout]);
    },

    in(el, ctx) {
      const duration = _scaledDuration(ctx, TOUCHDOWN_IN_MS);
      _remove(ctx._touchdownFlash);
      ctx._touchdownFlash = null;
      if (!ctx._touchdownBlackout) {
        ctx._touchdownBlackout = _layer(ctx, 'screen-fx-touchdown-blackout');
      }

      const screen = el.animate([
        { opacity: 1, filter: 'brightness(1.85)', offset: 0 },
        { opacity: 1, filter: 'brightness(1.85)', offset: 0.24 },
        { opacity: 1, filter: 'brightness(1.45)', offset: 0.25 },
        { opacity: 1, filter: 'brightness(1.45)', offset: 0.52 },
        { opacity: 1, filter: 'brightness(1.18)', offset: 0.53 },
        { opacity: 1, filter: 'brightness(1.18)', offset: 0.80 },
        { opacity: 1, filter: 'brightness(1)',    offset: 0.81 },
        { opacity: 1,    filter: 'brightness(1)',    offset: 1 },
      ], { duration, easing: 'linear', fill: 'backwards' });

      const blackout = ctx._touchdownBlackout && ctx._touchdownBlackout.animate([
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: 0.08 },
        { opacity: 0, offset: 0.09 },
        { opacity: 0, offset: 0.24 },
        { opacity: 1, offset: 0.25 },
        { opacity: 1, offset: 0.36 },
        { opacity: 0, offset: 0.37 },
        { opacity: 0, offset: 0.52 },
        { opacity: 1, offset: 0.53 },
        { opacity: 1, offset: 0.64 },
        { opacity: 0, offset: 0.65 },
        { opacity: 0, offset: 0.80 },
        { opacity: 1, offset: 0.81 },
        { opacity: 1, offset: 0.86 },
        { opacity: 0, offset: 0.87 },
        { opacity: 0, offset: 1 },
      ], { duration, easing: 'linear', fill: 'forwards' });

      return _group([screen, blackout]);
    },

    cleanup(ctx) {
      _remove(ctx && ctx._touchdownFlash);
      _remove(ctx && ctx._touchdownBlackout);
      if (ctx) ctx._touchdownFlash = null;
      if (ctx) ctx._touchdownBlackout = null;
    },
  };

  const crtFx = {
    duration: CRT_MS,

    out(el, ctx) {
      ctx._crtBeam = _layer(ctx, 'screen-fx-crt-beam');
      const screen = el.animate([
        { opacity: 1, filter: 'brightness(1)',   offset: 0 },
        { opacity: 1, filter: 'brightness(1)',   offset: 0.20 },
        { opacity: 1, filter: 'brightness(2.4)', offset: 0.21 },
        { opacity: 1, filter: 'brightness(2.4)', offset: 0.34 },
        { opacity: 0, filter: 'brightness(0)',   offset: 0.35 },
        { opacity: 0, filter: 'brightness(0)',   offset: 1 },
      ], { duration: ctx.duration, easing: 'linear', fill: 'forwards' });

      const beam = ctx._crtBeam && ctx._crtBeam.animate([
        { opacity: 0, width: '80ch', offset: 0 },
        { opacity: 0, width: '80ch', offset: 0.34 },
        { opacity: 1, width: '80ch', offset: 0.35 },
        { opacity: 1, width: '80ch', offset: 0.48 },
        { opacity: 1, width: '40ch', offset: 0.49 },
        { opacity: 1, width: '40ch', offset: 0.61 },
        { opacity: 1, width: '12ch', offset: 0.62 },
        { opacity: 1, width: '12ch', offset: 0.74 },
        { opacity: 1, width: '3ch',  offset: 0.75 },
        { opacity: 1, width: '3ch',  offset: 0.84 },
        { opacity: 1, width: '1ch',  offset: 0.85 },
        { opacity: 1, width: '1ch',  offset: 0.92 },
        { opacity: 0, width: '1ch',  offset: 0.93 },
        { opacity: 0, width: '1ch',  offset: 1 },
      ], { duration: ctx.duration, easing: 'linear', fill: 'forwards' });

      return _group([screen, beam]);
    },

    in(el, ctx) {
      return el.animate([
        { opacity: 0,    filter: 'brightness(0.2)', offset: 0 },
        { opacity: 0,    filter: 'brightness(0.2)', offset: 0.19 },
        { opacity: 1,    filter: 'brightness(1.5)', offset: 0.20 },
        { opacity: 1,    filter: 'brightness(1.5)', offset: 0.40 },
        { opacity: 0.25, filter: 'brightness(0.6)', offset: 0.41 },
        { opacity: 0.25, filter: 'brightness(0.6)', offset: 0.57 },
        { opacity: 1,    filter: 'brightness(1.2)', offset: 0.58 },
        { opacity: 1,    filter: 'brightness(1)',   offset: 1 },
      ], { duration: ctx.duration, easing: 'linear', fill: 'backwards' });
    },

    cleanup(ctx) {
      _remove(ctx && ctx._crtBeam);
      if (ctx) ctx._crtBeam = null;
    },
  };

  if (typeof ScreenFX !== 'undefined') {
    ScreenFX.register('touchdown', touchdownFx);
    ScreenFX.register('crt', crtFx);
  }

  return { touchdownFx, crtFx };
})();
