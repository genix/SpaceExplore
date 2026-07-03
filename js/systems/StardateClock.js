// Global game clock. Advances the Stardate and accrues Aetherium (hyperdrive
// fuel) from elapsed game-days. Runs from boot, but only credits time while the
// game is foreground and a screen with a non-zero rate is active, so time is
// effectively paused on the Title and Landing screens, never advances while the
// tab is hidden, and never advances between save and load. See design/Stardate.md.
const StardateClock = (() => {
  const TICK_MS = 250;

  // Calendar shape for the day/month/year readout.
  const DAYS_PER_MONTH  = 30;
  const MONTHS_PER_YEAR = 12;

  // Aetherium gained per stardate-day (flat; coupled to time for now).
  const AETHERIUM_PER_DAY = 0.1;

  // Stardate-days advanced per real second, by active screen. Screens absent
  // from this table hold time still (Title, Landing, transitions).
  const SCREEN_RATES = {
    'galaxy-screen':       1 / 3,    // a day every ~3s while plotting jumps
    'solar-system-screen': 1 / 20,   // much slower in the orrery
    'planet-view':         1 / 90,   // a day every 90s on the surface
    'interior-view':       1 / 90,   // same as the surface — time passes normally inside
  };

  let _timer      = null;
  let _lastMs     = 0;
  let _rate       = 0;
  let _hidden     = false;
  let _visHandler = null;

  function start() {
    if (_timer) return;
    _lastMs = _now();
    _hidden = (typeof document !== 'undefined' && document.hidden) || false;
    if (typeof document !== 'undefined') {
      _visHandler = _onVisibility;
      document.addEventListener('visibilitychange', _visHandler);
    }
    _timer = setInterval(_tick, TICK_MS);
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_visHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', _visHandler);
    }
    _visHandler = null;
    _rate = 0;
  }

  // Called by ScreenManager on every swap: picks the new rate and rebases the
  // clock so time spent under the previous rate is never re-counted.
  function setScreen(id) {
    _rate = SCREEN_RATES[id] || 0;
    _lastMs = _now();
  }

  function _onVisibility() {
    _hidden = document.hidden;
    if (!_hidden) _lastMs = _now();
  }

  function _tick() {
    const now = _now();
    const dt  = (now - _lastMs) / 1000;
    _lastMs = now;
    if (_hidden || _rate <= 0 || dt <= 0) return;
    if (!Datastore.has('stardate')) return;

    const days = dt * _rate;
    Datastore.withLock('stardate', d => d + days);
    if (Datastore.has('aetherium')) {
      Datastore.withLock('aetherium', a => a + days * AETHERIUM_PER_DAY);
    }
  }

  // Absolute fractional days -> {year, month, day}, all 1-based.
  function calendar(days) {
    const whole = Math.max(0, Math.floor(days));
    const day   = whole % DAYS_PER_MONTH;
    const month = Math.floor(whole / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
    const year  = Math.floor(whole / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
    return { year: year + 1, month: month + 1, day: day + 1 };
  }

  function format(days) {
    const c  = calendar(days);
    const mm = String(c.month).padStart(2, '0');
    const dd = String(c.day).padStart(2, '0');
    return `Y${c.year} M${mm} D${dd}`;
  }

  function _now() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  return { start, stop, setScreen, calendar, format, AETHERIUM_PER_DAY };
})();
