// Interior render mode: maps each interior grid tile key to its 2x2 display cells
// via InteriorTileDefs. Static lighting — ignoreDayCycleTint suppresses the planet
// day/night tint and the light-field lookups, since interiors light themselves.
const InteriorRenderer = {
  id:                 'interior',
  label:              'Hull Deck 1',
  ignoreDayCycleTint: true,
  redraw:             { pos: true, animate: true },

  getChars(tile) {
    return InteriorTileDefs.cells(tile);
  },
};
