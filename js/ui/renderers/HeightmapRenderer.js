// Height map rendering mode: visualises elevation as ASCII density symbols.
// Water tiles are blue; land tiles are brown. Denser characters indicate greater
// depth (water) or greater height (land). Day/night tinting is suppressed so the
// data view remains legible regardless of time of day.
const HeightmapRenderer = (() => {
  const SEA_LEVEL = 0.35;

  const DENSITY_RAMP = ['.', ':', '-', '+', '*', '#', '%', '@'];

  const WATER_GROUNDS = new Set([
    'water', 'deep-ocean', 'shallow-ocean', 'lake', 'river',
    'frozen-ocean', 'frozen-lake', 'frozen-river',
  ]);

  const CELL_BG = '#000000';

  // Index 0 = shallowest (lightest), 7 = deepest (darkest)
  const WATER_PALETTE = [
    '#3a80a8',
    '#2e6a8e',
    '#225272',
    '#1a3e5e',
    '#122c46',
    '#0d2238',
    '#081828',
    '#04111e',
  ];

  // Index 0 = low land (darkest), 7 = mountain peak (lightest)
  const LAND_PALETTE = [
    '#2a1a0e',
    '#3a2418',
    '#4a3020',
    '#5e4030',
    '#6e5040',
    '#806050',
    '#9a7c64',
    '#b8a080',
  ];

  function getChars(tile) {
    const elev = tile.elevation ?? 0.5;
    const isWater = WATER_GROUNDS.has(tile.ground);

    let densityIdx, color;
    if (isWater) {
      const depthRatio = MathUtils.clamp(1.0 - elev / SEA_LEVEL, 0, 1);
      densityIdx = Math.min(7, Math.floor(depthRatio * 8));
      color = WATER_PALETTE[densityIdx];
    } else {
      const heightRatio = MathUtils.clamp((elev - SEA_LEVEL) / (1.0 - SEA_LEVEL), 0, 1);
      densityIdx = Math.min(7, Math.floor(heightRatio * 8));
      color = LAND_PALETTE[densityIdx];
    }

    const char = DENSITY_RAMP[densityIdx];
    return [
      { char, color, bgColor: CELL_BG },
      { char, color, bgColor: CELL_BG },
      { char, color, bgColor: CELL_BG },
      { char, color, bgColor: CELL_BG },
    ];
  }

  return {
    id:                 'heightmap',
    label:              'Height Map',
    ignoreDayCycleTint: true,
    hideLayers:         true,
    redraw:             { pos: true },
    getChars,
  };
})();
