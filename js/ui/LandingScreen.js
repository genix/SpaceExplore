// Landing spot selector shown after world gen, before PlanetView.
// Renders a scaled ASCII orbital survey; each glyph represents a sector of tiles.
const LandingScreen = (() => {
  // Vertical split: 1-row title strip, a porthole-framed survey pane, an
  // inverted-corner site readout, then the 3-row context bar (1+38+8+3 = 50).
  const SCREEN_W       = 80;
  const SURVEY_FRAME_H = 38;
  const INFO_FRAME_H   = 8;

  // Porthole frame insets (Borders 'porthole'): 4 cols L/R, 2 rows T/B.
  const PORTHOLE_LEFT = 4;
  const PORTHOLE_TOP  = 2;
  const INNER_COLS    = SCREEN_W - 8;          // 72 survey columns
  const INNER_ROWS    = SURVEY_FRAME_H - 4;    // 34 survey rows

  // Inverted frame insets (Borders 'inverted'): 1 col L/R, 2 rows T/B.
  const INFO_INNER_W = SCREEN_W - 2;           // 78
  const INFO_INNER_H = INFO_FRAME_H - 4;       // 4

  const SECTOR_SIZE       = 6;
  const RETICLE_MARGIN    = 8;
  const SCAN_ROW_MS       = 90;
  const SCAN_REFRESH_MS   = 80;
  const DENY_FLASH_MS     = 900;

  const BORDER_COLOR = '#446644';
  const DIM          = '#334433';
  const LABEL        = '#666688';
  const BRIGHT       = '#ffffff';
  const CYAN         = '#88ffff';
  const GREEN        = '#55ff55';
  const RED          = '#ff5555';
  const BLUE         = '#55aaff';
  const YELLOW       = '#ffff55';

  const SCAN_MODES = [
    { id: 'surface',  label: 'SURFACE'  },
    { id: 'temp',     label: 'TEMP'     },
    { id: 'moisture', label: 'MOISTURE' },
    { id: 'landing',  label: 'LANDING'  },
  ];

  const LIQUID_GROUNDS = new Set(['water', 'deep-ocean', 'shallow-ocean', 'lake', 'river']);
  const FROZEN_GROUNDS = new Set(['ice', 'snow', 'frozen-ocean', 'frozen-lake', 'frozen-river', 'frozen-soil']);
  const ROUGH_GROUNDS  = new Set(['rock', 'dry-rock', 'gravel']);

  let _el                = null;
  let _titleEl           = null;
  let _surveyEl          = null;
  let _infoEl            = null;
  let _map               = null;
  let _planet            = null;
  let _sectors           = null;
  let _sectorW           = 0;
  let _sectorH           = 0;
  let _selected          = { sx: 0, sy: 0 };
  let _view              = { sx: 0, sy: 0 };
  let _scanModeIndex     = 0;
  let _scanStart         = 0;
  let _scanTimer         = null;
  let _denyUntil         = 0;
  let _blockedKeys       = new Set();
  let _keyHandler        = null;
  let _mouseMoveHandler  = null;
  let _mouseDownHandler  = null;
  let _clickHandler      = null;
  let _mouseLeaveHandler = null;

  // Cached static porthole frame cells (rebuilt only when the scan-mode title
  // changes) and the last-rendered info-panel signature (gates its rewrite).
  let _frameCells        = null;
  let _frameTitle        = null;
  let _infoSig           = null;
  let _beaconSectors     = new Map(); // key:"sx,sy" → { resourceMap:{resource→count} }

  function init() {
    _el = document.getElementById('landing-screen');
    _keyHandler = _onKey;
  }

  function show() {
    _el.innerHTML = '';
    _map = Datastore.get('planetMap');
    _planet = Datastore.get('currentPlanet');
    _scanModeIndex = 0;
    _denyUntil = 0;
    _scanStart = Date.now();
    _frameCells = null;
    _frameTitle = null;
    _infoSig = null;

    _buildBlockedKeys();
    _buildSectors();
    _loadBeaconSectors();
    _selected = _defaultSelection();
    _syncViewToSelection(true);

    const layoutEl = document.createElement('div');
    layoutEl.className = 'landing-layout';
    _el.appendChild(layoutEl);

    _titleEl = document.createElement('div');
    _titleEl.className = 'landing-title-bar';
    layoutEl.appendChild(_titleEl);

    _surveyEl = document.createElement('div');
    _surveyEl.className = 'landing-survey';
    layoutEl.appendChild(_surveyEl);

    _infoEl = document.createElement('div');
    _infoEl.className = 'landing-info';
    layoutEl.appendChild(_infoEl);

    const contextBarEl = document.createElement('div');
    contextBarEl.id = 'context-bar';
    layoutEl.appendChild(contextBarEl);
    ContextBar.init(contextBarEl, { frame: 'box', width: SCREEN_W, inset: 2 });
    ContextBar.setBindings([
      { key: 'WASD/Arrows', action: 'Move'      },
      { key: 'Tab',         action: 'Scan Mode' },
      { key: 'Enter/Click', action: 'Land'      },
      { key: 'Esc',         action: 'Back'      },
    ]);

    _mouseMoveHandler  = e => _onMouseMove(e);
    _mouseDownHandler  = e => _onMouseDown(e);
    _clickHandler      = e => _onClick(e);
    _mouseLeaveHandler = () => _onMouseLeave();
    _surveyEl.addEventListener('mousemove', _mouseMoveHandler);
    _surveyEl.addEventListener('mousedown', _mouseDownHandler);
    _surveyEl.addEventListener('click', _clickHandler);
    _surveyEl.addEventListener('mouseleave', _mouseLeaveHandler);
    document.addEventListener('keydown', _keyHandler);

    _scanTimer = setInterval(_render, SCAN_REFRESH_MS);
    _render();

    _el.style.display = 'block';
  }

  function hide() {
    document.removeEventListener('keydown', _keyHandler);
    if (_surveyEl) {
      _surveyEl.removeEventListener('mousemove', _mouseMoveHandler);
      _surveyEl.removeEventListener('mousedown', _mouseDownHandler);
      _surveyEl.removeEventListener('click', _clickHandler);
      _surveyEl.removeEventListener('mouseleave', _mouseLeaveHandler);
    }
    if (_scanTimer) {
      clearInterval(_scanTimer);
      _scanTimer = null;
    }
    ContextBar.destroy();
    _el.innerHTML      = '';
    _el.style.display  = 'none';
    _titleEl           = null;
    _surveyEl          = null;
    _infoEl            = null;
    _map               = null;
    _planet            = null;
    _sectors           = null;
    _blockedKeys       = new Set();
    _beaconSectors     = new Map();
    _mouseMoveHandler  = null;
    _mouseDownHandler  = null;
    _clickHandler      = null;
    _mouseLeaveHandler = null;
  }

  function _buildBlockedKeys() {
    _blockedKeys = new Set();
    const key = _objectStoreKey(_planet);
    if (!Datastore.has(key)) return;

    for (const obj of Datastore.get(key)) {
      if (obj.passable || obj.id === 'ship-1') continue;
      for (const { dx, dy } of obj.footprint ?? [{ dx: 0, dy: 0 }]) {
        const x = _wrap(obj.x + dx, _map.w);
        const y = _wrap(obj.y + dy, _map.h);
        _blockedKeys.add(_tileKey(x, y));
      }
    }
  }

  function _buildSectors() {
    _sectorW = Math.ceil(_map.w / SECTOR_SIZE);
    _sectorH = Math.ceil(_map.h / SECTOR_SIZE);
    _sectors = Array.from({ length: _sectorH }, (_, sy) =>
      Array.from({ length: _sectorW }, (_, sx) => _analyzeSector(sx, sy))
    );
  }

  function _analyzeSector(sx, sy) {
    const x0 = sx * SECTOR_SIZE;
    const y0 = sy * SECTOR_SIZE;
    const x1 = Math.min(_map.w, x0 + SECTOR_SIZE);
    const y1 = Math.min(_map.h, y0 + SECTOR_SIZE);
    const stats = {
      sx, sy, x0, y0, x1, y1,
      total: 0, passable: 0, liquid: 0, frozen: 0, snow: 0,
      rough: 0, veg: 0, high: 0,
      tempSum: 0, rainSum: 0, snowSum: 0, elevSum: 0,
      anchor: null,
    };

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tile = _map.grid[y][x];
        const zone = _map.climate.getClimateZone(x, y);
        stats.total++;
        if (MapGen.isPassable(tile)) stats.passable++;
        if (LIQUID_GROUNDS.has(tile.ground)) stats.liquid++;
        if (FROZEN_GROUNDS.has(tile.ground)) stats.frozen++;
        if (tile.ground === 'snow') stats.snow++;
        if (ROUGH_GROUNDS.has(tile.ground)) stats.rough++;
        if (tile.vegetation && tile.vegetation !== 'none') stats.veg++;
        if ((tile.elevation ?? 0) >= Heightmap.MOUNTAIN_THRESHOLD) stats.high++;
        stats.elevSum += tile.elevation ?? 0;
        stats.tempSum += zone.tempK - 273;
        stats.rainSum += zone.rainChance;
        stats.snowSum += zone.snowChance;
      }
    }

    stats.tempC = stats.total ? stats.tempSum / stats.total : 0;
    stats.rain  = stats.total ? stats.rainSum / stats.total : 0;
    stats.snowChance = stats.total ? stats.snowSum / stats.total : 0;
    stats.vegPct = stats.total ? stats.veg / stats.total : 0;
    stats.elev = stats.total ? stats.elevSum / stats.total : 0;
    stats.anchor = _bestAnchorInSector(stats);
    stats.terrain = _terrainLabel(stats);
    return stats;
  }

  function _loadBeaconSectors() {
    _beaconSectors = new Map();
    const key = `objects:${_planet.id}`;
    if (!Datastore.has(key)) return;
    const objects = Datastore.get(key);
    const deposits = objects.filter(o => o.type === 'deposit');

    for (const obj of objects) {
      if (obj.type !== 'beacon') continue;
      const bx = _wrap(obj.x, _map.w);
      const by = _wrap(obj.y, _map.h);
      const sx = Math.floor(bx / SECTOR_SIZE);
      const sy = Math.floor(by / SECTOR_SIZE);
      const sectorKey = `${sx},${sy}`;
      const existing = _beaconSectors.get(sectorKey) ?? { resourceMap: {} };

      for (const dep of deposits) {
        const depX = _wrap(dep.x, _map.w);
        const depY = _wrap(dep.y, _map.h);
        let ddx = Math.abs(depX - bx);
        let ddy = Math.abs(depY - by);
        ddx = Math.min(ddx, _map.w - ddx);
        ddy = Math.min(ddy, _map.h - ddy);
        if (ddx * ddx + ddy * ddy <= SECTOR_SIZE * SECTOR_SIZE) {
          existing.resourceMap[dep.resource] = (existing.resourceMap[dep.resource] || 0) + 1;
        }
      }

      _beaconSectors.set(sectorKey, existing);
    }
  }

  function _bestAnchorInSector(sector) {
    const cx = (sector.x0 + sector.x1 - 1) / 2;
    const cy = (sector.y0 + sector.y1 - 1) / 2;
    let best = null;
    let bestScore = Infinity;

    for (let y = sector.y0; y < sector.y1; y++) {
      for (let x = sector.x0; x < sector.x1; x++) {
        if (!_isValidAnchor(x, y)) continue;
        const score = Math.abs(x - cx) + Math.abs(y - cy);
        if (score < bestScore) {
          best = { x, y };
          bestScore = score;
        }
      }
    }
    return best;
  }

  function _defaultSelection() {
    const center = { sx: (_sectorW - 1) / 2, sy: (_sectorH - 1) / 2 };
    let best = null;
    let bestScore = Infinity;

    if (_beaconSectors.size > 0) {
      for (const key of _beaconSectors.keys()) {
        const [sx, sy] = key.split(',').map(Number);
        if (!_sectors[sy]?.[sx]?.anchor) continue;
        const score = Math.abs(sx - center.sx) + Math.abs(sy - center.sy);
        if (score < bestScore) { best = { sx, sy }; bestScore = score; }
      }
      if (best) return best;
      bestScore = Infinity;
    }

    for (let sy = 0; sy < _sectorH; sy++) {
      for (let sx = 0; sx < _sectorW; sx++) {
        const sector = _sectors[sy][sx];
        if (!sector.anchor) continue;
        const score = Math.abs(sx - center.sx) + Math.abs(sy - center.sy);
        if (score < bestScore) { best = { sx, sy }; bestScore = score; }
      }
    }

    return best ?? { sx: Math.floor(center.sx), sy: Math.floor(center.sy) };
  }

  function _render() {
    if (!_surveyEl || !_infoEl || !_map || !_planet) return;
    _titleEl.textContent = _buildTitle();
    Renderer.renderGrid(_surveyEl, _framedSurvey(), { cellClass: 'render-cell' });
    _renderInfoIfChanged();
  }

  // Survey panel as a full 80x38 cell grid: the static porthole frame (reused
  // across frames, rebuilt only when the scan-mode title changes) with the live
  // survey content composited into the inner rectangle. Fed to renderGrid so the
  // animation only touches the cells that actually change.
  function _framedSurvey() {
    const title = ` ${SCAN_MODES[_scanModeIndex].label} SCAN `;
    if (!_frameCells || _frameTitle !== title) {
      const frameRows = Borders.render('porthole', SCREEN_W, SURVEY_FRAME_H, {
        title, contentLines: null, borderColor: null,
      });
      _frameCells = frameRows.map(s => Array.from(s, ch => ({ char: ch, color: BORDER_COLOR })));
      _frameTitle = title;
    }

    const content = _buildSurveyContent();
    const grid = _frameCells.map(row => row.slice());
    for (let r = 0; r < INNER_ROWS; r++) {
      const gridRow = grid[PORTHOLE_TOP + r];
      const contentRow = content[r];
      for (let c = 0; c < INNER_COLS; c++) {
        gridRow[PORTHOLE_LEFT + c] = contentRow[c];
      }
    }
    return grid;
  }

  // The site-analysis panel changes only with the selected sector, scan mode, or
  // the deny flash — rewrite it only when one of those changes, not every frame.
  function _renderInfoIfChanged() {
    const sig = `${_selected.sx},${_selected.sy}|${_scanModeIndex}|${Date.now() < _denyUntil ? 1 : 0}`;
    if (sig === _infoSig) return;
    _infoSig = sig;

    const infoLines = _buildInfoContent().map(row => ({
      html: Renderer.rowHtml(row, 'render-cell'),
    }));
    Renderer.renderHtml(_infoEl, Borders.render('inverted', SCREEN_W, INFO_FRAME_H, {
      title: 'SITE ANALYSIS',
      contentLines: infoLines,
      borderColor: BORDER_COLOR,
    }));
  }

  function _buildTitle() {
    const mode = SCAN_MODES[_scanModeIndex].label;
    const sweep = ['|', '/', '-', '\\'][Math.floor((Date.now() - _scanStart) / 180) % 4];
    const label = ` LANDING // ${_planet.name} | ${_planet.terrain} | ${_planet.distanceAU.toFixed(1)} AU | RES ${SECTOR_SIZE}x${SECTOR_SIZE} | SCAN ${sweep} ${mode} `
      .toUpperCase().slice(0, 70);
    const innerW = 74;
    const left = Math.floor((innerW - label.length) / 2);
    return '  /' + '\u2500'.repeat(left) + label + '\u2500'.repeat(innerW - label.length - left) + '\\  ';
  }

  function _buildSurveyContent() {
    const rows = _emptyRows(INNER_ROWS, INNER_COLS, ' ', DIM);

    for (let r = 0; r < INNER_ROWS; r++) {
      for (let c = 0; c < INNER_COLS; c++) {
        const sx = _view.sx + c;
        const sy = _view.sy + r;
        const cell = _sectorCell(sx, sy);
        rows[r][c] = _applyScan(cell, r, sx, sy);
        if (_beaconSectors.has(`${_wrap(sx, _sectorW)},${_wrap(sy, _sectorH)}`)) {
          const pulse = (Math.sin(Date.now() / 300) + 1) / 2;
          const beaconColor = ColorUtils.mixHex('#ffaa00', '#884400', 1 - pulse);
          rows[r][c] = { char: '!', color: beaconColor, bgColor: rows[r][c].bgColor };
        }
      }
    }

    _drawReticle(rows);
    return rows;
  }

  function _sectorAt(sx, sy) {
    return _sectors[_wrap(sy, _sectorH)][_wrap(sx, _sectorW)];
  }

  function _sectorCell(sx, sy) {
    const sector = _sectorAt(sx, sy);
    const mode = SCAN_MODES[_scanModeIndex].id;
    const base =
      mode === 'temp'     ? _tempCell(sector)     :
      mode === 'moisture' ? _moistureCell(sector) :
      mode === 'landing'  ? _landingCell(sector)  :
                            _surfaceCell(sector);
    return { char: base.char, color: base.color, bgColor: _reliefBg(sector, base.bgColor) };
  }

  // Background carries elevation as shaded relief, mirroring the walking Planet View
  // (TerrainRenderer brightens its tile background by elevation). Land brightens as it
  // rises; water-dominant sectors brighten by shallowness so basins read darkest. The
  // ramp is anchored on sea level and uses a stronger factor than the per-tile view
  // because a sector's elevation is an average over its tiles.
  function _reliefBg(sector, baseBg) {
    const total = Math.max(1, sector.total);
    const isWater = sector.liquid / total > 0.45;
    const sea = Heightmap.SEA_LEVEL;
    const ratio = isWater
      ? _clamp(sector.elev / sea, 0, 1)
      : _clamp((sector.elev - sea) / (1 - sea), 0, 1);
    return ColorUtils.brightenHex(baseBg, ratio * (isWater ? 26 : 60));
  }

  function _surfaceCell(sector) {
    const total = Math.max(1, sector.total);
    const liquid = sector.liquid / total;
    const frozen = sector.frozen / total;
    const snow = sector.snow / total;
    const high = sector.high / total;
    const rough = sector.rough / total;

    if (liquid > 0.45) return { char: '~', color: '#2a7aaa', bgColor: '#050d18' };
    if (snow > 0.35) return { char: '*', color: '#dde8f0', bgColor: '#10161c' };
    if (frozen > 0.40) return { char: '#', color: '#aad8e8', bgColor: '#0a1520' };
    if (sector.vegPct > 0.25) return { char: ';', color: '#55aa44', bgColor: '#071505' };
    if (high > 0.20 || sector.elev > 0.62) return { char: '^', color: '#aaa080', bgColor: '#15120a' };
    if (rough > 0.35) return { char: ':', color: '#aa8855', bgColor: '#151008' };
    return { char: '.', color: '#c4a35a', bgColor: '#120e06' };
  }

  function _tempCell(sector) {
    const t = sector.tempC;
    if (t <= -70) return { char: '#', color: '#6688cc', bgColor: '#050812' };
    if (t <= -25) return { char: '*', color: '#88ccff', bgColor: '#061018' };
    if (t <= 5)   return { char: '-', color: '#88ddff', bgColor: '#071414' };
    if (t <= 30)  return { char: '.', color: '#aaffaa', bgColor: '#071507' };
    if (t <= 80)  return { char: '+', color: '#ffdd66', bgColor: '#181202' };
    return { char: '^', color: '#ff6644', bgColor: '#1a0804' };
  }

  function _moistureCell(sector) {
    const wet = Math.max(sector.rain, sector.snowChance);
    if (sector.snowChance > 0.45) return { char: '*', color: '#ddeeff', bgColor: '#081018' };
    if (wet > 0.75) return { char: '~', color: '#55bbff', bgColor: '#06121c' };
    if (wet > 0.45) return { char: ';', color: '#55ff99', bgColor: '#061406' };
    if (wet > 0.20) return { char: ':', color: '#88aa66', bgColor: '#101408' };
    return { char: '.', color: '#776644', bgColor: '#100c06' };
  }

  function _landingCell(sector) {
    if (sector.anchor) return { char: '.', color: GREEN, bgColor: '#041204' };
    if (sector.liquid / Math.max(1, sector.total) > 0.45) {
      return { char: '~', color: BLUE, bgColor: '#050d18' };
    }
    return { char: 'x', color: RED, bgColor: '#180404' };
  }

  function _applyScan(cell, row, sx, sy) {
    const elapsed = Date.now() - _scanStart;
    const scanRow = Math.floor(elapsed / SCAN_ROW_MS) % INNER_ROWS;
    const firstPass = elapsed < INNER_ROWS * SCAN_ROW_MS;

    if (firstPass && row > scanRow + 1) {
      const unresolved = _hash(sx, sy, Math.floor(elapsed / 200)) % 17 === 0;
      return {
        char: unresolved ? '?' : cell.char,
        color: ColorUtils.mixHex(cell.color, '#222222', 0.70),
        bgColor: cell.bgColor,
      };
    }

    const age = (scanRow - row + INNER_ROWS) % INNER_ROWS;
    if (age === 0) {
      return { char: cell.char, color: CYAN, bgColor: '#003333' };
    }
    if (age <= 3) {
      return {
        char: cell.char,
        color: ColorUtils.mixHex(CYAN, cell.color, age / 4),
        bgColor: cell.bgColor,
      };
    }
    return cell;
  }

  function _drawReticle(rows) {
    const c = _selected.sx - _view.sx;
    const r = _selected.sy - _view.sy;
    if (c < 0 || c >= INNER_COLS || r < 0 || r >= INNER_ROWS) return;

    const sector = _getSelectedSector();
    const color = sector?.anchor ? GREEN : RED;

    rows[r][c] = { char: '@', color: BRIGHT, bgColor: color === GREEN ? '#063006' : '#300606' };
    if (c - 1 >= 0) rows[r][c - 1] = { char: '[', color, bgColor: '#000000' };
    if (c + 1 < INNER_COLS) rows[r][c + 1] = { char: ']', color, bgColor: '#000000' };
  }

  // Horizontal full-width readout: a labelled stat grid laid across 6 columns,
  // with scan/resolution/landing-status on the second pair of rows.
  function _buildInfoContent() {
    const rows = _emptyRows(INFO_INNER_H, INFO_INNER_W, ' ', DIM);
    const sector = _getSelectedSector();

    if (!sector) {
      _writeText(rows, 0, 1, 'NO SIGNAL', RED, INFO_INNER_W - 2);
      return rows;
    }

    const deny          = Date.now() < _denyUntil;
    const temp          = _fmtSigned(Math.round(sector.tempC)) + ' C';
    const wetLabel      = sector.snowChance > sector.rain ? 'SNOW' : 'RAIN';
    const wetPct        = Math.round(Math.max(sector.rain, sector.snowChance) * 100) + '%';
    const vegPct        = Math.round(sector.vegPct * 100) + '%';
    const landing       = sector.anchor ? 'CLEAR' : 'DENIED';
    const landingDetail = sector.anchor ? '2x2 anchor found' : _landingReason(sector);
    const landingColor  = sector.anchor && !deny ? GREEN : RED;

    const col = [1, 14, 27, 40, 53, 66];
    const W   = 12;

    _writeText(rows, 0, col[0], 'SECTOR',   LABEL, W);
    _writeText(rows, 0, col[1], 'TERRAIN',  LABEL, W);
    _writeText(rows, 0, col[2], 'TEMP',     LABEL, W);
    _writeText(rows, 0, col[3], wetLabel,   LABEL, W);
    _writeText(rows, 0, col[4], 'VEG',      LABEL, W);
    _writeText(rows, 0, col[5], 'LANDING',  LABEL, W);

    _writeText(rows, 1, col[0], `${sector.sx},${sector.sy}`,      BRIGHT, W);
    _writeText(rows, 1, col[1], sector.terrain,                   _surfaceCell(sector).color, W);
    _writeText(rows, 1, col[2], temp,                             _tempCell(sector).color, W);
    _writeText(rows, 1, col[3], wetPct,                           _moistureCell(sector).color, W);
    _writeText(rows, 1, col[4], vegPct,                           GREEN, W);
    _writeText(rows, 1, col[5], deny ? 'DROP DENIED' : landing,   landingColor, W);

    _writeText(rows, 2, col[0], 'SCAN',       LABEL, W);
    _writeText(rows, 2, col[1], 'RESOLUTION', LABEL, W);
    _writeText(rows, 2, col[2], 'STATUS',     LABEL, INFO_INNER_W - col[2] - 1);

    _writeText(rows, 3, col[0], SCAN_MODES[_scanModeIndex].label,  CYAN, W);
    _writeText(rows, 3, col[1], `${SECTOR_SIZE}x${SECTOR_SIZE} tiles`, BRIGHT, W);
    _writeText(rows, 3, col[2], landingDetail, sector.anchor ? GREEN : RED, INFO_INNER_W - col[2] - 1);

    const elevBand = _elevBand(sector);
    _writeText(rows, 2, col[4], 'ELEV',         LABEL, W);
    _writeText(rows, 3, col[4], elevBand.label, elevBand.color, W);

    const beaconInfo = _beaconSectors.get(`${sector.sx},${sector.sy}`);
    if (beaconInfo) {
      _writeText(rows, 2, col[5], 'NEAR RES', LABEL, W);
      const resources = Object.entries(beaconInfo.resourceMap);
      if (resources.length === 0) {
        _writeText(rows, 3, col[5], 'none', DIM, W);
      } else {
        let x = col[5];
        for (const [resource] of resources) {
          if (x + 2 > col[5] + W) break;
          _writeText(rows, 3, x, ResourceItems.getCode(resource), ResourceItems.getColor(resource), 2);
          x += 3;
        }
      }
    }

    return rows;
  }

  function _terrainLabel(sector) {
    const total = Math.max(1, sector.total);
    if (sector.liquid / total > 0.45) return 'liquid';
    if (sector.snow / total > 0.35) return 'snow';
    if (sector.frozen / total > 0.40) return 'frozen';
    if (sector.vegPct > 0.25) return 'vegetated';
    if (sector.high / total > 0.20 || sector.elev > 0.62) return 'highland';
    if (sector.rough / total > 0.35) return 'rough';
    return 'open land';
  }

  // Elevation band for the readout; colour goes dim->bright to mirror the relief background.
  function _elevBand(sector) {
    const e = sector.elev;
    if (e < Heightmap.SEA_LEVEL)         return { label: 'BASIN', color: BLUE };
    if (e < 0.50)                        return { label: 'LOW',   color: '#7a8a7a' };
    if (e < Heightmap.MOUNTAIN_THRESHOLD) return { label: 'MID',  color: '#bcd0bc' };
    return { label: 'HIGH', color: BRIGHT };
  }

  function _landingReason(sector) {
    const total = Math.max(1, sector.total);
    if (sector.liquid / total > 0.45) return 'water mass';
    if (sector.passable / total < 0.25) return 'no surface';
    return 'need clear 2x2';
  }

  function _getSelectedSector() {
    if (!_sectors) return null;
    return _sectorAt(_selected.sx, _selected.sy);
  }

  function _moveSelection(dx, dy) {
    _selected = { sx: _selected.sx + dx, sy: _selected.sy + dy };
    _syncViewToSelection(false);
    _render();
  }

  function _syncViewToSelection(center) {
    if (center) {
      _view.sx = _selected.sx - Math.floor(INNER_COLS / 2);
      _view.sy = _selected.sy - Math.floor(INNER_ROWS / 2);
      return;
    }

    if (_selected.sx < _view.sx + RETICLE_MARGIN) {
      _view.sx = _selected.sx - RETICLE_MARGIN;
    } else if (_selected.sx >= _view.sx + INNER_COLS - RETICLE_MARGIN) {
      _view.sx = _selected.sx - INNER_COLS + RETICLE_MARGIN + 1;
    }

    if (_selected.sy < _view.sy + RETICLE_MARGIN) {
      _view.sy = _selected.sy - RETICLE_MARGIN;
    } else if (_selected.sy >= _view.sy + INNER_ROWS - RETICLE_MARGIN) {
      _view.sy = _selected.sy - INNER_ROWS + RETICLE_MARGIN + 1;
    }
  }

  function _confirmSelection() {
    const sector = _getSelectedSector();
    if (!sector || !sector.anchor) {
      _denyUntil = Date.now() + DENY_FLASH_MS;
      _render();
      return;
    }
    _landAt(sector.anchor.x, sector.anchor.y);
  }

  function _landAt(x, y) {
    if (!_isValidAnchor(x, y)) return;
    const spawn = _findPlayerSpawn(x, y);
    if (!spawn) return;

    const objKey = _objectStoreKey(_planet);
    const newShip = ShipObject.create(x, y);

    if (!Datastore.has(objKey)) {
      Datastore.init(objKey, [newShip], DatastoreTypes.OBJECT);
    } else {
      Datastore.withLock(objKey, objs => {
        const existing = objs.find(o => o.id === newShip.id);
        if (!existing) return [...objs, newShip];
        return objs.map(o => o.id === newShip.id
          ? { ...o, x, y, footprint: newShip.footprint, glyphs: newShip.glyphs, passable: newShip.passable }
          : o
        );
      });
    }

    if (Datastore.has('playerPos')) {
      Datastore.withLock('playerPos', () => spawn);
    } else {
      Datastore.init('playerPos', spawn, DatastoreTypes.PLAYER);
    }

    ScreenManager.show('planet-view', { type: 'touchdown', direction: 'down' });
  }

  function _isValidAnchor(ax, ay) {
    if (_inCrater(ax, ay)) return false;
    for (const { dx, dy } of ShipObject.FOOTPRINT) {
      const tx = _wrap(ax + dx, _map.w);
      const ty = _wrap(ay + dy, _map.h);
      if (!MapGen.isPassable(_map.grid[ty][tx])) return false;
      if (_blockedKeys.has(_tileKey(tx, ty))) return false;
    }
    return _findPlayerSpawn(ax, ay) !== null;
  }

  // Keeps the ship from dropping into a crater bowl or its rim; the boulder ring
  // already blocks rim tiles, but the floor and gaps stay passable otherwise.
  function _inCrater(ax, ay) {
    const craters = _planet?.craterMeta;
    if (!craters || craters.length === 0) return false;
    for (const c of craters) {
      if (c.broken) continue; // shallow, passable — fine to land in
      let dx = Math.abs(ax - c.cx); dx = Math.min(dx, _map.w - dx);
      let dy = Math.abs(ay - c.cy); dy = Math.min(dy, _map.h - dy);
      const rad = c.radius + 2;
      if (dx * dx + dy * dy <= rad * rad) return true;
    }
    return false;
  }

  function _findPlayerSpawn(ax, ay) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 2; dx++) {
        if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue;
        const tx = _wrap(ax + dx, _map.w);
        const ty = _wrap(ay + dy, _map.h);
        if (!MapGen.isPassable(_map.grid[ty][tx])) continue;
        if (_blockedKeys.has(_tileKey(tx, ty))) continue;
        return { x: tx, y: ty };
      }
    }
    return null;
  }

  function _objectStoreKey(planet) {
    return `objects:${planet.id}`;
  }

  function _tileKey(x, y) {
    return `${x},${y}`;
  }

  function _wrap(v, max) {
    return ((v % max) + max) % max;
  }

  function _onKey(e) {
    const key = e.key.toLowerCase();
    if (key === 'escape' || key === 'backspace') {
      e.preventDefault();
      ScreenManager.show(
        Datastore.has('currentSolarSystem') ? 'solar-system-screen' : 'title',
        { type: 'handoff', direction: 'up' }
      );
    } else if (key === 'enter') {
      e.preventDefault();
      _confirmSelection();
    } else if (key === 'tab') {
      e.preventDefault();
      _scanModeIndex = (_scanModeIndex + 1) % SCAN_MODES.length;
      _scanStart = Date.now();
      _render();
    } else if (key === 'arrowup' || key === 'w') {
      e.preventDefault();
      _moveSelection(0, -1);
    } else if (key === 'arrowdown' || key === 's') {
      e.preventDefault();
      _moveSelection(0, 1);
    } else if (key === 'arrowleft' || key === 'a') {
      e.preventDefault();
      _moveSelection(-1, 0);
    } else if (key === 'arrowright' || key === 'd') {
      e.preventDefault();
      _moveSelection(1, 0);
    }
  }

  function _onMouseMove(e) {
    if (_eventHitsReticleGlyph(e)) {
      const sector = _getSelectedSector();
      _surveyEl.style.cursor = sector?.anchor ? 'crosshair' : 'not-allowed';
      return;
    }

    const sector = _eventToSector(e);
    if (!sector) {
      _surveyEl.style.cursor = 'default';
      return;
    }
    _surveyEl.style.cursor = _sectorAt(sector.sx, sector.sy).anchor ? 'crosshair' : 'not-allowed';
    if (sector.sx === _selected.sx && sector.sy === _selected.sy) return;
    _selected = sector;
    _syncViewToSelection(false);
    _render();
  }

  function _onClick(e) {
    if (e.detail !== 0) return;
    _confirmFromPointerEvent(e);
  }

  function _onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    _confirmFromPointerEvent(e);
  }

  function _confirmFromPointerEvent(e) {
    if (_eventHitsReticleGlyph(e)) {
      _confirmSelection();
      return;
    }

    const sector = _eventToSector(e);
    if (sector) {
      _selected = sector;
      _syncViewToSelection(false);
      _confirmSelection();
    }
  }

  function _onMouseLeave() {
    if (_surveyEl) _surveyEl.style.cursor = 'default';
  }

  function _eventHitsReticleGlyph(e) {
    const text = e.target?.textContent;
    return text === '@' || text === '[' || text === ']';
  }

  function _eventToSector(e) {
    const pre = _surveyEl.querySelector('pre');
    if (!pre) return null;
    const rect = pre.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const frameCol = Math.floor((e.clientX - rect.left) / rect.width * SCREEN_W);
    const frameRow = Math.floor((e.clientY - rect.top) / rect.height * SURVEY_FRAME_H);
    const col = frameCol - PORTHOLE_LEFT;
    const row = frameRow - PORTHOLE_TOP;
    if (col < 0 || col >= INNER_COLS || row < 0 || row >= INNER_ROWS) return null;

    const reticleCol = _selected.sx - _view.sx;
    const reticleRow = _selected.sy - _view.sy;
    if (row === reticleRow && Math.abs(col - reticleCol) <= 1) {
      return { sx: _selected.sx, sy: _selected.sy };
    }

    return { sx: _view.sx + col, sy: _view.sy + row };
  }

  function _emptyRows(h, w, char, color) {
    return Array.from({ length: h }, () =>
      Array.from({ length: w }, () => ({ char, color, bgColor: '#000000' }))
    );
  }

  function _writeText(rows, row, col, text, color, maxW) {
    for (let i = 0; i < text.length && i < maxW; i++) {
      const c = col + i;
      if (row >= 0 && row < rows.length && c >= 0 && c < rows[row].length) {
        rows[row][c] = { char: text[i], color, bgColor: rows[row][c].bgColor };
      }
    }
  }

  function _fmtSigned(n) {
    return (n >= 0 ? '+' : '') + n;
  }

  function _clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function _hash(a, b, c) {
    let h = ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
  }

  return { init, show, hide };
})();
