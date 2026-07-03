// MapView layer that draws interior fixtures above the deck. Mirrors ObjectLayer but
// reads the interior's fixture list (held by InteriorSession, not ObjectManager) and
// maps to screen coordinates without toroidal wrap — interiors are bounded rooms.
const InteriorObjectLayer = {
  id: 'interior-objects',
  zIndex: 5,
  ignoreTint: true,

  getScreenCells({ cameraX, cameraY, viewW, viewH, charW, charH }) {
    const cells = Array.from({ length: charH }, () => Array(charW).fill(null));
    for (const obj of InteriorSession.getObjects()) {
      for (const { dx, dy } of obj.footprint) {
        const stx = (obj.x + dx) - cameraX;
        const sty = (obj.y + dy) - cameraY;
        if (stx < 0 || stx >= viewW || sty < 0 || sty >= viewH) continue;
        const glyph = obj.glyphs[`${dx},${dy}`];
        if (!glyph) continue;
        const sc = stx * 2;
        const sr = sty * 2;
        cells[sr][sc]         = { char: glyph.chars[0][0], color: glyph.color };
        cells[sr][sc + 1]     = { char: glyph.chars[0][1], color: glyph.color };
        cells[sr + 1][sc]     = { char: glyph.chars[1][0], color: glyph.color };
        cells[sr + 1][sc + 1] = { char: glyph.chars[1][1], color: glyph.color };
      }
    }
    return cells;
  },
};
