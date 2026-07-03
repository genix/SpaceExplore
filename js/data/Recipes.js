// Crafting recipe catalogue. Three tiers:
//   'component' — intermediate parts crafted from raw resources
//   'equipment' — deployables crafted from components
//   'synthesis' — special outputs that go directly to a game resource (not inventory);
//                 output.target names the Datastore key to credit
// Each recipe produces output.count units per craft action; the player batches
// by adjusting quantity in the Fabricate popup. Ingredient stock is counted
// across both suit inventory and ship cargo (see CraftingSystem). All recipes
// are known from the start. See design/CraftingAndDegradation.md.
const Recipes = (() => {
  // Ordered components-first so the Fabricate list groups naturally.
  const RECIPES = [
    { id: 'mechanical-parts',  category: 'component', output: { itemId: 'mechanical-parts',  count: 1 },
      inputs: [{ itemId: 'iron', count: 3 }, { itemId: 'common-metals', count: 3 }] },
    { id: 'thermal-casing',    category: 'component', output: { itemId: 'thermal-casing',    count: 1 },
      inputs: [{ itemId: 'iron', count: 2 }, { itemId: 'sulfur', count: 2 }] },
    { id: 'filter-membrane',   category: 'component', output: { itemId: 'filter-membrane',   count: 1 },
      inputs: [{ itemId: 'silica', count: 2 }, { itemId: 'organics', count: 2 }] },
    { id: 'photovoltaic-cell', category: 'component', output: { itemId: 'photovoltaic-cell', count: 1 },
      inputs: [{ itemId: 'silicon', count: 3 }, { itemId: 'crystal', count: 2 }] },
    { id: 'power-cell',        category: 'component', output: { itemId: 'power-cell',        count: 1 },
      inputs: [{ itemId: 'crystal', count: 2 }, { itemId: 'common-metals', count: 2 }] },

    { id: 'auto-drill',        category: 'equipment', output: { itemId: 'auto-drill',        count: 1 },
      inputs: [{ itemId: 'mechanical-parts', count: 4 }, { itemId: 'power-cell', count: 2 }] },
    { id: 'atmo-condenser',    category: 'equipment', output: { itemId: 'atmo-condenser',    count: 1 },
      inputs: [{ itemId: 'filter-membrane', count: 3 }, { itemId: 'power-cell', count: 2 }] },
    { id: 'geothermal-tap',    category: 'equipment', output: { itemId: 'geothermal-tap',    count: 1 },
      inputs: [{ itemId: 'thermal-casing', count: 4 }, { itemId: 'mechanical-parts', count: 2 }] },
    { id: 'solar-array',       category: 'equipment', output: { itemId: 'solar-array',       count: 1 },
      inputs: [{ itemId: 'photovoltaic-cell', count: 4 }, { itemId: 'power-cell', count: 1 }] },
    { id: 'power-relay',       category: 'equipment', output: { itemId: 'power-relay',        count: 1 },
      inputs: [{ itemId: 'mechanical-parts', count: 2 }, { itemId: 'power-cell', count: 1 }] },
    { id: 'beacon',            category: 'equipment', output: { itemId: 'beacon',             count: 1 },
      inputs: [{ itemId: 'mechanical-parts', count: 2 }] },

    { id: 'aetherium', category: 'synthesis',
      output: { itemId: 'aetherium', count: 1, target: 'aetherium' },
      inputs: [{ itemId: 'deuterium', count: 2 }, { itemId: 'rare-gases', count: 1 }, { itemId: 'water', count: 2 }] },
  ];

  const _byId = {};
  for (const r of RECIPES) _byId[r.id] = r;

  function getRecipe(id) {
    return _byId[id] || null;
  }

  function all() {
    return RECIPES;
  }

  function byCategory(category) {
    return RECIPES.filter(r => r.category === category);
  }

  // The recipe that produces a given item id (used by salvage in Phase D).
  function forOutput(itemId) {
    return RECIPES.find(r => r.output.itemId === itemId) || null;
  }

  return { getRecipe, all, byCategory, forOutput };
})();
