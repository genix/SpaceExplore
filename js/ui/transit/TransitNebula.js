// A horizontally-scrolling band of faint nebula tints for the transit field's
// cell backgrounds. Pure decoration: a few soft colour blobs drift right→left,
// slower than the stars so the clouds read as far-off depth, and accumulate into
// a dim per-cell background wash — the way SpaceBackdrop lifts cell backgrounds
// behind its glyphs. Works in interior-local coordinates; the view paints it
// behind the field. Never part of the serialized journey state.
const TransitNebula = (() => {
  const SPAN_MULT  = 2.1;    // virtual width (× interior) the blobs wrap across
  const PARALLAX   = 0.32;   // clouds scroll slower than the stars → distance cue
  const BLOB_MIN   = 3, BLOB_MAX = 5;
  const RX_MIN = 6, RX_MAX = 13;   // wide, soft horizontal clouds
  const RY_MIN = 2, RY_MAX = 4;
  const PEAK   = 34;   // brightest per-channel bg value (kept dim for readability)
  const FLOOR  = 3;    // below this a cell stays pure black (no bg span)
  const QUANT  = 5;    // channel quantisation → neighbours merge into spans

  // Cool scanner-friendly hues with one warm accent, echoing SpaceBackdrop.
  const COLORS = [
    [44, 70, 99],   // cool blue
    [38, 73, 74],   // teal
    [60, 43, 88],   // indigo
  ];
  const WARM_COLOR = [76, 53, 42];   // faint rose, an occasional warm cloud
  const WARM_CHANCE = 0.2;

  function create(width, height) {
    const span = Math.max(width + 1, Math.round(width * SPAN_MULT));
    const blobs = [];
    const count = BLOB_MIN + Math.floor(Math.random() * (BLOB_MAX - BLOB_MIN + 1));
    for (let i = 0; i < count; i++) {
      // Pin the first blob inside the visible field so a hop never opens with a
      // bare field while the rest drift in; the others spread across the span.
      const seeded = i === 0;
      blobs.push({
        x:  seeded ? width * (0.25 + Math.random() * 0.5) : Math.random() * span,
        cy: seeded ? 1 + Math.random() * (height - 2) : -1 + Math.random() * (height + 2),
        rx: RX_MIN + Math.random() * (RX_MAX - RX_MIN),
        ry: RY_MIN + Math.random() * (RY_MAX - RY_MIN),
        color: Math.random() < WARM_CHANCE ? WARM_COLOR : COLORS[(Math.random() * COLORS.length) | 0],
        gain: 0.6 + Math.random() * 0.4,
      });
    }

    // `rate` is cells/second of the star field; clouds drift a fraction of that.
    // A blob fully off the left wraps to the far end of the virtual span (still
    // off-screen right), so it re-enters after a gap with no visible pop.
    function step(dt, rate) {
      const dx = rate * dt * PARALLAX;
      for (const b of blobs) {
        b.x -= dx;
        if (b.x < -b.rx) b.x += span;
      }
    }

    // Sets cell.bg over the interior region from the accumulated blob colours.
    // Leaves char/color untouched, so it can overlay foreground glyphs safely.
    function paintBg(grid, originRow, originCol) {
      for (let row = 0; row < height; row++) {
        const r = originRow + row;
        if (r < 0 || r >= grid.length) continue;
        const gridRow = grid[r];
        for (let col = 0; col < width; col++) {
          const c = originCol + col;
          if (c < 0 || c >= gridRow.length) continue;
          let rr = 0, gg = 0, bb = 0;
          for (const b of blobs) {
            const dx = (col - b.x) / b.rx;
            const dy = (row - b.cy) / b.ry;
            const d2 = dx * dx + dy * dy;
            if (d2 >= 1) continue;
            const w = (1 - d2) * b.gain;
            rr += b.color[0] * w; gg += b.color[1] * w; bb += b.color[2] * w;
          }
          const hex = _hex(rr, gg, bb);
          if (hex) gridRow[c].bg = hex;
        }
      }
    }

    return { step, paintBg };
  }

  // Cap brightness by the dominant channel and scale the others to match, so a
  // bright cloud stays its own hue instead of desaturating toward grey at the cap.
  function _hex(r, g, b) {
    const m = Math.max(r, g, b);
    if (m < FLOOR) return null;
    if (m > PEAK) { const s = PEAK / m; r *= s; g *= s; b *= s; }
    return '#' + _pad(_q(r)) + _pad(_q(g)) + _pad(_q(b));
  }
  function _q(v) { return Math.round(v / QUANT) * QUANT; }
  function _pad(v) { return v.toString(16).padStart(2, '0'); }

  return { create };
})();
