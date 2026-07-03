// Signal Beacon: 1×1 passable carryable navigation marker. Two jobs:
//   1. Marks a spot on the planet (persists in objects:<planetId> like any object).
//   2. Recalls the landed ship to the beacon — the ship lands on the beacon tile,
//      which becomes one of its 2×2 footprint cells (4 anchor configs are tried so
//      a blocked configuration can fall back to another).
// Wears very slowly while placed (BeaconSystem); a worn-out beacon can no longer
// recall the ship. At most MAX_PER_PLANET may be placed on a single planet.
const BeaconObject = (() => {
  const COLOR          = '#55ffff';
  const LIGHT_RADIUS   = 5;
  const MAX_DURABILITY = 1000;   // ~0.05 wear/turn temperate -> ~20000 turns; wears very slowly
  const MAX_PER_PLANET = 3;

  // Side-on assembled display: '()' transmitter dish over '||' mast.
  const GLYPHS = {
    '0,0': { chars: ['()', '||'], color: COLOR },
  };

  const INVENTORY_GLYPH = [
    ['(', ')'],
    ['|', '|'],
  ];

  function create(id, x, y) {
    return {
      id, type: 'beacon',
      x, y,
      passable: true,
      carryable: true,
      interactable: true,
      itemId: 'beacon',
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
      lightRadius: LIGHT_RADIUS,
      durability: MAX_DURABILITY,
      maxDurability: MAX_DURABILITY,
    };
  }

  function countOnPlanet() {
    return ObjectManager.all().filter(o => o.type === 'beacon').length;
  }

  function canPlaceAt(pos) {
    if (!Datastore.has('planetMap')) return 'Cannot place here.';
    const map = Datastore.get('planetMap');
    if (ObjectManager.getAt(pos.x, pos.y)) return 'Tile blocked.';
    if (!MapGen.isPassable(map.grid[pos.y][pos.x])) return 'Impassable terrain.';
    if (countOnPlanet() >= MAX_PER_PLANET) return `Beacon limit reached (${MAX_PER_PLANET} per planet).`;
    return true;
  }

  // Relocate the ship so it lands on the beacon, then consume the beacon. Returns
  // { ok: true } on success, or { ok: false, reason } when blocked. The beacon is
  // only consumed once a valid landing is committed.
  function recall(beacon) {
    if (!Datastore.has('planetMap') || !Datastore.has('currentPlanet')) {
      return { ok: false, reason: 'No planet loaded.' };
    }
    if (Degradation.isBroken(beacon)) {
      return { ok: false, reason: 'Beacon is worn out.' };
    }
    const map      = Datastore.get('planetMap');
    const planetId = Datastore.get('currentPlanet').id;
    const ship     = ObjectManager.all().find(o => o.type === 'ship');
    if (!ship) return { ok: false, reason: 'No ship on this planet.' };

    // Anchor (top-left) candidates so the beacon tile is one of the four
    // footprint cells: beacon at (0,0), (1,0), (0,1) or (1,1) of the ship.
    const candidates = [
      { x: beacon.x,     y: beacon.y     },
      { x: beacon.x - 1, y: beacon.y     },
      { x: beacon.x,     y: beacon.y - 1 },
      { x: beacon.x - 1, y: beacon.y - 1 },
    ];

    for (const c of candidates) {
      const ax = ((c.x % map.w) + map.w) % map.w;
      const ay = ((c.y % map.h) + map.h) % map.h;
      if (!ShipObject.isValidAnchor(map, ax, ay, planetId)) continue;
      const spawn = ShipObject.findPlayerSpawn(map, ax, ay, planetId);
      if (!spawn) continue;

      ObjectManager.remove(beacon.id);
      ObjectManager.update(ship.id, { x: ax, y: ay });
      Datastore.withLock('playerPos', () => spawn);
      PowerSystem.resolve();
      return { ok: true };
    }

    return { ok: false, reason: 'No clear landing zone for the ship here.' };
  }

  return { create, recall, countOnPlanet, canPlaceAt, INVENTORY_GLYPH, COLOR, MAX_DURABILITY, MAX_PER_PLANET };
})();

Items.define({
  id:            'beacon',
  name:          'Signal Beacon',
  category:      'Navigation',
  size:          4,
  stackable:     false,
  maxDurability: BeaconObject.MAX_DURABILITY,
  color:         BeaconObject.COLOR,
  glyph:         BeaconObject.INVENTORY_GLYPH,
  objectFactory: BeaconObject.create,
  canPlaceAt:    BeaconObject.canPlaceAt,
});
