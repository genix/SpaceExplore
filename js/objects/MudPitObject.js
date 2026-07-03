// Mud pit object: 1×1 tile, impassable. Displays as murky brown waves.
const MudPitObject = (() => {
  const GLYPHS = {
    '0,0': { chars: ['~~', '~~'], color: '#7a5828' },
  };

  function create(id, x, y) {
    return {
      id, type: 'mud-pit', x, y,
      passable: false,
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
    };
  }

  return { create };
})();
