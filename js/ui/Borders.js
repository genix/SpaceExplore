// Pluggable ASCII border styles, reusable by any HTML (white-space:pre) content
// that needs a styled frame — not just popups. A style declares the cells its frame
// reserves (insets) + a minimum size, and build(w, h, ctx) returns the h frame rows
// as HTML strings with the content composited into the inner rectangle.
//
// PopupManager is one consumer: it adds the modal stack, DOM positioning, and the
// open/grow entrance animation. Non-popup callers can use Borders.render(name, w, h,
// ctx) directly, and Borders.inner(name, w, h) to size their content. Only popups
// animate. See design/Borders.md.
//
// ctx = {
//   title,         // string for the frame's title slot
//   contentLines,  // array of lines (string | {html} | {text,clickable} |
//                  //   {html,clickable}) for the inner rectangle, or null for a
//                  //   blank frame (e.g. mid open-animation, before full size)
//   borderColor,   // optional frame colour; null = inherit the surrounding colour
// }
const Borders = (() => {

  // Circle-cluster glyphs (UIBorderStyles.md §4, "heavier corners" variation).
  // NOTE: ● (U+25CF) is not in strict CP437, so it may render as a fallback glyph
  // (wrong width → misaligned) in the Px437 CGA font. If the corners look wrong,
  // swap `heavy` for a CP437-safe glyph such as '◙' or '█'. See HowToUI.md.
  const CIRCLE = { heavy: '●', mid: '○', light: '·', line: '─', wall: '│' };

  // Wrap an already-built (already-escaped) frame string in a colour span.
  // Does NOT escape — frame glyphs are safe and titles arrive pre-escaped.
  function _frame(s, color) {
    return color ? `<span style="color:${color}">${s}</span>` : s;
  }

  // Render one content line into an inner-width HTML string, honouring all four line
  // shapes and the clickable-cell markup. A clickable line is wrapped in a
  // `frame-btn` span carrying data-bidx; whoever drives the frame (e.g. PopupManager)
  // wires clicks to that class and maps the index to an action. bidx.i is advanced
  // per clickable cell.
  function renderContentLine(line, innerW, bidx) {
    if (line && typeof line === 'object') {
      if (line.html !== undefined) {
        return line.clickable
          ? '<span class="frame-btn" data-bidx="' + (bidx.i++) + '">' + line.html + '</span>'
          : line.html;
      }
      if (line.clickable) {
        return '<span class="frame-btn" data-bidx="' + (bidx.i++) + '">' +
          Ascii.escape(Ascii.pad(line.text || '', innerW)) + '</span>';
      }
      return Ascii.escape(Ascii.pad('', innerW));
    }
    return Ascii.escape(Ascii.pad(typeof line === 'string' ? line : '', innerW));
  }

  // Shared rectangular box builder for the single/double styles, parametrised by a
  // glyph set ({tl,tr,bl,br,h,v}).
  function _buildBox(w, h, ctx, g) {
    const inner = w - 2;
    const color = ctx.borderColor;
    const rows  = [];
    const bidx  = { i: 0 };

    rows.push(_frame(g.tl + Ascii.centerFill(Ascii.escape(ctx.title || ''), inner, g.h) + g.tr, color));

    if (ctx.contentLines) {
      for (let i = 0; i < h - 2; i++) {
        rows.push(_frame(g.v, color) + renderContentLine(ctx.contentLines[i], inner, bidx) + _frame(g.v, color));
      }
    } else {
      for (let i = 0; i < h - 2; i++) rows.push(_frame(g.v, color) + ' '.repeat(inner) + _frame(g.v, color));
    }

    rows.push(_frame(g.bl + g.h.repeat(inner) + g.br, color));
    return rows;
  }

  // Borderless: the caller owns every cell. The frame contributes nothing; content
  // lines fill the full w × h rectangle (used by popups with frame:false).
  function _buildNone(w, h, ctx) {
    const content = ctx.contentLines;
    const rows = [];
    for (let i = 0; i < h; i++) {
      const line = content ? content[i] : null;
      if (line && typeof line === 'object' && line.html !== undefined) {
        rows.push(line.html);
      } else if (typeof line === 'string') {
        rows.push(Ascii.escape(Ascii.pad(line, w)));
      } else {
        rows.push(' '.repeat(w));
      }
    }
    return rows;
  }

  // Porthole "nested ring" (design/UIBorderStyles.md §3). A subtly oval double ring:
  // inset flat caps widen through sloped shoulders into body rails one cell farther
  // out. Content is the rectangle rows 2..h-3 x cols 4..w-5. Reserved for the transit
  // popup; no consumer yet (see design/Borders.md §5).
  function _buildPorthole(w, h, ctx) {
    if (w < 13 || h < 7) return Array.from({ length: h }, () => ' '.repeat(w));

    const color = ctx.borderColor;
    const rows  = [];
    const bidx  = { i: 0 };
    const capArc      = '─'.repeat(w - 6);
    const shoulderArc = '─'.repeat(w - 8);

    rows.push(_frame('  .' + Ascii.centerFill(Ascii.escape(ctx.title || ''), w - 6, '─') + '.  ', color));
    rows.push(_frame(' / .' + shoulderArc + '. \\ ', color));

    for (let i = 0; i < h - 4; i++) {
      const body = ctx.contentLines
        ? renderContentLine(ctx.contentLines[i], w - 8, bidx)
        : ' '.repeat(w - 8);
      rows.push(_frame('( ( ', color) + body + _frame(' ) )', color));
    }

    rows.push(_frame(' \\ `' + shoulderArc + "' / ", color));
    rows.push(_frame('  `' + capArc + "'  ", color));
    return rows;
  }

  // Circle Clusters at Corners (design/UIBorderStyles.md §4, heavy variation). Heavy
  // circle mass at each corner fading along the edges to a thin line; the corner mass
  // eats 2 rows top and bottom, so content is (w-2) x (h-4) and starts below the mass
  // row. Best for sensor arrays / contact lists / scanner panels.
  function _buildCircle(w, h, ctx) {
    if (w < 12 || h < 7) return Array.from({ length: h }, () => ' '.repeat(w));

    const color = ctx.borderColor;
    const inner = w - 2;
    const rows  = [];
    const bidx  = { i: 0 };
    const g     = CIRCLE;

    const cornerL = g.heavy + g.heavy + g.mid + g.light;   // ●●○·
    const cornerR = g.light + g.mid + g.heavy + g.heavy;   // ·○●●
    const massL   = g.heavy + g.mid;                        // ●○
    const massR   = g.mid + g.heavy;                        // ○●

    rows.push(_frame(cornerL + Ascii.centerFill(Ascii.escape(ctx.title || ''), w - 8, g.line) + cornerR, color));
    rows.push(_frame(massL, color) + ' '.repeat(w - 4) + _frame(massR, color));

    const contentH = h - 4;
    for (let i = 0; i < contentH; i++) {
      const dist = Math.min(i, contentH - 1 - i);
      const v = dist === 0 ? g.mid : (dist === 1 ? g.light : g.wall);
      const body = ctx.contentLines
        ? renderContentLine(ctx.contentLines[i], inner, bidx)
        : ' '.repeat(inner);
      rows.push(_frame(v, color) + body + _frame(v, color));
    }

    rows.push(_frame(massL, color) + ' '.repeat(w - 4) + _frame(massR, color));
    rows.push(_frame(cornerL + g.line.repeat(w - 8) + cornerR, color));
    return rows;
  }

  // Stacked Bracket Corners (design/UIBorderStyles.md §2). Each corner is a 2×2
  // double-line bracket cluster; the walls/edges connect on the second row/column,
  // leaving the outer row/column as a projecting lip. Content is (w-4) x (h-4).
  // The doc art's top/bottom edge is `━` (U+2501 heavy), which is NOT in CP437; we
  // use `═` (double) instead — CP437-safe and consistent with the double corners.
  // Best for cargo / inventory / trade panels (the brackets read as panel clips).
  function _buildBracket(w, h, ctx) {
    if (w < 8 || h < 6) return Array.from({ length: h }, () => ' '.repeat(w));

    const color = ctx.borderColor;
    const inner = w - 4;
    const rows  = [];
    const bidx  = { i: 0 };

    rows.push(_frame('╔╗' + Ascii.centerFill(Ascii.escape(ctx.title || ''), inner, '═') + '╔╗', color));
    rows.push(_frame('╚╗', color) + ' '.repeat(inner) + _frame('╔╝', color));

    for (let i = 0; i < h - 4; i++) {
      const body = ctx.contentLines
        ? renderContentLine(ctx.contentLines[i], inner, bidx)
        : ' '.repeat(inner);
      rows.push(_frame(' ║', color) + body + _frame('║ ', color));
    }

    rows.push(_frame('╔╝', color) + ' '.repeat(inner) + _frame('╚╗', color));
    rows.push(_frame('╚╝' + '═'.repeat(inner) + '╚╝', color));
    return rows;
  }

  // Inverted / Inside-Out Corners (design/UIBorderStyles.md §1). The double-line
  // frame peels outward at each corner: a thin single-line cap (┌─┐ / └─┘) tucks
  // inside the projecting double walls (╔═╝ arms), so the panel reads as a display
  // mounted from outside. The title rides in the top-left arm. Content is (w-2) x
  // (h-4); insets {top:2, right:1, bottom:2, left:1}. All glyphs are CP437-safe.
  // Best for navigation / system-status panels.
  function _buildInverted(w, h, ctx) {
    if (w < 8 || h < 5) return Array.from({ length: h }, () => ' '.repeat(w));

    const color = ctx.borderColor;
    const inner = w - 2;
    const arm   = w - 6;
    const rows  = [];
    const bidx  = { i: 0 };
    const label = Ascii.pad(' ' + Ascii.escape(ctx.title || ''), arm);

    rows.push(_frame('  ┌' + '─'.repeat(arm) + '┐  ', color));
    rows.push(_frame('╔═╝' + label + '╚═╗', color));

    for (let i = 0; i < h - 4; i++) {
      const body = ctx.contentLines
        ? renderContentLine(ctx.contentLines[i], inner, bidx)
        : ' '.repeat(inner);
      rows.push(_frame('║', color) + body + _frame('║', color));
    }

    rows.push(_frame('╚═╗' + ' '.repeat(arm) + '╔═╝', color));
    rows.push(_frame('  └' + '─'.repeat(arm) + '┘  ', color));
    return rows;
  }

  const styles = {
    single: {
      insets: { top: 1, right: 1, bottom: 1, left: 1 },
      minSize: { w: 3, h: 3 },
      defaultAnim: 'grow',
      build: (w, h, ctx) => _buildBox(w, h, ctx, Ascii.BOX),
    },
    double: {
      insets: { top: 1, right: 1, bottom: 1, left: 1 },
      minSize: { w: 3, h: 3 },
      defaultAnim: 'grow',
      build: (w, h, ctx) => _buildBox(w, h, ctx, Ascii.BOX_DOUBLE),
    },
    porthole: {
      insets: { top: 2, right: 4, bottom: 2, left: 4 },
      minSize: { w: 13, h: 7 },
      defaultAnim: 'iris',
      build: _buildPorthole,
    },
    circle: {
      insets: { top: 2, right: 1, bottom: 2, left: 1 },
      minSize: { w: 12, h: 7 },
      defaultAnim: 'grow',
      build: _buildCircle,
    },
    bracket: {
      insets: { top: 2, right: 2, bottom: 2, left: 2 },
      minSize: { w: 8, h: 6 },
      defaultAnim: 'grow',
      build: _buildBracket,
    },
    inverted: {
      insets: { top: 2, right: 1, bottom: 2, left: 1 },
      minSize: { w: 8, h: 5 },
      defaultAnim: 'grow',
      build: _buildInverted,
    },
    none: {
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      minSize: { w: 1, h: 1 },
      defaultAnim: 'grow',
      build: _buildNone,
    },
  };

  function get(name) {
    return styles[name] || styles.single;
  }

  // Content rectangle a style leaves inside a w × h frame (dimensions minus insets).
  function inner(name, w, h) {
    const s = get(name);
    return {
      w: Math.max(0, w - s.insets.left - s.insets.right),
      h: Math.max(0, h - s.insets.top - s.insets.bottom),
    };
  }

  // One-shot convenience: render a w × h frame of `name` around ctx.contentLines and
  // return the h HTML rows. Does not clamp to minSize (the caller controls exact
  // dimensions); styles emit blank rows when handed less than they need.
  function render(name, w, h, ctx = {}) {
    return get(name).build(w, h, ctx);
  }

  return { get, inner, render, styles, renderContentLine };
})();
