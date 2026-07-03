// Crafting logic for the Fabricate interface. Pure data operations — no DOM.
// Ingredients are counted across both the suit inventory and ship cargo;
// consumption drains the suit first, then cargo. Crafted output goes to the
// suit inventory, overflowing into ship cargo when the suit is full. Equipment
// output is non-stackable, so each unit lands as its own full-durability
// instance. See design/CraftingAndDegradation.md.
const CraftingSystem = (() => {

  function _countIn(items, itemId) {
    let n = 0;
    for (const e of items) if (e.itemId === itemId) n += e.count;
    return n;
  }

  // Total held across suit + ship cargo.
  function countAvailable(itemId) {
    return _countIn(Inventory.getItems(), itemId) + _countIn(ShipCargo.getItems(), itemId);
  }

  // Max number of crafts the player can afford from current ingredient stock.
  function maxCraftable(recipeId) {
    const r = Recipes.getRecipe(recipeId);
    if (!r || r.inputs.length === 0) return 0;
    let max = Infinity;
    for (const inp of r.inputs) {
      max = Math.min(max, Math.floor(countAvailable(inp.itemId) / inp.count));
    }
    return Number.isFinite(max) ? max : 0;
  }

  function _hasIngredients(r, qty) {
    return r.inputs.every(inp => countAvailable(inp.itemId) >= inp.count * qty);
  }

  // Output must fit once the consumed ingredients have freed their space.
  function _outputFits(r, qty) {
    if (r.output.target) return true;
    const outDef  = Items.get(r.output.itemId);
    const outSize = (outDef?.size ?? 1) * r.output.count * qty;
    let freed = 0;
    for (const inp of r.inputs) {
      const idef = Items.get(inp.itemId);
      freed += (idef?.size ?? 1) * inp.count * qty;
    }
    const avail = Inventory.getRemainingSize() + ShipCargo.getRemainingSize() + freed;
    return outSize <= avail;
  }

  function canCraft(recipeId, qty = 1) {
    const r = Recipes.getRecipe(recipeId);
    if (!r || qty < 1) return false;
    return _hasIngredients(r, qty) && _outputFits(r, qty);
  }

  // Remove `count` of itemId, draining the suit first then ship cargo.
  function _consumeAcross(itemId, count) {
    const inSuit = Math.min(count, _countIn(Inventory.getItems(), itemId));
    if (inSuit > 0) Inventory.remove(itemId, inSuit);
    const rest = count - inSuit;
    if (rest > 0) ShipCargo.remove(itemId, rest);
  }

  // Place one unit of itemId into the suit, overflowing to ship cargo.
  function _placeOutput(itemId) {
    if (Inventory.canAdd(itemId, 1)) return Inventory.add(itemId, 1);
    if (ShipCargo.canAdd(itemId, 1)) return ShipCargo.add(itemId, 1);
    return false;
  }

  // Craft `qty` batches of a recipe. Returns the number of crafts completed
  // (0 on failure). Validates up front, so all-or-nothing.
  function craft(recipeId, qty = 1) {
    const r = Recipes.getRecipe(recipeId);
    if (!canCraft(recipeId, qty)) return 0;

    for (const inp of r.inputs) _consumeAcross(inp.itemId, inp.count * qty);

    if (r.output.target === 'aetherium' && Datastore.has('aetherium')) {
      Datastore.withLock('aetherium', a => a + r.output.count * qty);
      return qty;
    }

    let made = 0;
    for (let i = 0; i < qty; i++) {
      for (let k = 0; k < r.output.count; k++) _placeOutput(r.output.itemId);
      made++;
    }
    return made;
  }

  return { countAvailable, maxCraftable, canCraft, craft };
})();
