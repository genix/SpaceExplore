// Helpers for reading and mutating the playerInventory Datastore entry.
const Inventory = (() => {
  const _store = ContainerStore.fromDatastore('SUIT', 'playerInventory');

  return {
    getMaxSize: _store.getMaxSize,
    getUsedSize: _store.getUsedSize,
    getRemainingSize: _store.getRemainingSize,
    canAdd: _store.canAdd,
    add: _store.add,
    remove: _store.remove,
    removeByUid: _store.removeByUid,
    getByUid: _store.getByUid,
    getItems: _store.getItems,
  };
})();
