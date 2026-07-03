// Precondition: call init() for a key before any other operation on it.
// withLock() is the preferred write pattern — it guarantees release on throw.
const Datastore = (() => {
  const _store = {};

  function _entry(key) {
    const e = _store[key];
    if (!e) throw new Error(`Datastore: unknown key "${key}"`);
    return e;
  }

  function init(key, value, type) {
    if (_store[key]) throw new Error(`Datastore: key already exists "${key}"`);
    _store[key] = { key, value, type, locked: false, notifying: false, _oldValue: undefined, callbacks: [] };
  }

  function get(key) {
    return _entry(key).value;
  }

  function getType(key) {
    return _entry(key).type;
  }

  // Captures oldValue at acquire time so release() can diff before/after.
  function acquire(key) {
    const e = _entry(key);
    if (e.notifying) throw new Error(`Datastore: acquire blocked — "${key}" is notifying`);
    if (e.locked)    throw new Error(`Datastore: already locked "${key}"`);
    e._oldValue = e.value;
    e.locked = true;
    return true;
  }

  function set(key, value) {
    const e = _entry(key);
    if (!e.locked) throw new Error(`Datastore: "${key}" is not locked`);
    e.value = value;
  }

  function release(key) {
    const e = _entry(key);
    const newValue = e.value;
    const oldValue = e._oldValue;

    e.notifying = true;
    for (const cb of e.callbacks) {
      try { cb(key, newValue, oldValue); }
      catch (err) { console.error(`Datastore: callback error on "${key}":`, err); }
    }
    e.notifying = false;
    e.locked = false;
    e._oldValue = undefined;
  }

  function withLock(key, fn) {
    acquire(key);
    try {
      set(key, fn(get(key)));
    } finally {
      release(key);
    }
  }

  function has(key) {
    return Object.prototype.hasOwnProperty.call(_store, key);
  }

  function keys() {
    return Object.keys(_store);
  }

  function remove(key) {
    if (!has(key)) throw new Error(`Datastore: unknown key "${key}"`);
    delete _store[key];
  }

  function subscribe(key, callback) {
    _entry(key).callbacks.push(callback);
    return () => unsubscribe(key, callback);
  }

  function unsubscribe(key, callback) {
    const e = _entry(key);
    e.callbacks = e.callbacks.filter(cb => cb !== callback);
  }

  function clear() {
    for (const k of Object.keys(_store)) delete _store[k];
  }

  return { init, get, getType, has, keys, remove, acquire, set, release, withLock, subscribe, unsubscribe, clear };
})();
