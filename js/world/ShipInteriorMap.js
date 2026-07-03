// Static ship interior floorplan. build() returns a {grid, w, h, wrap, spawn,
// fixtures} spec: a single enclosed hull (non-toroidal, so MapView voids the area
// outside the walls) with equipment fixtures placed against the walls. Regenerated
// fresh on every entry — the ship interior carries no persistent layout state.
const ShipInteriorMap = (() => {
  // '#' hull wall, '.' deck floor, 'a' airlock approach pad.
  const ROWS = [
    '########################',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#.........aaaa.........#',
    '#......................#',
    '########################',
  ];

  const CODE = { '#': 'wall', '.': 'floor', 'a': 'airlock-pad' };

  function build() {
    const h = ROWS.length;
    const w = ROWS[0].length;
    const grid = ROWS.map(row => Array.from(row, ch => CODE[ch] || 'floor'));
    return {
      grid, w, h,
      wrap: false,
      spawn: { x: 12, y: 12 },
      fixtures: [
        { type: 'engine',     x: 11, y: 1 },   // 2x2 reactor, top-centre
        { type: 'cargo',      x: 3,  y: 1 },    // 2x1, top-left
        { type: 'fabricator', x: 19, y: 1 },    // 2x1, top-right
        { type: 'salvage',    x: 3,  y: 13 },   // 2x1, bottom-left
        { type: 'airlock',    x: 11, y: 13 },   // 2x1, bottom-centre (exit)
        { type: 'console',    x: 19, y: 13 },   // 2x1, bottom-right (helm)
      ],
    };
  }

  return { build };
})();
