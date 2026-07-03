// Lava vent object: 1×1 tile, impassable. Color animates between lava orange and red.
// heatBonus[d] = extra Kelvin contributed at Chebyshev distance d from this vent.
const LavaVentObject = (() => {
  const LAVA_ORANGE = [0xff, 0x66, 0x00];
  const LAVA_RED    = [0xcc, 0x11, 0x00];

  function _colorFn(wx, wy) {
    const phase  = (((wx * 73856093) ^ (wy * 19349663)) >>> 0) % 1000 / 1000;
    const t      = (Math.sin(Date.now() * 0.0009 + phase * Math.PI * 2) + 1) / 2;
    const r      = Math.round(LAVA_RED[0] + (LAVA_ORANGE[0] - LAVA_RED[0]) * t);
    const g      = Math.round(LAVA_RED[1] + (LAVA_ORANGE[1] - LAVA_RED[1]) * t);
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + '00';
  }

  const GLYPHS = {
    '0,0': { chars: ['{^', '^}'], colorFn: _colorFn },
  };

  // Extra Kelvin at Chebyshev distance 0 (vent tile), 1, 2, 3
  const HEAT_BONUS = [1200, 400, 150, 50];

  function create(id, x, y) {
    return {
      id, type: 'lava-vent', x, y,
      passable: false,
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
      heatBonus: HEAT_BONUS,
    };
  }

  return { create };
})();
