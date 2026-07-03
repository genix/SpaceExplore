// Boulder object definitions: small (1×1 tile) and heavy (2×2 tile).
// Small assembled display (2×2 chars):  Heavy assembled display (4×4 chars):
//   /\                                    /# #\
//   \/                                    /   \
//                                         \   /
//                                         \# #/
const BoulderObject = (() => {
  const GLYPHS_SMALL = {
    '0,0': { chars: ['/\\', '\\/'], color: '#999999' },
  };

  const GLYPHS_HEAVY = {
    '0,0': { chars: ['/#', '/ '], color: '#aaaaaa' },
    '1,0': { chars: ['#\\', ' \\'], color: '#aaaaaa' },
    '0,1': { chars: ['\\ ', '\\#'], color: '#888888' },
    '1,1': { chars: [' /', '#/'], color: '#888888' },
  };

  const FOOTPRINT_HEAVY = [
    { dx: 0, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 1, dy: 1 },
  ];

  function createSmall(id, x, y, metals = null) {
    return {
      id, type: 'boulder-small', x, y,
      passable: false,
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS_SMALL,
      metals,
    };
  }

  function createHeavy(id, x, y, metals = null) {
    return {
      id, type: 'boulder-heavy', x, y,
      passable: false,
      footprint: FOOTPRINT_HEAVY,
      glyphs: GLYPHS_HEAVY,
      metals,
    };
  }

  return { createSmall, createHeavy, FOOTPRINT_HEAVY };
})();
