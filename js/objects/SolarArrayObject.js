// Solar Array: 1×1 passable carryable power producer. Output rate scales
// with sunlight (DayCycle), star luminosity (SolarSystem), and weather (cloud
// occlusion). Useless at night; weak on dim-star planets.
// PowerSystem reads `power.rate` per tick — the rate field stores the base,
// and computeProducerRate (in PowerSystem) applies sunlight scaling.
const SolarArrayObject = (() => {
  const COLOR       = '#ffcc44';
  const POWER_RANGE = 5;
  const BASE_RATE   = 8;
  const MAX_DURABILITY = 1500;  // delivers ~2.5 power/turn avg at luminosity 1 -> ~600 active turns temperate; dim stars last far longer

  // Side-on: '==' flat collector plate over '/\' support legs.
  const GLYPHS = {
    '0,0': { chars: ['==', '/\\'], color: COLOR },
  };

  const INVENTORY_GLYPH = [
    ['=', '='],
    ['/', '\\'],
  ];

  function create(id, x, y) {
    return {
      id, type: 'solar-array',
      x, y,
      passable: true,
      carryable: true,
      interactable: true,
      itemId: 'solar-array',
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
      lightRadius: 0,
      durability: MAX_DURABILITY,
      maxDurability: MAX_DURABILITY,
      power: { role: 'producer', range: POWER_RANGE, rate: BASE_RATE },
    };
  }

  function canPlaceAt(pos) {
    if (!Datastore.has('planetMap')) return 'Cannot place here.';
    const map = Datastore.get('planetMap');
    if (ObjectManager.getAt(pos.x, pos.y)) return 'Tile blocked.';
    if (!MapGen.isPassable(map.grid[pos.y][pos.x])) return 'Impassable terrain.';
    return true;
  }

  return { create, INVENTORY_GLYPH, COLOR, BASE_RATE, MAX_DURABILITY, canPlaceAt };
})();

Items.define({
  id:            'solar-array',
  name:          'Solar Array',
  category:      'Power Source',
  size:          4,
  stackable:     false,
  maxDurability: SolarArrayObject.MAX_DURABILITY,
  color:         SolarArrayObject.COLOR,
  glyph:         SolarArrayObject.INVENTORY_GLYPH,
  objectFactory: SolarArrayObject.create,
  canPlaceAt:    SolarArrayObject.canPlaceAt,
});
