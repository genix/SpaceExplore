// Solar system orrery screen: ASCII planet selector between galaxy and landing screens.
const SolarSystemScreen = (() => {
  const SCANNER       = ScannerScreenFrame.geometry;
  const INNER_COLS    = SCANNER.viewportW;
  const INNER_ROWS    = SCANNER.contentH;
  const STAR_COL      = Math.floor(INNER_COLS / 2); // 27
  const STAR_ROW      = 0;
  const ORBIT_START_RY = 5;
  const ORBIT_STEP_RY  = 4;  // at least 3 chars between orbital radii for labels
  const ORBIT_X_SCALE  = 1.8;
  const ORBIT_MIN_T   = Math.PI * 0.15;
  const ORBIT_MAX_T   = Math.PI * 0.85;
  const INFO_W        = SCANNER.infoW;
  const INFO_H        = SCANNER.contentH;
  const BORDER_COLOR  = '#446644';
  const BG_STAR_COUNT = 28;

  const SPECTRAL_COLOR = { M: '#ff6666', K: '#ffaa44', G: '#ffdd88', F: '#ffff88' };
  const TERRAIN_GLYPH  = {
    scorched:  { ch: '·', color: '#ff4400' },
    arid:      { ch: 'o', color: '#c8a040' },
    temperate: { ch: 'O', color: '#40c840' },
    tundra:    { ch: 'o', color: '#40c8c8' },
    frozen:    { ch: '*', color: '#88ccff' },
    gas:       { ch: '@', color: '#6688cc' },
  };
  const DIM         = '#888888';
  const BRIGHT      = '#ffffff';
  const ORBIT_COLOR = '#446644';

  // Faint orrery background: deep space lifts toward the central star's spectral
  // hue near the top, fading to a cool void lower and outward, so the inner system
  // reads warm and lit while the outer system stays cold and dark.
  const GLOW_DEEP     = '#05060d';
  const GLOW_VOID     = '#141d36';
  const GLOW_AMBIENT  = 0.12;
  const GLOW_SIGMA    = 17;
  const GLOW_DY_W     = 1.25;  // chars are taller than wide; mild vertical squash
  const GLOW_STRENGTH = 0.9;
  const GLOW_TINT     = 0.2;   // how much of the spectral hue the peak glow carries

  // The central star is the orrery's heartbeat: its glyph breathes from its real
  // spectral colour toward white on a slow sine while the screen is idle.
  const STAR_PULSE_PERIOD_MS = 2000;
  const STAR_PULSE_MAX_MIX   = 0.5;

  let _el               = null;
  let _keyHandler       = null;
  let _mouseMoveHandler = null;
  let _clickHandler     = null;
  let _frame            = null;
  let _system           = null;
  let _planets          = null;
  let _positions        = null;
  let _selectedIndex    = 0;
  let _bgStars          = [];
  let _starGlow         = [];
  let _flickerTimer     = null;
  let _lastSd           = null;

  function init() {
    _el = document.getElementById('solar-system-screen');
    _keyHandler = _onKey;
  }

  function show() {
    if (!Datastore.has('currentSolarSystem')) {
      console.error('SolarSystemScreen: currentSolarSystem not in Datastore');
      ScreenManager.show('galaxy-screen');
      return;
    }

    _system        = Datastore.get('currentSolarSystem');
    _planets       = _system.planets;
    _positions     = _computePositions();
    _selectedIndex = _defaultIndex();
    _generateBgStars();
    _generateStarGlow();

    _frame = ScannerScreenFrame.mount(_el, {
      title: _titleText(),
      bindings: [
        { key: '↑↓',   action: 'Select Planet' },
        { key: 'Enter', action: 'Land Here'     },
        { key: 'Esc',   action: 'Back'          },
      ],
      borderColor: BORDER_COLOR,
    });

    _lastSd = null;
    _refreshTitle();
    _render();

    _mouseMoveHandler = e => _onMouseMove(e);
    _clickHandler     = e => _onClick(e);
    _frame.mainEl.addEventListener('mousemove', _mouseMoveHandler);
    _frame.mainEl.addEventListener('click',     _clickHandler);
    document.addEventListener('keydown', _keyHandler);

    _startFlicker();

    _el.style.display = 'flex';
  }

  function hide() {
    _stopFlicker();
    document.removeEventListener('keydown', _keyHandler);
    if (_frame) {
      _frame.mainEl.removeEventListener('mousemove', _mouseMoveHandler);
      _frame.mainEl.removeEventListener('click',     _clickHandler);
    }
    ScannerScreenFrame.unmount(_frame);
    _el.style.display = 'none';
    _frame            = null;
    _system           = null;
    _planets          = null;
    _positions        = null;
    _bgStars          = [];
    _starGlow         = [];
    _mouseMoveHandler = null;
    _clickHandler     = null;
    _lastSd           = null;
  }

  function _render() {
    if (!_frame) return;
    ScannerScreenFrame.render(_frame, {
      viewportRows: _buildOrrery(),
      infoRows: _buildInfoPanel(),
    });
  }

  function _titleText() {
    const pCount = _planets.length;
    return `SYSTEM // ${_system.name} · ${_system.star.spectralClass}-class` +
      ` · ${pCount} planet${pCount !== 1 ? 's' : ''}`;
  }

  // Live Stardate pinned to the right of the title cap; cached so the border only
  // re-renders when the displayed value changes.
  function _refreshTitle() {
    if (!_frame) return;
    const sd = Datastore.has('stardate')
      ? 'STARDATE ' + StardateClock.format(Datastore.get('stardate'))
      : null;
    if (sd === _lastSd) return;
    _lastSd = sd;
    ScannerScreenFrame.setTitle(_frame, _titleText(), sd);
  }

  function _buildOrrery() {
    const inner = Array.from({length: INNER_ROWS}, () =>
      Array.from({length: INNER_COLS}, () => ({char: ' ', color: DIM})));

    Starfield.paint(inner, _bgStars);

    // Draw orbit arcs outermost-first so inner arcs paint over if they overlap
    for (let i = _planets.length - 1; i >= 0; i--) {
      const {rx, ry} = _orbitRadii(i);
      _drawOrbitArc(inner, STAR_COL, STAR_ROW, rx, ry, ORBIT_COLOR);
    }

    // Star glyph (overwrites any arc character at its cell)
    const sc     = _system.star.spectralClass;
    const sGlyph = {M: '.', K: '*', G: '+', F: '@'}[sc] || '+';
    inner[STAR_ROW][STAR_COL] = {char: sGlyph, color: _starPulseColor(sc)};

    // Planets and labels
    for (let i = 0; i < _planets.length; i++) {
      const p        = _planets[i];
      const {col, row} = _positions[i];
      const def      = TERRAIN_GLYPH[p.terrain] || {ch: 'o', color: DIM};
      const selected = i === _selectedIndex;

      if (selected) {
        if (col - 1 >= 0)         inner[row][col - 1] = {char: '[', color: BRIGHT};
        inner[row][col]                                = {char: def.ch, color: BRIGHT};
        if (col + 1 < INNER_COLS) inner[row][col + 1] = {char: ']', color: BRIGHT};
      } else {
        inner[row][col] = {char: def.ch, color: def.color};
      }

      const auText    = p.distanceAU.toFixed(1) + ' AU';
      const labelW    = Math.max(p.name.length, selected ? auText.length : 0);
      const nameStart = _labelStart(col, labelW, selected);
      const nameColor = selected ? BRIGHT : DIM;
      _writeStr(inner, row, nameStart, p.name.slice(0, INNER_COLS - nameStart), nameColor, INNER_COLS);

      // Show AU label only for the selected planet
      if (selected && row + 1 < INNER_ROWS) {
        _writeStr(inner, row + 1, nameStart, auText.slice(0, INNER_COLS - nameStart), DIM, INNER_COLS);
      }
    }

    for (let r = 0; r < inner.length; r++) {
      const glowRow = _starGlow[r];
      if (!glowRow) continue;
      for (let c = 0; c < inner[r].length; c++) inner[r][c].bgColor = glowRow[c];
    }

    return inner;
  }

  function _writeStr(grid, row, startCol, str, color, maxCols) {
    for (let i = 0; i < str.length; i++) {
      const c = startCol + i;
      if (c >= 0 && c < maxCols) grid[row][c] = {char: str[i], color};
    }
  }

  function _orbitRadii(index) {
    const ry = ORBIT_START_RY + index * ORBIT_STEP_RY;
    return { rx: ry * ORBIT_X_SCALE, ry };
  }

  // Draws the visible lower arc of an orbit centered on the star.
  function _drawOrbitArc(inner, starCol, starRow, rx, ry, color) {
    const STEPS = Math.max(160, Math.ceil(Math.PI * Math.max(rx, ry) * 6));
    const points = [];
    let lastKey = null;

    for (let i = 0; i <= STEPS; i++) {
      const theta = Math.PI * i / STEPS;
      const col   = Math.round(starCol + rx * Math.cos(theta));
      const row   = Math.round(starRow + ry * Math.sin(theta));
      if (col < 0 || col >= INNER_COLS || row < 0 || row >= INNER_ROWS) continue;
      if (row <= starRow) continue;

      // Tangent vector in char space, then pixel-space slope (chars ≈ 2× tall)
      const tx   = -rx * Math.sin(theta);
      const ty   =  ry * Math.cos(theta);
      const ps   = tx !== 0 ? (ty / tx) * 2 : Infinity;
      const absP = Math.abs(ps);
      const ch   = absP < 0.5 ? '_' : absP > 2.0 ? '|' : ps > 0 ? '\\' : '/';

      const key = row + ',' + col;
      if (key === lastKey) continue;
      lastKey = key;
      points.push({row, col, ch});
    }

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.ch === '|') {
        let end = i;
        while (end + 1 < points.length &&
               points[end + 1].row === p.row &&
               points[end + 1].ch === '|') {
          end++;
        }

        const midCol = (points[i].col + points[end].col) / 2;
        const barIndex = midCol < starCol ? end : i;
        for (let j = i; j <= end; j++) {
          const q = points[j];
          if (inner[q.row][q.col].char !== ' ') continue;
          inner[q.row][q.col] = {char: j === barIndex ? '|' : '.', color};
        }
        i = end;
        continue;
      }

      if (p.ch !== '\\' && p.ch !== '/') {
        if (inner[p.row][p.col].char === ' ') inner[p.row][p.col] = {char: p.ch, color};
        continue;
      }

      let end = i;
      while (end + 1 < points.length &&
             points[end + 1].row === p.row &&
             (points[end + 1].ch === '\\' || points[end + 1].ch === '/')) {
        end++;
      }

      const midCol = (points[i].col + points[end].col) / 2;
      const slashIndex = midCol < starCol ? end : i;
      for (let j = i; j <= end; j++) {
        const q = points[j];
        if (inner[q.row][q.col].char !== ' ') continue;
        inner[q.row][q.col] = {char: j === slashIndex ? q.ch : '_', color};
      }
      i = end;
    }
  }

  function _computePositions() {
    return _planets.map((p, i) => {
      const {rx, ry} = _orbitRadii(i);
      const seed  = NoiseGen.seedFrom(`${_system.id}:${p.id}:orbit`);
      const rng   = NoiseGen.mulberry32(seed);
      const theta = _visibleOrbitTheta(rx, rng);
      return {
        col: Math.round(STAR_COL + rx * Math.cos(theta)),
        row: Math.round(STAR_ROW + ry * Math.sin(theta)),
      };
    });
  }

  function _visibleOrbitTheta(rx, rng) {
    const leftCos  = (1 - STAR_COL) / rx;
    const rightCos = (INNER_COLS - 2 - STAR_COL) / rx;
    const minTheta = Math.max(ORBIT_MIN_T, Math.acos(Math.min(1, Math.max(-1, rightCos))));
    const maxTheta = Math.min(ORBIT_MAX_T, Math.acos(Math.min(1, Math.max(-1, leftCos))));
    return minTheta + rng() * Math.max(0, maxTheta - minTheta);
  }

  function _labelStart(col, labelW, selected) {
    const width = Math.min(labelW, INNER_COLS);
    const gap   = selected ? 3 : 2;
    const right = col + gap;
    const left  = col - gap - width;
    const preferRight = col <= STAR_COL;

    if (preferRight && right + width <= INNER_COLS) return right;
    if (!preferRight && left >= 0) return left;
    if (right + width <= INNER_COLS) return right;
    if (left >= 0) return left;
    return Math.max(0, Math.min(INNER_COLS - width, right));
  }

  function _generateBgStars() {
    _bgStars = Starfield.create(INNER_COLS, INNER_ROWS, BG_STAR_COUNT, {
      exclude: (row, col) => row < 1 || row >= INNER_ROWS - 1 ||
        (Math.abs(row - STAR_ROW) <= 1 && Math.abs(col - STAR_COL) <= 1),
    });
  }

  // Precomputes one background colour per orrery cell: a radial glow from the
  // central star tinted by its spectral class, over a faint cool void ripple. The
  // field is static per system, so the flicker only re-applies the cached colours.
  function _generateStarGlow() {
    const sc   = _system.star.spectralClass;
    const peak = ColorUtils.mixHex(GLOW_DEEP, SPECTRAL_COLOR[sc] || BRIGHT, GLOW_TINT);
    _starGlow = Array.from({ length: INNER_ROWS }, (_, y) =>
      Array.from({ length: INNER_COLS }, (_, x) => _starGlowColor(x, y, peak)));
  }

  function _starGlowColor(x, y, peak) {
    const dx = x - STAR_COL;
    const dy = (y - STAR_ROW) * GLOW_DY_W;
    const glow = Math.exp(-(dx * dx + dy * dy) / (2 * GLOW_SIGMA * GLOW_SIGMA));
    const ambient = 0.5 + 0.5 * Math.sin(x * 0.21 + y * 0.17) * Math.cos(y * 0.13 - x * 0.09);
    const base = ColorUtils.mixHex(GLOW_DEEP, GLOW_VOID, ambient * GLOW_AMBIENT);
    return ColorUtils.mixHex(base, peak, MathUtils.clamp(glow * GLOW_STRENGTH, 0, 1));
  }

  function _starPulseColor(spectralClass) {
    const base = SPECTRAL_COLOR[spectralClass] || BRIGHT;
    if (!_ambientOn()) return base;
    const phase = (Math.sin(Date.now() / STAR_PULSE_PERIOD_MS * 2 * Math.PI) + 1) / 2;
    return ColorUtils.mixHex(base, BRIGHT, phase * STAR_PULSE_MAX_MIX);
  }

  function _ambientOn() {
    return typeof ScreenFX === 'undefined' || ScreenFX.effectiveMotion() !== 'off';
  }

  function _startFlicker() {
    _flickerTimer = setInterval(() => {
      if (!_frame) return;
      _refreshTitle();
      const twinkled = Starfield.tick(_bgStars);
      if (twinkled || _ambientOn()) _render();
    }, 250);
  }

  function _stopFlicker() {
    if (_flickerTimer) {
      clearInterval(_flickerTimer);
      _flickerTimer = null;
    }
  }

  function _defaultIndex() {
    const hz = Math.sqrt(_system.star.luminosity);
    let i = _planets.findIndex(p => p.landable && p.distanceAU >= hz * 0.8 && p.distanceAU < hz * 2.0);
    if (i >= 0) return i;
    i = _planets.findIndex(p => p.landable);
    return i >= 0 ? i : 0;
  }

  function _fmtC(c) { return (c >= 0 ? '+' : '') + c + '\xB0C'; }

  function _tempColor(c) {
    if (c > 200)  return '#ff2200';
    if (c > 50)   return '#ff6600';
    if (c > 10)   return '#ffaa44';
    if (c > -10)  return '#aaffaa';
    if (c > -50)  return '#88ddff';
    if (c > -100) return '#88ccff';
    return '#6688cc';
  }

  function _buildInfoPanel() {
    const p    = _planets[_selectedIndex];
    const W    = INFO_W;
    const tDef = TERRAIN_GLYPH[p.terrain] || {ch: '?', color: DIM};

    const SEP    = BORDER_COLOR;
    const LABEL  = '#666688';
    const NAME_C = '#ffffff';
    const RES_C  = '#ffdd88';
    const LAND_Y = '#40c840';
    const LAND_N = '#cc4444';

    function row(parts) {
      const cells = [];
      for (const {text, color} of parts)
        for (const ch of text) cells.push({char: ch, color});
      while (cells.length < W) cells.push({char: ' ', color: DIM});
      return cells.slice(0, W);
    }

    function line(text, color) {
      return row([{text: text.slice(0, W).padEnd(W), color}]);
    }

    function blank() { return line('', DIM); }
    function section(label) {
      const fill = Math.max(0, W - label.length - 4);
      return row([
        {text: '── ', color: SEP},
        {text: label, color: LABEL},
        {text: ' ' + '─'.repeat(fill), color: SEP},
      ]);
    }

    const rows = [
      line('SELECTED PLANET', NAME_C),
      line('─'.repeat(W), SEP),
      row([
        {text: '[', color: DIM},
        {text: tDef.ch, color: tDef.color},
        {text: '] ', color: DIM},
        {text: p.name.toUpperCase(), color: NAME_C},
      ]),
    ];

    const terrainLabel = p.terrain === 'gas' ? 'gas giant' : p.terrain;
    rows.push(row([{text: tDef.ch + ' ', color: tDef.color},
                   {text: terrainLabel,  color: tDef.color}]));

    rows.push(row([{text: p.distanceAU.toFixed(2) + ' AU', color: BRIGHT},
                   {text: '  ' + p.orbitalPeriod + 'd orbit', color: LABEL}]));

    rows.push(row([{text: 'day: ', color: LABEL}, {text: p.dayLength + 'h', color: BRIGHT}]));

    if (p.terrain !== 'gas') {
      rows.push(row([{text: 'atmo: ', color: LABEL}, {text: Atmosphere.label(p.atmosphere), color: BRIGHT}]));
    }

    rows.push(blank(), section('TEMP'));

    if (p.terrain === 'gas') {
      rows.push(row([{text: _fmtC(p.tempBaseC), color: _tempColor(p.tempBaseC)}]));
    } else {
      rows.push(row([{text: _fmtC(p.tempMinC), color: _tempColor(p.tempMinC)},
                     {text: ' / ',             color: LABEL},
                     {text: _fmtC(p.tempMaxC), color: _tempColor(p.tempMaxC)}]));
    }

    const landText  = p.landable ? '[ LAND: YES ]' : '[ LAND: NO  ]';
    const landColor = p.landable ? LAND_Y : LAND_N;
    const tail = [blank(), line(landText, landColor)];
    const resourceRows = (p.landable ? (p.resources || []) : []).map(resource =>
      row([{text: ' - ', color: RES_C},
           {text: ResourceMaterials.resourceLabel(resource), color: RES_C}]));

    let resourceSlots = Math.max(0, INFO_H - rows.length - tail.length);
    if (resourceRows.length && resourceSlots > 0) {
      rows.push(section('RESOURCES'));
      resourceSlots--;
      if (resourceRows.length <= resourceSlots) {
        rows.push(...resourceRows);
      } else if (resourceSlots > 0) {
        const visible = Math.max(0, resourceSlots - 1);
        rows.push(...resourceRows.slice(0, visible));
        rows.push(line(' ... +' + (resourceRows.length - visible) + ' more', LABEL));
      }
    }
    rows.push(...tail);

    while (rows.length < INFO_H) rows.push(blank());
    return rows.slice(0, INFO_H);
  }

  function _onKey(e) {
    if (e.repeat) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _selectedIndex = (_selectedIndex - 1 + _planets.length) % _planets.length;
      _render();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      _selectedIndex = (_selectedIndex + 1) % _planets.length;
      _render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      _confirmSelection();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      ScreenManager.show('galaxy-screen', { type: 'static', viewport: true });
    }
  }

  function _onMouseMove(e) {
    const idx = _hoverPlanetIndex(e);
    if (idx !== -1 && idx !== _selectedIndex) {
      _selectedIndex = idx;
      _render();
    }
  }

  function _onClick(e) {
    const idx = _hoverPlanetIndex(e);
    if (idx !== -1) {
      _selectedIndex = idx;
      _confirmSelection();
    }
  }

  function _hoverPlanetIndex(e) {
    const cell = ScannerScreenFrame.viewportCellAt(_frame, e);
    if (!cell) return -1;
    let best = -1, bestDist = 5;
    for (let i = 0; i < _positions.length; i++) {
      const dist = Math.max(
        Math.abs(cell.row - _positions[i].row),
        Math.abs(cell.col - _positions[i].col)
      );
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  }

  function _setOrInit(key, value, type) {
    if (Datastore.has(key)) Datastore.withLock(key, () => value);
    else Datastore.init(key, value, type);
  }

  function _confirmSelection() {
    const p = _planets[_selectedIndex];
    if (!p.landable) return;

    const samePlanet = Datastore.has('currentPlanet') && Datastore.get('currentPlanet').id === p.id;

    _setOrInit('currentPlanet', p, DatastoreTypes.PLANET);

    if (!samePlanet) {
      // The heavy terrain grid is regenerable from seed, so non-current grids are
      // evicted to cap RAM and rebuilt on return. The small objects/deposits stay
      // resident and, thanks to deterministic worldgen, still line up with the rebuild.
      const map = PlanetGrids.ensureResident(p, _system.star.luminosity);
      _setOrInit('planetMap', map, DatastoreTypes.GAME_MAP);
    }

    _setOrInit('dayTurn',       0,    DatastoreTypes.CYCLE);
    _setOrInit('dayPhase',      0,    DatastoreTypes.CYCLE);
    _setOrInit('currentDay',    1,    DatastoreTypes.CYCLE);
    _setOrInit('weatherEvent',  null, DatastoreTypes.WEATHER_EVENT);
    _setOrInit('weatherEvents', [],   DatastoreTypes.WEATHER_EVENT);

    ScreenManager.show('landing-screen', { type: 'handoff', direction: 'down' });
  }

  return { init, show, hide };
})();
