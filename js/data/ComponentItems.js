// Registers intermediate crafting components as Items catalogue entries. Like
// raw resources they are stackable and have no objectFactory (they cannot be
// dropped onto the map); they sit between raw materials and equipment in the
// crafting tiers. See design/CraftingAndDegradation.md.
const ComponentItems = (() => {
  const ENTRIES = [
    { id: 'mechanical-parts',  code: 'Mp', name: 'Mechanical Parts',  color: '#bbbbbb' },
    { id: 'thermal-casing',    code: 'Tc', name: 'Thermal Casing',    color: '#cc7744' },
    { id: 'filter-membrane',   code: 'Fm', name: 'Filter Membrane',   color: '#88cc99' },
    { id: 'photovoltaic-cell', code: 'Pv', name: 'Photovoltaic Cell', color: '#ffdd55' },
    { id: 'power-cell',        code: 'Pc', name: 'Power Cell',        color: '#66ddff' },
  ];

  function register() {
    for (const e of ENTRIES) {
      Items.define({
        id:       e.id,
        name:     e.name,
        category: 'Components',
        size:     1,
        color:    e.color,
        glyph:    [
          [e.code[0], e.code[1]],
          ['·',       '·'      ],
        ],
        // No objectFactory — components cannot be dropped to the map.
      });
    }
  }

  function getCode(id) {
    const e = ENTRIES.find(x => x.id === id);
    return e ? e.code : id.slice(0, 2);
  }

  return { register, getCode, ENTRIES };
})();

ComponentItems.register();
