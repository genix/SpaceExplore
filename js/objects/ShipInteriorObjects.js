// Ship interior fixtures: the interactable equipment the player walks up to inside
// the hull. These are display/interaction shells only — they own no persistent data
// (cargo and aetherium live in their own Datastore keys). Each fixture is an
// impassable object with a 2x2-per-tile glyph block; `action` tells InteriorView
// which UI to open on interact.
const ShipInteriorObjects = (() => {
  const FOOT_2x1 = [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }];
  const FOOT_2x2 = [
    { dx: 0, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 1, dy: 1 },
  ];

  const DEFS = {
    // Cargo racks -> opens the suit<->ship cargo transfer.
    cargo: {
      label: 'Cargo Hold', hint: 'Cargo', action: 'cargo',
      footprint: FOOT_2x1,
      glyphs: {
        '0,0': { chars: ['╔╗', '╚╝'], color: '#c8a85a' },
        '1,0': { chars: ['╔╗', '╚╝'], color: '#c8a85a' },
      },
    },
    // Fabrication bench -> opens the crafting UI.
    fabricator: {
      label: 'Fabrication Bench', hint: 'Fabricate', action: 'fabricate',
      footprint: FOOT_2x1,
      glyphs: {
        '0,0': { chars: ['▼─', '██'], color: '#55c8ff' },
        '1,0': { chars: ['─▼', '██'], color: '#55c8ff' },
      },
    },
    // Salvage station -> breaks carried equipment into components.
    salvage: {
      label: 'Salvage Station', hint: 'Salvage', action: 'salvage',
      footprint: FOOT_2x1,
      glyphs: {
        '0,0': { chars: ['»─', '▄▄'], color: '#ff9650' },
        '1,0': { chars: ['─«', '▄▄'], color: '#ff9650' },
      },
    },
    // Flight console -> the ship's command station: return to the system and
    // configure suit modules.
    console: {
      label: 'Flight Console', hint: 'Console', action: 'console',
      footprint: FOOT_2x1,
      glyphs: {
        '0,0': { chars: ['▛▀', '▙▄'], color: '#5fd7af' },
        '1,0': { chars: ['▀▜', '▄▟'], color: '#5fd7af' },
      },
    },
    // Engine / Aetherium core -> shows hyperdrive fuel + engine status.
    engine: {
      label: 'Aetherium Core', hint: 'Engine', action: 'engine',
      footprint: FOOT_2x2,
      glyphs: {
        '0,0': { chars: ['╔═', '║▒'], color: '#8aa0b8' },
        '1,0': { chars: ['═╗', '▒║'], color: '#8aa0b8' },
        '0,1': { chars: ['║▓', '╚═'], color: '#a99bff' },
        '1,1': { chars: ['▓║', '═╝'], color: '#a99bff' },
      },
    },
    // Airlock -> exit back to the planet surface.
    airlock: {
      label: 'Airlock', hint: 'Exit Ship', action: 'airlock',
      footprint: FOOT_2x1,
      glyphs: {
        '0,0': { chars: ['◄│', '══'], color: '#c6d24a' },
        '1,0': { chars: ['│►', '══'], color: '#c6d24a' },
      },
    },
  };

  function create(type, x, y) {
    const d = DEFS[type];
    if (!d) throw new Error(`ShipInteriorObjects: unknown fixture "${type}"`);
    return {
      id:           `interior-${type}`,
      type:         `interior-${type}`,
      fixture:      type,
      x, y,
      passable:     false,
      interactable: true,
      footprint:    d.footprint,
      glyphs:       d.glyphs,
      label:        d.label,
      hint:         d.hint,
      action:       d.action,
    };
  }

  return { DEFS, create };
})();
