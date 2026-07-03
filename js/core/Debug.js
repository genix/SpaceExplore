// Debug mode. Press backtick three times in quick succession to activate. While
// active, a single backtick opens the debug popup (DebugPopup); disable from there.
// When active: #status-bar shows an indicator, document.title is prefixed.
const Debug = (() => {
  const WINDOW_MS    = 800;
  const REQUIRED     = 3;
  const BASE_TITLE   = 'SpaceExplore';

  let _active        = false;
  let _count         = 0;
  let _lastPress     = 0;
  let _spaceInterval = null;

  function init() {
    document.addEventListener('keydown', _onKey);
    document.addEventListener('keyup',   _onKeyUp);
  }

  function _onKey(e) {
    if (e.key === ' ' && _active && !_spaceInterval) {
      e.preventDefault();
      TurnManager.tick();
      _spaceInterval = setInterval(() => TurnManager.tick(), 200);
      return;
    }
    if (e.repeat) return;
    if (e.key !== '`') { _count = 0; return; }

    // Already in debug mode: one backtick opens the debug popup. (While the popup
    // is open, PopupManager captures the key first, so we never re-enter here.)
    if (_active) {
      _count = 0;
      e.preventDefault();
      if (typeof DebugPopup !== 'undefined') DebugPopup.open();
      return;
    }

    const now = Date.now();
    if (now - _lastPress > WINDOW_MS) _count = 0;
    _lastPress = now;
    _count++;
    if (_count >= REQUIRED) {
      _count  = 0;
      _active = true;
      _render();
    }
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    _count  = 0;
    if (_spaceInterval) { clearInterval(_spaceInterval); _spaceInterval = null; }
    _render();
  }

  function _onKeyUp(e) {
    if (e.key === ' ' && _spaceInterval) {
      clearInterval(_spaceInterval);
      _spaceInterval = null;
    }
  }

  function _render() {
    document.title = _active ? `[DEBUG] ${BASE_TITLE}` : BASE_TITLE;
    const el = document.getElementById('status-bar');
    if (el) el.textContent = _active ? ' [DEBUG MODE]' : '';
  }

  function isActive() { return _active; }

  return { init, isActive, deactivate };
})();
