// Formatting constants and line helpers for the planet sidebar.
const InspectorFormat = (() => {
  const W = 18;
  const PANEL_W = 19;
  const H = 46;
  const SCANNER_COLOR = '#446644';
  const SECTION_COLOR = '#88bbcc';

  const MODES = [
    { id: 'auto',   label: 'AUTO'   },
    { id: 'scan',   label: 'SCAN'   },
    { id: 'object', label: 'OBJECT' },
    { id: 'power',  label: 'POWER'  },
    { id: 'env',    label: 'ENV'    },
    { id: 'cargo',  label: 'CARGO'  },
    { id: 'world',  label: 'WORLD'  },
  ];

  const TYPE_LABELS = {
    rain:       'Rain',
    heavy_rain: 'Heavy Rain',
    snow:       'Snow',
    blizzard:   'Blizzard',
    fog:        'Fog',
    thick_fog:  'Thick Fog',
    dust_storm: 'Dust Storm',
    sandstorm:  'Sandstorm',
    ash_fall:   'Ash Fall',
    electrical: 'Ion Storm',
  };

  const C = Colors.UI;

  const GROUND_STYLE = {
    sand:            { g: '.', c: '#c4a35a' },
    rock:            { g: '^', c: '#888888' },
    soil:            { g: '.', c: '#7a5c3d' },
    grass:           { g: '"', c: '#55ff55' },
    'dry-rock':      { g: ':', c: '#8a6a4a' },
    gravel:          { g: ':', c: '#6a5a4a' },
    'frozen-soil':   { g: '.', c: '#8a9aaa' },
    snow:            { g: '*', c: '#dde8f0' },
    ice:             { g: '#', c: '#55ffff' },
    water:           { g: '~', c: '#5555ff' },
    'deep-ocean':    { g: '~', c: '#5555ff' },
    'shallow-ocean': { g: '~', c: '#5599ff' },
    lake:            { g: '~', c: '#5555ff' },
    river:           { g: '~', c: '#55aaff' },
    'frozen-ocean':  { g: '#', c: '#aaddff' },
    'frozen-lake':   { g: '#', c: '#aaddff' },
    'frozen-river':  { g: '-', c: '#aaddff' },
  };

  const VEG_COLOR = {
    tree:         C.green,
    grass:        C.green,
    bush:         C.green,
    cactus:       C.yellow,
    scrub:        C.grey,
    moss:         C.cyan,
    'rock-plant': C.cyan,
  };

  // Per-terrain identity glyph + colour, matching the Galaxy sidebar's palette so a
  // world reads the same on both screens.
  const TERRAIN_STYLE = {
    scorched:  { g: '^', c: '#ff4422' },
    arid:      { g: '~', c: '#cc8844' },
    temperate: { g: '#', c: '#44aa44' },
    tundra:    { g: ',', c: '#66bbcc' },
    frozen:    { g: '*', c: '#aaddff' },
    gas:       { g: 'o', c: '#8866cc' },
  };

  function renderLine(line) {
    if (line?.panelFrame) return _renderSegments(line.segments, PANEL_W);
    const content = typeof line === 'string'
      ? Ascii.escape(Ascii.pad(line, W))
      : _renderSegments(line, W);
    return content + `<span style="color:${SCANNER_COLOR}">║</span>`;
  }

  function _renderSegments(segments, width) {
    let html = '';
    let used = 0;
    for (const seg of segments) {
      if (used >= width) break;
      const chunk = String(seg.text).slice(0, width - used);
      if (!chunk) continue;
      html += seg.color
        ? `<span style="color:${seg.color}">${Ascii.escape(chunk)}</span>`
        : Ascii.escape(chunk);
      used += chunk.length;
    }
    if (used < width) html += ' '.repeat(width - used);
    return html;
  }

  // Galaxy-style labelled section rule: "── LABEL ─────────" with a box-drawing rail
  // in scanner green and the label in soft section blue.
  function header(label, color = SECTION_COLOR) {
    const lab = String(label).slice(0, W - 4);
    const dashes = Math.max(0, W - 3 - lab.length - 1);
    return [
      { text: '── ', color: SCANNER_COLOR },
      { text: lab, color },
      { text: ' ' + '─'.repeat(dashes), color: SCANNER_COLOR },
    ];
  }

  // Galaxy-style "[g] NAME" identity row: a bracketed coloured glyph then a name.
  function subject(glyph, name, glyphColor = C.cyan, nameColor = C.bright) {
    return [
      { text: '[', color: C.grey },
      { text: String(glyph).slice(0, 1), color: glyphColor },
      { text: '] ', color: C.grey },
      { text: String(name).slice(0, W - 4), color: nameColor },
    ];
  }

  // Symbol-led list row: a small coloured bullet then a label, echoing the Galaxy
  // sidebar's colour-coded resource lines.
  function bullet(label, color = C.grey, glyph = '·') {
    return [
      { text: glyph + ' ', color },
      { text: String(label), color },
    ];
  }

  // Block-density bullet keyed to a 0..1 intensity, for weather rows.
  function intensityGlyph(v) {
    if (v < 0.17) return '·';
    if (v < 0.50) return '▒';
    if (v < 0.83) return '▓';
    return '█';
  }

  function panelHeader(label, color = C.cyan) {
    const name = String(label).slice(0, PANEL_W - 5);
    const left = '══ ';
    const gap = ' ';
    const fill = '═'.repeat(Math.max(0, PANEL_W - left.length - name.length - gap.length - 1));
    return { panelFrame: true, segments: [
      { text: left, color: SCANNER_COLOR },
      { text: name, color },
      { text: gap + fill + '╗', color: SCANNER_COLOR },
    ] };
  }

  function panelFooter() {
    return {
      panelFrame: true,
      segments: [{ text: '═'.repeat(PANEL_W - 1) + '╝', color: SCANNER_COLOR }],
    };
  }

  function text(value, color = C.grey) {
    return [{ text: String(value), color }];
  }

  function kv(label, value, color = C.bright) {
    const left = String(label).slice(0, 7);
    return [{ text: left.padEnd(7), color: C.grey }, { text: String(value), color }];
  }

  function fmtC(c) {
    if (c == null || Number.isNaN(c)) return '---';
    const n = Math.round(c);
    return (n >= 0 ? '+' : '') + n + '\xB0C';
  }

  function fmtNum(n) {
    if (n == null || Number.isNaN(n)) return '0';
    if (Math.abs(n) < 0.05) return '0';
    return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
  }

  function fmtRate(n) {
    if (n == null || Number.isNaN(n) || Math.abs(n) < 0.05) return '0/t';
    return (n > 0 ? '+' : '') + fmtNum(n) + '/t';
  }

  function rateColor(n) {
    if (n > 0.05) return C.green;
    if (n < -0.05) return C.red;
    return C.grey;
  }

  function pctColor(pct) {
    if (pct > 75) return C.green;
    if (pct > 35) return C.yellow;
    return C.red;
  }

  function tempColor(tempC) {
    if (tempC < -30) return C.blue;
    if (tempC <   0) return C.cyan;
    if (tempC <  25) return C.green;
    if (tempC <  50) return C.yellow;
    return C.red;
  }

  function bar(pct, width = 12) {
    return Ascii.percentBar(pct, width, '#', '.');
  }

  function percent(n) {
    return Math.round(MathUtils.clamp(n ?? 0, 0, 1) * 100) + '%';
  }

  function resourceName(id) {
    const metal = ResourceMaterials.metalLabel ? ResourceMaterials.metalLabel(id) : id;
    if (metal !== id) return metal;
    return Items.get(id)?.name || ResourceMaterials.resourceLabel(id);
  }

  function objectName(obj) {
    if (!obj) return '---';
    return Items.get(obj.itemId)?.name || obj.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function intensityColor(v) {
    if (v < 0.17) return C.grey;
    if (v < 0.50) return C.cyan;
    if (v < 0.83) return C.yellow;
    return C.red;
  }

  return {
    W, PANEL_W, H, MODES, TYPE_LABELS, C, SECTION_COLOR, GROUND_STYLE, VEG_COLOR, TERRAIN_STYLE,
    renderLine, header, subject, bullet, panelHeader, panelFooter, text, kv, fmtC, fmtNum, fmtRate, rateColor,
    pctColor, tempColor, bar, percent, resourceName, objectName, intensityColor, intensityGlyph,
  };
})();
