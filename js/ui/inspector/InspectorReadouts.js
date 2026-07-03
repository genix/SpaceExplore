// Readout builders for the planet sidebar.
const InspectorReadouts = (() => {
  const F = InspectorFormat;
  const T = InspectorTargeting;
  const C = F.C;

  function autoMode(hoverTile = null) {
    const renderer = MapView.getRenderer();
    if (renderer?.isGlobalView) return 'env';

    const suit = SuitSystem.status();
    const power = PowerSystem.status();
    const shipNet = T.shipNet(suit, power);
    const suitPct = suit.suit ? suit.suit.battery / suit.suit.maxBattery * 100 : 100;
    const shipPct = power.ship ? power.ship.battery / power.ship.maxBattery * 100 : 100;
    const weather = T.weatherReadings();
    const strongest = weather[0]?.intensity ?? 0;
    const penalty = weather.reduce((m, r) => Math.max(m, r.event.movePenalty ?? 0), 0);

    if (suit.suit && suitPct <= 35 && suit.suitNet < -0.05) return 'env';
    if (power.ship && shipPct <= 35 && shipNet < -0.05) return 'power';
    if (strongest >= 0.67 || penalty >= 0.33) return 'env';

    const obj = T.targetObject(hoverTile);
    if (obj) {
      if (obj.type === 'ship') return shipNet < -0.05 ? 'power' : 'cargo';
      return 'object';
    }

    const ship = T.shipObject();
    const info = T.tileInfo();
    if (ship && info) {
      const d = T.distanceToObject(Datastore.get('playerPos'), ship, info.map);
      if (d <= 1 && (Inventory.getUsedSize() > 0 || ShipCargo.getUsedSize() > 0)) return 'cargo';
      if (suit.inChargeZone && shipNet < -0.05) return 'power';
    }

    return 'scan';
  }

  function powerSpine() {
    const suit = SuitSystem.status();
    const power = PowerSystem.status();
    const lines = [];

    if (!suit.suit) {
      lines.push(F.text('SUIT ---', C.dim), F.text('SHIP ---', C.dim));
      return lines;
    }

    const suitPct = Math.round(suit.suit.battery / suit.suit.maxBattery * 100);
    lines.push([
      { text: 'SUIT ', color: C.grey },
      { text: String(suitPct).padStart(3) + '% ', color: F.pctColor(suitPct) },
      { text: F.fmtRate(suit.suitNet), color: F.rateColor(suit.suitNet) },
    ]);
    lines.push(F.text(F.bar(suitPct), F.pctColor(suitPct)));
    lines.push([
      { text: 'drn ', color: C.grey },
      { text: F.fmtNum(suit.drain), color: C.yellow },
      { text: ' chg ', color: C.grey },
      { text: F.fmtNum(suit.chargeRate), color: suit.chargeRate > 0 ? C.green : C.dim },
    ]);

    if (!power.ship) {
      lines.push(F.text('SHIP ---', C.dim));
      return lines;
    }

    const shipPct = Math.round(power.ship.battery / power.ship.maxBattery * 100);
    const shipNet = T.shipNet(suit, power);
    lines.push([
      { text: 'SHIP ', color: C.grey },
      { text: String(shipPct).padStart(3) + '% ', color: F.pctColor(shipPct) },
      { text: F.fmtRate(shipNet), color: F.rateColor(shipNet) },
    ]);
    lines.push(F.text(F.bar(shipPct), F.pctColor(shipPct)));
    lines.push([
      { text: 'gen ', color: C.grey },
      { text: F.fmtNum(power.graphGen + suit.shipSunRate), color: C.green },
      { text: ' use ', color: C.grey },
      { text: F.fmtNum(power.graphUse + suit.shipChargeDraw), color: C.yellow },
    ]);

    return lines;
  }

  function scanLines(hoverTile = null) {
    const info = T.tileInfo(hoverTile);
    if (!info) return [F.header('SCAN'), F.text('no map', C.dim)];
    const gs = F.GROUND_STYLE[info.tile.ground] ?? { g: '.', c: C.grey };
    const elevVal = info.tile.elevation ?? 0;
    const veg = info.tile.vegetation && info.tile.vegetation !== 'none' ? info.tile.vegetation : null;
    const obj = ObjectManager.getAt(info.x, info.y);
    const target = hoverTile ? 'hover' : 'player';

    const lines = [
      F.header('SCAN'),
      F.kv(target, `${info.x},${info.y}`, C.yellow),
      [{ text: gs.g + ' ', color: gs.c }, { text: (info.tile.ground || '?').slice(0, F.W - 2), color: C.bright }],
      F.kv('temp', F.fmtC(info.tempC), F.tempColor(info.tempC)),
      F.kv('elev', elevVal.toFixed(2), C.grey),
      veg
        ? [{ text: 'veg    ', color: C.grey }, { text: veg, color: F.VEG_COLOR[veg] ?? C.green }]
        : F.kv('veg', 'bare', C.dim),
      F.kv('path', info.passable ? 'passable' : 'blocked', info.passable ? C.green : C.red),
    ];

    const inGrid = PowerSystem.coverageAt(info.x, info.y);
    lines.push(F.kv('grid', inGrid ? 'in range' : 'no reach', inGrid ? C.green : C.red));

    if (obj) {
      lines.push(F.header('OBJECT'), F.subject(objectGlyph(obj), F.objectName(obj), C.cyan, C.cyan));
      lines.push(interactionLine(obj));
    }
    return lines;
  }

  function interactionLine(obj, reachable = true) {
    if (!obj?.interactable) return F.text('no interaction', C.dim);
    if (!reachable) return F.text('move to interact', C.dim);
    if (obj.type === 'ship') return F.text('E ship menu', C.green);
    if (obj.bufferMax != null && obj.buffer > 0) return F.text('E drain buffer', C.green);
    if (obj.carryable) return F.text('E pickup', C.green);
    return F.text('E interact', C.green);
  }

  function objectLines(hoverTile = null) {
    const obj = T.targetObject(hoverTile);
    if (!obj) return [F.header('OBJECT'), F.text('no nearby object', C.dim)];

    const lines = [
      F.header('OBJECT'),
      F.subject(objectGlyph(obj), F.objectName(obj), C.cyan, C.cyan),
      F.kv('at', `${obj.x},${obj.y}`, C.yellow),
    ];

    if (obj.power) {
      lines.push(F.kv('state', obj.power.powered || obj.power.role === 'storage' ? 'powered' : 'no power',
        obj.power.powered || obj.power.role === 'storage' ? C.green : C.red));
      lines.push(F.kv('role', obj.power.role, C.cyan));
      if (obj.power.role === 'producer') lines.push(F.kv('rate', '+' + F.fmtNum(obj.power.rate) + '/t', C.green));
      if (obj.power.role === 'consumer') lines.push(F.kv('draw', '-' + F.fmtNum(obj.power.rate) + '/t', C.yellow));
      if (obj.power.role === 'conduit') lines.push(F.kv('range', obj.power.range, C.cyan));
    }

    if (obj.maxDurability) {
      const pct = Math.round(Degradation.fraction(obj) * 100);
      const broken = Degradation.isBroken(obj);
      lines.push(F.header('WEAR'));
      lines.push(F.kv('cond', broken ? 'broken' : `${pct}%`, broken ? C.red : F.pctColor(pct)));
      lines.push(F.text(F.bar(pct), broken ? C.red : F.pctColor(pct)));
    }

    if (obj.bufferMax != null) {
      const pct = Math.round(obj.buffer / obj.bufferMax * 100);
      lines.push(F.header('BUFFER'));
      lines.push(F.kv('fill', `${obj.buffer}/${obj.bufferMax}`, pct >= 90 ? C.yellow : C.bright));
      lines.push(F.text(F.bar(pct), pct >= 90 ? C.yellow : C.green));
      if (obj.resource) lines.push(F.kv('res', F.resourceName(obj.resource), C.yellow));
      lines.push(F.kv('status', extractorStatus(obj), extractorStatusColor(obj)));
    }

    if (obj.type === 'deposit') {
      const dep = T.depositById(obj.depositId || obj.id);
      lines.push(F.header('DEPOSIT'));
      lines.push(F.kv('res', F.resourceName(obj.resource), C.yellow));
      if (dep) lines.push(F.kv('left', dep.amount, dep.amount > 0 ? C.green : C.red));
    }

    if (obj.type === 'ship') {
      lines.push(F.header('SHIP'));
      lines.push(F.kv('cargo', `${ShipCargo.getUsedSize()}/${ShipCargo.getMaxSize()}`, C.yellow));
      lines.push(F.kv('charge', SuitSystem.status().inChargeZone ? 'in range' : 'out range',
        SuitSystem.status().inChargeZone ? C.green : C.dim));
    }

    lines.push('', interactionLine(obj, T.canInteractWith(obj)));
    return lines;
  }

  // A single-cell identity glyph for an object, used in the bracketed subject row.
  function objectGlyph(obj) {
    if (obj.type === 'ship') return 'S';
    if (obj.type === 'deposit') return '*';
    if (obj.power?.role === 'producer') return '+';
    if (obj.power?.role === 'consumer') return '-';
    if (obj.carryable) return '=';
    return 'o';
  }

  function extractorStatus(obj) {
    if (Degradation.isBroken(obj)) return 'broken';
    if (obj.exhausted) return 'exhausted';
    if (obj.buffer >= obj.bufferMax) return 'full';
    if (obj.power && !obj.power.powered) return 'no power';
    if (obj.power?.consumedThisTick) return 'working';
    return 'idle';
  }

  function extractorStatusColor(obj) {
    const s = extractorStatus(obj);
    if (s === 'working') return C.green;
    if (s === 'idle') return C.grey;
    if (s === 'full') return C.yellow;
    return C.red;
  }

  function powerLines() {
    const suit = SuitSystem.status();
    const power = PowerSystem.status();
    const shipNet = T.shipNet(suit, power);
    const lines = [
      F.header('POWER'),
      F.kv('ship', F.fmtRate(shipNet), F.rateColor(shipNet)),
      F.kv('solar', F.fmtNum(suit.shipSunRate) + '/t', C.green),
      F.kv('graph+', F.fmtNum(power.graphGen) + '/t', C.green),
      F.kv('graph-', F.fmtNum(power.graphUse) + '/t', C.yellow),
      F.kv('suit', F.fmtNum(suit.shipChargeDraw) + '/t', suit.shipChargeDraw > 0 ? C.yellow : C.dim),
      '',
      F.kv('nodes', power.connectedCount, C.cyan),
      F.kv('offline', power.unpoweredCount, power.unpoweredCount > 0 ? C.red : C.green),
      F.kv('prod', power.producerCount, C.green),
      F.kv('loads', power.consumerCount, C.yellow),
    ];
    if (power.biggestLoad) {
      lines.push(F.kv('top', `${power.biggestLoad.type}`, C.yellow));
      lines.push(F.kv('draw', F.fmtNum(power.biggestLoad.rate) + '/t', C.yellow));
    }
    lines.push(F.kv('charge', suit.inChargeZone ? 'in zone' : 'no zone', suit.inChargeZone ? C.green : C.dim));
    return lines;
  }

  function envLines(hoverTile = null) {
    const info = T.tileInfo(hoverTile);
    if (!info) return [F.header('ENV'), F.text('no map', C.dim)];
    const suit = SuitSystem.status();
    const weather = T.weatherReadings({ x: info.x, y: info.y });
    const lines = [
      F.header('ENV'),
      F.kv('temp', F.fmtC(info.tempC), F.tempColor(info.tempC)),
      F.kv('band', suit.band, C.cyan),
      F.kv('drain', F.fmtNum(suit.drain) + '/t', C.yellow),
      F.kv('sun', F.percent(suit.sun), C.yellow),
      '',
      F.header('WEATHER'),
    ];

    if (weather.length === 0) {
      lines.push(F.text('clear', C.grey));
    } else {
      for (const { event, intensity } of weather.slice(0, 4)) {
        const ic = F.intensityColor(intensity);
        lines.push([
          { text: F.intensityGlyph(intensity) + ' ', color: ic },
          { text: (F.TYPE_LABELS[event.type] ?? event.type).slice(0, 10).padEnd(10), color: C.grey },
          { text: F.percent(intensity).padStart(4), color: ic },
        ]);
      }
      const penalty = weather.reduce((m, r) => Math.max(m, r.event.movePenalty ?? 0), 0);
      if (penalty > 0) lines.push(F.kv('move', F.percent(penalty), C.red));
      if (weather.some(r => r.event.type === 'thick_fog' && r.intensity > 0.03)) {
        lines.push(F.text('visibility low', C.red));
      }
    }

    lines.push('', F.header('CLIMATE'));
    lines.push(F.kv('rain', F.percent(info.zone.rainChance), C.cyan));
    lines.push(F.kv('snow', F.percent(info.zone.snowChance), C.cyan));
    lines.push(F.kv('wind', F.fmtNum(info.zone.windSpeed ?? 0), C.grey));
    return lines;
  }

  function cargoLines(hoverTile = null) {
    const invUsed = Inventory.getUsedSize();
    const invMax = Inventory.getMaxSize();
    const cargoUsed = ShipCargo.getUsedSize();
    const cargoMax = ShipCargo.getMaxSize();
    const obj = T.targetObject(hoverTile);
    const lines = [
      F.header('CARGO'),
      F.kv('suit', `${invUsed}/${invMax}`, invUsed >= invMax ? C.red : C.yellow),
      F.text(F.bar(invMax ? invUsed / invMax * 100 : 0), C.yellow),
      F.kv('ship', cargoMax ? `${cargoUsed}/${cargoMax}` : '---', cargoUsed >= cargoMax && cargoMax ? C.red : C.yellow),
    ];
    if (cargoMax) lines.push(F.text(F.bar(cargoUsed / cargoMax * 100), C.yellow));

    if (obj?.bufferMax != null) {
      lines.push('', F.header('BUFFER'));
      lines.push(F.text(F.objectName(obj), C.cyan));
      lines.push(F.kv('fill', `${obj.buffer}/${obj.bufferMax}`, obj.buffer > 0 ? C.green : C.grey));
      if (obj.resource) lines.push(F.kv('res', F.resourceName(obj.resource), C.yellow));
      lines.push(interactionLine(obj, T.canInteractWith(obj)));
    }

    const items = Inventory.getItems().filter(e => Items.get(e.itemId)?.category === 'Resources');
    if (items.length > 0) {
      lines.push('', F.header('SUIT RES'));
      for (const entry of items.slice(0, 5)) {
        lines.push(F.kv(ResourceItems.getCode(entry.itemId), 'x' + entry.count, Items.get(entry.itemId)?.color || C.yellow));
      }
    }

    const planet = Datastore.has('currentPlanet') ? Datastore.get('currentPlanet') : null;
    const deposits = planet?.deposits ?? [];
    if (deposits.length > 0) {
      const revealed = deposits.filter(d => d.revealed).length;
      lines.push('', F.header('DEPOSITS'));
      lines.push(F.kv('known', `${revealed}/${deposits.length}`, revealed ? C.green : C.dim));
    }
    return lines;
  }

  function worldLines() {
    if (!Datastore.has('currentPlanet')) return [F.header('WORLD'), F.text('---', C.dim)];
    const p = Datastore.get('currentPlanet');
    const ts = F.TERRAIN_STYLE[p.terrain] || { g: '?', c: C.grey };
    const deposits = p.deposits ?? [];
    const revealed = deposits.filter(d => d.revealed).length;
    const lines = [
      F.header('WORLD'),
      F.subject(ts.g, p.name || '---', ts.c, C.bright),
      F.kv('terrain', p.terrain || '---', ts.c),
      F.kv('atmo', Atmosphere.label(p.atmosphere), C.cyan),
      F.kv('orbit', p.distanceAU != null ? p.distanceAU.toFixed(2) + 'AU' : '---', C.yellow),
      F.kv('day', p.dayLength != null ? p.dayLength + 't' : '---', C.grey),
      F.kv('land', p.landable ? 'yes' : 'no', p.landable ? C.green : C.red),
      F.kv('min', p.tempMinC != null ? F.fmtC(p.tempMinC) : '---', F.tempColor(p.tempMinC ?? 0)),
      F.kv('max', p.tempMaxC != null ? F.fmtC(p.tempMaxC) : '---', F.tempColor(p.tempMaxC ?? 0)),
    ];

    if (p.resources?.length) {
      lines.push('', F.header('RESOURCES'));
      for (const r of p.resources.slice(0, 7)) {
        lines.push(F.bullet(F.resourceName(r).slice(0, F.W - 2), Items.get(r)?.color || C.yellow));
      }
    }
    if (deposits.length > 0) {
      lines.push('', F.header('SURVEY'));
      lines.push(F.kv('depos', `${revealed}/${deposits.length}`, revealed ? C.green : C.dim));
    }
    return lines;
  }

  function readoutLines(mode, hoverTile = null) {
    if (mode === 'object') return objectLines(hoverTile);
    if (mode === 'power') return powerLines();
    if (mode === 'env') return envLines(hoverTile);
    if (mode === 'cargo') return cargoLines(hoverTile);
    if (mode === 'world') return worldLines();
    return scanLines(hoverTile);
  }

  return { autoMode, powerSpine, readoutLines };
})();
