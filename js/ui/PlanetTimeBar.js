// Top bar showing planet name, current day, in-game clock time, and day phase label.
// Subscribes to dayTurn and dayPhase so it re-renders on every turn tick.
// Precondition: init() must be called before DayCycle.start() so subscriptions are in place.
const PlanetTimeBar = (() => {
  let _el = null;
  let _unsubTurn  = null;
  let _unsubPhase = null;
  let _unsubPos   = null;

  function init(el) {
    if (_el) destroy();
    _el = el;
    if (Datastore.has('dayTurn'))   _unsubTurn  = Datastore.subscribe('dayTurn',   _render);
    if (Datastore.has('dayPhase'))  _unsubPhase = Datastore.subscribe('dayPhase',  _render);
    if (Datastore.has('playerPos')) _unsubPos   = Datastore.subscribe('playerPos', _render);
  }

  function refresh() { _render(); }

  function destroy() {
    if (_unsubTurn)  { _unsubTurn();  _unsubTurn  = null; }
    if (_unsubPhase) { _unsubPhase(); _unsubPhase = null; }
    if (_unsubPos)   { _unsubPos();   _unsubPos   = null; }
    _el = null;
  }

  function _phaseLabel(t) {
    if (t >= 0.75  && t < 5/6)   return 'Dawn';
    if (t >= 5/6   && t < 23/24) return 'Morning';
    if (t >= 23/24 || t < 0.125) return 'Midday';
    if (t >= 0.125 && t < 0.25)  return 'Afternoon';
    if (t >= 0.25  && t < 1/3)   return 'Evening';
    return 'Night';
  }

  function _render() {
    if (!_el) return;
    let name = '---', day = '-', timeStr = '--:--', label = '---';
    if (Datastore.has('currentPlanet')) {
      name = Datastore.get('currentPlanet').name || '---';
    }
    if (Datastore.has('currentDay')) {
      day = Datastore.get('currentDay');
    }
    if (Datastore.has('dayPhase')) {
      const t = Datastore.get('dayPhase');
      const offsetH = (t * 24 + 12) % 24;
      const h = Math.floor(offsetH);
      const m = Math.floor((offsetH - h) * 60);
      timeStr = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      label = _phaseLabel(t);
    }
    let tempStr = '---\xB0C';
    if (Datastore.has('playerPos') && Datastore.has('planetMap')) {
      const map = Datastore.get('planetMap');
      if (map && map.climate) {
        MapGen.reattachClimate(map);
        const pos       = Datastore.get('playerPos');
        const zone      = map.climate.getClimateZone(pos.x, pos.y);
        const heatBonus = ObjectManager.getLavaHeatBonus(pos.x, pos.y);
        const planet    = Datastore.has('currentPlanet') ? Datastore.get('currentPlanet') : null;
        const phase     = Datastore.has('dayPhase') ? Datastore.get('dayPhase') : 0;
        const tempK     = Temperature.currentTempK(zone.tempK, phase, planet, zone, heatBonus);
        const tempC     = Math.round(tempK - 273);
        tempStr     = (tempC >= 0 ? '+' : '') + tempC + '\xB0C';
      }
    }
    const title = ` SURFACE // ${name} | DAY ${day} | ${timeStr} ${label} | ${tempStr} `
      .toUpperCase().slice(0, 70);
    const innerW = 74;
    const left = Math.floor((innerW - title.length) / 2);
    _el.textContent = '  /' + '\u2500'.repeat(left) + title +
      '\u2500'.repeat(innerW - title.length - left) + '\\  ';
  }

  return { init, refresh, destroy };
})();
