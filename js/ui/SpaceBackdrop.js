// Generated ASCII starfield + nebula backdrop that sits behind the centered game screen.
// Generated once per page load from a session seed; regenerated on window resize using
// the same seed so the pattern stays consistent.
const SpaceBackdrop = (() => {
  const DUST_DENSITY     = 0.030;
  const DISTANT_DENSITY  = 0.010;
  const MID_DENSITY      = 0.003;
  const BRIGHT_DENSITY   = 0.0005;

  const CENTRAL_NEBULA_MARGIN     = 18;
  const CENTRAL_NEBULA_RING_WIDTH = 12;
  const CENTRAL_NEBULA_RING_PEAK  = 0.70;
  const CENTRAL_NEBULA_OUTER_PEAK = 0.40;

  const INCIDENTAL_NEBULA_MAX = 2;
  const NEBULA_RADIUS_MIN     = 8;
  const NEBULA_RADIUS_MAX     = 16;
  const NEBULA_OUTER_PEAK     = 0.45;
  const NEBULA_PLACEMENT_TRIES = 20;

  // Coherent fractal-noise cloud structure.
  const NEBULA_FREQ_LOW    = 0.05;
  const NEBULA_FREQ_HIGH   = 0.12;
  const NEBULA_NOISE_FLOOR = 0.35;
  const NEBULA_NOISE_CEIL  = 0.78;
  const NEBULA_RAMP_GAIN   = 1.5;
  const NEBULA_COLOR_STEPS = 4;
  const NEBULA_COLOR_GAIN  = 1.5;

  // Background-tint layer: a faint colour wash painted behind the glyphs, the
  // way the Galaxy scanner lifts cell backgrounds around star clusters. The
  // whole viewport gets a very dim, low-frequency ambient tint; each nebula
  // adds a soft glow halo in its own hue. Deliberately darker than the Galaxy
  // nebula so it stays subtle and never competes with the centred game screen.
  const BG_AMBIENT_COLOR = '#0a0c18'; // peak ambient tint (near-black cool blue)
  const BG_AMBIENT_FREQ  = 0.03;      // low frequency -> broad, soft tinted regions
  const BG_AMBIENT_FLOOR = 0.45;      // noise below this stays pure black
  const BG_AMBIENT_GAIN  = 0.85;      // overall ambient strength
  const BG_NEBULA_GAIN   = 0.55;      // how strongly a nebula tints its own background
  const BG_MAX_LEVEL     = 38;        // per-channel cap so the wash stays dim
  const BG_MIN_LEVEL     = 2;         // below this a cell is left black (no span)
  const BG_QUANT         = 4;         // channel quantisation -> long same-bg runs merge

  const PALETTE_DUST        = '#15151f';
  const PALETTE_DISTANT     = '#2a3340';
  const PALETTE_MID         = '#445566';
  const PALETTE_BRIGHT      = '#7788aa';
  const PALETTE_BRIGHT_WARM = '#aa9977';
  const PALETTE_NEBULA = [
    { edge: '#16222e', core: '#2c4663' }, // cool blue
    { edge: '#1f1530', core: '#3c2b58' }, // indigo
    { edge: '#16282a', core: '#26494a' }, // teal
    { edge: '#2a1a16', core: '#4c352a' }, // faint rose
  ];

  const GLYPH_DISTANT = ['.', ',', "'"];
  const GLYPH_MID     = ['*', '+'];
  const GLYPH_BRIGHT  = ['*', '+', 'o'];
  const NEBULA_RAMP   = ["'", '.', ':', ';', '~', '*']; // light -> dense

  const PRIORITY = {
    EMPTY: 0, DUST: 1, DISTANT: 2, NEBULA: 3, MID: 4, BRIGHT: 5,
  };

  const FALLBACK_SCREEN_COLS = 80;
  const FALLBACK_SCREEN_ROWS = 50;
  const RESIZE_DEBOUNCE_MS   = 200;

  let _el          = null;
  let _seed        = 0;
  let _resizeTimer = null;

  function init() {
    _el = document.getElementById('space-backdrop');
    if (!_el) return;
    _seed = (Math.floor(Math.random() * 0x7fffffff) | 1) >>> 0;
    requestAnimationFrame(() => {
      regenerate();
      window.addEventListener('resize', _onResize);
    });
  }

  function regenerate() {
    if (!_el) return;
    const cell = _measureCell();
    if (cell.w <= 0 || cell.h <= 0) return;
    const cols = Math.ceil(window.innerWidth  / cell.w) + 2;
    const rows = Math.ceil(window.innerHeight / cell.h) + 2;
    const screenBox = _measureScreenBox(cell);
    const { cells, bg } = _generate(cols, rows, screenBox);
    _el.innerHTML = _serialize(cells, bg);
  }

  function _onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(regenerate, RESIZE_DEBOUNCE_MS);
  }

  function _measureCell() {
    const probe = document.createElement('span');
    probe.style.position   = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    probe.textContent = 'M'.repeat(80);
    _el.appendChild(probe);
    const r = probe.getBoundingClientRect();
    _el.removeChild(probe);
    return { w: r.width / 80, h: r.height };
  }

  function _measureScreenBox(cell) {
    const screenEl = document.getElementById('screen-container');
    if (!screenEl) {
      return {
        cx: window.innerWidth  / (2 * cell.w),
        cy: window.innerHeight / (2 * cell.h),
        halfW: FALLBACK_SCREEN_COLS / 2,
        halfH: FALLBACK_SCREEN_ROWS / 2,
      };
    }
    const r = screenEl.getBoundingClientRect();
    return {
      cx:    (r.left + r.width  / 2) / cell.w,
      cy:    (r.top  + r.height / 2) / cell.h,
      halfW:  r.width  / (2 * cell.w),
      halfH:  r.height / (2 * cell.h),
    };
  }

  function _generate(cols, rows, screenBox) {
    const rng = _mulberry32(_seed);
    const cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({
        char: ' ', color: '', priority: PRIORITY.EMPTY,
      })));
    const bgField = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => [0, 0, 0]));

    _paintAmbientBg(bgField, cols, rows);

    _paintNoise(cells, cols, rows, rng, DUST_DENSITY, PRIORITY.DUST, () => ({
      char: '.', color: PALETTE_DUST,
    }));

    _paintNoise(cells, cols, rows, rng, DISTANT_DENSITY, PRIORITY.DISTANT, () => ({
      char: GLYPH_DISTANT[(rng() * GLYPH_DISTANT.length) | 0],
      color: PALETTE_DISTANT,
    }));

    _paintCentralNebula(cells, bgField, cols, rows, rng, screenBox);
    _paintIncidentalNebulae(cells, bgField, cols, rows, rng, screenBox);

    _paintNoise(cells, cols, rows, rng, MID_DENSITY, PRIORITY.MID, () => ({
      char: GLYPH_MID[(rng() * GLYPH_MID.length) | 0],
      color: PALETTE_MID,
    }));

    _paintNoise(cells, cols, rows, rng, BRIGHT_DENSITY, PRIORITY.BRIGHT, () => ({
      char: GLYPH_BRIGHT[(rng() * GLYPH_BRIGHT.length) | 0],
      color: rng() < 0.20 ? PALETTE_BRIGHT_WARM : PALETTE_BRIGHT,
    }));

    return { cells, bg: _finalizeBg(bgField, cols, rows) };
  }

  // Faint low-frequency wash across the whole viewport. Same seeded noise as the
  // nebulae, so it reproduces on resize. The floor keeps broad reaches pure black.
  function _paintAmbientBg(bgField, cols, rows) {
    const amb = _hexToRgb(BG_AMBIENT_COLOR);
    const span = 1 - BG_AMBIENT_FLOOR;
    const salt = 1777;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const n = _fbm(c * BG_AMBIENT_FREQ + salt, r * BG_AMBIENT_FREQ + salt, salt);
        const t = _smooth(_clamp01((n - BG_AMBIENT_FLOOR) / span)) * BG_AMBIENT_GAIN;
        if (t <= 0) continue;
        const bgc = bgField[r][c];
        bgc[0] += amb[0] * t;
        bgc[1] += amb[1] * t;
        bgc[2] += amb[2] * t;
      }
    }
  }

  function _paintNoise(cells, cols, rows, rng, density, priority, makeCell) {
    for (let r = 0; r < rows; r++) {
      const row = cells[r];
      for (let c = 0; c < cols; c++) {
        if (rng() > density) continue;
        if (row[c].priority >= priority) continue;
        const made = makeCell();
        row[c] = { char: made.char, color: made.color, priority };
      }
    }
  }

  function _paintCentralNebula(cells, bgField, cols, rows, rng, screenBox) {
    const screenDiag = Math.sqrt(
      screenBox.halfW * screenBox.halfW * 4 + screenBox.halfH * screenBox.halfH * 4
    );
    const radius = screenDiag / 2 + CENTRAL_NEBULA_MARGIN;

    // Base wispy field everywhere inside the radius, plus a halo boost that
    // hugs the screen rectangle and fades smoothly to nothing at RING_WIDTH.
    // The boost is *additive* (and smoothstepped) so there is no weight cliff
    // at the ring edge — a hard step there reads as a square edge on the glow.
    _paintNebulaField(cells, bgField, cols, rows, rng, screenBox.cx, screenBox.cy, radius,
      (dx, dy, dist, radial) => {
        const outer = CENTRAL_NEBULA_OUTER_PEAK * radial;
        const sdx = Math.max(0, Math.abs(dx) - screenBox.halfW);
        const sdy = Math.max(0, Math.abs(dy) - screenBox.halfH);
        const distFromScreen = Math.sqrt(sdx * sdx + sdy * sdy);
        if (distFromScreen >= CENTRAL_NEBULA_RING_WIDTH) return outer;
        const ringFalloff = _smooth(1 - distFromScreen / CENTRAL_NEBULA_RING_WIDTH);
        return Math.min(1, outer + CENTRAL_NEBULA_RING_PEAK * ringFalloff);
      });
  }

  function _paintIncidentalNebulae(cells, bgField, cols, rows, rng, screenBox) {
    const screenDiag = Math.sqrt(
      screenBox.halfW * screenBox.halfW * 4 + screenBox.halfH * screenBox.halfH * 4
    );
    const centralRadius = screenDiag / 2 + CENTRAL_NEBULA_MARGIN;

    const target = (rng() * (INCIDENTAL_NEBULA_MAX + 1)) | 0;
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts++ < NEBULA_PLACEMENT_TRIES) {
      const px = rng() * cols;
      const py = rng() * rows;
      const dx = px - screenBox.cx;
      const dy = py - screenBox.cy;
      if (Math.sqrt(dx * dx + dy * dy) < centralRadius) continue;

      const radius = NEBULA_RADIUS_MIN
        + ((rng() * (NEBULA_RADIUS_MAX - NEBULA_RADIUS_MIN + 1)) | 0);
      _paintNebulaField(cells, bgField, cols, rows, rng, px, py, radius,
        (dx2, dy2, dist, radial) => NEBULA_OUTER_PEAK * radial);
      placed++;
    }
  }

  // Paints one nebula as a coherent noise field. weightAt() returns the local
  // cloud thickness (0..1) from geometry; fractal noise then carves structure,
  // wisps and an irregular edge, and drives glyph weight and the colour gradient.
  function _paintNebulaField(cells, bgField, cols, rows, rng, cx, cy, radius, weightAt) {
    const pal = PALETTE_NEBULA[(rng() * PALETTE_NEBULA.length) | 0];
    const colors = _buildNebulaColors(pal, NEBULA_COLOR_STEPS);
    const coreRgb = _hexToRgb(pal.core);
    const salt = (rng() * 4096) | 0;
    const horizontal = rng() < 0.5;
    const fx = horizontal ? NEBULA_FREQ_LOW : NEBULA_FREQ_HIGH;
    const fy = horizontal ? NEBULA_FREQ_HIGH : NEBULA_FREQ_LOW;
    const span = NEBULA_NOISE_CEIL - NEBULA_NOISE_FLOOR;

    const r0 = Math.max(0, Math.floor(cy - radius));
    const r1 = Math.min(rows - 1, Math.ceil(cy + radius));
    const c0 = Math.max(0, Math.floor(cx - radius));
    const c1 = Math.min(cols - 1, Math.ceil(cx + radius));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = c - cx;
        const dy = r - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;

        const weight = weightAt(dx, dy, dist, 1 - dist / radius);
        if (weight <= 0) continue;

        const n = _fbm(c * fx + salt, r * fy + salt * 0.5, salt);
        const carved = _smooth(_clamp01((n - NEBULA_NOISE_FLOOR) / span));
        const density = weight * carved;
        if (density <= 0) continue;

        const glow = density * BG_NEBULA_GAIN;
        const bgc = bgField[r][c];
        bgc[0] += coreRgb[0] * glow;
        bgc[1] += coreRgb[1] * glow;
        bgc[2] += coreRgb[2] * glow;

        if (rng() > density) continue;
        if (cells[r][c].priority >= PRIORITY.NEBULA) continue;

        let gi = (density * NEBULA_RAMP_GAIN * NEBULA_RAMP.length) | 0;
        if (gi >= NEBULA_RAMP.length) gi = NEBULA_RAMP.length - 1;
        let ci = (density * NEBULA_COLOR_GAIN * NEBULA_COLOR_STEPS) | 0;
        if (ci >= NEBULA_COLOR_STEPS) ci = NEBULA_COLOR_STEPS - 1;

        cells[r][c] = { char: NEBULA_RAMP[gi], color: colors[ci], priority: PRIORITY.NEBULA };
      }
    }
  }

  function _buildNebulaColors(pal, steps) {
    const out = [];
    for (let i = 0; i < steps; i++) {
      out.push(_lerpHex(pal.edge, pal.core, steps === 1 ? 1 : i / (steps - 1)));
    }
    return out;
  }

  // Clamps and quantises the accumulated background field into per-cell hex
  // strings. Quantisation makes neighbouring cells share a colour so the
  // serializer can merge long runs; cells under the floor are left empty (black).
  function _finalizeBg(bgField, cols, rows) {
    const out = Array.from({ length: rows }, () => new Array(cols).fill(''));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = bgField[r][c];
        const rr = _quantLevel(a[0]);
        const gg = _quantLevel(a[1]);
        const bb = _quantLevel(a[2]);
        if (rr === 0 && gg === 0 && bb === 0) continue;
        out[r][c] = _rgbToHex(rr, gg, bb);
      }
    }
    return out;
  }

  function _quantLevel(v) {
    if (v < BG_MIN_LEVEL) return 0;
    if (v > BG_MAX_LEVEL) v = BG_MAX_LEVEL;
    return Math.round(v / BG_QUANT) * BG_QUANT;
  }

  function _serialize(grid, bg) {
    const out = [];
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      const bgRow = bg[r];
      let buf = '', curColor = null, curBg = null;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        const empty = cell.char === ' ' || cell.priority === PRIORITY.EMPTY;
        const color = empty ? '' : cell.color;
        const cellBg = bgRow[c] || '';
        if (color !== curColor || cellBg !== curBg) {
          if (buf) out.push(_cellSpan(curColor, curBg, buf));
          buf = ''; curColor = color; curBg = cellBg;
        }
        buf += empty ? ' ' : cell.char;
      }
      if (buf) out.push(_cellSpan(curColor, curBg, buf));
      if (r < grid.length - 1) out.push('\n');
    }
    return out.join('');
  }

  function _cellSpan(color, bg, text) {
    if (!color && !bg) return text;
    let style = color ? 'color:' + color : '';
    if (bg) style += (style ? ';' : '') + 'background-color:' + bg;
    return '<span style="' + style + '">' + text + '</span>';
  }

  function _clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function _smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function _hash2(ix, iy, salt) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
             + Math.imul(salt, 1274126177) + _seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function _valueNoise(x, y, salt) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = _smooth(x - x0), fy = _smooth(y - y0);
    const v00 = _hash2(x0,     y0,     salt);
    const v10 = _hash2(x0 + 1, y0,     salt);
    const v01 = _hash2(x0,     y0 + 1, salt);
    const v11 = _hash2(x0 + 1, y0 + 1, salt);
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
  }

  function _fbm(x, y, salt) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < 3; o++) {
      sum += amp * _valueNoise(x * freq, y * freq, salt + o * 101);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  function _hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function _rgbToHex(r, g, b) {
    return '#' + (((1 << 24) | (r << 16) | (g << 8) | b).toString(16)).slice(1);
  }

  function _lerpHex(a, b, t) {
    const [ar, ag, ab] = _hexToRgb(a);
    const [br, bg, bb] = _hexToRgb(b);
    return _rgbToHex(
      Math.round(ar + (br - ar) * t),
      Math.round(ag + (bg - ag) * t),
      Math.round(ab + (bb - ab) * t),
    );
  }

  function _mulberry32(a) {
    let state = a >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return { init, regenerate };
})();
