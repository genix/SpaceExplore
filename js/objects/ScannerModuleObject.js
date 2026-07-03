// Scanner Module: a carryable suit module. Pickup adds it to inventory; from there
// the player installs it into a slot at the ship. Activation reveals nearby deposits.
// Map-object form is what appears when the module is dropped into the world.
const ScannerModuleObject = (() => {
  const COLOR = '#88ddff';
  const RANGE = 8;

  const GLYPHS = {
    '0,0': { chars: ['<>', '/\\'], color: COLOR },
  };

  const INVENTORY_GLYPH = [
    ['<', '>'],
    ['/', '\\'],
  ];

  function create(id, x, y) {
    return {
      id, type: 'scanner-module',
      x, y,
      passable: true,
      carryable: true,
      interactable: true,
      itemId: 'scanner-module',
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
    };
  }

  function _distance(a, b, map) {
    let ddx = Math.abs(a.x - b.x);
    let ddy = Math.abs(a.y - b.y);
    if (ddx > map.w / 2) ddx = map.w - ddx;
    if (ddy > map.h / 2) ddy = map.h - ddy;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  // Reveals deposits within RANGE tiles of the player. Deposits live in
  // planet.deposits (added in Phase 3); for now this is a no-op if absent.
  // The visual pulse fires regardless so the player sees the scanned area.
  function activate(ctx) {
    if (!ctx.playerPos || !ctx.map) return { revealed: 0 };
    ScannerPulse.spawn(ctx.playerPos, RANGE);
    if (!ctx.planet) return { revealed: 0 };
    const deposits = ctx.planet.deposits ?? [];
    let revealed = 0;
    for (const d of deposits) {
      if (d.revealed) continue;
      if (_distance(ctx.playerPos, d, ctx.map) <= RANGE) {
        d.revealed = true;
        revealed++;
        ObjectManager.add(DepositObject.create(d.id, d.x, d.y, d.resource));
      }
    }
    if (revealed > 0) {
      Datastore.withLock('currentPlanet', p => ({ ...p, deposits: [...deposits] }));
    }
    return { revealed };
  }

  return { create, activate, INVENTORY_GLYPH, COLOR, RANGE };
})();

Items.define({
  id:            'scanner-module',
  name:          'Scanner Module',
  category:      'Suit Module',
  size:          2,
  color:         ScannerModuleObject.COLOR,
  glyph:         ScannerModuleObject.INVENTORY_GLYPH,
  objectFactory: ScannerModuleObject.create,
  moduleSpec: {
    batteryCost: 20,
    range:       ScannerModuleObject.RANGE,
    label:       'Scanner',
    onActivate:  ScannerModuleObject.activate,
  },
});
