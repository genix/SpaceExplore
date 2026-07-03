// Subscribes to map and player-position Datastore keys; renders a player-centred
// viewport via the active renderer and Renderer. Supports visual effect layers composited
// on top of terrain each draw; see addLayer/removeLayer/clearLayers.
// Precondition: 'planetMap' and 'playerPos' must exist in Datastore before init() is called.
const MapView = (() => {
  // The map-container is a CSS-fixed 61×46 cell box (see planet-view/interior-view
  // css). The frame inset reserves cells around the edge, so the content viewport is
  // derived from the outer box minus the active frame's inset — keeping the rendered
  // grid at exactly 61×46 whichever border style is used.
  const OUTER_W = 61;
  const OUTER_H = 46;
  const BC = '#446644';
  const SCANNER = Object.freeze({
    topLeft: '╔', topRight: '╦', bottomLeft: '╚', bottomRight: '╩',
    horizontal: '═', vertical: '║', topTick: '╤', bottomTick: '╧',
    leftTick: '╟', rightTick: '╢', bright: '#88aa88',
  });
  const RANGE_STEP_CELLS = 10;
  const ANIM_FRAME_MS = 250;
  // Filler cell drawn outside a non-toroidal map's bounds (e.g. the hull exterior
  // of a bounded interior), so the room reads as enclosed rather than tiling.
  const VOID_CELL = Object.freeze({ char: ' ', color: '#0a0c12', bgColor: '#04060b' });

  let _container  = null;
  let _renderer   = null;
  let _unsubMap   = null;
  let _unsubPos   = null;
  let _unsubPhase = null;
  let _mapKey   = 'planetMap';
  let _posKey   = 'playerPos';
  let _phaseKey = 'dayPhase';
  let _frame  = null;   // active frame descriptor { inset, compose }
  let _viewW = 0, _viewH = 0, _charW = 0, _charH = 0;
  let _camX = 0;
  let _camY = 0;
  let _layers = [];
  let _animInterval = null;
  let _rafId = null;
  let _dirty = false;
  let _playerOverlay = null;

  // keys lets a caller point the view at a different map/pos/phase trio (e.g. an
  // interior's interiorMap/interiorPos); defaults preserve the planet-surface keys.
  // Pass phase: null to opt out of a phase subscription entirely. keys.frame selects
  // the border style ('scanner' default; 'bracket' for the ship interior).
  function init(container, renderer, keys = {}) {
    if (_container) destroy();
    _container = container;
    _renderer  = renderer || TerrainRenderer;
    _mapKey    = keys.map || 'planetMap';
    _posKey    = keys.pos || 'playerPos';
    _phaseKey  = keys.phase === undefined ? 'dayPhase' : keys.phase;
    _frame     = FRAMES[keys.frame] || FRAMES.scanner;
    _charW = OUTER_W - 2 * _frame.inset;
    _charH = OUTER_H - 2 * _frame.inset;
    _viewW = (_charW + 1) / 2;
    _viewH = _charH / 2;
    _unsubMap   = Datastore.subscribe(_mapKey, () => _scheduleDraw('map'));
    _unsubPos   = Datastore.subscribe(_posKey, () => _scheduleDraw('pos'));
    _unsubPhase = (_phaseKey && Datastore.has(_phaseKey))
      ? Datastore.subscribe(_phaseKey, () => _scheduleDraw('phase'))
      : null;
    _animInterval = setInterval(() => _scheduleDraw('animate'), ANIM_FRAME_MS);
  }

  function setRenderer(renderer) {
    _renderer = renderer;
    _scheduleDraw('force');
  }

  function getRenderer() {
    return _renderer;
  }

  function refresh(reason = 'force') {
    _scheduleDraw(reason);
  }

  // Whether the active renderer's output depends on a given change signal.
  // 'map' and 'force' always redraw; other signals consult the renderer's
  // `redraw` descriptor (absent ⇒ redraw on everything, the safe default).
  function _wants(reason) {
    if (reason === 'map' || reason === 'force') return true;
    const rd = _renderer && _renderer.redraw;
    return rd ? !!rd[reason] : true;
  }

  // Coalesce all redraw requests into a single draw on the next animation frame.
  function _scheduleDraw(reason) {
    if (!_container || !_wants(reason)) return;
    _dirty = true;
    if (_rafId == null) _rafId = requestAnimationFrame(_flush);
  }

  function _flush() {
    _rafId = null;
    if (!_dirty || !_container) return;
    _dirty = false;
    _draw();
  }

  function destroy() {
    if (_unsubMap)   { _unsubMap();   _unsubMap = null; }
    if (_unsubPos)   { _unsubPos();   _unsubPos = null; }
    if (_unsubPhase) { _unsubPhase(); _unsubPhase = null; }
    if (_animInterval) { clearInterval(_animInterval); _animInterval = null; }
    if (_rafId != null) { cancelAnimationFrame(_rafId); _rafId = null; }
    _dirty = false;
    clearLayers();
    _playerOverlay = null;
    _renderer  = null;
    _container = null;
  }

  // Layer descriptor: { id, zIndex, ignoreTint, getScreenCells(viewportInfo) → charH×charW of {char,color}|null }
  // null cells are transparent (show layer below). ignoreTint skips DayCycle colour adjustment for this layer's cells.
  function addLayer(descriptor) {
    if (_layers.some(l => l.id === descriptor.id))
      throw new Error(`MapView: layer id '${descriptor.id}' already registered`);
    _layers.push(descriptor);
    _layers.sort((a, b) => a.zIndex - b.zIndex);
  }

  function removeLayer(id) {
    const i = _layers.findIndex(l => l.id === id);
    if (i !== -1) _layers.splice(i, 1);
  }

  function clearLayers() {
    _layers = [];
  }

  function _axisTicks(axis, size) {
    const ticks = new Set();
    for (let p = axis; p > 0; p -= RANGE_STEP_CELLS) ticks.add(p);
    for (let p = axis + RANGE_STEP_CELLS; p < size; p += RANGE_STEP_CELLS) ticks.add(p);
    return ticks;
  }

  function _truncateLabel(text, maxLen) {
    if (text.length <= maxLen) return text;
    if (maxLen <= 3) return text.slice(0, maxLen);
    return text.slice(0, maxLen - 3) + '...';
  }

  function _scannerFrame(label, charW, charH, { crosshair = null } = {}) {
    const axisX = crosshair?.x ?? Math.floor(charW / 2);
    const axisY = crosshair?.y ?? Math.floor(charH / 2);
    const xTicks = _axisTicks(axisX, charW);
    const yTicks = _axisTicks(axisY, charH);
    const cell = (char, color = BC) => ({ char, color });
    const horizontal = () => Array.from({ length: charW }, () => cell(SCANNER.horizontal));
    const topRow = [cell(SCANNER.topLeft), ...horizontal(), cell(SCANNER.topRight)];
    const botRow = [cell(SCANNER.bottomLeft), ...horizontal(), cell(SCANNER.bottomRight)];

    for (const x of xTicks) {
      topRow[x + 1] = cell(SCANNER.topTick);
      botRow[x + 1] = cell(SCANNER.bottomTick);
    }

    const axisCol = axisX + 1;
    const axisColor = crosshair ? SCANNER.bright : BC;
    topRow[axisCol] = cell('N', axisColor);
    botRow[axisCol] = cell('S', axisColor);

    const labelStart = 3;
    const labelMax = Math.max(0, axisCol - labelStart - 2);
    const tab = _truncateLabel(`[ ${String(label).trim().toUpperCase()} ]`, labelMax);
    for (let i = 0; i < tab.length; i++) topRow[labelStart + i] = cell(tab[i]);

    function sideCells(row) {
      let left = yTicks.has(row) ? SCANNER.leftTick : SCANNER.vertical;
      let right = yTicks.has(row) ? SCANNER.rightTick : SCANNER.vertical;
      let color = BC;
      if (row === axisY) {
        left = 'W';
        right = 'E';
        color = axisColor;
      }
      return { left: cell(left, color), right: cell(right, color) };
    }

    return { topRow, botRow, sideCells };
  }

  // Wrap the content rows in the scanner instrument frame (default planet/galaxy
  // border): a single-cell ruled edge with bearing/range ticks and N/S/E/W axes.
  function _composeScanner(contentRows, { label, crosshair } = {}) {
    const frame = _scannerFrame(label, _charW, _charH, { crosshair });
    const body = contentRows.map((row, index) => {
      const sides = frame.sideCells(index);
      return [sides.left, ...row, sides.right];
    });
    return [frame.topRow, ...body, frame.botRow];
  }

  // Wrap the content rows in a Stacked Bracket Corners frame (UIBorderStyles.md §2):
  // a two-cell border whose corners are nested `╔╗ ╚╝` brackets with a projecting
  // outer lip. Used for the ship interior, where the panel-clip look fits the hull.
  function _composeBracket(contentRows, { label } = {}) {
    const cell = (char, color = BC) => ({ char, color });
    const w = _charW;
    const strCells = s => Array.from(s, ch => cell(ch));
    const spaces   = () => Array.from({ length: w }, () => cell(' '));
    const cap = label ? `[ ${String(label).trim().toUpperCase()} ]` : '';

    const topLip   = [cell('╔'), cell('╗'), ...strCells(Ascii.centerFill(cap, w, '═')), cell('╔'), cell('╗')];
    const topInner = [cell('╚'), cell('╗'), ...spaces(),                                cell('╔'), cell('╝')];
    const botInner = [cell('╔'), cell('╝'), ...spaces(),                                cell('╚'), cell('╗')];
    const botLip   = [cell('╚'), cell('╝'), ...strCells('═'.repeat(w)),                 cell('╚'), cell('╝')];

    const body = contentRows.map(row => [cell(' '), cell('║'), ...row, cell('║'), cell(' ')]);
    return [topLip, topInner, ...body, botInner, botLip];
  }

  const FRAMES = {
    scanner: { inset: 1, compose: _composeScanner },
    bracket: { inset: 2, compose: _composeBracket },
  };

  function _drawGlobal(map) {
    if (_playerOverlay) _playerOverlay.style.display = 'none';
    const weatherEvents = Datastore.has('weatherEvents')
      ? Datastore.get('weatherEvents')
      : (Datastore.has('weatherEvent') && Datastore.get('weatherEvent') ? [Datastore.get('weatherEvent')] : []);
    const rows = _renderer.getFullGrid(map, weatherEvents, _charW, _charH);

    const ship = ObjectManager.all().find(obj => obj.type === 'ship');
    if (ship) {
      const sx = Math.min(_charW - 1, Math.floor((ship.x + 0.5) / map.w * _charW));
      const sy = Math.min(_charH - 1, Math.floor((ship.y + 0.5) / map.h * _charH));
      rows[sy][sx] = { char: 'S', color: '#ffff55', bgColor: rows[sy][sx].bgColor };
    }

    const pos = Datastore.get(_posKey);
    const px  = Math.min(_charW - 1, Math.floor(pos.x / map.w * _charW));
    const py  = Math.min(_charH - 1, Math.floor(pos.y / map.h * _charH));
    rows[py][px] = { char: '@', color: '#00ff00', bgColor: rows[py][px].bgColor };

    Renderer.renderGrid(_container, _composeScanner(rows, { label: _renderer.label }));
  }

  function _draw() {
    if (!_container || !Datastore.has(_mapKey) || !Datastore.has(_posKey)) return;

    const map  = Datastore.get(_mapKey);
    if (_renderer.isGlobalView) { _drawGlobal(map); return; }
    const pos  = Datastore.get(_posKey);
    const mapH = map.h;
    const mapW = map.w;
    const wrap = map.wrap !== false;

    const camX = pos.x - Math.floor(_viewW / 2);
    const camY = pos.y - Math.floor(_viewH / 2);
    _camX = camX;
    _camY = camY;

    // Build terrain grid: rows[charRow][charCol] = { char, color, bgColor, skipTint }
    const rows = [];
    for (let ty = 0; ty < _viewH; ty++) {
      const rowTop = [];
      const rowBot = [];
      for (let tx = 0; tx < _viewW; tx++) {
        let cells;
        if (wrap) {
          const mx = ((camX + tx) % mapW + mapW) % mapW;
          const my = ((camY + ty) % mapH + mapH) % mapH;
          cells = _renderer.getChars(map.grid[my][mx], mx, my);
        } else {
          const mx = camX + tx;
          const my = camY + ty;
          cells = (my >= 0 && my < mapH && mx >= 0 && mx < mapW)
            ? _renderer.getChars(map.grid[my][mx], mx, my)
            : [VOID_CELL, VOID_CELL, VOID_CELL, VOID_CELL];
        }
        rowTop.push(
          { char: cells[0].char, color: cells[0].color, bgColor: cells[0].bgColor, skipTint: false },
          { char: cells[1].char, color: cells[1].color, bgColor: cells[1].bgColor, skipTint: false }
        );
        rowBot.push(
          { char: cells[2].char, color: cells[2].color, bgColor: cells[2].bgColor, skipTint: false },
          { char: cells[3].char, color: cells[3].color, bgColor: cells[3].bgColor, skipTint: false }
        );
      }
      rows.push(rowTop.slice(0, _charW), rowBot.slice(0, _charW));
    }

    // Composite layers in ascending zIndex order (skipped for data-view renderers)
    if (_layers.length > 0 && !_renderer.hideLayers) {
      const viewportInfo = {
        cameraX: camX, cameraY: camY,
        viewW: _viewW, viewH: _viewH,
        charW: _charW, charH: _charH,
        gameTick: TurnManager.gameTick,
      };
      for (const layer of _layers) {
        const layerCells = layer.getScreenCells(viewportInfo);
        for (let r = 0; r < _charH; r++) {
          const layerRow = layerCells[r];
          if (!layerRow) continue;
          for (let c = 0; c < _charW; c++) {
            const cell = layerRow[c];
            if (cell != null) {
              rows[r][c] = { char: cell.char, color: cell.color, bgColor: rows[r][c].bgColor, skipTint: !!layer.ignoreTint };
            }
          }
        }
      }
    }

    // Apply DayCycle tint scaled by light-source influence for each tile.
    if (!_renderer.ignoreDayCycleTint) {
      for (let r = 0; r < _charH; r++) {
        for (let c = 0; c < _charW; c++) {
          const cell = rows[r][c];
          const wx = ((camX + Math.floor(c / 2)) % mapW + mapW) % mapW;
          const wy = ((camY + Math.floor(r / 2)) % mapH + mapH) % mapH;
          const lf = ObjectManager.getLightFactor(wx, wy);
          if (!cell.skipTint) cell.color = DayCycle.tintColorScaled(cell.color, lf);
          if (cell.bgColor) cell.bgColor = DayCycle.tintColorScaled(cell.bgColor, lf);
        }
      }
    }

    // Strip internal skipTint flag before passing to Renderer
    const finalRows = rows.map(row => row.map(({ char, color, bgColor }) => ({ char, color, bgColor })));

    const grid = _frame.compose(finalRows, {
      label: _renderer.label,
      crosshair: { x: _viewW, y: _viewH },
    });
    Renderer.renderGrid(_container, grid);

    // Player glyph: positioned div centred over the 2x2 tile, above the char grid.
    // Offset past the frame inset so it lands over the right cell.
    const px = (pos.x - camX) * 2 + _frame.inset;
    const py = (pos.y - camY) * 2 + _frame.inset;
    _updatePlayerOverlay(px, py);
  }

  function _updatePlayerOverlay(px, py) {
    if (!_playerOverlay || _playerOverlay.parentElement !== _container) {
      _playerOverlay = document.createElement('div');
      _playerOverlay.className = 'player-glyph';
      _playerOverlay.textContent = '@';
      _container.appendChild(_playerOverlay);
    }
    const pos = Datastore.get(_posKey);
    _playerOverlay.style.display = '';
    _playerOverlay.style.left    = `${px}ch`;
    _playerOverlay.style.top     = `calc(${py} * var(--line-height))`;
    _playerOverlay.style.color   = _renderer.ignoreDayCycleTint
      ? '#33ff66'
      : DayCycle.tintColorScaled('#00ff00', ObjectManager.getLightFactor(pos.x, pos.y));
  }

  function getViewport() {
    return {
      camX: _camX, camY: _camY,
      viewportW: _viewW, viewportH: _viewH,
      charW: _charW, charH: _charH,
    };
  }

  function getLayers() {
    return [..._layers];
  }

  return {
    init, refresh, destroy, getViewport, addLayer, removeLayer, clearLayers,
    getLayers, setRenderer, getRenderer,
    get charW() { return _charW; },
    get charH() { return _charH; },
  };
})();
