// Snow weather plugin. Handles 'snow' and 'blizzard' event types.
// Snow uses moving radial clouds: broad, slow snowfalls and smaller fast blizzards.
// Multiple clouds can be active at once, capped by WeatherSystem.maxInstances
// (world size and atmosphere), with additional clouds nucleating over the storm's life.
const SnowWeather = (() => {
  const SNOW_THRESHOLD = 0.08;
  const FREEZE_K = 273;
  const NEW_CLOUD_CHANCE = 0.02;

  const TYPE_CFG = {
    snow: {
      minSnowChance: 0.30,
      minWind: 0.10,
      baseIntensity: 0.55,
      movePenalty: 0.17,
      radiusMin: 14,
      radiusMax: 20,
      totalTurnsMin: 45,
      totalTurnsMax: 85,
    },
    blizzard: {
      minSnowChance: 0.65,
      minWind: 0.50,
      baseIntensity: 0.88,
      movePenalty: 0.33,
      radiusMin: 8,
      radiusMax: 12,
      totalTurnsMin: 16,
      totalTurnsMax: 40,
    },
  };

  let _clouds = [];
  let _maxClouds = 1;

  function _localWindStrength(dayPhase) {
    const shifted = (dayPhase - 0.25 + 1.0) % 1.0;
    return 0.25 + 0.75 * Math.pow(Math.cos(shifted * 2 * Math.PI), 2);
  }

  function _effectiveWind(climate, dayPhase) {
    return climate.dominantWindSpeed * _localWindStrength(dayPhase);
  }

  function _driftSpeed(type, effWind) {
    if (type === 'blizzard') return Math.min(0.10 + effWind * 0.35, 0.50);
    return MathUtils.clamp(0.08 + effWind * 0.04, 0.08, 0.15);
  }

  function _eligibleZones(context, type) {
    const { climate, dayPhase, planet } = context;
    const cfg = TYPE_CFG[type];
    if (!['temperate', 'tundra', 'frozen'].includes(planet.terrain)) return [];
    if (type === 'blizzard' && planet.terrain !== 'frozen') return [];

    const effWind = _effectiveWind(climate, dayPhase);
    if (effWind <= cfg.minWind) return [];

    const zones = [];
    for (let i = 0; i < climate.zones.length; i++) {
      const zone = climate.zones[i];
      if ((zone.tempK ?? FREEZE_K) >= (Temperature.FREEZE_THRESHOLD ?? FREEZE_K)) continue;
      if (zone.snowChance <= cfg.minSnowChance) continue;
      zones.push({
        idx: i,
        weight: type === 'blizzard' ? zone.snowChance * effWind : zone.snowChance,
      });
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

  function _makeCloud(type, context) {
    const map = Datastore.get('planetMap');
    const cfg = TYPE_CFG[type];
    const zones = _eligibleZones(context, type);
    const picked = zones.length ? _weightedPick(zones) : { idx: 0 };
    const point = _spawnPointFromZone(map, picked.idx);
    const radius = cfg.radiusMin + Math.floor(Math.random() * (cfg.radiusMax - cfg.radiusMin + 1));
    const totalDuration = cfg.totalTurnsMin + Math.floor(Math.random() * (cfg.totalTurnsMax - cfg.totalTurnsMin + 1));
    const effWind = _effectiveWind(context.climate, context.dayPhase);
    const driftSpeed = _driftSpeed(type, effWind);

    return {
      type,
      cloudX: point.x,
      cloudY: point.y,
      cloudRadius: radius,
      driftDx: context.climate.dominantWindDir.dx * driftSpeed,
      driftDy: context.climate.dominantWindDir.dy * driftSpeed,
      age: 0,
      totalDuration,
      turnsLeft: totalDuration,
      baseIntensity: cfg.baseIntensity,
      maxMovePenalty: cfg.movePenalty,
      intensity: 0,
    };
  }

  function _lifecycleIntensity(cloud, planet) {
    const rampInFraction = planet.terrain === 'frozen' ? 0.08 : 0.15;
    const rampInTurns = cloud.totalDuration * rampInFraction;
    const rampOutTurns = cloud.totalDuration * 0.20;
    let ramp = 1.0;

    if (cloud.age < rampInTurns) {
      ramp = Math.min(ramp, cloud.age / rampInTurns);
    }
    if (cloud.turnsLeft < rampOutTurns) {
      ramp = Math.min(ramp, cloud.turnsLeft / rampOutTurns);
    }

    return MathUtils.clamp(cloud.baseIntensity * ramp, 0, 1);
  }

  function _cloudFalloff(tx, ty, cloud) {
    const dx = tx - cloud.cloudX;
    const dy = ty - cloud.cloudY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > cloud.cloudRadius) return 0;
    const edgeFade = 1 - dist / cloud.cloudRadius;
    return MathUtils.clamp(cloud.intensity * (0.35 + edgeFade * 0.65), 0, 1);
  }

  function _intensityAt(tx, ty, clouds) {
    let max = 0;
    for (const cloud of clouds) {
      const v = _cloudFalloff(tx, ty, cloud);
      if (v > max) max = v;
    }
    return max;
  }

  function _snapshot() {
    return _clouds.map(c => ({
      cloudX: c.cloudX,
      cloudY: c.cloudY,
      cloudRadius: c.cloudRadius,
      intensity: c.intensity,
    }));
  }

  function _makeSubCell(cfg, now) {
    const phase = Math.random() < 0.72 ? 'hidden' : (Math.random() < 0.45 ? 'visible' : 'fadeout');
    const cell = {
      phase,
      phaseStart: now,
      phaseDur:   cfg.hiddenMinMs,
      char:       cfg.glyphs[Math.floor(Math.random() * cfg.glyphs.length)],
      color:      cfg.colorPeak,
    };
    switch (phase) {
      case 'hidden':
        cell.phaseDur = cfg.hiddenMinMs + Math.random() * (cfg.hiddenMaxMs - cfg.hiddenMinMs);
        cell.phaseStart = now - Math.random() * cell.phaseDur;
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

  function _advanceSubCellAnim(sc, cfg, intensityAtTile, now) {
    const elapsed = now - sc.phaseStart;
    if (elapsed < sc.phaseDur) {
      if (sc.phase === 'fadeout') {
        sc.color = WeatherLayer.lerpColor(cfg.colorPeak, cfg.colorFade, elapsed / sc.phaseDur);
      }
      return;
    }

    switch (sc.phase) {
      case 'hidden':
        if (intensityAtTile <= SNOW_THRESHOLD) {
          sc.phaseDur   = cfg.hiddenMinMs + Math.random() * (cfg.hiddenMaxMs - cfg.hiddenMinMs);
          sc.phaseStart = now;
          return;
        }
        sc.phase      = 'visible';
        sc.char       = cfg.glyphs[Math.floor(Math.random() * cfg.glyphs.length)];
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
        sc.phase      = 'hidden';
        sc.color      = cfg.colorFade;
        sc.phaseDur   = cfg.hiddenMinMs + Math.random() * (cfg.hiddenMaxMs - cfg.hiddenMinMs);
        sc.phaseStart = now;
        break;
    }
  }

  function _advanceSnowTiles(tiles, cfg, event, viewport) {
    const now = Date.now();
    const clouds = event.clouds ?? [];
    const inView = new Set();
    for (let dy = 0; dy < viewport.viewportH; dy++) {
      for (let dx = 0; dx < viewport.viewportW; dx++) {
        inView.add(`${viewport.camX + dx},${viewport.camY + dy}`);
      }
    }

    for (const [key, tile] of tiles) {
      if (!inView.has(key)) { tiles.delete(key); continue; }
      const intensity = _intensityAt(tile.tx, tile.ty, clouds);
      for (const sc of tile.subCells) _advanceSubCellAnim(sc, cfg, intensity, now);
      if (intensity <= SNOW_THRESHOLD && tile.subCells.every(sc => sc.phase === 'hidden')) {
        tiles.delete(key);
      }
    }

    const eligible = [];
    let intensitySum = 0;
    for (const key of inView) {
      const [txS, tyS] = key.split(',');
      const tx = +txS;
      const ty = +tyS;
      const intensity = _intensityAt(tx, ty, clouds);
      if (intensity <= SNOW_THRESHOLD) continue;
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
    types: ['snow', 'blizzard'],

    reset() {
      _clouds = [];
      _maxClouds = 1;
    },

    getCandidates(context) {
      const candidates = [];
      const snowZones = _eligibleZones(context, 'snow');
      if (snowZones.length > 0) {
        candidates.push({
          type: 'snow',
          weight: snowZones.reduce((s, z) => s + z.weight, 0) / snowZones.length,
        });
      }
      const blizzardZones = _eligibleZones(context, 'blizzard');
      if (blizzardZones.length > 0) {
        candidates.push({
          type: 'blizzard',
          weight: blizzardZones.reduce((s, z) => s + z.weight, 0) / blizzardZones.length,
        });
      }
      return candidates;
    },

    onSpawn(type, context) {
      _clouds = [];
      _maxClouds = WeatherSystem.maxInstances(1, Datastore.get('planetMap'), context.planet);
      _clouds.push(_makeCloud(type, context));

      return {
        type,
        turnsLeft: _clouds[0].totalDuration,
        age: 0,
        intensity: 0,
        movePenalty: 0,
        clouds: _snapshot(),
        playerInCloud: false,
      };
    },

    onTick(event, context) {
      const map = Datastore.get('planetMap');

      if (_clouds.length < _maxClouds && Math.random() < NEW_CLOUD_CHANCE) {
        _clouds.push(_makeCloud(event.type, context));
      }

      const effWind = _effectiveWind(context.climate, context.dayPhase);
      for (let i = _clouds.length - 1; i >= 0; i--) {
        const c = _clouds[i];
        const driftSpeed = _driftSpeed(c.type, effWind);
        c.driftDx = context.climate.dominantWindDir.dx * driftSpeed;
        c.driftDy = context.climate.dominantWindDir.dy * driftSpeed;
        c.cloudX += c.driftDx;
        c.cloudY += c.driftDy;
        c.age++;
        c.turnsLeft--;
        if (c.turnsLeft <= 0 || c.cloudX < 0 || c.cloudX >= map.w || c.cloudY < 0 || c.cloudY >= map.h) {
          _clouds.splice(i, 1);
          continue;
        }
        c.intensity = _lifecycleIntensity(c, context.planet);
      }

      if (_clouds.length === 0) return null;

      const clouds = _snapshot();
      const playerIntensity = _intensityAt(context.playerPos.x, context.playerPos.y, clouds);
      const playerInCloud = playerIntensity > SNOW_THRESHOLD;
      const maxPenalty = Math.max(..._clouds.map(c => c.maxMovePenalty));
      const movePenalty = playerInCloud
        ? maxPenalty * MathUtils.clamp((playerIntensity - SNOW_THRESHOLD) / (1 - SNOW_THRESHOLD), 0, 1)
        : 0;

      return {
        age: event.age + 1,
        turnsLeft: Math.max(1, Math.max(..._clouds.map(c => c.turnsLeft))),
        intensity: playerIntensity,
        clouds,
        playerInCloud,
        movePenalty,
      };
    },

    getSpatialIntensity(event) {
      const clouds = event.clouds ?? [];
      return (tx, ty) => _intensityAt(tx, ty, clouds);
    },

    getLayer(event) {
      const cfg = WeatherLayer.WEATHER_ANIM[event.type];
      const label = event.type === 'blizzard' ? 'Blizzard' : 'Snow';
      const tiles = new Map();

      return {
        id:         event.type,
        zIndex:     10,
        ignoreTint: false,
        get label() { return tiles.size > 0 ? label : null; },

        visualTick(viewport) {
          const ev = WeatherSystem.getEvent(event.type) ?? Datastore.get('weatherEvent');
          if (!ev) return;
          _advanceSnowTiles(tiles, cfg, ev, viewport);
        },

        getScreenCells({ cameraX, cameraY, charW, charH }) {
          const cells = Array.from({ length: charH }, () => new Array(charW).fill(null));
          const offsets = [[0, 0], [1, 0], [0, 1], [1, 1]];
          for (const tile of tiles.values()) {
            const c0 = (tile.tx - cameraX) * 2;
            const r0 = (tile.ty - cameraY) * 2;
            if (c0 + 1 < 0 || c0 >= charW || r0 + 1 < 0 || r0 >= charH) continue;
            for (let i = 0; i < tile.subCells.length; i++) {
              const sc = tile.subCells[i];
              if (sc.phase === 'hidden') continue;
              const [dc, dr] = offsets[i];
              const cc = c0 + dc;
              const rr = r0 + dr;
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
