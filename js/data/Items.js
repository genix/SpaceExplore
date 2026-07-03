// Static catalogue of carryable items. Object modules call Items.define(record) at
// load time to register; UI and inventory code reads via get(id) / all().
const Items = (() => {
  const _byId = {};

  function define(record) {
    if (!record || !record.id) throw new Error('Items.define: record must have an id');
    _byId[record.id] = record;
  }

  function get(id) {
    return _byId[id] || null;
  }

  function all() {
    return Object.values(_byId);
  }

  return { define, get, all };
})();
