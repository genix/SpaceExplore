// Pure renderer for the Starlane Transit popup. Builds the Scanner instrument
// canvas (UIBorderStyles #5, re-axed to lane-distance × lateral-offset) inside the
// popup's porthole border: ruled frame, scrolling field, ship, markers, destination
// and status strips. Serialises each row to coloured-span HTML for PopupManager.
// No state of its own — it reads TransitModel and the TransitStarfield buffer.
const TransitView = (() => {
  // --- geometry (whole character cells per HowToUI) ---
  const W = 62, H = 15;
  const COL_BL = 7;            // left border column
  const COL_IN0 = 8;          // interior first column
  const INW = 42;             // interior width
  const COL_BR = COL_IN0 + INW; // right border column (50)
  const SHIP_COL = COL_IN0 + 1;

  const OFFSET_ROWS = [12, 9, 6, 3, 0, -3, -6, -9, -12];   // the ±AU ladder (AU)
  const ROW_LABEL = 0, ROW_CARET = 1, ROW_TOP = 2;
  const ROW_FIELD0 = ROW_TOP + 1;                 // 3
  const ROW_CENTER = ROW_FIELD0 + OFFSET_ROWS.indexOf(0);
  const ROW_BOT = ROW_FIELD0 + OFFSET_ROWS.length; // 12
  const ROW_TELE = ROW_BOT + 1, ROW_CTX = ROW_BOT + 2;

  const FIELD_LOOKAHEAD = 0.30;   // lane-units of look-ahead the interior spans
  const TICK_FRACS  = [0.25, 0.5, 0.75];
  const LABEL_FRACS = [0, 0.25, 0.5, 0.75, 1];
  // ASCII spinner — the geometric ◐◓◑◒ are not in the VT323 font and render
  // wider than one cell, shifting the rest of the row. Same reason every glyph
  // below stays within ASCII / box-drawing / block-elements.
  const SPINNER = ['|', '/', '-', '\\'];
  const SPINNER_PERIOD = 0.13;
  const FRAME_COLOR = '#3f9e9e';

  const C = {
    bg: '#000000',
    frame:  FRAME_COLOR, tick: '#7fd6d6',
    label:  '#7fa6b0', unit: '#5f8a8a',
    caret:  '#ffcc44',
    origin: '#8899bb', dest: '#66e0ff',
    ship:   '#e6f7ff',
    axis:   '#2f6060', axisLit: '#5fc8c8',
    spinner:'#6fd6c0',
    teleLabel: '#7f9aa0', teleVal: '#bfeef0', teleStatus: '#ffcc44', sep: '#3f6f6f',
    contact: '#55ffff', select: '#55ffff',
    navlock: '#ffaa44', key: '#ffe24a', hint: '#aaaaaa',
    passed:  '#43585a',
  };

  const SHIP = ['█', '>'];                    // hull + nose, both single-width
  const DEST_FAR = '*', DEST_MID = 'o', DEST_NEAR = '@';
  const MARKER_GLYPH = { radio: '~', beacon: '!', derelict: '#', anomaly: '?' };
  const MARKER_COLOR = { radio: '#55ffff', beacon: '#ffdd33', derelict: '#ff9944', anomaly: '#cc66ff' };

  function render(model, starfield, nebula, ctx) {
    const grid = _blank();
    _distanceRow(grid, model);
    _caret(grid, model);
    _frame(grid, model, ctx);
    if (!ctx.reducedMotion) {
      const streak = MathUtils.clamp(model.speed / model.cruiseSpeed, 0, 1);
      starfield.paint(grid, ROW_FIELD0, COL_IN0, streak);
    }
    _laneAxis(grid, model, starfield, ctx);
    _ship(grid);
    _markers(grid, model, ctx);
    _destination(grid, model, ctx);
    // Nebula wash last: it only tints cell backgrounds (never chars), so it sits
    // behind the field's stars, ship and markers without disturbing them.
    if (nebula) nebula.paintBg(grid, ROW_FIELD0, COL_IN0);
    _telemetry(grid, model);
    _contextStrip(grid, model, ctx);
    return grid.map(row => ({ html: _rowHtml(row) }));
  }

  // --- coordinate mappings ---
  function _rulerCol(frac) { return COL_IN0 + Math.round(frac * (INW - 1)); }
  function _fieldCol(rel)  { return SHIP_COL + Math.round(rel / FIELD_LOOKAHEAD * (COL_BR - 1 - SHIP_COL)); }
  function _offsetRow(au) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < OFFSET_ROWS.length; i++) {
      const d = Math.abs(OFFSET_ROWS[i] - au);
      if (d < bd) { bd = d; bi = i; }
    }
    return ROW_FIELD0 + bi;
  }

  // --- frame & rulers ---
  function _distanceRow(grid, model) {
    for (const f of LABEL_FRACS) {
      const v = Math.round(model.lengthLy * f);
      _write(grid, ROW_LABEL, _rulerCol(f), String(v), C.label);
    }
    _write(grid, ROW_LABEL, COL_BR + 2, 'ly', C.unit);
  }

  function _caret(grid, model) {
    _put(grid, ROW_CARET, _rulerCol(model.progress), '▼', C.caret);
  }

  function _frame(grid, model, ctx) {
    for (let c = COL_IN0; c < COL_BR; c++) {
      _put(grid, ROW_TOP, c, '═', C.frame);
      _put(grid, ROW_BOT, c, '═', C.frame);
    }
    _put(grid, ROW_TOP, COL_BL, '╔', C.frame); _put(grid, ROW_TOP, COL_BR, '╗', C.frame);
    _put(grid, ROW_BOT, COL_BL, '╚', C.frame); _put(grid, ROW_BOT, COL_BR, '╝', C.frame);
    for (const f of TICK_FRACS) {
      _put(grid, ROW_TOP, _rulerCol(f), '╤', C.tick);
      _put(grid, ROW_BOT, _rulerCol(f), '╧', C.tick);
    }
    for (let i = 0; i < OFFSET_ROWS.length; i++) {
      const r = ROW_FIELD0 + i;
      _put(grid, r, COL_BL, '╟', C.frame);
      _put(grid, r, COL_BR, '╢', C.frame);
      _writeRight(grid, r, COL_BL - 1, _offsetLabel(OFFSET_ROWS[i]), _labelColor(OFFSET_ROWS[i]));
    }
    _write(grid, ROW_TOP, 1, _abbrev(ctx.originName), C.origin);
    _write(grid, ROW_TOP, COL_BR + 2, _abbrev(ctx.destName), ctx.destColor || C.dest);

    const idx = Math.floor(model.elapsed / SPINNER_PERIOD) % SPINNER.length;
    _put(grid, ROW_BOT, 3, SPINNER[idx], C.spinner);
    _writeRight(grid, ROW_BOT, W - 1, _mmss(model.etaSeconds()), C.teleLabel);
  }

  // --- interior ---
  function _laneAxis(grid, model, starfield, ctx) {
    const caret = _rulerCol(model.progress);
    if (ctx.reducedMotion) {
      for (let c = COL_IN0; c < COL_BR; c++)
        _put(grid, ROW_CENTER, c, c <= caret ? '─' : '·', c <= caret ? C.axisLit : C.axis);
      _put(grid, ROW_CENTER, caret, '>', C.caret);
      return;
    }
    const phase = Math.floor(starfield.scrollPhase());
    for (let c = SHIP_COL + 2; c < COL_BR; c++)
      if (((c + phase) % 2) === 0) _put(grid, ROW_CENTER, c, '·', C.axis);
  }

  function _ship(grid) {
    _put(grid, ROW_CENTER, SHIP_COL, SHIP[0], C.ship);
    _put(grid, ROW_CENTER, SHIP_COL + 1, SHIP[1], C.ship);
  }

  function _markers(grid, model, ctx) {
    for (const m of model.markers) {
      if (model.isConsumed(m.id)) continue;
      const rel = m.distance - model.progress;
      if (m.onInvestigate && rel > 0) {
        _put(grid, ROW_TOP, _rulerCol(m.distance), _glyph(m), _markerCol(m));
      }
      const col = _fieldCol(rel);
      if (col < COL_IN0 || col >= COL_BR) continue;
      const row = _offsetRow(m.offset);
      const selected = !!m.onInvestigate && ctx.selectedId === m.id;
      const color = selected ? C.select : (rel <= 0 ? C.passed : _markerCol(m));
      _put(grid, row, col, _glyph(m), color);
      if (selected) {
        _put(grid, row, col - 1, '[', C.select);
        _put(grid, row, col + 1, ']', C.select);
      }
    }
  }

  // The destination star coasts in past DECEL_START, growing as the ship nears
  // it, tinted by the destination's real spectral colour.
  function _destination(grid, model, ctx) {
    const rel = 1 - model.progress;
    if (rel > FIELD_LOOKAHEAD) return;
    const col = _fieldCol(rel);
    if (col < COL_IN0 || col >= COL_BR) return;
    const color = ctx.destColor || C.dest;
    if (rel > 0.18) {
      _put(grid, ROW_CENTER, col, DEST_FAR, color);
    } else if (rel > 0.06) {
      _put(grid, ROW_CENTER, col, DEST_MID, color);
    } else {
      _put(grid, ROW_CENTER, col, DEST_NEAR, color);
      _put(grid, ROW_CENTER, col - 2, '(', color);
      _put(grid, ROW_CENTER, col + 2, ')', color);
    }
  }

  // --- status strips ---
  function _telemetry(grid, model) {
    const ph = model.phase();
    const sep = ['   ·   ', C.sep];
    const segs = [];
    if (ph === 'accel')      segs.push(['DEPARTING', C.teleStatus]);
    else if (ph === 'decel') segs.push(['DECELERATING', C.teleStatus]);
    else segs.push(['ELAPSED ', C.teleLabel], [_mmss(model.elapsed), C.teleVal]);
    segs.push(sep, ['VELOCITY ', C.teleLabel], [model.velocityC().toFixed(2) + 'c', C.teleVal], sep);
    if (ph === 'decel') segs.push(['ARRIVING', C.teleStatus]);
    else segs.push(['ETA ', C.teleLabel], [_mmss(model.etaSeconds()), C.teleVal]);
    _writeSegs(grid, ROW_TELE, Math.max(1, Math.floor((W - _segLen(segs)) / 2)), segs);
  }

  function _contextStrip(grid, model, ctx) {
    const sel = ctx.selectedId ? model.markerById(ctx.selectedId) : null;
    if (sel) {
      const label = String(sel.label || 'Contact').slice(0, 16);
      _writeSegs(grid, ROW_CTX, 1, [
        ['<< CONTACT >> ', C.contact],
        [label, _markerCol(sel)],
        ['  ', C.sep],
        [_offsetText(sel.offset), C.teleLabel],
      ]);
      _hint(grid, '[Enter]', 'Investigate');
      return;
    }
    if (model.abortable()) _hint(grid, '[Esc]', 'Abort travel');
    else _writeRight(grid, ROW_CTX, W - 2, '- NAV LOCKED -', C.navlock);
  }

  function _hint(grid, key, action) {
    const total = key.length + 1 + action.length;
    const start = W - 2 - total;
    _write(grid, ROW_CTX, start, key, C.key);
    _write(grid, ROW_CTX, start + key.length + 1, action, C.hint);
  }

  // --- marker helpers ---
  function _glyph(m)     { return m.glyph || MARKER_GLYPH[m.type] || 'o'; }
  function _markerCol(m) { return m.color || MARKER_COLOR[m.type] || '#66bbff'; }

  // --- label formatting ---
  function _offsetLabel(au) { return au === 0 ? '0' : (au > 0 ? '+' + au : String(au)) + 'AU'; }
  // Dim the ±AU ladder on a gradient so the 0 reading stays brightest and the
  // outer 3/6/9/12 markers fade toward the background, easing visual clutter.
  function _labelColor(au) {
    const maxAu = OFFSET_ROWS[0];                 // 12
    const t = (Math.abs(au) / maxAu) * 0.6;       // 0 → 0, 12 → 0.6
    return ColorUtils.mixHex(C.label, C.bg, t);
  }
  function _offsetText(au)  { return (au > 0 ? '+' + au : String(au)) + ' AU'; }
  function _abbrev(name)    { return String(name || '????').slice(0, 4).toUpperCase(); }
  function _mmss(sec) {
    sec = MathUtils.clamp(Math.round(sec || 0), 0, 599);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  // --- grid primitives ---
  function _blank() {
    return Array.from({ length: H }, () =>
      Array.from({ length: W }, () => ({ char: ' ', color: C.bg })));
  }
  function _put(grid, r, c, ch, color) {
    if (r < 0 || r >= H || c < 0 || c >= W) return;
    grid[r][c] = { char: ch, color };
  }
  function _write(grid, r, c, text, color) {
    text = String(text);
    for (let i = 0; i < text.length; i++) _put(grid, r, c + i, text[i], color);
  }
  function _writeRight(grid, r, endCol, text, color) {
    text = String(text);
    _write(grid, r, endCol - text.length + 1, text, color);
  }
  // Lays out [text, color] segments left-to-right from a start column.
  function _writeSegs(grid, r, c, segs) {
    for (const [text, color] of segs) { _write(grid, r, c, text, color); c += String(text).length; }
  }
  function _segLen(segs) {
    return segs.reduce((n, s) => n + String(s[0]).length, 0);
  }
  function _rowHtml(row) {
    let html = '', buf = '', color = null, bg = null;
    for (const cell of row) {
      const cbg = cell.bg || null;
      if (cell.color !== color || cbg !== bg) {
        if (buf) html += _span(buf, color, bg);
        buf = ''; color = cell.color; bg = cbg;
      }
      buf += cell.char;
    }
    if (buf) html += _span(buf, color, bg);
    return html;
  }
  function _span(text, color, bg) {
    let style = 'color:' + color;
    if (bg) style += ';background-color:' + bg;
    return `<span style="${style}">${Ascii.escape(text)}</span>`;
  }

  return {
    render, W, H, FRAME_COLOR, FIELD_LOOKAHEAD,
    INTERIOR: { width: INW, height: OFFSET_ROWS.length },
  };
})();
