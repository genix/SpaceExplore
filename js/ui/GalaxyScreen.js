// Galaxy map screen: shows the banded star map after New Game; Enter proceeds to SolarSystemScreen.
const GalaxyScreen = (() => {
  const SCANNER = ScannerScreenFrame.geometry;
  const MAP_W = SCANNER.viewportW;
  const MAP_H = 44;
  const MAP_VIEW_TOP = 1;
  const MAP_VIEW_H = SCANNER.contentH;
  const INFO_W = SCANNER.infoW;
  const INFO_H = SCANNER.contentH;
  const BORDER_COLOR = '#446644';
  const BOX = {
    h: '\u2500', v: '\u2502',
  };

  // Faint scanner-glow field painted behind the map: near-black deep space lifting
  // to a dim nebula blue around star clusters, plus a low-frequency ambient ripple.
  const NEBULA_DEEP    = '#05060d';
  const NEBULA_BRIGHT  = '#1b2342';
  const NEBULA_SIGMA   = 4.5;
  const NEBULA_DY_W    = 1.9;  // chars are ~2\u00d7 tall, so weight vertical distance up
  const NEBULA_AMBIENT = 0.12;

  // Current-system "you are here" beacon: the glyph and its [ ] brackets breathe
  // toward white on a slow sine so the home star reads at a glance while idle.
  const BEACON_PERIOD_MS = 1600;
  const BEACON_MAX_MIX   = 0.55;

  // Hyperdrive fuel cost of a starlane jump: 1 Aetherium per light-year of lane.
  const AETHERIUM_PER_LY = 1;

  let _el           = null;
  let _frame        = null;
  let _keyHandler   = null;
  let _bgStars      = [];
  let _nebula       = [];
  let _flickerTimer = null;
  let _selectedId   = null;
  let _traveling    = false;
  let _lastSd       = null;

  const _STAR_GLYPHS    = { M: '.', K: '*', G: '+', F: '@' };
  const _LUM_BARS       = { M: 1,   K: 2,   G: 3,   F: 5  };
  const _TERRAIN_GLYPHS = { scorched: '^', arid: '~', temperate: '#', tundra: ',', frozen: '*', gas: 'o' };

  const INFO_DEFAULT  = '#aaaaaa';
  const INFO_DIM      = '#555555';
  const INFO_BRIGHT   = '#dddddd';
  const INFO_SECTION  = '#88bbcc';
  const SELECT_COLOR  = '#55ffff';
  const AETHER_COLOR  = '#a99bff';
  const AFFORD_COLOR  = '#66cc66';
  const DENY_COLOR    = '#cc5555';

  const _STAR_COLORS = { M: '#ff6644', K: '#ff9944', G: '#ffee44', F: '#ccddff' };
  const _TERRAIN_COLORS = {
    scorched: '#ff4422', arid: '#cc8844', temperate: '#44aa44',
    tundra:   '#66bbcc', frozen:  '#aaddff', gas: '#8866cc',
  };
  const _RESOURCE_COLORS = {
    'rare-materials': '#ffcc22',
    'common-metals':  '#888888',
    organics:         '#44bb44',
    water:            '#4488ff',
    ice:              '#88ccff',
    silicon:          '#ccaa66',
    carbon:           '#999999',
    crystal:          '#00ffcc',
    'rare-gases':     '#cc66ff',
    sulfur:           '#aacc00',
    silica:           '#bbaa88',
    methane:          '#44aaaa',
  };

  function init() {
    _el = document.getElementById('galaxy-screen');
    _keyHandler = _onKey;
  }

  function show() {
    if (!Datastore.has('galaxy')) { console.error('GalaxyScreen: galaxy not in Datastore'); return; }

    const galaxy = Datastore.get('galaxy');
    _selectedId = _currentSystemId(galaxy);
    _generateBgStars(galaxy);
    _generateNebula(galaxy);
    _frame = ScannerScreenFrame.mount(_el, {
      title: _titleText(galaxy),
      bindings: _bindings(galaxy),
      borderColor: BORDER_COLOR,
    });

    _lastSd = null;
    _refreshTitle(galaxy);
    _renderMain(galaxy);
    _startFlicker(galaxy);

    document.addEventListener('keydown', _keyHandler);
    _el.style.display = 'flex';
  }

  function hide() {
    _stopFlicker();
    document.removeEventListener('keydown', _keyHandler);
    ScannerScreenFrame.unmount(_frame);
    _el.style.display = 'none';
    _frame = null;
    _selectedId = null;
    _traveling = false;
    _lastSd = null;
    _bgStars = [];
    _nebula = [];
  }

  function _onKey(e) {
    if (e.repeat || _traveling) return;
    const galaxy = Datastore.get('galaxy');

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Tab') {
      e.preventDefault();
      const ring = _ring(galaxy);
      if (ring.length <= 1) return;
      const idx = Math.max(0, ring.indexOf(_selectedId));
      const dir = (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) ? -1 : 1;
      _selectedId = ring[(idx + dir + ring.length) % ring.length];
      _refresh(galaxy);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_selectedId === _currentSystemId(galaxy)) {
        ScreenManager.show('solar-system-screen', { type: 'static', viewport: true });
      } else {
        _travelTo(_selectedId);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      ScreenManager.show('title');
    }
  }

  // Selectable systems: the current system followed by its known neighbors,
  // in starlane order. Unknown neighbors are not travel targets.
  function _ring(galaxy) {
    const currentId = _currentSystemId(galaxy);
    const neighbors = Galaxy.neighborsOf(galaxy, currentId, { knownOnly: true });
    return [currentId, ...neighbors.map(s => s.id)];
  }

  function _refresh(galaxy) {
    _renderMain(galaxy);
    _updateContextBar(galaxy);
  }

  function _updateContextBar(galaxy) {
    ScannerScreenFrame.setBindings(_frame, _bindings(galaxy));
  }

  function _bindings(galaxy) {
    const onCurrent = _selectedId === _currentSystemId(galaxy);
    let enterAction = 'Visit System';
    if (!onCurrent) {
      const dest = galaxy.systems.find(s => s.id === _selectedId);
      enterAction = 'Jump · ' + _travelCost(_currentSystem(galaxy), dest) + ' Aeth';
    }
    return [
      { key: '↑↓',    action: 'Select' },
      { key: 'Enter', action: enterAction },
      { key: 'Esc',   action: 'Quit' },
    ];
  }

  // Opens the in-transit popup for the hop. Galaxy state is committed only when
  // the popup reports arrival (onArrive); aborting during the accel ramp returns
  // here with nothing changed. A _traveling guard blocks key-spam double-hops.
  function _travelTo(destId) {
    if (_traveling) return;
    const galaxy   = Datastore.get('galaxy');
    const origin   = galaxy.systems.find(s => s.id === _currentSystemId(galaxy));
    const dest     = galaxy.systems.find(s => s.id === destId);
    if (!origin || !dest) return;

    const cost = _travelCost(origin, dest);
    if (!_affordable(cost)) return;

    _traveling = true;
    StarlaneTransitPopup.open({
      originSystem: origin,
      destSystem:   dest,
      lengthLy:     _laneLengthLy(origin, dest),
      markers:      [],
      onArrive:     () => _arriveAtSystem(destId, cost),
      onAbort:      () => { _traveling = false; _selectedId = _currentSystemId(Datastore.get('galaxy')); },
    });
  }

  // Jump cost in Aetherium for a hop, derived from the lane length. Deducted only
  // on arrival, so an aborted hop is free.
  function _travelCost(origin, dest) {
    if (!origin || !dest) return 0;
    return Math.max(1, Math.round(_laneLengthLy(origin, dest) * AETHERIUM_PER_LY));
  }

  function _affordable(cost) {
    return Datastore.has('aetherium') && Datastore.get('aetherium') >= cost;
  }

  function _arriveAtSystem(destId, cost) {
    if (cost && Datastore.has('aetherium')) {
      Datastore.withLock('aetherium', a => Math.max(0, a - cost));
    }
    Datastore.withLock('galaxy', g => Galaxy.arriveAt(g, destId));
    const galaxy = Datastore.get('galaxy');
    const dest   = galaxy.systems.find(s => s.id === destId);
    if (Datastore.has('currentSolarSystem')) Datastore.withLock('currentSolarSystem', () => dest);
    else Datastore.init('currentSolarSystem', dest, DatastoreTypes.SOLAR_SYSTEM);

    _traveling  = false;
    _selectedId = destId;
    _refresh(galaxy);
  }

  // Nominal lane length in light-years from galaxy node spacing (no real lane
  // length exists yet); the y axis is unscaled by Y_SCALE so distance is isotropic.
  function _laneLengthLy(a, b) {
    const dx = a.mapPos.x - b.mapPos.x;
    const dy = (a.mapPos.y - b.mapPos.y) / 0.72;
    return MathUtils.clamp(Math.round(Math.sqrt(dx * dx + dy * dy)), 4, 16);
  }

  function _renderMain(galaxy) {
    if (!_frame) return;
    ScannerScreenFrame.render(_frame, {
      viewportRows: _buildMapRows(galaxy),
      infoRows: _buildInfoGrid(galaxy),
    });
  }

  function _titleText(galaxy) {
    return 'GALAXY // ' + galaxy.name;
  }

  // Live Stardate pinned to the right of the title cap. Cached so the border only
  // re-renders when the displayed value actually changes.
  function _refreshTitle(galaxy) {
    if (!_frame) return;
    const sd = Datastore.has('stardate')
      ? 'STARDATE ' + StardateClock.format(Datastore.get('stardate'))
      : null;
    if (sd === _lastSd) return;
    _lastSd = sd;
    ScannerScreenFrame.setTitle(_frame, _titleText(galaxy), sd);
  }

  function _buildMapRows(galaxy) {
    const rows = Galaxy.renderCells(galaxy, {
      currentSystemId: _currentSystemId(galaxy),
      selectedSystemId: _selectedId,
      backgroundStars: _bgStars,
    }).slice(MAP_VIEW_TOP, MAP_VIEW_TOP + MAP_VIEW_H);

    for (let r = 0; r < rows.length; r++) {
      const fieldRow = _nebula[MAP_VIEW_TOP + r];
      if (!fieldRow) continue;
      for (let c = 0; c < rows[r].length; c++) rows[r][c].bgColor = fieldRow[c];
    }
    if (_ambientOn()) _applyBeacon(rows, galaxy);
    return rows;
  }

  function _applyBeacon(rows, galaxy) {
    const sys = _currentSystem(galaxy);
    if (!sys) return;
    const r = sys.mapPos.y - MAP_VIEW_TOP;
    if (r < 0 || r >= rows.length) return;
    const phase = (Math.sin(Date.now() / BEACON_PERIOD_MS * 2 * Math.PI) + 1) / 2;
    const mix = phase * BEACON_MAX_MIX;
    for (const c of [sys.mapPos.x - 1, sys.mapPos.x, sys.mapPos.x + 1]) {
      const cell = rows[r][c];
      if (cell) cell.color = ColorUtils.mixHex(cell.color, '#ffffff', mix);
    }
  }

  function _ambientOn() {
    return typeof ScreenFX === 'undefined' || ScreenFX.effectiveMotion() !== 'off';
  }

  function _buildInfoGrid(galaxy) {
    const currentId = _currentSystemId(galaxy);
    const sys = galaxy.systems.find(s => s.id === _selectedId) || _currentSystem(galaxy);
    const isCurrent = sys.id === currentId;
    const explored = isCurrent || (galaxy.systemStates[sys.id] || 'unknown') === 'visited';
    const starColor = _STAR_COLORS[sys.star.spectralClass] || INFO_DEFAULT;
    const landable = sys.planets.filter(p => p.landable).length;
    const glyph = _STAR_GLYPHS[sys.star.spectralClass] || '.';
    const bars = _LUM_BARS[sys.star.spectralClass] || 3;

    function seg(text, color) {
      return text.split('').map(c => ({ char: c, color }));
    }
    function row(...parts) {
      const cells = parts.flat();
      while (cells.length < INFO_W) cells.push({ char: ' ', color: INFO_DEFAULT });
      return cells.slice(0, INFO_W);
    }
    function emptyRow() {
      return Array.from({ length: INFO_W }, () => ({ char: ' ', color: INFO_DEFAULT }));
    }
    function centerRow(text, color) {
      const pad = Math.max(0, Math.floor((INFO_W - text.length) / 2));
      return row(seg(' '.repeat(pad) + text, color));
    }
    function divRow() {
      return Array.from({ length: INFO_W }, () => ({ char: BOX.h, color: BORDER_COLOR }));
    }
    function sectionRow(label) {
      const dashCount = INFO_W - 3 - label.length - 1;
      return row(
        seg(BOX.h + BOX.h + ' ', BORDER_COLOR),
        seg(label, INFO_SECTION),
        seg(' ' + BOX.h.repeat(Math.max(0, dashCount)), BORDER_COLOR),
      );
    }

    const aetherStr = Datastore.has('aetherium')
      ? String(Math.floor(Datastore.get('aetherium'))) : '0';

    const rows = [
      row(seg(' ' + 'AETHERIUM'.padEnd(10), INFO_DIM), seg(aetherStr, AETHER_COLOR)),
      emptyRow(),
      centerRow(isCurrent ? 'CURRENT SYSTEM' : 'DESTINATION', INFO_BRIGHT),
      divRow(),
      row(
        seg('[', INFO_DEFAULT), seg(glyph, starColor), seg('] ', INFO_DEFAULT),
        seg(sys.star.name.toUpperCase(), isCurrent ? INFO_BRIGHT : SELECT_COLOR),
      ),
    ];

    const lumFill = '*'.repeat(bars) + ' '.repeat(5 - bars);
    rows.push(row(
      seg('    ', INFO_DEFAULT),
      seg(sys.star.spectralClass + '-class', starColor),
      seg('  [', INFO_DEFAULT),
      seg(lumFill, starColor),
      seg(']', INFO_DEFAULT),
    ));

    if (!isCurrent) {
      const cost = _travelCost(_currentSystem(galaxy), sys);
      rows.push(emptyRow());
      rows.push(row(
        seg(' ' + 'JUMP COST'.padEnd(10), INFO_DIM),
        seg(cost + ' Aeth', _affordable(cost) ? AFFORD_COLOR : DENY_COLOR),
      ));
    }

    if (!explored) {
      rows.push(emptyRow());
      rows.push(row(seg('    Unexplored.', INFO_DIM)));
      rows.push(row(seg('    Travel to survey.', INFO_DIM)));
      while (rows.length < INFO_H) rows.push(emptyRow());
      return rows.slice(0, INFO_H);
    }

    rows.push(row(
      seg('  ', INFO_DEFAULT),
      seg(String(sys.planets.length), INFO_BRIGHT),
      seg(' planets / ', INFO_DEFAULT),
      seg(String(landable), INFO_BRIGHT),
      seg(' land', INFO_DEFAULT),
    ));

    rows.push(emptyRow());
    const planetRows = [];
    for (const p of sys.planets) {
      const tColor = _TERRAIN_COLORS[p.terrain] || INFO_DEFAULT;
      const tGlyph = _TERRAIN_GLYPHS[p.terrain] || '?';
      const name = p.name.slice(0, 9).padEnd(9);
      const cells = [
        ...seg(' ', INFO_DEFAULT),
        ...seg(tGlyph, tColor),
        ...seg(' ', INFO_DEFAULT),
        ...seg(name, INFO_DEFAULT),
        ...seg(' ', INFO_DEFAULT),
      ];
      if (p.terrain === 'gas') {
        cells.push(...seg('(gas)', tColor));
      } else {
        let used = 0;
        for (let i = 0; i < p.resources.length; i++) {
          const resId = p.resources[i];
          const code = ResourceMaterials.resourceCode(resId);
          const spaceNeeded = i > 0 ? 1 : 0;
          if (used + spaceNeeded + code.length > 8) break;
          if (i > 0) cells.push(...seg(' ', INFO_DEFAULT));
          cells.push(...seg(code, _RESOURCE_COLORS[resId] || INFO_DEFAULT));
          used += spaceNeeded + code.length;
        }
      }
      planetRows.push(row(cells));
    }

    const laneRows = [];
    const seen = new Set();
    for (const conn of galaxy.connections) {
      let nId = null;
      if (conn.from === sys.id) nId = conn.to;
      else if (conn.to === sys.id) nId = conn.from;
      if (!nId || seen.has(nId)) continue;
      seen.add(nId);

      const state = galaxy.systemStates[nId] || 'unknown';
      const neighbor = galaxy.systems.find(s => s.id === nId);
      const nGlyph = state === 'unknown' ? '?' : (_STAR_GLYPHS[neighbor.star.spectralClass] || '.');
      const nGlyphColor = state === 'unknown' ? '#aa4444' : (_STAR_COLORS[neighbor.star.spectralClass] || INFO_DEFAULT);
      const arrow = state === 'visited' ? '-->' : '..>';
      const arrowColor = state === 'visited' ? '#44aa44' : '#445544';
      const label = state === 'unknown' ? 'unknown' : neighbor.star.name;
      const labelColor = state === 'unknown' ? INFO_DIM : INFO_DEFAULT;

      laneRows.push(row(
        seg(arrow, arrowColor),
        seg(' [', INFO_DEFAULT),
        seg(nGlyph, nGlyphColor),
        seg('] ', INFO_DEFAULT),
        seg(label, labelColor),
      ));
    }

    const laneBlock = [emptyRow(), sectionRow('STARLANES'), ...laneRows];
    let planetSlots = Math.max(0, INFO_H - rows.length - laneBlock.length);
    if (planetSlots > 0) {
      rows.push(sectionRow('PLANETS'));
      planetSlots--;
      if (planetRows.length <= planetSlots) {
        rows.push(...planetRows);
      } else if (planetSlots > 0) {
        const visible = Math.max(0, planetSlots - 1);
        rows.push(...planetRows.slice(0, visible));
        rows.push(row(seg(' ... +' + (planetRows.length - visible) + ' more', INFO_DIM)));
      }
    }
    rows.push(...laneBlock);

    while (rows.length < INFO_H) rows.push(emptyRow());
    return rows.slice(0, INFO_H);
  }

  function _currentSystem(galaxy) {
    const currentId = _currentSystemId(galaxy);
    return galaxy.systems.find(s => s.id === currentId) ||
           galaxy.systems.find(s => s.id === galaxy.startSystemId) ||
           galaxy.systems[0];
  }

  function _currentSystemId(galaxy) {
    return Datastore.has('currentSolarSystem')
      ? Datastore.get('currentSolarSystem').id
      : galaxy.startSystemId;
  }

  function _generateBgStars(galaxy) {
    const occupied = new Set(galaxy.systems.map(s => `${s.mapPos.y},${s.mapPos.x}`));
    _bgStars = Starfield.create(MAP_W, MAP_H, 48, {
      exclude: (row, col) => occupied.has(`${row},${col}`),
    });
  }

  // Precomputes one background colour per map cell. The field is static for a
  // galaxy, so the flicker only re-applies it rather than recomputing.
  function _generateNebula(galaxy) {
    _nebula = Array.from({ length: MAP_H }, (_, y) =>
      Array.from({ length: MAP_W }, (_, x) => _nebulaColor(galaxy, x, y)));
  }

  function _nebulaColor(galaxy, x, y) {
    let glow = 0;
    for (const sys of galaxy.systems) {
      const dx = x - sys.mapPos.x;
      const dy = (y - sys.mapPos.y) * NEBULA_DY_W;
      glow += Math.exp(-(dx * dx + dy * dy) / (2 * NEBULA_SIGMA * NEBULA_SIGMA));
    }
    const ambient = 0.5 + 0.5 * Math.sin(x * 0.22 + y * 0.15) * Math.cos(y * 0.19 - x * 0.08);
    const t = MathUtils.clamp(glow * 0.8 + ambient * NEBULA_AMBIENT, 0, 1);
    return ColorUtils.mixHex(NEBULA_DEEP, NEBULA_BRIGHT, t);
  }

  function _startFlicker(galaxy) {
    _flickerTimer = setInterval(() => {
      if (!_frame) return;
      _refreshTitle(galaxy);
      const twinkled = Starfield.tick(_bgStars, 0.10);
      if (twinkled || _ambientOn()) _renderMain(galaxy);
    }, 250);
  }

  function _stopFlicker() {
    if (_flickerTimer) {
      clearInterval(_flickerTimer);
      _flickerTimer = null;
    }
  }

  return { init, show, hide };
})();
