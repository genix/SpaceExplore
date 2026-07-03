// Turn-driven day/night cycle. Advances one step per TurnManager tick.
// Owns dayTurn, dayPhase, and currentDay Datastore keys; exposes tintColor(hex) for rendering.
// t=0 is noon (natural colors), t=0.5 is midnight (peak night tint). Cosine curve interpolates between.
// Precondition: 'dayTurn', 'dayPhase', 'currentDay', and 'currentPlanet' must exist in Datastore before start().
const DayCycle = (() => {

  // RGB target color applied at deepest night.
  const NIGHT_TINT   = [10, 24, 64];
  // Maximum strength of the night tint at midnight.
  const NIGHT_FACTOR = 0.78;

  let _dayLength = 180;
  let _active = false;
  let _unsubTurn = null;
  let _currentT = 0;

  function start() {
    if (_active) return;
    if (!Datastore.has('currentPlanet')) return;
    const planet = Datastore.get('currentPlanet');
    _dayLength = (planet.dayLength != null) ? planet.dayLength : 180;
    _currentT = Datastore.get('dayTurn') / _dayLength;
    _active = true;
    _unsubTurn = TurnManager.subscribe(_tick);
  }

  function stop() {
    if (!_active) return;
    if (_unsubTurn) { _unsubTurn(); _unsubTurn = null; }
    _active = false;
  }

  function _tick() {
    const prev = Datastore.get('dayTurn');
    const next = (prev + 1) % _dayLength;
    _currentT = next / _dayLength;
    if (next === 0) Datastore.withLock('currentDay', d => d + 1);
    Datastore.withLock('dayTurn',  () => next);
    Datastore.withLock('dayPhase', () => _currentT);
  }

  // Returns a night-tinted version of a '#rrggbb' color string.
  // Factor peaks at midnight (t=0.5) via cosine curve, zero at noon (t=0).
  // scale: 0 = no tint (full light), 1 = full night tint. Used by light-source system.
  function tintColorScaled(hex, scale) {
    if (scale <= 0) return hex;
    const factor = (1 - Math.cos(2 * Math.PI * _currentT)) / 2 * NIGHT_FACTOR * scale;
    return ColorUtils.rgbToHex(ColorUtils.mixRgb(ColorUtils.hexToRgb(hex), NIGHT_TINT, factor));
  }

  function tintColor(hex) {
    return tintColorScaled(hex, 1);
  }

  return { start, stop, tintColor, tintColorScaled };
})();
