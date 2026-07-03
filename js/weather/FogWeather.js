// Fog weather plugin. Handles 'fog' and 'thick_fog' event types.
// Fog forms as stationary regional banks in humid, calm parts of the map.
// Multiple banks can be active at once, capped by WeatherSystem.maxInstances
// (world size and atmosphere), with additional banks settling over the event's life.
const FogWeather = (() => {
  const FOG_WIND_MAX   = 0.30;
  const FOG_WIND_CLEAR = 0.40;
  const FOG_WINDOW_MIN = 0.40;
  const FOG_WINDOW_MAX = 0.88;
  const WET_WORLD_RAIN = 0.75;
  const FOG_THRESHOLD  = 0.03;
  const NEW_BANK_CHANCE = 0.02;

  const TYPE_CFG = {
    fog: {
      baseIntensity: 0.68,
      radiusMin: 22,
      radiusMax: 38,
      totalTurnsMin: 24,
      totalTurnsMax: 52,
    },
    thick_fog: {
      baseIntensity: 0.90,
      radiusMin: 28,
      radiusMax: 48,
      totalTurnsMin: 34,
      totalTurnsMax: 68,
    },
  };

  let _banks = [];
  let _maxBanks = 1;

  function _localWindStrength(dayPhase) {
    const shifted = (dayPhase - 0.25 + 1.0) % 1.0;
    return 0.25 + 0.75 * Math.pow(Math.cos(shifted * 2 * Math.PI), 2);
  }

  function _rainProfile(climate) {
    let sum = 0, max = 0;
    for (const zone of climate.zones) {
      sum += zone.rainChance;
      if (zone.rainChance > max) max = zone.rainChance;
    }
    return { avg: sum / climate.zones.length, max };
  }

  function _fogSupport(profile, localRainChance) {
    return Math.max(localRainChance, profile.avg * 0.65, profile.max * 0.25);
  }

  function _effectiveWind(climate, dayPhase, planet) {
    let windSpeed = climate.dominantWindSpeed;
    if (windSpeed >= 1.99 && planet?.dayLength != null) {
      windSpeed = MathUtils.clamp(Math.max(planet.dayLength, 1) / 180, 0.5, 2.0);
    }
    return windSpeed * _localWindStrength(dayPhase);
  }

  function _fogParams(context) {
    const { climate, dayPhase, planet } = context;
    if (!['temperate', 'tundra'].includes(planet.terrain)) return null;
    if (dayPhase <= FOG_WINDOW_MIN || dayPhase >= FOG_WINDOW_MAX) return null;

    const profile = _rainProfile(climate);
    const wetWorld = profile.avg >= WET_WORLD_RAIN || profile.max >= 0.90;
    const windMax = wetWorld ? 0.40 : FOG_WIND_MAX;
    const effWind = _effectiveWind(climate, dayPhase, planet);
    if (effWind >= windMax) return null;

    return {
      profile,
      wetWorld,
      effWind,
      windSuppression: Math.max(0, 1.0 - effWind / windMax),
      humidMin: wetWorld ? 0.18 : 0.30,
    };
  }

  function _eligibleZones(context, type = 'fog') {
    const params = _fogParams(context);
    if (!params) return [];

    const zones = [];
    const thick = type === 'thick_fog';
    const thickMin = params.wetWorld ? 0.55 : 0.70;
    for (let i = 0; i < context.climate.zones.length; i++) {
      const zone = context.climate.zones[i];
      if (zone.tempK <= 250) continue;

      const support = _fogSupport(params.profile, zone.rainChance);
      if (support <= params.humidMin) continue;
      if (thick && (support <= thickMin || params.effWind >= 0.15)) continue;

      const weight = thick
        ? support * (params.wetWorld ? 1.1 : 0.8)
        : support * (0.35 + params.windSuppression) * (params.wetWorld ? 1.4 : 1.0);
      zones.push({ idx: i, weight, support, wetWorld: params.wetWorld });
    }
    return zones;
  }

  function _weightedPick(items) {
    const total = items.reduce((s, it) => s + it.weight, 0);
    let r = Math.random() * total;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  function _spawnPointFromZone(map, zoneIdx) {
    const { zoneSize, zoneCount } = map.climate;
    const zx = zoneIdx % zoneCount.w;
    const zy = Math.floor(zoneIdx / zoneCount.w);
    const x0 = zx * zoneSize.w;
    const y0 = zy * zoneSize.h;
    const w = Math.min(zoneSize.w, map.w - x0);
    const h = Math.min(zoneSize.h, map.h - y0);
    return {
      x: x0 + Math.floor((0.25 + Math.random() * 0.50) * w),
      y: y0 + Math.floor((0.25 + Math.random() * 0.50) * h),
    };
  }

  function _wrappedDelta(a, b, size) {
    let d = a - b;
    if (d > size / 2) d -= size;
    if (d < -size / 2) d += size;
    return d;
  }

  function _makeBank(type, context) {
    const map = Datastore.get('planetMap');
    const cfg = TYPE_CFG[type];
    const zones = _eligibleZones(context, type);
    const picked = zones.length ? _weightedPick(zones) : { idx: 0, wetWorld: false };
    const point = _spawnPointFromZone(map, picked.idx);
    const durationScale = picked.wetWorld ? 1.65 : 1.0;
    const range = Math.round((cfg.totalTurnsMax - cfg.totalTurnsMin) * durationScale);
    const totalDuration = Math.round(cfg.totalTurnsMin * durationScale) + Math.floor(Math.random() * Math.max(1, range));
    const radius = cfg.radiusMin + Math.floor(Math.random() * (cfg.radiusMax - cfg.radiusMin + 1));

    return {
      fogX: point.x,
      fogY: point.y,
      fogRadius: radius,
      age: 0,
      totalDuration,
      turnsLeft: totalDuration,
      baseIntensity: cfg.baseIntensity,
      wetWorld: !!picked.wetWorld,
      dissipateOnSunrise: true,
      intensity: 0,
    };
  }

  function _bankIntensity(bank, dayPhase, effWind) {
    const rampInTurns  = bank.totalDuration * 0.25;
    const rampOutTurns = bank.totalDuration * 0.30;
    let ramp = 1.0;
    if (bank.age < rampInTurns) ramp = Math.min(ramp, bank.age / rampInTurns);
    if (bank.turnsLeft < rampOutTurns) ramp = Math.min(ramp, bank.turnsLeft / rampOutTurns);
    if (dayPhase > 0.85 || dayPhase < 0.05 || effWind > FOG_WIND_CLEAR) ramp *= 0.85;
    return MathUtils.clamp(bank.baseIntensity * ramp, 0, 1);
  }

  function _bankFalloff(tx, ty, bank, map) {
    const dx = _wrappedDelta(tx, bank.fogX, map.w);
    const dy = _wrappedDelta(ty, bank.fogY, map.h);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > bank.fogRadius) return 0;
    const edgeFade = 1 - dist / bank.fogRadius;
    return MathUtils.clamp(bank.intensity * (0.30 + edgeFade * 0.70), 0, 1);
  }

  function _intensityAt(tx, ty, banks, map) {
    let max = 0;
    for (const bank of banks) {
      const v = _bankFalloff(tx, ty, bank, map);
      if (v > max) max = v;
    }
    return max;
  }

  function _snapshot() {
    return _banks.map(b => ({
      fogX: b.fogX,
      fogY: b.fogY,
      fogRadius: b.fogRadius,
      intensity: b.intensity,
    }));
  }

  function _makeSubCell(cfg, now) {
    const phase = ['fadein', 'visible', 'fadeout'][Math.floor(Math.random() * 3)];
    const cell = {
      phase,
      phaseStart: now,
      phaseDur:   cfg.fadeInMs,
      char:       cfg.glyphs[Math.floor(Math.random() * cfg.glyphs.length)],
      color:      cfg.colorFade,
    };
    switch (phase) {
      case 'hidden':
        cell.phaseDur = cfg.hiddenMinMs + Math.random() * (cfg.hiddenMaxMs - cfg.hiddenMinMs);
        break;
      case 'fadein':
        cell.phaseDur = cfg.fadeInMs;
        cell.phaseStart = now - Math.random() * cfg.fadeInMs;
        break;
      case 'visible':
        cell.color = cfg.colorPeak;
        cell.phaseDur = cfg.visibleMinMs + Math.random() * (cfg.visibleMaxMs - cfg.visibleMinMs);
        cell.phaseStart = now - Math.random() * cell.phaseDur;
        break;
      case 'fadeout':
        cell.color = cfg.colorPeak;
        cell.phaseDur = cfg.fadeOutMs;
        cell.phaseStart = now - Math.random() * cfg.fadeOutMs;
        break;
    }
    return cell;
  }

  function _advanceSubCell(sc, cfg, intensityAtTile, now) {
    const elapsed = now - sc.phaseStart;
    if (elapsed < sc.phaseDur) {
      if (sc.phase === 'fadein') {
        sc.color = WeatherLayer.lerpColor(cfg.colorFade, cfg.colorPeak, elapsed / sc.phaseDur);
      } else if (sc.phase === 'fadeout') {
        sc.color = WeatherLayer.lerpColor(cfg.colorPeak, cfg.colorFade, elapsed / sc.phaseDur);
      }
      return;
    }

    switch (sc.phase) {
      case 'hidden':
        if (intensityAtTile <= FOG_THRESHOLD) {
          sc.phaseDur   = cfg.hiddenMinMs + Math.random() * (cfg.hiddenMaxMs - cfg.hiddenMinMs);
          sc.phaseStart = now;
          return;
        }
        sc.phase      = 'fadein';
        sc.char       = cfg.glyphs[Math.floor(Math.random() * cfg.glyphs.length)];
        sc.color      = cfg.colorFade;
        sc.phaseDur   = cfg.fadeInMs;
        sc.phaseStart = now - Math.random() * cfg.fadeInMs * 0.25;
        break;
      case 'fadein':
        sc.phase      = 'visible';
        sc.color      = cfg.colorPeak;
        sc.phaseDur   = cfg.visibleMinMs + Math.random() * (cfg.visibleMaxMs - cfg.visibleMinMs);
        sc.phaseStart = now;
        break;
      case 'visible':
        sc.phase      = 'fadeout';
        sc.color      = cfg.colorPeak;
        sc.phaseDur   = cfg.fadeOutMs;
        sc.phaseStart = now;
        break;
      case 'fadeout':
        if (intensityAtTile > FOG_THRESHOLD) {
          sc.phase      = 'fadein';
          sc.char       = cfg.glyphs[Math.floor(Math.random() * cfg.glyphs.length)];
          sc.color      = cfg.colorFade;
          sc.phaseDur   = cfg.fadeInMs;
          sc.phaseStart = now - Math.random() * cfg.fadeInMs * 0.25;
        } else {
          sc.phase      = 'hidden';
          sc.color      = cfg.colorFade;
          sc.phaseDur   = cfg.hiddenMinMs + Math.random() * (cfg.hiddenMaxMs - cfg.hiddenMinMs);
          sc.phaseStart = now;
        }
        break;
    }
  }

  function _advanceTiles(tiles, cfg, event, viewport, map) {
    const now = Date.now();
    const banks = event.banks ?? [];
    const inView = new Set();
    for (let dy = 0; dy < viewport.viewportH; dy++) {
      for (let dx = 0; dx < viewport.viewportW; dx++) {
        inView.add(`${viewport.camX + dx},${viewport.camY + dy}`);
      }
    }

    for (const [key, tile] of tiles) {
      if (!inView.has(key)) { tiles.delete(key); continue; }
      const intensity = _intensityAt(tile.tx, tile.ty, banks, map);
      for (const sc of tile.subCells) _advanceSubCell(sc, cfg, intensity, now);
      if (intensity <= FOG_THRESHOLD && tile.subCells.every(sc => sc.phase === 'hidden')) {
        tiles.delete(key);
      }
    }

    const eligible = [];
    let intensitySum = 0;
    for (const key of inView) {
      const [txS, tyS] = key.split(',');
      const tx = +txS;
      const ty = +tyS;
      const intensity = _intensityAt(tx, ty, banks, map);
      if (intensity <= FOG_THRESHOLD) continue;
      intensitySum += intensity;
      if (!tiles.has(key)) eligible.push({ key, tx, ty });
    }
    if (eligible.length === 0) return;

    const avgIntensity = intensitySum / eligible.length;
    const target = Math.floor(eligible.length * cfg.cellFraction * avgIntensity);
    if (tiles.size >= target) return;

    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const needed = Math.min(target - tiles.size, eligible.length);
    for (let i = 0; i < needed; i++) {
      const { key, tx, ty } = eligible[i];
      tiles.set(key, {
        tx, ty,
        subCells: [0, 1, 2, 3].map(() => _makeSubCell(cfg, now)),
      });
    }
  }

  return {
    types: ['fog', 'thick_fog'],

    reset() {
      _banks = [];
      _maxBanks = 1;
    },

    getCandidates(context) {
      const fogZones = _eligibleZones(context, 'fog');
      if (fogZones.length === 0) return [];

      const candidates = [{ type: 'fog', weight: fogZones.reduce((s, z) => s + z.weight, 0) / fogZones.length }];
      const thickZones = _eligibleZones(context, 'thick_fog');
      if (thickZones.length > 0) {
        candidates.push({
          type: 'thick_fog',
          weight: thickZones.reduce((s, z) => s + z.weight, 0) / thickZones.length,
        });
      }
      return candidates;
    },

    onSpawn(type, context) {
      _banks = [];
      _maxBanks = WeatherSystem.maxInstances(1, Datastore.get('planetMap'), context.planet);
      _banks.push(_makeBank(type, context));

      return {
        type,
        turnsLeft: _banks[0].totalDuration,
        age: 0,
        intensity: 0,
        bankIntensity: 0,
        movePenalty: 0,
        banks: _snapshot(),
        playerInFog: false,
      };
    },

    onTick(event, context) {
      const map = Datastore.get('planetMap');
      const effWind = _effectiveWind(context.climate, context.dayPhase, context.planet);
      const clearing = context.dayPhase > 0.85 || context.dayPhase < 0.05 || effWind > FOG_WIND_CLEAR;

      if (_banks.length < _maxBanks && Math.random() < NEW_BANK_CHANCE) {
        _banks.push(_makeBank(event.type, context));
      }

      for (let i = _banks.length - 1; i >= 0; i--) {
        const b = _banks[i];
        b.turnsLeft -= 1;
        if (b.dissipateOnSunrise && clearing) b.turnsLeft -= b.wetWorld ? 0.5 : 1;
        if (b.turnsLeft <= 0) { _banks.splice(i, 1); continue; }
        b.age++;
        b.intensity = _bankIntensity(b, context.dayPhase, effWind);
      }

      if (_banks.length === 0) return null;

      const banks = _snapshot();
      const playerIntensity = _intensityAt(context.playerPos.x, context.playerPos.y, banks, map);

      return {
        age: event.age + 1,
        turnsLeft: Math.max(1, Math.max(..._banks.map(b => b.turnsLeft))),
        bankIntensity: Math.max(0, ..._banks.map(b => b.intensity)),
        intensity: playerIntensity,
        banks,
        playerInFog: playerIntensity > FOG_THRESHOLD,
        movePenalty: 0,
      };
    },

    getSpatialIntensity(event, map) {
      const banks = event.banks ?? [];
      return (tx, ty) => _intensityAt(tx, ty, banks, map);
    },

    getLayer(event) {
      const cfg = WeatherLayer.WEATHER_ANIM[event.type];
      const map = Datastore.get('planetMap');
      const tiles = new Map();
      const label = event.type === 'thick_fog' ? 'Thick Fog' : 'Fog';

      return {
        id:         event.type,
        zIndex:     10,
        ignoreTint: false,
        get label() { return tiles.size > 0 ? label : null; },

        visualTick(viewport) {
          const ev = WeatherSystem.getEvent(event.type) ?? Datastore.get('weatherEvent');
          if (!ev) return;
          _advanceTiles(tiles, cfg, ev, viewport, map);
        },

        getScreenCells({ cameraX, cameraY, charW, charH }) {
          const cells = Array.from({ length: charH }, () => new Array(charW).fill(null));
          const offsets = [[0, 0], [1, 0], [0, 1], [1, 1]];
          for (const tile of tiles.values()) {
            const charCol = (tile.tx - cameraX) * 2;
            const charRow = (tile.ty - cameraY) * 2;
            if (charCol + 1 < 0 || charCol >= charW || charRow + 1 < 0 || charRow >= charH) continue;
            for (let i = 0; i < tile.subCells.length; i++) {
              const sc = tile.subCells[i];
              if (sc.phase === 'hidden') continue;
              const [dc, dr] = offsets[i];
              const cc = charCol + dc;
              const rr = charRow + dr;
              if (cc < 0 || cc >= charW || rr < 0 || rr >= charH) continue;
              cells[rr][cc] = { char: sc.char, color: sc.color };
            }
          }
          return cells;
        },

        destroy() { tiles.clear(); },
      };
    },
  };
})();
