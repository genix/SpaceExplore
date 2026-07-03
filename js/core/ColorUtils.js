// Shared color helpers for modules that work with RGB arrays and '#rrggbb' strings.
const ColorUtils = (() => {
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }

  function rgbToHex(rgb) {
    return '#' + rgb
      .map(value => Math.round(MathUtils.clamp(value, 0, 255)).toString(16).padStart(2, '0'))
      .join('');
  }

  function mixRgb(a, b, t) {
    return [
      MathUtils.lerp(a[0], b[0], t),
      MathUtils.lerp(a[1], b[1], t),
      MathUtils.lerp(a[2], b[2], t),
    ];
  }

  function mixHex(a, b, t) {
    return rgbToHex(mixRgb(hexToRgb(a), hexToRgb(b), t));
  }

  function brightenHex(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex([r + amount, g + amount, b + amount]);
  }

  // Blends a colour toward dim gray. amount: 0 = unchanged, 1 = fully dim gray.
  function desaturateHex(hex, amount = 0.6) {
    return mixHex(hex, '#444444', amount);
  }

  return { hexToRgb, rgbToHex, mixRgb, mixHex, brightenHex, desaturateHex };
})();
