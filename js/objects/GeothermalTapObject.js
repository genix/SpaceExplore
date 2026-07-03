// Geothermal Tap: 1×1 passable carryable power producer. Placement requires
// a lava vent on an adjacent tile (vents are impassable, so the tap cannot sit
// on one); the vent is preserved. Constant power output.
const GeothermalTapObject = (() => {
  const COLOR       = '#ff8844';
  const POWER_RANGE = 5;
  const POWER_RATE  = 5;
  const LIGHT_RADIUS = 5;
  const MAX_DURABILITY = 3000;  // delivers ~5 power/turn -> ~600 active turns temperate (wears only on delivery)

  // Side-on: '^^' rising heat plume over '/\' wellhead base.
  const GLYPHS = {
    '0,0': { chars: ['^^', '/\\'], color: COLOR },
  };

  const INVENTORY_GLYPH = [
    ['^', '^'],
    ['/', '\\'],
  ];

  function create(id, x, y) {
    return {
      id, type: 'geothermal-tap',
      x, y,
      passable: true,
      carryable: true,
      interactable: true,
      itemId: 'geothermal-tap',
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
      lightRadius: LIGHT_RADIUS,
      durability: MAX_DURABILITY,
      maxDurability: MAX_DURABILITY,
      power: { role: 'producer', range: POWER_RANGE, rate: POWER_RATE },
    };
  }

  function canPlaceAt(pos) {
    if (ObjectManager.getAt(pos.x, pos.y)) return 'Tile blocked.';
    if (!ObjectManager.findVentAdjacent(pos.x, pos.y)) return 'Geothermal Tap must be placed next to a lava vent.';
    return true;
  }

  return { create, INVENTORY_GLYPH, COLOR, MAX_DURABILITY, canPlaceAt };
})();

Items.define({
  id:            'geothermal-tap',
  name:          'Geothermal Tap',
  category:      'Power Source',
  size:          10,
  stackable:     false,
  maxDurability: GeothermalTapObject.MAX_DURABILITY,
  color:         GeothermalTapObject.COLOR,
  glyph:         GeothermalTapObject.INVENTORY_GLYPH,
  objectFactory: GeothermalTapObject.create,
  canPlaceAt:    GeothermalTapObject.canPlaceAt,
});
