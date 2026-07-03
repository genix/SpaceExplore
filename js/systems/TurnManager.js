// Synchronous turn-tick dispatcher. Safe to call tick() with no subscribers.
// gameTick increments on every tick(); use it to drive deterministic per-turn animations.
// Auto-tick: while active, fires tick() after intervalMs of idle. Any tick() call resets the timer.
// Subscribers may pass a priority (higher fires earlier); equal priorities preserve registration order.
const TurnManager = (() => {
  const _callbacks = [];
  let _gameTick = 0;
  let _autoTickInterval = 0;
  let _autoTickTimer = null;

  // Returns an unsubscribe function.
  function subscribe(cb, priority = 0) {
    _callbacks.push({ cb, priority });
    _callbacks.sort((a, b) => b.priority - a.priority);
    return () => {
      const i = _callbacks.findIndex(e => e.cb === cb);
      if (i !== -1) _callbacks.splice(i, 1);
    };
  }

  function tick() {
    _gameTick++;
    for (const { cb } of _callbacks) {
      try { cb(); }
      catch (err) { console.error('TurnManager: callback error:', err); }
    }
    if (_autoTickInterval > 0) _resetAutoTick();
  }

  function startAutoTick(intervalMs) {
    _autoTickInterval = intervalMs;
    _resetAutoTick();
  }

  function stopAutoTick() {
    _autoTickInterval = 0;
    if (_autoTickTimer !== null) {
      clearTimeout(_autoTickTimer);
      _autoTickTimer = null;
    }
  }

  function _resetAutoTick() {
    if (_autoTickTimer !== null) clearTimeout(_autoTickTimer);
    _autoTickTimer = setTimeout(tick, _autoTickInterval);
  }

  return {
    subscribe, tick, startAutoTick, stopAutoTick,
    get gameTick() { return _gameTick; },
  };
})();
