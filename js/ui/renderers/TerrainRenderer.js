// Terrain rendering mode: char encodes elevation via HEIGHT_CHARS density ramp;
// colour encodes ground cover type (vegetation overrides ground when present).
// Subject to DayCycle colour tinting.
const TerrainRenderer = (() => {
  const SEA_LEVEL = 0.35;

  // Edit this array to change height symbols. Index 0 = lowest, last = highest.
  // The number of entries determines the number of elevation bands.
  const HEIGHT_CHARS = ['.', '.', '-', '=', '≡', '#', '%', '@'];

  const WATER_GROUNDS = new Set([
    'water', 'deep-ocean', 'shallow-ocean', 'lake', 'river',
    'frozen-ocean', 'frozen-lake', 'frozen-river',
  ]);
  const LIQUID_WATER_GROUNDS = new Set(['water', 'deep-ocean', 'shallow-ocean', 'lake', 'river']);

  const GROUND_COLORS = {
    grass:           '#6ab040',
    soil:            '#7a6050',
    sand:            '#c4a35a',
    rock:            '#8a8a8a',
    'dry-rock':      '#7a7060',
    gravel:          '#706060',
    'frozen-soil':   '#8090a0',
    snow:            '#dde8f0',
    ice:             '#b0cce0',
    water:           '#2a7aaa',
    'deep-ocean':    '#0a3a6a',
    'shallow-ocean': '#1a6a9a',
    lake:            '#2a6a8a',
    river:           '#2a7aaa',
    'frozen-ocean':  '#9fd4ea',
    'frozen-lake':   '#aad8e8',
    'frozen-river':  '#c0e4f0',
  };

  const VEG_COLORS = {
    grass:        '#5c9e3a',
    tree:         '#1e4a10',
    bush:         '#2a5a1a',
    cactus:       '#4a7a2a',
    scrub:        '#5a7030',
    moss:         '#2a5a3a',
    'rock-plant': '#4a5a30',
  };

  const GROUND_BG = {
    grass:           '#081805',
    soil:            '#120e08',
    sand:            '#1a1208',
    rock:            '#181818',
    'dry-rock':      '#141208',
    gravel:          '#121010',
    'frozen-soil':   '#0e1218',
    snow:            '#12161a',
    ice:             '#0e141e',
    water:           '#081020',
    'deep-ocean':    '#040a12',
    'shallow-ocean': '#080f1c',
    lake:            '#070e1a',
    river:           '#08101e',
    'frozen-ocean':  '#0a1420',
    'frozen-lake':   '#0b1520',
    'frozen-river':  '#0c161e',
  };

  const BANDS = HEIGHT_CHARS.length;

  // Deterministic hash from tile position + sub-cell index (0-3).
  function _tileHash(x, y, sub) {
    let h = ((x * 73856093) ^ (y * 19349663) ^ (sub * 83492791)) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
  }

  // Slightly vary a colour per-cell so terrain doesn't look flat and uniform.
  function _varyColor(hex, x, y, sub) {
    const h = _tileHash(x ?? 0, y ?? 0, sub);
    const [r, g, b] = ColorUtils.hexToRgb(hex);
    const dr = ((h & 0xff) / 255 - 0.5) * 24;
    const dg = (((h >> 8) & 0xff) / 255 - 0.5) * 24;
    const db = (((h >> 16) & 0xff) / 255 - 0.5) * 24;
    return ColorUtils.rgbToHex([r + dr, g + dg, b + db]);
  }

  function _waterColor(ground, x, y) {
    const base  = GROUND_COLORS[ground] || GROUND_COLORS.water;
    const hash  = (((x ?? 0) * 73856093) ^ ((y ?? 0) * 19349663)) >>> 0;
    const rate  = 0.0001 + (hash % 80) / 1000000;
    const phase = (hash % 1000) / 1000;
    const wave  = (Math.sin((Date.now() * rate + phase) * Math.PI * 2) + 1) / 2;
    const dark  = ColorUtils.mixHex(base, '#051c32', 0.24);
    const light = ColorUtils.mixHex(base, '#52bde8', 0.36);
    return ColorUtils.mixHex(dark, light, wave);
  }

  function getChars(tile, x, y) {
    const elev = tile.elevation ?? 0.3;
    const isWater = WATER_GROUNDS.has(tile.ground);

    const ratio = isWater
      ? MathUtils.clamp(1.0 - elev / SEA_LEVEL, 0, 1)
      : MathUtils.clamp((elev - SEA_LEVEL) / (1.0 - SEA_LEVEL), 0, 1);

    const char = LIQUID_WATER_GROUNDS.has(tile.ground)
      ? '~'
      : HEIGHT_CHARS[Math.min(BANDS - 1, Math.floor(ratio * BANDS))];

    const color = LIQUID_WATER_GROUNDS.has(tile.ground)
               ? _waterColor(tile.ground, x, y)
               : (tile.vegetation && VEG_COLORS[tile.vegetation])
               || GROUND_COLORS[tile.ground]
               || '#888888';
    const baseBg = GROUND_BG[tile.ground] || '#101010';
    const bgColor = isWater ? baseBg : ColorUtils.brightenHex(baseBg, ratio * 20);

    const cx = x ?? 0;
    const cy = y ?? 0;
    const c = isWater
      ? [color, color, color, color]
      : [0, 1, 2, 3].map(i => _varyColor(color, cx, cy, i));

    return [
      { char, color: c[0], bgColor },
      { char, color: c[1], bgColor },
      { char, color: c[2], bgColor },
      { char, color: c[3], bgColor },
    ];
  }

  return {
    id:                 'terrain',
    label:              'Terrain',
    ignoreDayCycleTint: false,
    redraw:             { pos: true, phase: true, weather: true, animate: true },
    getChars,
  };
})();
