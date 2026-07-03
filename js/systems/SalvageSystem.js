// Salvage logic: breaking equipment (broken or intact) back down into ~30% of
// its recipe's component ingredients, rounded to the nearest whole per
// ingredient. Returned components go to the suit inventory first; overflow goes
// to a Parts Cache on the tile (field salvage) or to ship cargo (ship salvage).
// See design/CraftingAndDegradation.md.
const SalvageSystem = (() => {
  const RETURN_FRACTION = 0.3;

  function _returns(itemId) {
    const recipe = Recipes.forOutput(itemId);
    if (!recipe) return [];
    return recipe.inputs
      .map(inp => ({ itemId: inp.itemId, count: Math.round(inp.count * RETURN_FRACTION) }))
      .filter(r => r.count > 0);
  }

  // Components a piece of equipment would yield (for UI preview / prompts).
  function previewReturns(itemId) {
    return _returns(itemId);
  }

  // Add returns to the suit inventory; whatever doesn't fit is passed to
  // `overflow(itemId, count)`.
  function _distribute(returns, overflow) {
    for (const r of returns) {
      let remaining = r.count;
      while (remaining > 0 && Inventory.canAdd(r.itemId, 1)) {
        Inventory.add(r.itemId, 1);
        remaining -= 1;
      }
      if (remaining > 0) overflow(r.itemId, remaining);
    }
  }

  // Field salvage of a deployed object: remove it from the map, return
  // components to the suit, overflow into a Parts Cache on its tile.
  function salvageObject(obj) {
    const returns = _returns(obj.itemId);
    const x = obj.x, y = obj.y;
    ObjectManager.remove(obj.id);
    const overflow = [];
    _distribute(returns, (itemId, count) => overflow.push({ itemId, count }));
    if (overflow.length) PartsCacheObject.depositMany(x, y, overflow);
    PowerSystem.resolve();
    return returns;
  }

  // Ship salvage of a carried equipment instance: remove it from its container,
  // return components to the suit, overflow into ship cargo.
  function salvageInstance(uid) {
    const inSuit = Inventory.getByUid(uid);
    const entry  = inSuit || ShipCargo.getByUid(uid);
    if (!entry) return null;
    const returns = _returns(entry.itemId);
    if (inSuit) Inventory.removeByUid(uid);
    else        ShipCargo.removeByUid(uid);
    _distribute(returns, (itemId, count) => {
      let rem = count;
      while (rem > 0 && ShipCargo.canAdd(itemId, 1)) { ShipCargo.add(itemId, 1); rem -= 1; }
    });
    return returns;
  }

  return { salvageObject, salvageInstance, previewReturns };
})();
