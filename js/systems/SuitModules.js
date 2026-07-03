// Suit module slot manager: activation, install, uninstall. Slots live on
// playerSuit.modules as length-SLOT_COUNT array of moduleId strings or nulls.
// Activating a slot deducts the module's batteryCost from the suit, fires the
// onActivate handler, and advances one game tick.
const SuitModules = (() => {
  const SLOT_COUNT = 4;

  function init() {
    if (!Datastore.has('playerSuit')) return;
    Datastore.withLock('playerSuit', s => {
      if (Array.isArray(s.modules) && s.modules.length === SLOT_COUNT) return s;
      const modules = Array(SLOT_COUNT).fill(null);
      if (Array.isArray(s.modules)) {
        for (let i = 0; i < Math.min(s.modules.length, SLOT_COUNT); i++) modules[i] = s.modules[i];
      }
      return { ...s, modules };
    });
  }

  function getSlots() {
    if (!Datastore.has('playerSuit')) return [];
    const s = Datastore.get('playerSuit');
    return Array.isArray(s.modules) ? s.modules : [];
  }

  function getSlotCount() {
    return SLOT_COUNT;
  }

  function getModuleAt(slotIndex) {
    const slots = getSlots();
    return slots[slotIndex] ?? null;
  }

  function canActivate(slotIndex) {
    const moduleId = getModuleAt(slotIndex);
    if (!moduleId) return false;
    const def = Items.get(moduleId);
    if (!def?.moduleSpec) return false;
    const suit = Datastore.get('playerSuit');
    return suit.battery >= def.moduleSpec.batteryCost;
  }

  function activate(slotIndex) {
    const moduleId = getModuleAt(slotIndex);
    if (!moduleId) return false;
    const def = Items.get(moduleId);
    if (!def?.moduleSpec) return false;
    const suit = Datastore.get('playerSuit');
    const cost = def.moduleSpec.batteryCost;
    if (suit.battery < cost) return false;

    Datastore.withLock('playerSuit', s => ({ ...s, battery: s.battery - cost }));

    const ctx = {
      playerPos: Datastore.has('playerPos')      ? Datastore.get('playerPos')      : null,
      planet:    Datastore.has('currentPlanet')  ? Datastore.get('currentPlanet')  : null,
      map:       Datastore.has('planetMap')      ? Datastore.get('planetMap')      : null,
    };
    try { def.moduleSpec.onActivate(ctx); }
    catch (err) { console.error(`SuitModules: activate ${moduleId} threw:`, err); }

    TurnManager.tick();
    return true;
  }

  // Move a module from inventory into a slot. Returns true on success.
  function install(slotIndex, itemId) {
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return false;
    const def = Items.get(itemId);
    if (!def?.moduleSpec) return false;
    const slots = getSlots();
    if (slots[slotIndex]) return false;
    const items = Inventory.getItems();
    const entry = items.find(it => it.itemId === itemId);
    if (!entry || entry.count <= 0) return false;

    Inventory.remove(itemId, 1);
    Datastore.withLock('playerSuit', s => {
      const updated = [...(s.modules ?? Array(SLOT_COUNT).fill(null))];
      updated[slotIndex] = itemId;
      return { ...s, modules: updated };
    });
    return true;
  }

  // Move a module from a slot back into inventory. Refuses if inventory is full.
  function uninstall(slotIndex) {
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return false;
    const itemId = getModuleAt(slotIndex);
    if (!itemId) return false;
    if (!Inventory.canAdd(itemId, 1)) return false;

    Datastore.withLock('playerSuit', s => {
      const updated = [...(s.modules ?? Array(SLOT_COUNT).fill(null))];
      updated[slotIndex] = null;
      return { ...s, modules: updated };
    });
    Inventory.add(itemId, 1);
    return true;
  }

  return { init, activate, install, uninstall, getSlots, getSlotCount, getModuleAt, canActivate, SLOT_COUNT };
})();
