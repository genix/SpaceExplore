// Parts Cache: a passable container object dropped on a tile to hold salvage
// overflow when the player's suit inventory can't fit returned components.
// Interacting (E) opens a transfer popup (shared with ship cargo) to move items
// either direction; the cache is removed once emptied. Multiple caches can exist
// independently. See design/CraftingAndDegradation.md.
const PartsCacheObject = (() => {
  const COLOR    = '#cc9966';
  const MAX_SIZE = 100;

  // Side-on: '[]' crate lid over filled body.
  const GLYPHS = {
    '0,0': { chars: ['[]', '##'], color: COLOR },
  };

  function create(id, x, y, items = []) {
    return {
      id, type: 'parts-cache',
      x, y,
      passable: true,
      carryable: false,
      interactable: true,
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: GLYPHS,
      lightRadius: 0,
      cache: { items, maxSize: MAX_SIZE },
    };
  }

  // Drop a batch of components onto the tile, merging into an existing cache
  // there or creating a new one.
  function depositMany(x, y, list) {
    const existing = ObjectManager.getAt(x, y);
    const onCache  = existing && existing.type === 'parts-cache' ? existing : null;
    let items = onCache ? [...onCache.cache.items] : [];
    for (const { itemId, count } of list) items = ContainerOps.add(items, itemId, count);
    if (onCache) {
      ObjectManager.update(onCache.id, { cache: { ...onCache.cache, items } });
    } else {
      const id = `parts-cache-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      ObjectManager.add(create(id, x, y, items));
    }
  }

  function isEmpty(cacheId) {
    const o = ObjectManager.all().find(x => x.id === cacheId);
    return !o || (o.cache?.items?.length ?? 0) === 0;
  }

  // Container adapter (for CargoTransferPopup) bound to a specific cache id.
  function adapter(cacheId) {
    const _obj = () => ObjectManager.all().find(o => o.id === cacheId) || null;
    return ContainerStore.fromObjectField(
      'CACHE',
      _obj,
      'cache',
      (obj, cache) => ObjectManager.update(obj.id, { cache })
    );
  }

  return { create, depositMany, isEmpty, adapter, COLOR };
})();
