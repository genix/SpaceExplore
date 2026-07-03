// StaticTransitionFX — a quick "signal re-tune" static dissolve, registered into
// ScreenFX as the 'static' transition.
//
// The outgoing view breaks up into a burst of CP437 phosphor snow, the screens swap
// behind the fully-snowed frame, then the static clears to reveal the incoming view —
// a CRT channel re-tune. Unlike a scale/transform it is pure grid output painted
// cell-by-cell into #screen-fx (via Renderer), so it stays on the character grid and
// fits the ASCII aesthetic.
//
// Trigger:  ScreenManager.show(id, { type:'static' })                // full screen
//           ScreenManager.show(id, { type:'static', viewport:true }) // scanner viewport only
// With `viewport:true` the snow is confined to the shared scanner viewport pane, so
// the circle chassis stays lit and only the instrument's display re-tunes — the
// galaxy<->system "one instrument changing focus" read, without moving any glyphs.
const StaticTransitionFX = (() => {
  // --- Tuning knobs ---
  const FPS         = 30;
  const FRAME_MS    = 1000 / FPS;
  const STATIC_MS   = 110;          // fallback per-phase duration (cover / clear)
  const SCREEN_COLS = 80;
  const SCREEN_ROWS = 50;
  // CP437-safe speckle, weighted toward fine grain with occasional blocks.
  const GLYPHS = ['.', '.', ',', ':', ';', '·', "'", '*', '+', '=', '#', '%', '░', '▒', '▓'];
  // Dim green phosphor snow (weighted dark; capped at a muted mid-green, no white).
  const COLORS = ['#0a3d0a', '#0a3d0a', '#176317', '#256e25', '#338a33', '#42a042'];

  function _resolveRegion(ctx) {
    if (ctx.viewport && typeof ScannerScreenFrame !== 'undefined' &&
        ScannerScreenFrame.viewportMetrics && ctx.overlay) {
      const m = ScannerScreenFrame.viewportMetrics();
      if (m) {
        const fx = ctx.overlay.getBoundingClientRect();
        return {
          left: m.preRect.left - fx.left + m.frameCol * m.cellW,
          top:  m.preRect.top  - fx.top  + m.frameRow * m.cellH,
          cols: m.cols, rows: m.rows,
        };
      }
    }
    return { left: 0, top: 0, cols: SCREEN_COLS, rows: SCREEN_ROWS };
  }

  function _makeGrid(cols, rows) {
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ char: ' ', color: '#000' })));
  }

  // density 0..1 = fraction of cells that are snow this frame (opaque, black-backed);
  // the rest are transparent spaces, so the live screen shows through the gaps.
  function _paint(ctx, density) {
    const { cols, rows } = ctx._region;
    const grid = ctx._grid;
    for (let r = 0; r < rows; r++) {
      const row = grid[r];
      for (let c = 0; c < cols; c++) {
        const cell = row[c];
        if (Math.random() < density) {
          cell.char = GLYPHS[(Math.random() * GLYPHS.length) | 0];
          cell.color = COLORS[(Math.random() * COLORS.length) | 0];
          cell.bgColor = '#000';
        } else {
          cell.char = ' ';
          cell.color = '#000';
          delete cell.bgColor;
        }
      }
    }
    Renderer.render(ctx._noiseEl, grid, { cellClass: 'render-cell' });
  }

  // A WAA-Animation-like controller (finished / finish / cancel) so ScreenFX can
  // await it and force-complete it exactly as it does a CSS animation.
  function _phase(ctx, fromD, toD) {
    const dur = ctx.duration || STATIC_MS;
    let raf = null, start = 0, last = 0, done = false, resolve;
    const finished = new Promise(r => { resolve = r; });

    function stop(finalDensity) {
      if (done) return;
      done = true;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (finalDensity !== null) _paint(ctx, finalDensity);
      resolve();
    }

    function loop(now) {
      if (done) return;
      if (!start) start = now;
      const t = Math.min(1, (now - start) / dur);
      if (!last || now - last >= FRAME_MS) {
        _paint(ctx, fromD + (toD - fromD) * t);
        last = now;
      }
      if (t >= 1) { stop(toD); return; }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return {
      finished,
      finish() { stop(toD); },   // snap to the end density (full snow / clear)
      cancel() { stop(null); },  // stop where it is; cleanup() removes the layer
    };
  }

  const staticFx = {
    duration: STATIC_MS,

    // OUT: build the snow layer over the outgoing view and ramp it up to full cover,
    // so the controller swap (at the midpoint) happens behind opaque static.
    out(el, ctx) {
      ctx._region = _resolveRegion(ctx);
      ctx._grid = _makeGrid(ctx._region.cols, ctx._region.rows);
      ctx._noiseEl = document.createElement('div');
      Object.assign(ctx._noiseEl.style, {
        position: 'absolute',
        left: ctx._region.left + 'px', top: ctx._region.top + 'px',
        overflow: 'hidden', pointerEvents: 'none',
      });
      ctx.overlay.appendChild(ctx._noiseEl);
      return _phase(ctx, 0, 1);
    },

    // IN: clear the snow over the now-current view; cleanup() then drops the layer.
    in(el, ctx) {
      if (!ctx._noiseEl) return null;
      return _phase(ctx, 1, 0);
    },

    cleanup(ctx) {
      if (ctx && ctx._noiseEl && ctx._noiseEl.parentNode) {
        ctx._noiseEl.parentNode.removeChild(ctx._noiseEl);
      }
      if (ctx) { ctx._noiseEl = null; ctx._grid = null; }
    },
  };

  if (typeof ScreenFX !== 'undefined') ScreenFX.register('static', staticFx);

  return { staticFx };
})();
