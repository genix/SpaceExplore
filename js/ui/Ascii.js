// Shared fixed-width ASCII UI helpers.
const Ascii = (() => {
  const FOCUS_MARK = '►';
  const BOX = {
    tl: '┌', tr: '┐', bl: '└', br: '┘',
    h: '─', v: '│',
    atl: '+', atr: '+', abl: '+', abr: '+', ah: '-', av: '|',
  };
  const BOX_DOUBLE = {
    tl: '╔', tr: '╗', bl: '╚', br: '╝',
    h: '═', v: '║',
  };

  function escape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function pad(str, width) {
    str = String(str ?? '');
    if (str.length >= width) return str.slice(0, width);
    return str + ' '.repeat(width - str.length);
  }

  function padPair(left, right, width) {
    left = String(left ?? '');
    right = String(right ?? '');
    const space = Math.max(1, width - left.length - right.length);
    return pad(left + ' '.repeat(space) + right, width);
  }

  function center(text, width) {
    text = String(text ?? '');
    if (text.length >= width) return text.slice(0, width);
    return ' '.repeat(Math.floor((width - text.length) / 2)) + text;
  }

  function centerFill(text, width, fill) {
    text = String(text ?? '');
    fill = String(fill || ' ');
    if (!text) return fill.repeat(width);
    if (text.length >= width) return text.slice(0, width);
    const rem = width - text.length;
    const left = Math.floor(rem / 2);
    return fill.repeat(left) + text + fill.repeat(rem - left);
  }

  function bar(used, max, width, filled = '█', empty = '░') {
    if (max <= 0) return '[' + ' '.repeat(width) + ']';
    const n = MathUtils.clamp(Math.round((used / max) * width), 0, width);
    return '[' + filled.repeat(n) + empty.repeat(width - n) + ']';
  }

  function percentBar(pct, width, filled = '#', empty = '.') {
    const n = MathUtils.clamp(Math.round((pct / 100) * width), 0, width);
    return '[' + filled.repeat(n) + empty.repeat(width - n) + ']';
  }

  function span(text, color) {
    return `<span style="color:${color}">${escape(text)}</span>`;
  }

  // Render an array of {text, color?} segments into a fixed-width HTML string.
  // Truncates at width; pads with spaces if short.
  function colorLine(segments, width) {
    let html = '';
    let used = 0;
    for (const seg of segments) {
      if (used >= width) break;
      const chunk = String(seg.text ?? '').slice(0, width - used);
      if (!chunk) continue;
      html += seg.color ? span(chunk, seg.color) : escape(chunk);
      used += chunk.length;
    }
    if (used < width) html += ' '.repeat(width - used);
    return html;
  }

  // Returns an HTML string for a muted capacity bar: '[████░░░░]'.
  // Visual width is barWidth + 2. Intended for embedding in { html } lines.
  function colorBar(used, max, barWidth) {
    if (max <= 0) max = 1;
    const n = MathUtils.clamp(Math.round((used / max) * barWidth), 0, barWidth);
    return '[' +
      (n > 0 ? span('█'.repeat(n), Colors.BAR_FILL) : '') +
      (n < barWidth ? span('░'.repeat(barWidth - n), Colors.BAR_EMPTY) : '') +
      ']';
  }

  // Like padPair but takes segment arrays; computes the gap automatically.
  function colorPair(leftSegs, rightSegs, width) {
    const leftLen  = leftSegs.reduce((n, s) => n + String(s.text ?? '').length, 0);
    const rightLen = rightSegs.reduce((n, s) => n + String(s.text ?? '').length, 0);
    const gap = Math.max(1, width - leftLen - rightLen);
    return colorLine([...leftSegs, { text: ' '.repeat(gap) }, ...rightSegs], width);
  }

  function emptyRows(h, w, char = ' ', color = '#aaaaaa', bgColor = '#000000') {
    return Array.from({ length: h }, () =>
      Array.from({ length: w }, () => ({ char, color, bgColor }))
    );
  }

  function writeText(rows, row, col, text, color, maxW = String(text ?? '').length) {
    text = String(text ?? '');
    for (let i = 0; i < text.length && i < maxW; i++) {
      const c = col + i;
      if (row >= 0 && row < rows.length && c >= 0 && c < rows[row].length) {
        rows[row][c] = { char: text[i], color, bgColor: rows[row][c].bgColor };
      }
    }
  }

  function drawBox(rows, x, y, w, h, color, label = '', glyphs = BOX) {
    for (let c = x + 1; c < x + w - 1; c++) {
      rows[y][c] = { char: glyphs.h, color };
      rows[y + h - 1][c] = { char: glyphs.h, color };
    }
    for (let r = y + 1; r < y + h - 1; r++) {
      rows[r][x] = { char: glyphs.v, color };
      rows[r][x + w - 1] = { char: glyphs.v, color };
    }
    rows[y][x] = { char: glyphs.tl, color };
    rows[y][x + w - 1] = { char: glyphs.tr, color };
    rows[y + h - 1][x] = { char: glyphs.bl, color };
    rows[y + h - 1][x + w - 1] = { char: glyphs.br, color };

    if (label) {
      const text = label.slice(0, Math.max(0, w - 4));
      const start = x + Math.floor((w - text.length) / 2);
      writeText(rows, y, start, text, color, w - 2);
    }
  }

  return { FOCUS_MARK, BOX, BOX_DOUBLE, escape, pad, padPair, center, centerFill, bar, percentBar, span, colorLine, colorPair, colorBar, emptyRows, writeText, drawBox };
})();
