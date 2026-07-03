// Interior tile -> 2x2 display-cell mapping, mirroring TileDefs/TerrainRenderer's
// shape but for enclosed spaces (ship hull, future caves). Tiles are stored in the
// interior grid as plain string keys; cells(key) builds the 4-cell block the
// MapView renderer consumes, and isPassable(key) gates movement.
const InteriorTileDefs = (() => {
  const TILES = {
    // Metal hull plating: solid, impassable boundary.
    wall:          { chars: ['▓▓', '▓▓'], color: '#6a7482', bg: '#0e1015', passable: false },
    // Deck floor: sparse rivet dots over dark plating.
    floor:         { chars: ['· ', ' ·'], color: '#324050', bg: '#090c12', passable: true  },
    // Airlock approach: distinctly coloured deck cueing the exit point.
    'airlock-pad': { chars: [': ', ' :'], color: '#c6d24a', bg: '#1b1d0b', passable: true  },
  };

  function isPassable(key) {
    const t = TILES[key];
    return t ? t.passable : false;
  }

  function cells(key) {
    const t = TILES[key] || TILES.wall;
    const c = t.chars;
    return [
      { char: c[0][0], color: t.color, bgColor: t.bg },
      { char: c[0][1], color: t.color, bgColor: t.bg },
      { char: c[1][0], color: t.color, bgColor: t.bg },
      { char: c[1][1], color: t.color, bgColor: t.bg },
    ];
  }

  return { TILES, isPassable, cells };
})();
