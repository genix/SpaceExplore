// Manages which screen is currently visible. Each screen must expose show() and hide().
// show(id) is an instant cut (unchanged); show(id, opts) routes the swap through
// ScreenFX so the outgoing screen animates off and the incoming one animates in.
// opts.afterSwap runs after the target has mounted, at the real swap boundary.
const ScreenManager = (() => {
  const _screens = {};
  let _currentId = null;

  function register(id, screen) {
    _screens[id] = screen;
  }

  function show(id, opts) {
    const swap = () => {
      _swap(id);
      if (opts && typeof opts.afterSwap === 'function') {
        try { opts.afterSwap(); } catch (err) { console.error('ScreenManager afterSwap error', err); }
      }
    };
    if (opts && id !== _currentId && typeof ScreenFX !== 'undefined') {
      ScreenFX.transition(id, opts, swap);
    } else {
      swap();
    }
  }

  function _swap(id) {
    // Modal popups belong to the current screen; clear them before transitioning.
    if (typeof PopupManager !== 'undefined') PopupManager.dismissAll();
    for (const [sid, screen] of Object.entries(_screens)) {
      if (sid !== id) screen.hide();
    }
    if (_screens[id]) _screens[id].show();
    _currentId = id;
    if (typeof StardateClock !== 'undefined') StardateClock.setScreen(id);
  }

  return { register, show };
})();
