// Atmospheric Condenser: 1×1 passable carryable extractor. Placed anywhere
// passable; output resource is derived from planet.terrain. Slower than a
// drill but doesn't require a deposit. Weather modifies output rate.
const AtmoCondenserObject = (() => {
  const COLOR       = '#88aacc';
  const BUFFER_MAX  = 15;
  const POWER_RANGE = 5;
  const POWER_RATE  = 1;
  const BASE_TICKS  = 5;   // ticks per unit at modifier 1.0
  const MAX_DURABILITY = 120;   // ~1 unit / 5 turns -> ~600 active turns temperate (design lifespan table)

  // Resource by terrain. Drives the condenser's output type.
  const TERRAIN_OUTPUT = {
    temperate: 'water',
    tundra:    'methane',
    frozen:    'rare-gases',
    arid:      'silica',
    scorched:  'sulfur',
  };

  // Side-on: '~~' vapor intake over '/\' support legs.
  const GLYPHS = {
    '0,0': { chars: ['~~', '/\\'], color: COLOR },
  };

  const INVENTORY_GLYPH = [
    ['~', '~'],
    ['/', '\\'],
  ];

  function create(id, x, y) {
    return {
      id, type: 'atmo-condenser',
      x, y,
      passable: true,
      carryable: true,
      interactable: true,
      itemId: 'atmo-condenser',
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
      lightRadius: 3,
      buffer: 0,
      bufferMax: BUFFER_MAX,
      resource: null,     // assigned at placement from planet terrain
      tickAccumulator: 0,
      durability: MAX_DURABILITY,
      maxDurability: MAX_DURABILITY,
      power: { role: 'consumer', range: POWER_RANGE, rate: POWER_RATE },
      onInteract: drainBufferOrFallthrough,
    };
  }

  function drainBufferOrFallthrough(obj) {
    if (!obj.buffer || obj.buffer <= 0) return { consumed: false };
    const resource = obj.resource;
    if (!resource) return { consumed: false };
    let buffer = obj.buffer;
    while (buffer > 0 && Inventory.canAdd(resource, 1)) {
      Inventory.add(resource, 1);
      buffer -= 1;
    }
    ObjectManager.update(obj.id, { buffer });
    return { consumed: true };
  }

  function canPlaceAt(pos) {
    if (!Datastore.has('planetMap')) return 'Cannot place here.';
    const map = Datastore.get('planetMap');
    if (ObjectManager.getAt(pos.x, pos.y)) return 'Tile blocked.';
    if (!MapGen.isPassable(map.grid[pos.y][pos.x])) return 'Impassable terrain.';
    if (!Datastore.has('currentPlanet')) return 'Cannot place here.';
    const terrain = Datastore.get('currentPlanet').terrain;
    if (!TERRAIN_OUTPUT[terrain]) return 'Atmosphere yields nothing here.';
    return true;
  }

  function onPlace(obj) {
    if (!Datastore.has('currentPlanet')) return;
    const terrain = Datastore.get('currentPlanet').terrain;
    obj.resource = TERRAIN_OUTPUT[terrain] ?? null;
  }

  return { create, INVENTORY_GLYPH, COLOR, BASE_TICKS, MAX_DURABILITY, TERRAIN_OUTPUT, canPlaceAt, onPlace };
})();

Items.define({
  id:            'atmo-condenser',
  name:          'Atmo Condenser',
  category:      'Powered Equipment',
  size:          6,
  stackable:     false,
  maxDurability: AtmoCondenserObject.MAX_DURABILITY,
  color:         AtmoCondenserObject.COLOR,
  glyph:         AtmoCondenserObject.INVENTORY_GLYPH,
  objectFactory: AtmoCondenserObject.create,
  canPlaceAt:    AtmoCondenserObject.canPlaceAt,
  onPlace:       AtmoCondenserObject.onPlace,
});
