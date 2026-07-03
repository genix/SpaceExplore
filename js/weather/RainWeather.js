// Rain weather plugin. Handles 'rain' and 'heavy_rain' event types.
// Clouds are independent spatial entities: each is a per-zone density field that nucleates
// at a random map location, builds from local moisture, drifts with wind, gains density on
// upslopes (orographic lift) and loses it on leeward sides (rain shadow).
// Multiple clouds can exist simultaneously on moisture-rich planets.
// The layer renders rain glyphs only over tiles whose zone density exceeds RAIN_THRESHOLD,
// so the player walks into and out of rain by moving through the map.
const RainWeather = (() => {

  // --- Simulation constants ---
  const RAIN_THRESHOLD      = 0.20;
  const TERRAIN_DRAIN_BASE  = 0.021;
  const DISSIPATION_DRAIN   = 0.070;
  const TURBULENCE_STRENGTH = 0.40;
  const UPLIFT_THRESHOLD    = 0.05;   // min elevation delta to trigger uplift
  const OROGRAPHIC_UPLIFT   = 0.8;    // density gain multiplier per unit of upslope
  const SHADOW_THRESHOLD    = 0.05;   // min elevation delta to trigger rain shadow
  const OROGRAPHIC_DRAIN    = 0.6;    // density loss multiplier per unit of downslope
  const NEW_CLOUD_CHANCE_BASE = 0.0035;

  const PHASE_DRIFT = { building: 0.04, active: 0.28, dissipating: 0.55 };

  const CLOUD_CFG = {
    rain: {
      targetPeakDensity: 0.68,
      seedRate:          0.065,
      moistureFeedRate:  0.030,
      precipDrainRate:   0.028,
      buildTurns:        45,
      minActiveTurns:    80,
      lowDensityLimit:   0.08,
      dissipateStart:    0.18,
      totalTurnsMin:     160,
      totalTurnsMax:     260,
    },
    heavy_rain: {
      targetPeakDensity: 0.88,
      seedRate:          0.12,
      moistureFeedRate:  0.040,
      precipDrainRate:   0.050,
      buildTurns:        22,
      minActiveTurns:    50,
      lowDensityLimit:   0.12,
      dissipateStart:    0.16,
      totalTurnsMin:     75,
      totalTurnsMax:     130,
    },
  };

  // --- Layer rendering constants (per type) ---
  const LAYER_CFG = {
    rain:       { glyphs: ["'"],       startColor: '#4488cc', fadeDurMs: 200, hiddenMinMs: 450, hiddenMaxMs: 1200, cellFraction: 0.22 },
    heavy_rain: { glyphs: ['|', ';'],  startColor: '#2255aa', fadeDurMs: 120, hiddenMinMs: 260, hiddenMaxMs: 750,  cellFraction: 0.38 },
  };

  // --- Module state (reset each time onSpawn is called) ---
  let _clouds    = [];
  let _zoneElev  = null;   // Float32Array of per-zone average elevation, computed once per planet
  let _maxClouds = 1;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  // Deterministic float in [0,1) from three integers. Used for per-zone turbulence.
  function _zoneHash(a, b, c) {
    let h = (a * 1619 + b * 31337 + c * 2053) >>> 0;
    h ^= h >>> 16;
    h  = Math.imul(h, 0x45d9f3b) >>> 0;
    h ^= h >>> 16;
    return h / 0x100000000;
  }

  function _localWindStrength(dayPhase) {
    const shifted = (dayPhase - 0.25 + 1.0) % 1.0;
    return 0.25 + 0.75 * Math.pow(Math.cos(shifted * 2 * Math.PI), 2);
  }

  function _buildZoneElev(map) {
    const { zoneSize, zoneCount } = map.climate;
    const zw   = zoneCount.w;
    const zh   = zoneCount.h;
    const elev = new Float32Array(zw * zh);
    const cnt  = new Uint32Array(zw * zh);
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const zx  = Math.min(Math.floor(x / zoneSize.w), zw - 1);
        const zy  = Math.min(Math.floor(y / zoneSize.h), zh - 1);
        const idx = zy * zw + zx;
        elev[idx] += map.grid[y][x].elevation ?? 0;
        cnt[idx]++;
      }
    }
    for (let i = 0; i < elev.length; i++) {
      if (cnt[i]) elev[i] /= cnt[i];
    }
    return elev;
  }

  function _computeMaxClouds(climate) {
    const profile = _rainProfile(climate);
    if (profile.avg >= 0.68 || profile.max >= 0.90) return 4;
    if (profile.avg >= 0.45 || profile.max >= 0.75) return 3;
    if (profile.avg >= 0.25 || profile.max >= 0.55) return 2;
    return 1;
  }

  function _rainProfile(climate) {
    let sum = 0, max = 0;
    for (const zone of climate.zones) {
      sum += zone.rainChance;
      if (zone.rainChance > max) max = zone.rainChance;
    }
    return { avg: sum / climate.zones.length, max };
  }

  function _stormSupport(climate, localRainChance) {
    const profile = _rainProfile(climate);
    return Math.max(localRainChance, profile.avg * 0.75, profile.max * 0.35);
  }

  function _newCloudChance(climate) {
    const profile = _rainProfile(climate);
    return NEW_CLOUD_CHANCE_BASE + profile.avg * 0.012 + profile.max * 0.004;
  }

  function _pickFollowupType(currentType, climate, dayPhase) {
    const support = _stormSupport(climate, 0);
    const convective = dayPhase > 0.10 && dayPhase < 0.40;
    if (currentType === 'heavy_rain' && Math.random() < 0.30) return 'heavy_rain';
    if (convective && support > 0.55 && Math.random() < support * 0.22) return 'heavy_rain';
    return 'rain';
  }

  // Add `amount` of cloud density to zone (zx, zy), applying orographic lift/shadow.
  function _addZoneOro(field, zw, zh, zx, zy, amount, srcElev, zoneElev) {
    if (zy < 0 || zy >= zh) return;
    const wx    = ((zx % zw) + zw) % zw;
    const idx   = zy * zw + wx;
    const dElev = zoneElev[idx] - srcElev;
    if (dElev > UPLIFT_THRESHOLD) {
      amount *= 1 + OROGRAPHIC_UPLIFT * dElev;
    } else if (dElev < -SHADOW_THRESHOLD) {
      amount *= Math.max(0, 1 - OROGRAPHIC_DRAIN * Math.abs(dElev));
    }
    field[idx] = Math.min(1.0, field[idx] + amount);
  }

  // Create a new cloud object, nucleating at a random moisture-weighted zone.
  function _makeCloud(type, climate) {
    const { zoneCount, zones, dominantWindDir } = climate;
    const zw  = zoneCount.w;
    const zh  = zoneCount.h;
    const cfg = CLOUD_CFG[type];

    // Pick spawn zone weighted by rainChance
    const totalRc = zones.reduce((s, z) => s + z.rainChance, 0);
    let r = Math.random() * totalRc;
    let spawnIdx = zones.length - 1;
    for (let i = 0; i < zones.length; i++) {
      r -= zones[i].rainChance;
      if (r <= 0) { spawnIdx = i; break; }
    }
    const spawnZx = spawnIdx % zw;
    const spawnZy = Math.floor(spawnIdx / zw);

    // Plant a broad nucleus cluster upwind of the spawn zone so the building cloud drifts toward the area.
    const upwindAngle = Math.atan2(-dominantWindDir.dy, -dominantWindDir.dx);
    const numNuclei   = 8 + Math.floor(Math.random() * 7);
    const nuclei      = [];
    for (let n = 0; n < numNuclei; n++) {
      const angle = upwindAngle + (Math.random() - 0.5) * Math.PI * 1.35;
      const dist  = 1 + Math.random() * 8;
      const nx    = Math.round(spawnZx + Math.cos(angle) * dist);
      const ny    = Math.round(spawnZy + Math.sin(angle) * dist);
      if (nx < 0 || nx >= zw || ny < 0 || ny >= zh) continue;
      if (zones[ny * zw + nx].rainChance < 0.10) continue;
      nuclei.push({ zx: nx, zy: ny, rate: cfg.seedRate * (0.7 + Math.random() * 0.6) });
    }
    if (nuclei.length === 0) {
      nuclei.push({ zx: spawnZx, zy: spawnZy, rate: cfg.seedRate });
    }

    const totalTurns = cfg.totalTurnsMin + Math.floor(Math.random() * (cfg.totalTurnsMax - cfg.totalTurnsMin));
    const density    = new Float32Array(zw * zh);
    for (const n of nuclei) {
      density[n.zy * zw + n.zx] = 0.10 + Math.random() * 0.12;
    }

    return { type, phase: 'building', phaseAge: 0, age: 0, totalTurns, turnsLeft: totalTurns, density, nuclei };
  }

  // Advance one cloud by one turn: advect, seed, drain, transition phase.
  // Returns maxDensity after the update.
  function _updateCloud(cloud, climate, dayPhase) {
    const { zoneCount, dominantWindDir, dominantWindSpeed, zones } = climate;
    const zw  = zoneCount.w;
    const zh  = zoneCount.h;
    const cfg = CLOUD_CFG[cloud.type];

    const effWind    = dominantWindSpeed * _localWindStrength(dayPhase);
    const driftScale = effWind * PHASE_DRIFT[cloud.phase];
    const windDx     = dominantWindDir.dx;
    const windDy     = dominantWindDir.dy;
    const next       = new Float32Array(cloud.density.length);

    // Advection with per-zone turbulence and orographic effects
    for (let zy = 0; zy < zh; zy++) {
      for (let zx = 0; zx < zw; zx++) {
        const idx = zy * zw + zx;
        const d   = cloud.density[idx];
        if (d < 0.01) continue;

        const turbX  = (_zoneHash(zx, zy, cloud.age)         - 0.5) * TURBULENCE_STRENGTH;
        const turbY  = (_zoneHash(zx + 1000, zy, cloud.age)  - 0.5) * TURBULENCE_STRENGTH;
        const tZxF   = zx + (windDx + turbX) * driftScale;
        const tZyF   = zy + (windDy + turbY) * driftScale;

        const advFrac = Math.min(0.35, driftScale * 0.25);
        next[idx] += d * (1 - advFrac);

        const x0      = Math.floor(tZxF), x1 = x0 + 1;
        const y0      = Math.floor(tZyF), y1 = y0 + 1;
        const fx      = tZxF - x0,        fy = tZyF - y0;
        const adv     = d * advFrac;
        const srcElev = _zoneElev[idx];

        _addZoneOro(next, zw, zh, x0, y0, adv * (1 - fx) * (1 - fy), srcElev, _zoneElev);
        _addZoneOro(next, zw, zh, x1, y0, adv *      fx  * (1 - fy), srcElev, _zoneElev);
        _addZoneOro(next, zw, zh, x0, y1, adv * (1 - fx) *      fy,  srcElev, _zoneElev);
        _addZoneOro(next, zw, zh, x1, y1, adv *      fx  *      fy,  srcElev, _zoneElev);
      }
    }

    // Seeding — active only during building phase, fading out in the final 3 turns
    if (cloud.phase === 'building') {
      const seedFade = cloud.phaseAge > cfg.buildTurns - 3
        ? Math.max(0, 1 - (cloud.phaseAge - (cfg.buildTurns - 3)) / 3)
        : 1.0;
      for (const n of cloud.nuclei) {
        const idx = n.zy * zw + n.zx;
        next[idx] = Math.min(1.0, next[idx] + n.rate * seedFade);
      }
    }

    // Terrain drain and precipitation drain
    let maxDensity = 0;
    for (let i = 0; i < next.length; i++) {
      let d = next[i];
      if (d < 0.01) { next[i] = 0; continue; }

      const zone    = zones[i];
      if (cloud.phase !== 'dissipating' && d > 0.08 && zone.rainChance > 0.45) {
        const wetness = (zone.rainChance - 0.45) / 0.55;
        const feed = cfg.moistureFeedRate * wetness * Math.max(0, 1 - d / cfg.targetPeakDensity);
        d = Math.min(cfg.targetPeakDensity, d + feed);
      }
      const leeward = Math.max(0, 0.5 - zone.rainChance);
      d *= (1 - TERRAIN_DRAIN_BASE - leeward * 0.10);

      if (d > RAIN_THRESHOLD) {
        d -= (d - RAIN_THRESHOLD) * cfg.precipDrainRate;
      }
      if (cloud.phase === 'dissipating') {
        d *= (1 - DISSIPATION_DRAIN);
      }

      next[i] = Math.max(0, d);
      if (next[i] > maxDensity) maxDensity = next[i];
    }

    cloud.density = next;
    cloud.phaseAge++;
    cloud.age++;
    cloud.turnsLeft--;

    // Phase transitions
    if (cloud.phase === 'building') {
      if (maxDensity >= cfg.targetPeakDensity * 0.85 || cloud.phaseAge >= cfg.buildTurns) {
        cloud.phase    = 'active';
        cloud.phaseAge = 0;
      }
    } else if (cloud.phase === 'active') {
      if (cloud.phaseAge >= cfg.minActiveTurns &&
          (cloud.turnsLeft <= cloud.totalTurns * cfg.dissipateStart || maxDensity < cfg.lowDensityLimit)) {
        cloud.phase    = 'dissipating';
        cloud.phaseAge = 0;
      }
    }

    return maxDensity;
  }

  // Combine all cloud density fields into a single zone snapshot for the renderer.
  function _buildZoneCloud(zw) {
    const result = {};
    const len    = _clouds[0].density.length;
    for (let i = 0; i < len; i++) {
      let combined = 0;
      for (const c of _clouds) combined += c.density[i];
      combined = Math.min(1.0, combined);
      if (combined > 0.05) result[`${i % zw},${Math.floor(i / zw)}`] = combined;
    }
    return result;
  }

  function _getPlayerZoneDensity(context) {
    const { playerPos, climate } = context;
    const { zoneSize, zoneCount } = climate;
    const zx  = Math.min(Math.floor(playerPos.x / zoneSize.w), zoneCount.w - 1);
    const zy  = Math.min(Math.floor(playerPos.y / zoneSize.h), zoneCount.h - 1);
    const idx = zy * zoneCount.w + zx;
    let combined = 0;
    for (const c of _clouds) combined += c.density[idx];
    return Math.min(1.0, combined);
  }

  // -----------------------------------------------------------------------
  // Rendering helpers
  // -----------------------------------------------------------------------

  function _tileBaseColors(map, tx, ty) {
    const mx    = ((tx % map.w) + map.w) % map.w;
    const my    = ((ty % map.h) + map.h) % map.h;
    const chars = TerrainRenderer.getChars(map.grid[my][mx], mx, my);
    return [chars[0].color, chars[1].color, chars[2].color, chars[3].color];
  }

  function _makeSubCell(now, lcfg, baseColor) {
    if (Math.random() < 0.4) {
      return {
        phase:      'fading',
        phaseStart: now - Math.random() * lcfg.fadeDurMs,
        phaseDur:   lcfg.fadeDurMs,
        char:       lcfg.glyphs[Math.floor(Math.random() * lcfg.glyphs.length)],
        endColor:   baseColor,
      };
    }
    return {
      phase:      'hidden',
      phaseStart: now,
      phaseDur:   Math.random() * lcfg.hiddenMaxMs,
      char:       lcfg.glyphs[0],
      endColor:   baseColor,
    };
  }

  function _advanceSubCell(sc, lcfg, now, baseColor) {
    if (now - sc.phaseStart < sc.phaseDur) return;
    if (sc.phase === 'hidden') {
      sc.phase      = 'fading';
      sc.char       = lcfg.glyphs[Math.floor(Math.random() * lcfg.glyphs.length)];
      sc.endColor   = baseColor;
      sc.phaseDur   = lcfg.fadeDurMs;
      sc.phaseStart = now;
    } else {
      sc.phase      = 'hidden';
      sc.phaseDur   = lcfg.hiddenMinMs + Math.random() * (lcfg.hiddenMaxMs - lcfg.hiddenMinMs);
      sc.phaseStart = now;
    }
  }

  function _zoneDensityAt(tx, ty, map, zoneCloud) {
    const mx = ((tx % map.w) + map.w) % map.w;
    const my = ((ty % map.h) + map.h) % map.h;
    const { zoneSize, zoneCount } = map.climate;
    const zx = Math.min(Math.floor(mx / zoneSize.w), zoneCount.w - 1);
    const zy = Math.min(Math.floor(my / zoneSize.h), zoneCount.h - 1);
    return zoneCloud[`${zx},${zy}`] ?? 0;
  }

  function _advanceTiles(tiles, map, lcfg, viewport, eventType) {
    const now       = Date.now();
    const event     = WeatherSystem.getEvent(eventType) ?? Datastore.get('weatherEvent');
    const zoneCloud = (event && event.zoneCloud) ? event.zoneCloud : {};

    const inView = new Set();
    for (let dy = 0; dy < viewport.viewportH; dy++) {
      for (let dx = 0; dx < viewport.viewportW; dx++) {
        inView.add(`${viewport.camX + dx},${viewport.camY + dy}`);
      }
    }

    for (const [key, tile] of tiles) {
      if (!inView.has(key)) { tiles.delete(key); continue; }
      const baseColors = _tileBaseColors(map, tile.tx, tile.ty);
      for (let s = 0; s < 4; s++) _advanceSubCell(tile.subCells[s], lcfg, now, baseColors[s]);
      if (tile.subCells.every(sc => sc.phase === 'hidden') &&
          _zoneDensityAt(tile.tx, tile.ty, map, zoneCloud) <= RAIN_THRESHOLD) {
        tiles.delete(key);
      }
    }

    const eligible = [];
    let totalRainy = 0, intensitySum = 0;
    for (const key of inView) {
      const [txStr, tyStr] = key.split(',');
      const tx = +txStr, ty = +tyStr;
      const d  = _zoneDensityAt(tx, ty, map, zoneCloud);
      if (d <= RAIN_THRESHOLD) continue;
      const localIntensity = (d - RAIN_THRESHOLD) / (1 - RAIN_THRESHOLD);
      totalRainy++;
      intensitySum += localIntensity;
      if (!tiles.has(key)) eligible.push({ key, tx, ty });
    }
    if (eligible.length === 0) return;

    const avgIntensity = intensitySum / totalRainy;
    const coverage     = 0.5 + 0.5 * avgIntensity;
    const target       = Math.floor(totalRainy * lcfg.cellFraction * coverage);
    if (tiles.size >= target) return;

    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const needed = Math.min(target - tiles.size, eligible.length);
    for (let i = 0; i < needed; i++) {
      const { key, tx, ty } = eligible[i];
      const baseColors = _tileBaseColors(map, tx, ty);
      tiles.set(key, {
        tx, ty,
        subCells: [0, 1, 2, 3].map(s => _makeSubCell(now, lcfg, baseColors[s])),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Plugin interface
  // -----------------------------------------------------------------------

  return {
    types: ['rain', 'heavy_rain'],

    reset() {
      _clouds = [];
      _zoneElev = null;
      _maxClouds = 1;
    },

    getCandidates(context) {
      if (_clouds.length >= _maxClouds) return [];
      const rc = _stormSupport(context.climate, context.zone.rainChance);
      if (rc < 0.08) return [];
      const candidates = [{ type: 'rain', weight: rc }];
      // Heavy rain requires higher moisture and a convective afternoon window
      if (rc > 0.5 && context.dayPhase > 0.10 && context.dayPhase < 0.40) {
        candidates.push({ type: 'heavy_rain', weight: rc * 0.3 });
      }
      return candidates;
    },

    onSpawn(type, context) {
      const map = Datastore.get('planetMap');
      _clouds    = [];
      _zoneElev  = _buildZoneElev(map);
      _maxClouds = WeatherSystem.maxInstances(_computeMaxClouds(context.climate), map, context.planet);

      _clouds.push(_makeCloud(type, context.climate));
      return {
        type,
        turnsLeft: _clouds[0].totalTurns,
        intensity:  0,
        zoneCloud:  {},
      };
    },

    onTick(event, context) {
      const { climate, dayPhase } = context;

      // Possibly spawn an additional cloud if below cap
      if (_clouds.length < _maxClouds && Math.random() < _newCloudChance(climate)) {
        _clouds.push(_makeCloud(_pickFollowupType(event.type, climate, dayPhase), climate));
      }

      // Update all clouds; remove depleted ones
      for (let i = _clouds.length - 1; i >= 0; i--) {
        const maxDensity = _updateCloud(_clouds[i], climate, dayPhase);
        if (_clouds[i].phase === 'dissipating' && maxDensity < 0.025) {
          _clouds.splice(i, 1);
        }
      }

      if (_clouds.length === 0) return null;

      const zoneCloud = _buildZoneCloud(climate.zoneCount.w);
      const intensity = _getPlayerZoneDensity(context);
      const turnsLeft = Math.max(..._clouds.map(c => c.turnsLeft));

      return { turnsLeft: Math.max(1, turnsLeft), intensity, zoneCloud };
    },

    getSpatialIntensity(event, map) {
      const { zoneSize, zoneCount } = map.climate;
      const zoneCloud = event.zoneCloud ?? {};
      return function(tx, ty) {
        const zx = Math.min(Math.floor(tx / zoneSize.w), zoneCount.w - 1);
        const zy = Math.min(Math.floor(ty / zoneSize.h), zoneCount.h - 1);
        return zoneCloud[`${zx},${zy}`] ?? 0;
      };
    },

    getLayer(event) {
      const lcfg  = LAYER_CFG[event.type];
      const map   = Datastore.get('planetMap');
      const tiles = new Map();

      return {
        id:         event.type,
        zIndex:     10,
        ignoreTint: false,
        get label() { return tiles.size > 0 ? (event.type === 'heavy_rain' ? 'Heavy Rain' : 'Rain') : null; },

        visualTick(viewport) {
          _advanceTiles(tiles, map, lcfg, viewport, event.type);
        },

        getScreenCells({ cameraX, cameraY, charW, charH }) {
          const now       = Date.now();
          const cells     = Array.from({ length: charH }, () => new Array(charW).fill(null));
          const SC_OFFSETS = [[0, 0], [1, 0], [0, 1], [1, 1]];
          for (const tile of tiles.values()) {
            const charCol = (tile.tx - cameraX) * 2;
            const charRow = (tile.ty - cameraY) * 2;
            if (charCol + 1 < 0 || charCol >= charW || charRow + 1 < 0 || charRow >= charH) continue;
            for (let s = 0; s < 4; s++) {
              const sc = tile.subCells[s];
              if (sc.phase === 'hidden') continue;
              const [dc, dr] = SC_OFFSETS[s];
              const cc = charCol + dc;
              const cr = charRow + dr;
              if (cc < 0 || cc >= charW || cr < 0 || cr >= charH) continue;
              const t     = Math.min((now - sc.phaseStart) / sc.phaseDur, 1);
              const color = WeatherLayer.lerpColor(lcfg.startColor, sc.endColor, t);
              cells[cr][cc] = { char: sc.char, color };
            }
          }
          return cells;
        },

        destroy() { tiles.clear(); },
      };
    },
  };
})();
