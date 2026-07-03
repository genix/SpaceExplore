// MapView layer that renders all objects above terrain.
// zIndex 5: above terrain (0), below weather effects (10+), below player glyph.
const ObjectLayer = {
  id: 'objects',
  zIndex: 5,
  ignoreTint: false,

  // Equipment that draws from or feeds the power graph flashes a yellow 'z' while
  // it has no path to the ship; the badge clears once a relay reconnects it.
  FLASH_COLOR: '#ffee33',

  _flashOn() {
    return Math.floor(Date.now() / 500) % 2 === 0;
  },

  _isDisconnectedEquipment(obj) {
    const role = obj.power?.role;
    return (role === 'producer' || role === 'consumer') && !obj.power.powered;
  },

  getScreenCells({ cameraX, cameraY, viewW, viewH, charW, charH }) {
    const cells = Array.from({ length: charH }, () => Array(charW).fill(null));
    if (!Datastore.has('planetMap')) return cells;
    const map = Datastore.get('planetMap');

    for (const obj of ObjectManager.all()) {
      for (const { dx, dy } of obj.footprint ?? [{ dx: 0, dy: 0 }]) {
        const wx  = ((obj.x + dx) % map.w + map.w) % map.w;
        const wy  = ((obj.y + dy) % map.h + map.h) % map.h;
        const stx = ((wx - cameraX) % map.w + map.w) % map.w;
        const sty = ((wy - cameraY) % map.h + map.h) % map.h;
        if (stx >= viewW || sty >= viewH) continue;
        const sc    = stx * 2;
        const sr    = sty * 2;
        const glyph = obj.glyphs?.[`${dx},${dy}`];
        if (!glyph) continue;
        const baseColor = glyph.colorFn ? glyph.colorFn(wx, wy) : glyph.color;
        let color       = (obj.power && !obj.power.powered)
          ? ColorUtils.desaturateHex(baseColor, 0.65)
          : baseColor;
        const wearTint  = Degradation.tintColor(obj, baseColor);
        if (wearTint) color = wearTint;
        cells[sr][sc]         = { char: glyph.chars[0][0], color };
        cells[sr][sc + 1]     = { char: glyph.chars[0][1], color };
        cells[sr + 1][sc]     = { char: glyph.chars[1][0], color };
        cells[sr + 1][sc + 1] = { char: glyph.chars[1][1], color };

        if (this._isDisconnectedEquipment(obj) && this._flashOn()) {
          cells[sr][sc + 1] = { char: 'z', color: this.FLASH_COLOR };
        }
      }
    }
    return cells;
  },
};
