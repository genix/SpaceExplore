// Shared 80×50 scanner chassis used by GalaxyScreen and SolarSystemScreen.
// Callers provide a 54×43 viewport and 23×43 information pane; this module owns
// the attached title cap, circle-cluster frame, divider, compact controls, and
// pointer-to-viewport coordinate conversion.
const ScannerScreenFrame = (() => {
  const geometry = Object.freeze({
    screenW: 80,
    titleH: 1,
    chassisH: 47,
    contentH: 43,
    viewportW: 54,
    infoW: 23,
    contextH: 2,
    viewportFrameRow: 2,
    viewportFrameCol: 1,
  });

  const DEFAULTS = {
    borderColor: '#446644',
    titleColor: '#ffff55',
    titleBg: '#1a1800',
    infoBg: '#0d0d18',
    viewportColor: '#888888',
    infoColor: '#aaaaaa',
  };

  // Faint blue lift mixed into alternating info rows so the readout pane reads as
  // a scanning CRT rather than a flat panel.
  const INFO_SCANLINE = '#1b2238';

  // Right-aligned telemetry on the title cap (e.g. the live Stardate).
  const STATUS_COLOR = '#88bbcc';

  let _activeHandle = null;

  function mount(root, options = {}) {
    if (_activeHandle) unmount(_activeHandle);
    root.innerHTML = '';

    const layoutEl = document.createElement('div');
    layoutEl.className = 'scanner-screen-layout';

    const titleEl = document.createElement('div');
    titleEl.className = 'scanner-title-bar';

    const mainEl = document.createElement('div');
    mainEl.className = 'scanner-main-frame';

    const contextEl = document.createElement('div');
    contextEl.id = 'context-bar';

    layoutEl.append(titleEl, mainEl, contextEl);
    root.appendChild(layoutEl);

    const handle = {
      root, layoutEl, titleEl, mainEl, contextEl,
      colors: {
        borderColor: options.borderColor || DEFAULTS.borderColor,
        titleColor: options.titleColor || DEFAULTS.titleColor,
        titleBg: options.titleBg || DEFAULTS.titleBg,
        infoBg: options.infoBg || DEFAULTS.infoBg,
      },
    };

    _activeHandle = handle;
    ContextBar.init(contextEl, {
      compact: true,
      frame: 'bottom-cap',
      width: geometry.screenW,
      inset: 2,
    });
    setTitle(handle, options.title || '');
    setBindings(handle, options.bindings || []);
    return handle;
  }

  function render(handle, { viewportRows = [], infoRows = [] } = {}) {
    if (!handle) return [];
    const viewport = _normalizeRows(
      viewportRows, geometry.viewportW, geometry.contentH,
      DEFAULTS.viewportColor, null,
    );
    const info = _normalizeRows(
      infoRows, geometry.infoW, geometry.contentH,
      DEFAULTS.infoColor, r => _infoBg(handle, r),
    );

    const contentLines = viewport.map((row, r) => ({
      html: Renderer.rowHtml([...row, _dividerCell(handle, r), ...info[r]], 'render-cell'),
    }));
    const frameRows = Borders.render('circle', geometry.screenW, geometry.chassisH, {
      contentLines,
      borderColor: handle.colors.borderColor,
    });
    Renderer.renderHtml(handle.mainEl, frameRows);
    return frameRows;
  }

  // Optional `status` is drawn right-aligned on the cap (e.g. the live Stardate);
  // the main title is centered in whatever space remains so the two never overlap.
  function setTitle(handle, title, status) {
    if (!handle) return;
    const row = Array.from({ length: geometry.screenW }, () => ({
      char: ' ', color: handle.colors.borderColor,
    }));
    for (let c = 2; c <= 77; c++) {
      row[c] = { char: ' ', color: handle.colors.borderColor, bgColor: handle.colors.titleBg };
    }
    row[2].char = '/';
    row[77].char = '\\';
    for (let c = 3; c <= 76; c++) row[c].char = '─';

    const place = (text, start, color) => {
      for (let i = 0; i < text.length; i++) {
        const c = start + i;
        if (c < 3 || c > 76) continue;
        row[c] = { char: text[i], color, bgColor: handle.colors.titleBg };
      }
    };

    let centerEnd = 76;
    if (status) {
      const slabel = ' ' + String(status).toUpperCase() + ' ';
      const sstart = Math.max(3, 77 - slabel.length);
      place(slabel, sstart, STATUS_COLOR);
      centerEnd = sstart - 1;
    }

    const avail = Math.max(0, centerEnd - 3 + 1);
    const label = (' ' + String(title).toUpperCase() + ' ').slice(0, Math.min(70, avail));
    const start = 3 + Math.floor((avail - label.length) / 2);
    place(label, start, handle.colors.titleColor);

    Renderer.render(handle.titleEl, [row], { cellClass: 'render-cell' });
  }

  function setBindings(handle, bindings) {
    if (!handle || _activeHandle !== handle) return;
    ContextBar.setBindings(bindings);
  }

  function viewportCellAt(handle, event) {
    if (!handle) return null;
    const pre = handle.mainEl.querySelector
      ? handle.mainEl.querySelector('pre')
      : handle.mainEl.firstElementChild;
    if (!pre || typeof pre.getBoundingClientRect !== 'function') return null;
    const rect = pre.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const frameRow = Math.floor((event.clientY - rect.top) / rect.height * geometry.chassisH);
    const frameCol = Math.floor((event.clientX - rect.left) / rect.width * geometry.screenW);
    const row = frameRow - geometry.viewportFrameRow;
    const col = frameCol - geometry.viewportFrameCol;
    if (row < 0 || row >= geometry.contentH || col < 0 || col >= geometry.viewportW) return null;
    return { row, col };
  }

  // Geometry of the live viewport pane in client pixels, so a transition effect can
  // confine itself to the 54×43 viewport while the chassis stays fixed (e.g. the
  // galaxy<->system static re-tune). Returns null when nothing is rendered yet.
  function viewportMetrics() {
    const pre = _activePre();
    if (!pre) return null;
    const rect = pre.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const cellW = rect.width / geometry.screenW;
    const cellH = rect.height / geometry.chassisH;
    return {
      preRect: rect, cellW, cellH,
      frameCol: geometry.viewportFrameCol, frameRow: geometry.viewportFrameRow,
      cols: geometry.viewportW, rows: geometry.contentH,
      screenW: geometry.screenW, chassisH: geometry.chassisH,
    };
  }

  function _activePre() {
    if (!_activeHandle || !_activeHandle.mainEl) return null;
    return _activeHandle.mainEl.querySelector
      ? _activeHandle.mainEl.querySelector('pre')
      : null;
  }

  function unmount(handle) {
    if (!handle) return;
    if (_activeHandle === handle) {
      ContextBar.destroy();
      _activeHandle = null;
    }
    handle.root.innerHTML = '';
  }

  function _normalizeRows(rows, width, height, defaultColor, bgColor) {
    const bgFor = typeof bgColor === 'function' ? bgColor : () => bgColor;
    return Array.from({ length: height }, (_, r) => {
      const source = Array.isArray(rows[r]) ? rows[r] : [];
      const rowBg = bgFor(r);
      return Array.from({ length: width }, (_, c) => {
        const cell = source[c] || {};
        const normalized = {
          char: String(cell.char ?? ' ').slice(0, 1) || ' ',
          color: cell.color || defaultColor,
        };
        const background = cell.bgColor ?? rowBg;
        if (background) normalized.bgColor = background;
        return normalized;
      });
    });
  }

  function _infoBg(handle, row) {
    const base = handle.colors.infoBg;
    return row % 2 === 0 ? ColorUtils.mixHex(base, INFO_SCANLINE, 0.35) : base;
  }

  function _dividerCell(handle, row) {
    const dist = Math.min(row, geometry.contentH - 1 - row);
    return {
      char: dist === 0 ? '○' : (dist === 1 ? '·' : '│'),
      color: handle.colors.borderColor,
      bgColor: _infoBg(handle, row),
    };
  }

  return {
    geometry, mount, render, setTitle, setBindings, viewportCellAt,
    viewportMetrics, unmount,
  };
})();
