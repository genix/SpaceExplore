// Registers each raw resource type as an Items catalogue entry so it can be held
// in the player's inventory or the ship's cargo. Resources are stack-only — they
// have no objectFactory and cannot be dropped onto the map.
const ResourceItems = (() => {
  const ENTRIES = [
    { id: 'iron',          code: 'Fe', color: '#aa6644' },
    { id: 'water',         code: 'H2', color: '#3399ff' },
    { id: 'cryolite',      code: 'Cy', color: '#aaddff' },
    { id: 'deuterium',     code: 'Dt', color: '#4488ff' },
    { id: 'methane',       code: 'Mn', color: '#88ff88' },
    { id: 'rare-gases',    code: 'Rg', color: '#dd88ff' },
    { id: 'silica',        code: 'Sc', color: '#ddccaa' },
    { id: 'sulfur',        code: 'Su', color: '#eecc55' },
    { id: 'carbon',        code: 'Cb', color: '#666666' },
    { id: 'organics',      code: 'Or', color: '#88cc66' },
    { id: 'silicon',       code: 'Si', color: '#aaaaff' },
    { id: 'crystal',       code: 'Cr', color: '#88ffff' },
    { id: 'common-metals', code: 'Cm', color: '#999999' },
    { id: 'rare-materials',code: 'Rm', color: '#dddd33' },
  ];

  function _label(id) {
    return ResourceMaterials.resourceLabel ? ResourceMaterials.resourceLabel(id) : id;
  }

  function register() {
    for (const e of ENTRIES) {
      Items.define({
        id:       e.id,
        name:     _label(e.id),
        category: 'Resources',
        size:     1,
        color:    e.color,
        glyph:    [
          [e.code[0], e.code[1]],
          ['·',       '·'      ],
        ],
        // No objectFactory — resources cannot be dropped to the map.
      });
    }
  }

  function getColor(id) {
    const e = ENTRIES.find(x => x.id === id);
    return e ? e.color : '#cccccc';
  }

  function getCode(id) {
    const e = ENTRIES.find(x => x.id === id);
    return e ? e.code : id.slice(0, 2);
  }

  return { register, getColor, getCode, ENTRIES };
})();

ResourceItems.register();
