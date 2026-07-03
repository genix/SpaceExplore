// A horizontally-scrolling parallax star buffer for the transit field. Distinct
// from the shared Starfield (which twinkles in place): here stars stream
// right→left, and rows nearer the centerline move faster (parallax = speed).
// Works in interior-local coordinates; the view paints it at an offset. Stateful
// and decorative — it is never part of the serialized journey state.
const TransitStarfield = (() => {
  // Mostly faint dust with the occasional brighter accent — kept deliberately
  // sparse in variety so the field reads calm rather than busy.
  const GLYPHS = ['.', '.', '.', ',', "'", '*'];
  // Dim → brighter by parallax depth (faster/nearer rows are brighter).
  const COLORS = ['#2a3a4a', '#37506a', '#4f7298', '#7396c0'];
  const WARM_COLOR = '#b3a07d';   // an occasional warm star for variety
  const WARM_CHANCE = 0.12;
  const PAR_MIN = 0.45;   // slowest rows (near the edges)
  const PAR_MAX = 1.0;    // fastest rows (the centerline)
  const TRAIL_COLOR = '#243648';

  function create(width, height, count) {
    const center = (height - 1) / 2;
    const maxDist = Math.max(1, center);
    const stars = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(Math.random() * height);
      const par = PAR_MIN + (PAR_MAX - PAR_MIN) * (1 - Math.abs(row - center) / maxDist);
      const color = Math.random() < WARM_CHANCE
        ? WARM_COLOR
        : COLORS[Math.min(COLORS.length - 1, (par * COLORS.length) | 0)];
      stars.push({
        x: Math.random() * width,
        row,
        par,
        glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
        color,
      });
    }
    let scroll = 0;   // total cells scrolled — also drives the lane-axis dot phase

    // `rate` is cells/second at the current speed; each star advances by rate×par.
    function step(dt, rate) {
      scroll += rate * dt;
      for (const s of stars) {
        s.x -= rate * dt * s.par;
        if (s.x < 0) {
          s.x += width;
          s.glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
      }
    }

    // Paints stars into `grid` at (originRow+row, originCol+floor(x)), only over
    // empty cells so foreground (ship, markers, axis) always wins. `streak` (0..1)
    // grows a short right-side tail so acceleration reads in the field itself.
    function paint(grid, originRow, originCol, streak) {
      for (const s of stars) {
        const c = originCol + Math.floor(s.x);
        const r = originRow + s.row;
        _put(grid, r, c, s.glyph, s.color);
        const tail = Math.min(1, Math.floor(streak * s.par * 2));
        for (let t = 1; t <= tail; t++) _put(grid, r, c + t, '·', TRAIL_COLOR);
      }
    }

    function scrollPhase() { return scroll; }

    return { step, paint, scrollPhase };
  }

  function _put(grid, r, c, ch, color) {
    if (r < 0 || r >= grid.length) return;
    const row = grid[r];
    if (c < 0 || c >= row.length) return;
    if (row[c].char !== ' ') return;
    row[c] = { char: ch, color };
  }

  return { create };
})();
