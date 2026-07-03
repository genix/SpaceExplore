// Auto-Drill: 1×1 passable carryable extractor. Must be placed on a revealed
// deposit tile (Items.canPlaceAt enforces this). Placement removes the
// underlying DepositObject (the drill replaces it visually) and links the
// drill to that deposit by id.
// Each powered tick: deposit.amount -= 1, drill.buffer += 1. When the deposit
// is exhausted the drill marks itself exhausted and stops ticking.
const AutoDrillObject = (() => {
  const COLOR        = '#cccccc';
  const BUFFER_MAX   = 20;
  const DRILL_TICKS  = 3;
  const POWER_RANGE  = 5;
  const POWER_RATE   = 2;
  const MAX_DURABILITY = 200;   // ~1 unit / 3 turns -> ~600 active turns temperate (design lifespan table)

  // Side-on: '||' drill shaft over '\/' bit biting into the deposit.
  const GLYPHS = {
    '0,0': { chars: ['||', '\\/'], color: COLOR },
  };

  const INVENTORY_GLYPH = [
    ['|', '|'],
    ['\\', '/'],
  ];

  function create(id, x, y) {
    const obj = {
      id, type: 'auto-drill',
      x, y,
      passable: true,
      carryable: true,
      interactable: true,
      itemId: 'auto-drill',
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
      lightRadius: 4,
      buffer: 0,
      bufferMax: BUFFER_MAX,
      tickAccumulator: 0,
      depositId: null,
      resource: null,
      exhausted: false,
      durability: MAX_DURABILITY,
      maxDurability: MAX_DURABILITY,
      power: { role: 'consumer', range: POWER_RANGE, rate: POWER_RATE },
      onInteract: drainBufferOrFallthrough,
    };
    return obj;
  }

  // E key handler: drain buffer to inventory if non-empty; otherwise fall
  // through so PlanetView's default carryable pickup runs.
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
    if (!Datastore.has('playerPos') || !Datastore.has('planetMap')) return 'Cannot place here.';
    if (ObjectManager.findDepositAt(pos.x, pos.y) === null) return 'Auto-Drill needs a revealed deposit.';
    return true;
  }

  // Called by InventoryPopup after objectFactory and before add() so we can
  // link the drill to its deposit and clear the DepositObject from the map.
  function onPlace(obj, pos) {
    const dep = ObjectManager.findDepositAt(pos.x, pos.y);
    if (!dep) return;
    obj.depositId = dep.depositId || dep.id;
    obj.resource  = dep.resource;
    ObjectManager.remove(dep.id);
  }

  return { create, INVENTORY_GLYPH, COLOR, DRILL_TICKS, MAX_DURABILITY, canPlaceAt, onPlace };
})();

Items.define({
  id:            'auto-drill',
  name:          'Auto-Drill',
  category:      'Powered Equipment',
  size:          8,
  stackable:     false,
  maxDurability: AutoDrillObject.MAX_DURABILITY,
  color:         AutoDrillObject.COLOR,
  glyph:         AutoDrillObject.INVENTORY_GLYPH,
  objectFactory: AutoDrillObject.create,
  canPlaceAt:    AutoDrillObject.canPlaceAt,
  onPlace:       AutoDrillObject.onPlace,
});
