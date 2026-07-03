// Per-turn space-suit battery: drains from local temperature, recharges from nearby ship.
// Ship battery recharges from sunlight. On suit depletion: popup, then reset to title.
// Lifecycle is tied to PlanetView show/hide; subscribes to TurnManager on start().
const SuitSystem = (() => {
  const SHIP_SUN_RATE      = 15;
  const SHIP_CHARGE_RADIUS = 3;
  const DEBUG_FLOOR        = 1;

  const BANDS = [
    { maxC: -50,       drain: 5.0, name: 'critical_cold' },
    { maxC: -20,       drain: 2.0, name: 'cold'          },
    { maxC:   0,       drain: 0.6, name: 'cool'          },
    { maxC:  30,       drain: 0.1, name: 'nominal'       },
    { maxC:  50,       drain: 0.6, name: 'warm'          },
    { maxC:  80,       drain: 2.0, name: 'hot'           },
    { maxC: Infinity,  drain: 5.0, name: 'critical_hot'  },
  ];

  let _active   = false;
  let _unsub    = null;
  let _dying    = false;
  let _lastCharging = false;

  function start() {
    if (_active) return;
    _active   = true;
    _dying    = false;
    _unsub    = TurnManager.subscribe(_tick);
  }

  function stop() {
    if (!_active) return;
    if (_unsub) { _unsub(); _unsub = null; }
    _active = false;
  }

  function bandFor(tempC) {
    for (const b of BANDS) if (tempC < b.maxC) return b;
    return BANDS[BANDS.length - 1];
  }

  function _findShip() {
    const list = ObjectManager.all();
    for (const o of list) if (o.type === 'ship') return o;
    return null;
  }

  function _chebyshevToObject(pos, obj, map) {
    let best = Infinity;
    const fp = obj.footprint ?? [{ dx: 0, dy: 0 }];
    for (const { dx, dy } of fp) {
      const sx = ((obj.x + dx) % map.w + map.w) % map.w;
      const sy = ((obj.y + dy) % map.h + map.h) % map.h;
      let ax = Math.abs(pos.x - sx);
      let ay = Math.abs(pos.y - sy);
      if (ax > map.w / 2) ax = map.w - ax;
      if (ay > map.h / 2) ay = map.h - ay;
      const d = Math.max(ax, ay);
      if (d < best) best = d;
    }
    return best;
  }

  // The suit can draw from the ship's battery when the player is within the ship's
  // SHIP_CHARGE_RADIUS, or within a powered conduit's own power.range. The conduit's
  // lit area IS its charge zone, which gives the player a clear visual cue.
  function _isInChargeZone(pos, ship, map) {
    if (_chebyshevToObject(pos, ship, map) <= SHIP_CHARGE_RADIUS) return true;
    for (const obj of ObjectManager.all()) {
      if (obj.id === ship.id) continue;
      if (!obj.power || obj.power.role !== 'conduit' || !obj.power.powered) continue;
      if (_chebyshevToObject(pos, obj, map) <= obj.power.range) return true;
    }
    return false;
  }

  function _chargeRate(suitBattery, suitMax, shipBattery, env, ship) {
    if (!ship) return 0;
    if (!_isInChargeZone(env.pos, ship, env.map)) return 0;
    if (shipBattery <= 0 || suitBattery >= suitMax * 0.99) return 0;
    return Math.min(suitMax * 0.10, suitMax - suitBattery, shipBattery);
  }

  function _readEnv() {
    if (!Datastore.has('playerPos') || !Datastore.has('planetMap')) return null;
    const map    = MapGen.reattachClimate(Datastore.get('planetMap'));
    const pos    = Datastore.get('playerPos');
    const phase  = Datastore.has('dayPhase') ? Datastore.get('dayPhase') : 0;
    const planet = Datastore.has('currentPlanet') ? Datastore.get('currentPlanet') : null;
    const zone      = map.climate.getClimateZone(pos.x, pos.y);
    const heatBonus = ObjectManager.getLavaHeatBonus(pos.x, pos.y);
    const tempK     = Temperature.currentTempK(zone.tempK, phase, planet, zone, heatBonus);
    return {
      map, pos, phase, planet,
      tempC: tempK - 273,
      sun:   Math.max(0, Math.cos(2 * Math.PI * phase)),
    };
  }

  function _tick() {
    if (_dying) return;
    if (!Datastore.has('playerSuit')) return;
    const env = _readEnv();
    if (!env) return;

    const band       = bandFor(env.tempC);
    const suitPrev   = Datastore.get('playerSuit');
    const suitMax    = suitPrev.maxBattery;
    const devilDrain = DustDevilSystem.getInsideDrain(env.pos, env.map);
    let suitBattery  = suitPrev.battery - band.drain - devilDrain;

    const ship      = _findShip();
    let shipBattery = ship ? ship.battery : 0;
    const shipMax   = ship ? ship.maxBattery : 0;
    let didCharge   = false;

    if (ship) {
      const want   = _chargeRate(suitBattery, suitMax, shipBattery, env, ship);
      suitBattery += want;
      shipBattery -= want;
      didCharge    = want > 0;
      shipBattery = MathUtils.clamp(shipBattery + SHIP_SUN_RATE * env.sun, 0, shipMax);
    }
    _lastCharging = didCharge;

    if (Debug.isActive() && suitBattery < DEBUG_FLOOR) suitBattery = DEBUG_FLOOR;
    suitBattery = MathUtils.clamp(suitBattery, 0, suitMax);

    Datastore.withLock('playerSuit', s => ({ ...s, battery: suitBattery }));
    if (ship && env.planet) {
      const key = `objects:${env.planet.id}`;
      Datastore.withLock(key, objs => objs.map(o => o.id === ship.id ? { ...o, battery: shipBattery } : o));
    }

    if (suitBattery <= 0) _triggerDeath();
  }

  function _triggerDeath() {
    if (_dying) return;
    _dying = true;
    PopupManager.show({
      width: 50,
      height: 12,
      title: ' SUIT FAILURE ',
      border: 'single',
      render(innerW) {
        const center = s => ' '.repeat(Math.max(0, Math.floor((innerW - s.length) / 2))) + s;
        return [
          '',
          center('Your suit battery is empty.'),
          center('Life support has failed.'),
          '',
          center('You have died.'),
          '',
          '─'.repeat(innerW),
          '',
          { text: center('[ DISMISS ]  Space / Enter'), clickable: true },
        ];
      },
      dismissKeys: [' ', 'Enter', 'Escape'],
      onDismiss: _reset,
    });
  }

  function _reset() {
    ScreenManager.show('title', {
      type: 'crt',
      afterSwap() {
        Datastore.clear();
        _dying = false;
      },
    });
  }

  function status() {
    if (!Datastore.has('playerSuit')) {
      return { suit: null, ship: null, drain: 0, band: '---', sun: 0, charging: false };
    }
    const suit = Datastore.get('playerSuit');
    const ship = _findShip();
    const env  = _readEnv();
    const band = env ? bandFor(env.tempC) : { drain: 0, name: '---' };
    const postDrainBattery = MathUtils.clamp(suit.battery - band.drain, 0, suit.maxBattery);
    const chargeRate = (env && ship)
      ? _chargeRate(postDrainBattery, suit.maxBattery, ship.battery, env, ship)
      : 0;
    const shipSunRate = env ? SHIP_SUN_RATE * env.sun : 0;
    return {
      suit: { battery: suit.battery, maxBattery: suit.maxBattery },
      ship: ship ? { battery: ship.battery, maxBattery: ship.maxBattery } : null,
      drain:          band.drain,
      chargeRate,
      suitNet:        chargeRate - band.drain,
      band:           band.name,
      tempC:          env ? env.tempC : null,
      sun:            env ? env.sun : 0,
      shipSunRate,
      shipChargeDraw: chargeRate,
      inChargeZone:   !!(env && ship && _isInChargeZone(env.pos, ship, env.map)),
      charging:       chargeRate > 0 || _lastCharging,
    };
  }

  return { start, stop, status, bandFor };
})();
