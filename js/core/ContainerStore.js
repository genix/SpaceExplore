// Adapter factory for item containers stored in different places.
const ContainerStore = (() => {
  function create({ label, read, write }) {
    function _container() {
      return read ? read() : null;
    }

    function getItems() {
      return _container()?.items ?? [];
    }

    function getMaxSize() {
      return _container()?.maxSize ?? 0;
    }

    function getUsedSize() {
      return ContainerOps.usedSize(getItems());
    }

    function getRemainingSize() {
      return Math.max(0, getMaxSize() - getUsedSize());
    }

    function canAdd(itemId, count = 1) {
      const c = _container();
      return c ? ContainerOps.canAdd(c.items, c.maxSize, itemId, count) : false;
    }

    function _mutate(mutator) {
      const c = _container();
      if (!c || !write) return false;
      write({ ...c, items: mutator(c.items, c.maxSize) });
      return true;
    }

    function add(itemId, count = 1, instanceData = null) {
      if (!canAdd(itemId, count)) return false;
      return _mutate(items => ContainerOps.add(items, itemId, count, instanceData));
    }

    function remove(itemId, count = 1) {
      return _mutate(items => ContainerOps.remove(items, itemId, count));
    }

    function removeByUid(uid) {
      return _mutate(items => ContainerOps.removeByUid(items, uid));
    }

    function getByUid(uid) {
      return ContainerOps.getByUid(getItems(), uid);
    }

    return { label, getItems, getMaxSize, getUsedSize, getRemainingSize, canAdd, add, remove, removeByUid, getByUid };
  }

  function fromDatastore(label, key) {
    return create({
      label,
      read: () => Datastore.has(key) ? Datastore.get(key) : null,
      write: next => Datastore.withLock(key, () => next),
    });
  }

  function fromObjectField(label, findObject, fieldName, updateObject) {
    return create({
      label,
      read: () => {
        const obj = findObject();
        return obj ? obj[fieldName] : null;
      },
      write: next => {
        const obj = findObject();
        if (obj) updateObject(obj, next);
      },
    });
  }

  return { create, fromDatastore, fromObjectField };
})();
