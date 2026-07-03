// Dust storm plugin for WeatherSystem. Handles 'dust_storm' and 'sandstorm' types.
// Dust is simulated as a per-tile particulate density field. Each turn, density
// is advected via bilinear interpolation in the wind direction; uphill tiles receive
// exponentially less flow so the cloud routes around mountains rather than over them.
// High-moisture zones drain dust rapidly — a cloud blowing into a rainy area dissipates.
// Spawns anywhere on the map (not only near the player), and wraps at both map edges.
const DustStormWeather = (() => {

  const DUST_THRESHOLD     = 0.15;
  const MOISTURE_SUPPRESS  = 0.25;
  const MOISTURE_KILL      = 0.35;
  const MOUNTAIN_RESISTANCE = 3.5;
  const MAX_OUTFLOW_FRAC   = 0.55;
  const BASE_TERRAIN_DRAIN = 0.018;
  const DISSIPATION_DRAIN  = 0.090;
  const DUST_WIND_MIN      = 0.45;
  const SAND_WIND_MIN      = 0.70;
  const NEW_CLOUD_CHANCE   = 0.025;

  const PHASE_DRIFT = { building: 0.12, active: 0.55, dissipating: 0.70 };

  const CLOUD_CFG = {
    dust_storm: {
      seedRadius:     8,
      seedDensity:    0.80,
      buildTurns:     4,
      minActiveTurns: 12,
      totalTurnsMin:  14,
      totalTurnsMax:  40,
      minDrift:       0.10,
      maxMovePenalty: 0.25,
    },
    sandstorm: {
      seedRadius:     5,
      seedDensity:    0.95,
      buildTurns:     2,
      minActiveTurns: 6,
      totalTurnsMin:  8,
      totalTurnsMax:  20,
      minDrift:       0.25,
      maxMovePenalty: 0.50,
    },
  };

  let _clouds       = [];
  let _tileElev     = null;
  let _mapW         = 0;
  let _mapH         = 0;
  let _maxClouds    = 1;
  let _terrainScale = 1.0;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function _localWindStrength(dayPhase) {
    const shifted = (dayPhase - 0.25 + 1.0) % 1.0;
    return 0.25 + 0.75 * Math.pow(Math.cos(shifted * 2 * Math.PI), 2);
  }

  function _wrapX(x) { return ((x % _mapW) + _mapW) % _mapW; }
  function _wrapY(y) { return ((y % _mapH) + _mapH) % _mapH; }
  function _wrapIdx(tx, ty) { return _wrapY(ty) * _mapW + _wrapX(tx); }

  function _getZone(tx, ty, climate) {
    const { zoneSize, zoneCount, zones } = climate;
    const zx = Math.min(Math.floor(_wrapX(tx) / zoneSize.w), zoneCount.w - 1);
    const zy = Math.min(Math.floor(_wrapY(ty) / zoneSize.h), zoneCount.h - 1);
    return zones[zy * zoneCount.w + zx];
  }

  function _buildTileElev(map) {
    const elev = new Float32Array(_mapW * _mapH);
    for (let y = 0; y < _mapH; y++) {
      for (let x = 0; x < _mapW; x++) {
        elev[y * _mapW + x] = map.grid[y][x].elevation ?? 0;
      }
    }
    return elev;
  }

  // Spread `amount` of dust from (tx, ty) toward (tx + driftDx, ty + driftDy).
  // Bilinear weights are multiplied by exp(-resistance * elevGain) so dust
  // preferentially flows to lower or equal neighbours; weights are renormalised
  // so no mass is lost — it reroutes rather than disappears.
  function _addWithElevation(next, tx, ty, amount, driftDx, driftDy) {
    const tXF = tx + driftDx;
    const tYF = ty + driftDy;
    const x0  = Math.floor(tXF), x1 = x0 + 1;
    const y0  = Math.floor(tYF), y1 = y0 + 1;
    const fx  = tXF - x0, fy = tYF - y0;

    const srcElev = _tileElev[_wrapIdx(tx, ty)];
    const corners = [
      { bx: x0, by: y0, w: (1 - fx) * (1 - fy) },
      { bx: x1, by: y0, w:      fx  * (1 - fy) },
      { bx: x0, by: y1, w: (1 - fx) *      fy  },
      { bx: x1, by: y1, w:      fx  *      fy  },
    ];

    let totalW = 0;
    for (const c of corners) {
      const dElev = _tileElev[_wrapIdx(c.bx, c.by)] - srcElev;
      if (dElev > 0) c.w *= Math.exp(-MOUNTAIN_RESISTANCE * dElev);
      totalW += c.w;
    }

    if (totalW < 0.001) {
      next[_wrapIdx(tx, ty)] += amount;
      return;
    }

    for (const c of corners) {
      if (c.w < 0.001) continue;
      const nidx = _wrapIdx(c.bx, c.by);
      next[nidx] = Math.min(1.0, next[nidx] + amount * (c.w / totalW));
    }
  }

  function _updateCloud(cloud, climate, dayPhase) {
    const { dominantWindDir, dominantWindSpeed } = climate;
    const effWind    = dominantWindSpeed * _localWindStrength(dayPhase);
    const cfg        = CLOUD_CFG[cloud.type];
    const driftSpeed = Math.max(cfg.minDrift, 0.20 + effWind * 0.50);
    const driftScale = PHASE_DRIFT[cloud.phase];
    const driftDx    = dominantWindDir.dx * driftSpeed * driftScale;
    const driftDy    = dominantWindDir.dy * driftSpeed * driftScale;
    const advFrac    = Math.min(MAX_OUTFLOW_FRAC, driftSpeed * driftScale * 0.8);

    const next = new Float32Array(_mapW * _mapH);
    let maxDensity = 0;

    for (let i = 0; i < _mapW * _mapH; i++) {
      const d = cloud.density[i];
      if (d < 0.001) continue;
      const tx = i % _mapW;
      const ty = Math.floor(i / _mapW);
      next[i] += d * (1 - advFrac);
      _addWithElevation(next, tx, ty, d * advFrac, driftDx, driftDy);
    }

    for (let i = 0; i < _mapW * _mapH; i++) {
      let d = next[i];
      if (d < 0.001) { next[i] = 0; continue; }

      const tx   = i % _mapW;
      const ty   = Math.floor(i / _mapW);
      const zone = _getZone(tx, ty, climate);

      if (zone.rainChance > MOISTURE_KILL) {
        const f = (zone.rainChance - MOISTURE_KILL) / (1.0 - MOISTURE_KILL);
        d *= Math.max(0, 1 - f * 0.45);
      } else if (zone.rainChance > MOISTURE_SUPPRESS) {
        const f = (zone.rainChance - MOISTURE_SUPPRESS) / (MOISTURE_KILL - MOISTURE_SUPPRESS);
        d *= 1 - f * 0.08;
      }

      d *= (1 - BASE_TERRAIN_DRAIN);
      if (cloud.phase === 'dissipating') d *= (1 - DISSIPATION_DRAIN);

      next[i] = Math.max(0, d);
      if (next[i] > maxDensity) maxDensity = next[i];
    }

    cloud.density = next;
    cloud.phaseAge++;
    cloud.age++;
    cloud.turnsLeft--;

    if (cloud.phase === 'building') {
      if (maxDensity >= cfg.seedDensity * 0.80 || cloud.phaseAge >= cfg.buildTurns) {
        cloud.phase    = 'active';
        cloud.phaseAge = 0;
      }
    } else if (cloud.phase === 'active') {
      if (cloud.phaseAge >= cfg.minActiveTurns &&
          (cloud.turnsLeft <= cloud.totalTurns * 0.20 || maxDensity < 0.05)) {
        cloud.phase    = 'dissipating';
        cloud.phaseAge = 0;
      }
    }

    return maxDensity;
  }

  function _buildDustCloud() {
    const result = {};
    for (let i = 0; i < _mapW * _mapH; i++) {
      let combined = 0;
      for (const c of _clouds) combined += c.density[i];
      if (combined < DUST_THRESHOLD * 0.5) continue;
      result[`${i % _mapW},${Math.floor(i / _mapW)}`] = Math.min(1.0, combined);
    }
    return result;
  }

  function _getPlayerDensity(playerPos) {
    const idx = _wrapIdx(Math.floor(playerPos.x), Math.floor(playerPos.y));
    let combined = 0;
    for (const c of _clouds) combined += c.density[idx];
    return Math.min(1.0, combined);
  }

  function _makeCloud(type, spawnTx, spawnTy, radiusScale = 1.0) {
    const cfg    = CLOUD_CFG[type];
    const radius = Math.round(cfg.seedRadius * radiusScale);
    const density = new Float32Array(_mapW * _mapH);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const idx = _wrapIdx(spawnTx + dx, spawnTy + dy);
        density[idx] = Math.min(1.0, density[idx] + cfg.seedDensity * (1 - dist / radius));
      }
    }
    const baseRange  = cfg.totalTurnsMax - cfg.totalTurnsMin;
    const totalTurns = cfg.totalTurnsMin + Math.floor(Math.random() * Math.round(baseRange * radiusScale));
    return { type, phase: 'building', phaseAge: 0, age: 0, totalTurns, turnsLeft: totalTurns, density };
  }

  function _pickSpawnTile(climate, effWind) {
    const { zoneSize, zoneCount, zones } = climate;
    const weights = new Float32Array(zones.length);
    let totalWeight = 0;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.rainChance >= MOISTURE_SUPPRESS || z.tempK < 265) continue;
      const w = (1 - z.rainChance / MOISTURE_SUPPRESS) * effWind * (z.tempK > 285 ? 1.2 : 1.0);
      weights[i]    = w;
      totalWeight  += w;
    }

    if (totalWeight <= 0) {
      return { tx: Math.floor(Math.random() * _mapW), ty: Math.floor(Math.random() * _mapH) };
    }

    let r = Math.random() * totalWeight;
    let spawnIdx = zones.length - 1;
    for (let i = 0; i < zones.length; i++) {
      r -= weights[i];
      if (r <= 0) { spawnIdx = i; break; }
    }

    const spawnZx = spawnIdx % zoneCount.w;
    const spawnZy = Math.floor(spawnIdx / zoneCount.w);
    return {
      tx: Math.floor((spawnZx + 0.5) * zoneSize.w),
      ty: Math.floor((spawnZy + 0.5) * zoneSize.h),
    };
  }

  // -----------------------------------------------------------------------
  // Visual layer helpers
  // -----------------------------------------------------------------------

  function _tileDensityAt(tx, ty, dustCloud) {
    return dustCloud[`${_wrapX(tx)},${_wrapY(ty)}`] ?? 0;
  }

  // Returns true when the tile should be removed from the pool (dust has gone and fadeout finished).
  function _advanceTileAnim(tile, lcfg, dustCloud, now) {
    const elapsed = now - tile.phaseStart;
    if (elapsed < tile.phaseDur) {
      if (tile.phase === 'fadein') {
        tile.color = WeatherLayer.lerpColor(lcfg.colorFade, lcfg.colorPeak, elapsed / tile.phaseDur);
      } else if (tile.phase === 'fadeout') {
        tile.color = WeatherLayer.lerpColor(lcfg.colorPeak, lcfg.colorFade, elapsed / tile.phaseDur);
      }
      return false;
    }
    switch (tile.phase) {
      case 'fadein':
        tile.phase      = 'visible';
        tile.color      = lcfg.colorPeak;
        tile.phaseDur   = lcfg.visibleMinMs + Math.random() * (lcfg.visibleMaxMs - lcfg.visibleMinMs);
        tile.phaseStart = now;
        break;
      case 'visible':
        tile.phase      = 'fadeout';
        tile.color      = lcfg.colorPeak;
        tile.phaseDur   = lcfg.fadeOutMs;
        tile.phaseStart = now;
        break;
      case 'fadeout':
        if (_tileDensityAt(tile.tx, tile.ty, dustCloud) > DUST_THRESHOLD) {
          tile.phase      = 'fadein';
          tile.char       = lcfg.glyphs[Math.floor(Math.random() * lcfg.glyphs.length)];
          tile.color      = lcfg.colorFade;
          tile.phaseDur   = lcfg.fadeInMs;
          tile.phaseStart = now;
        } else {
          return true;
        }
        break;
    }
    return false;
  }

  function _advanceDustTiles(tiles, lcfg, dustCloud, viewport) {
    const now    = Date.now();
    const inView = new Set();
    for (let dy = 0; dy < viewport.viewportH; dy++) {
      for (let dx = 0; dx < viewport.viewportW; dx++) {
        inView.add(`${viewport.camX + dx},${viewport.camY + dy}`);
      }
    }

    for (const [key, tile] of tiles) {
      if (!inView.has(key)) { tiles.delete(key); continue; }
      if (_advanceTileAnim(tile, lcfg, dustCloud, now)) tiles.delete(key);
    }

    for (const key of inView) {
      if (tiles.has(key)) continue;
      const [txS, tyS] = key.split(',');
      if (_tileDensityAt(+txS, +tyS, dustCloud) <= DUST_THRESHOLD) continue;
      const char = lcfg.glyphs[Math.floor(Math.random() * lcfg.glyphs.length)];
      tiles.set(key, {
        tx: +txS, ty: +tyS,
        phase:      'fadein',
        phaseStart: now - Math.floor(Math.random() * lcfg.fadeInMs),
        phaseDur:   lcfg.fadeInMs,
        char,
        color:      lcfg.colorFade,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Plugin interface
  // -----------------------------------------------------------------------

  return {
    types: ['dust_storm', 'sandstorm'],

    reset() {
      _clouds       = [];
      _tileElev     = null;
      _mapW         = 0;
      _mapH         = 0;
      _terrainScale = 1.0;
    },

    getCandidates(context) {
      if (_clouds.length >= _maxClouds) return [];
      const { climate, dayPhase, planet } = context;
      if (!['arid', 'scorched'].includes(planet.terrain)) return [];

      const effWind = climate.dominantWindSpeed * _localWindStrength(dayPhase);

      let minRain = 1, maxTemp = 0, hotDryCount = 0, drySum = 0;
      for (const z of climate.zones) {
        if (z.rainChance < minRain) minRain = z.rainChance;
        if (z.tempK > maxTemp) maxTemp = z.tempK;
        if (z.rainChance < MOISTURE_SUPPRESS && z.tempK > 285) hotDryCount++;
        drySum += Math.max(0, MOISTURE_SUPPRESS - z.rainChance) / MOISTURE_SUPPRESS;
      }

      if (minRain >= MOISTURE_SUPPRESS || maxTemp < 265) return [];

      const inAfternoon = dayPhase > 0.10 && dayPhase < 0.40;
      const aftMult     = inAfternoon ? 1.8 : 0.5;
      const dryAvg      = drySum / climate.zones.length;

      const candidates = [];
      if (effWind > DUST_WIND_MIN) {
        candidates.push({ type: 'dust_storm', weight: dryAvg * effWind * aftMult });
      }
      if (planet.terrain === 'arid' && effWind > SAND_WIND_MIN && hotDryCount > 0) {
        const hotDryFrac = hotDryCount / climate.zones.length;
        candidates.push({ type: 'sandstorm', weight: hotDryFrac * effWind * aftMult * 1.3 });
      }
      return candidates;
    },

    onSpawn(type, context) {
      const map     = Datastore.get('planetMap');
      _clouds       = [];
      _mapW         = map.w;
      _mapH         = map.h;
      _tileElev     = _buildTileElev(map);
      _maxClouds    = WeatherSystem.maxInstances(context.climate.dominantWindSpeed > 0.9 ? 2 : 1, map, context.planet);
      _terrainScale = context.planet.terrain === 'arid' ? 1.6 : 1.0;

      const effWind    = context.climate.dominantWindSpeed * _localWindStrength(context.dayPhase);
      const { tx, ty } = _pickSpawnTile(context.climate, effWind);
      _clouds.push(_makeCloud(type, tx, ty, _terrainScale));

      return { type, turnsLeft: _clouds[0].totalTurns, intensity: 0, dustCloud: {}, movePenalty: 0 };
    },

    onTick(event, context) {
      const { climate, dayPhase } = context;

      if (_clouds.length < _maxClouds && Math.random() < NEW_CLOUD_CHANCE) {
        const effWind    = climate.dominantWindSpeed * _localWindStrength(dayPhase);
        const { tx, ty } = _pickSpawnTile(climate, effWind);
        _clouds.push(_makeCloud(event.type, tx, ty, _terrainScale));
      }

      for (let i = _clouds.length - 1; i >= 0; i--) {
        const maxD = _updateCloud(_clouds[i], climate, dayPhase);
        if (_clouds[i].phase === 'dissipating' && maxD < 0.01) {
          _clouds.splice(i, 1);
        }
      }

      if (_clouds.length === 0) return null;

      const dustCloud   = _buildDustCloud();
      const intensity   = _getPlayerDensity(context.playerPos);
      const turnsLeft   = Math.max(..._clouds.map(c => c.turnsLeft));
      const cfg         = CLOUD_CFG[event.type];
      const movePenalty = intensity > DUST_THRESHOLD
        ? cfg.maxMovePenalty * ((intensity - DUST_THRESHOLD) / (1 - DUST_THRESHOLD))
        : 0;

      return { turnsLeft: Math.max(1, turnsLeft), intensity, dustCloud, movePenalty };
    },

    getSpatialIntensity(event, map) {
      const dustCloud = event.dustCloud ?? {};
      const mw = map.w, mh = map.h;
      return function(tx, ty) {
        const wx = ((tx % mw) + mw) % mw;
        const wy = ((ty % mh) + mh) % mh;
        return dustCloud[`${wx},${wy}`] ?? 0;
      };
    },

    getLayer(event) {
      const lcfg  = WeatherLayer.WEATHER_ANIM[event.type];
      const label = event.type === 'sandstorm' ? 'Sandstorm' : 'Dust Storm';
      const tiles = new Map();

      return {
        id:         event.type,
        zIndex:     10,
        ignoreTint: false,
        get label() { return tiles.size > 0 ? label : null; },

        visualTick(viewport) {
          const ev        = WeatherSystem.getEvent(event.type) ?? Datastore.get('weatherEvent');
          const dustCloud = (ev && ev.dustCloud) ? ev.dustCloud : {};
          _advanceDustTiles(tiles, lcfg, dustCloud, viewport);
        },

        getScreenCells({ cameraX, cameraY, charW, charH }) {
          const cells = Array.from({ length: charH }, () => new Array(charW).fill(null));
          for (const tile of tiles.values()) {
            const c0 = (tile.tx - cameraX) * 2;
            const r0 = (tile.ty - cameraY) * 2;
            if (c0 < 0 || c0 >= charW || r0 < 0 || r0 >= charH) continue;
            const cell = { char: tile.char, color: tile.color };
            cells[r0][c0] = cell;
            if (c0 + 1 < charW)                    cells[r0][c0 + 1]         = cell;
            if (r0 + 1 < charH)                    cells[r0 + 1][c0]         = cell;
            if (c0 + 1 < charW && r0 + 1 < charH) cells[r0 + 1][c0 + 1]     = cell;
          }
          return cells;
        },

        destroy() { tiles.clear(); },
      };
    },
  };
})();
