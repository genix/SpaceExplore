// Writes a 2D array of {char,color} cells to a DOM element as a coloured <pre>.
const Renderer = (() => {
  // Per-container persistent span grids for renderGrid(); keyed weakly so a
  // discarded container's grid state is collected with it.
  const _gridState = new WeakMap();

  function init() {}

  function _escape(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function rowHtml(row, cellClass = '') {
    const classAttr = cellClass ? ` class="${cellClass}"` : '';
    return row.map(cell => {
      const style = cell.bgColor
        ? `color:${cell.color};background-color:${cell.bgColor}`
        : `color:${cell.color}`;
      return `<span${classAttr} style="${style}">${_escape(cell.char)}</span>`;
    }).join('');
  }

  function renderHtml(container, rows) {
    const html = rows.join('<br>');
    let pre = container.firstElementChild;
    if (!pre || pre.tagName !== 'PRE') {
      container.innerHTML = '';
      pre = document.createElement('pre');
      container.appendChild(pre);
    }
    pre.innerHTML = html;
  }

  // Precondition: container is a DOM element; rows is a 2D array of {char,color,bgColor?}.
  // Reuses an existing <pre> child to avoid unnecessary DOM churn.
  function render(container, rows, { cellClass = '' } = {}) {
    renderHtml(container, rows.map(row => rowHtml(row, cellClass)));
  }

  function _buildGrid(container, rows, w, h, cellClass) {
    let pre = container.querySelector('pre');
    if (!pre) {
      container.innerHTML = '';
      pre = document.createElement('pre');
      container.appendChild(pre);
    }
    pre.innerHTML = rows.map(row => rowHtml(row, cellClass)).join('<br>');
    const spans = pre.querySelectorAll('span');
    const shadow = rows.map(row => row.map(c => ({ char: c.char, color: c.color, bgColor: c.bgColor || '' })));
    return { pre, w, h, spans, shadow };
  }

  // Like render(), but for a fixed-size grid that is redrawn repeatedly: builds
  // the spans once, then mutates only the cells whose char/color/bgColor changed.
  // Cells are fixed-width inline-blocks, so in-place edits repaint without reflow.
  // Rebuilds from scratch if the grid dimensions change or the <pre> is detached.
  function renderGrid(container, rows, { cellClass = '' } = {}) {
    const h = rows.length;
    const w = h ? rows[0].length : 0;
    let st = _gridState.get(container);
    const stale = !st || st.w !== w || st.h !== h ||
      st.pre.parentNode !== container || !st.spans[0] || !st.spans[0].isConnected;
    if (stale) {
      _gridState.set(container, _buildGrid(container, rows, w, h, cellClass));
      return;
    }
    const { spans, shadow } = st;
    for (let r = 0; r < h; r++) {
      const row = rows[r];
      if (row.length !== w) {
        _gridState.set(container, _buildGrid(container, rows, w, h, cellClass));
        return;
      }
      const srow = shadow[r];
      const base = r * w;
      for (let c = 0; c < w; c++) {
        const cell = row[c];
        const prev = srow[c];
        const span = spans[base + c];
        if (cell.char !== prev.char) { span.textContent = cell.char; prev.char = cell.char; }
        if (cell.color !== prev.color) { span.style.color = cell.color; prev.color = cell.color; }
        const bg = cell.bgColor || '';
        if (bg !== prev.bgColor) { span.style.backgroundColor = bg; prev.bgColor = bg; }
      }
    }
  }

  return { init, render, renderGrid, rowHtml, renderHtml };
})();
