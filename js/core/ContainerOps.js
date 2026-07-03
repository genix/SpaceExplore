// Pure helpers for an item-container's `items` array (the same shape used by the
// player inventory and ship cargo). Stackable items merge by id; non-stackable
// items (equipment) are stored as per-instance entries carrying durability.
// Callers pass the items array in and get a new array back; persistence is the
// caller's responsibility. Used by Parts Caches (and available to any future
// object-backed container).
const ContainerOps = (() => {
  function _genUid() {
    return `inst-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }

  function usedSize(items) {
    let s = 0;
    for (const e of items) {
      const d = Items.get(e.itemId);
      if (d) s += d.size * e.count;
    }
    return s;
  }

  function canAdd(items, maxSize, itemId, count = 1) {
    const d = Items.get(itemId);
    if (!d) return false;
    return d.size * count <= maxSize - usedSize(items);
  }

  function add(items, itemId, count = 1, instanceData = null) {
    const def = Items.get(itemId);
    const out = [...items];
    if (def && def.stackable === false) {
      const md = def.maxDurability ?? null;
      for (let i = 0; i < count; i++) {
        out.push({
          uid:           _genUid(),
          itemId,
          count:         1,
          durability:    instanceData?.durability   ?? md,
          maxDurability: instanceData?.maxDurability ?? md,
        });
      }
    } else {
      const i = out.findIndex(e => e.itemId === itemId);
      if (i === -1) out.push({ itemId, count });
      else out[i] = { ...out[i], count: out[i].count + count };
    }
    return out;
  }

  function remove(items, itemId, count = 1) {
    const out = [...items];
    const i = out.findIndex(e => e.itemId === itemId);
    if (i === -1) return out;
    const nc = out[i].count - count;
    if (nc <= 0) out.splice(i, 1);
    else out[i] = { ...out[i], count: nc };
    return out;
  }

  function removeByUid(items, uid) {
    return items.filter(e => e.uid !== uid);
  }

  function getByUid(items, uid) {
    return items.find(e => e.uid === uid) ?? null;
  }

  return { usedSize, canAdd, add, remove, removeByUid, getByUid };
})();
