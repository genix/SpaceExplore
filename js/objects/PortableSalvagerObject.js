// Portable Salvager: a carryable suit module. While installed in a slot it is
// passive — it costs no battery and has no active effect. Its purpose is to
// enable field salvage: standing next to a piece of equipment and pressing E
// offers a Salvage option (handled in PlanetView). See
// design/CraftingAndDegradation.md.
const PortableSalvagerObject = (() => {
  const COLOR = '#dd9955';

  const GLYPHS = {
    '0,0': { chars: ['<>', '┴┴'], color: COLOR },
  };

  const INVENTORY_GLYPH = [
    ['<', '>'],
    ['┴', '┴'],
  ];

  function create(id, x, y) {
    return {
      id, type: 'portable-salvager',
      x, y,
      passable: true,
      carryable: true,
      interactable: true,
      itemId: 'portable-salvager',
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
    };
  }

  return { create, INVENTORY_GLYPH, COLOR };
})();

Items.define({
  id:            'portable-salvager',
  name:          'Portable Salvager',
  category:      'Suit Module',
  size:          2,
  color:         PortableSalvagerObject.COLOR,
  glyph:         PortableSalvagerObject.INVENTORY_GLYPH,
  objectFactory: PortableSalvagerObject.create,
  moduleSpec: {
    batteryCost: 0,
    label:       'Salvager',
    passive:     true,
    onActivate:  () => {},   // passive: field salvage is offered via E in PlanetView
  },
});
