// Power Relay: 1x1 passable carryable equipment.
// Side-on assembled display (2 chars wide × 2 rows tall):
//   XX   (lattice transmission pylon)
//   /\   (support legs / base)
const PowerRelayObject = (() => {
  const COLOR = '#66ccff';

  const GLYPHS = {
    '0,0': { chars: ['XX', '/\\'], color: COLOR },
  };

  // 2×2 character grid used by the inventory popup to show a tile-style icon.
  const INVENTORY_GLYPH = [
    ['X', 'X'],
    ['/', '\\'],
  ];

  const LIGHT_RADIUS = 6;
  const MAX_DURABILITY = 600;   // flat ~0.1 wear/turn while passing power -> ~6000 turns; the long-lived conduit

  function create(id, x, y) {
    return {
      id, type: 'power-relay',
      x, y,
      passable: true,
      carryable: true,
      interactable: true,
      itemId: 'power-relay',
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
      lightRadius: LIGHT_RADIUS,
      durability: MAX_DURABILITY,
      maxDurability: MAX_DURABILITY,
      power: { role: 'conduit', range: LIGHT_RADIUS, powered: false },
    };
  }

  return { create, INVENTORY_GLYPH, COLOR, MAX_DURABILITY };
})();

Items.define({
  id:            'power-relay',
  name:          'Power Relay',
  category:      'Powered Equipment',
  size:          4,
  stackable:     false,
  maxDurability: PowerRelayObject.MAX_DURABILITY,
  color:         PowerRelayObject.COLOR,
  glyph:         PowerRelayObject.INVENTORY_GLYPH,
  objectFactory: PowerRelayObject.create,
});
