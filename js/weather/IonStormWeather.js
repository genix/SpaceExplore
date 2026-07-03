// Ion storm plugin for WeatherSystem. Handles the 'electrical' type (displayed as "Ion Storm").
// Ion storms are a rare planet-wide electromagnetic event. There is no cloud entity:
// when one is active, the whole planet is inside it. Spawn weight derives from a
// deterministic per-planet electromagnetic intensity (planet.id hash), with a night bonus.
// Visuals: rapid flickering purple arcs (^, ~, |) with a surge brightening on ~25% of cells.
const IonStormWeather = (() => {
  const TYPE = 'electrical';

  const TOTAL_TURNS_MIN  = 5;
  const TOTAL_TURNS_MAX  = 15;
  const BASE_INTENSITY   = 0.80;
  const WEIGHT_THRESHOLD = 0.005;
  const RAMP_OUT_FRAC    = 0.10;
  const RARITY_GATE      = 8;        // Gate scales baseWeight up to a per-turn probability.
  const SURGE_COLOR      = '#ffeeff';
  const SURGE_MIX        = 0.55;     // Strength of surge brightening.

  // Per-planet electromagnetic activity in [0,1], skewed toward quiet worlds.
  function _planetElectricIntensity(planetId) {
    const h = NoiseGen.mulberry32(NoiseGen.seedFrom(String(planetId) + '_electric'))();
    return Math.pow(h, 1.5);
  }

  function _isSurge(tx, ty, age) {
    const seed = tx * 7 + ty * 13 + age * 31;
    return (((seed % 100) + 100) % 100) > 75;
  }

  function _advanceTile(tile, cfg, now) {
    const elapsed = now - tile.phaseStart;
    if (elapsed < tile.phaseDur) {
      if (tile.phase === 'fadein') {
        tile.color = WeatherLayer.lerpColor(cfg.colorFade, cfg.colorPeak, elapsed / tile.phaseDur);
      } else if (tile.phase === 'fadeout') {
        tile.color = WeatherLayer.lerpColor(cfg.colorPeak, cfg.colorFade, elapsed / tile.phaseDur);
      }
      return;
    }
    switch (tile.phase) {
      case 'hidden':
        tile.phase      = 'fadein';
        tile.char       = cfg.glyphs[Math.floor(Math.random() * cfg.glyphs.length)];
        tile.color      = cfg.colorFade;
        tile.phaseDur   = cfg.fadeInMs;
        tile.phaseStart = now;
        break;
      case 'fadein':
        tile.phase      = 'visible';
        tile.color      = cfg.colorPeak;
        tile.phaseDur   = cfg.visibleMinMs + Math.random() * (cfg.visibleMaxMs - cfg.visibleMinMs);
        tile.phaseStart = now;
        break;
      case 'visible':
        tile.phase      = 'fadeout';
        tile.color      = cfg.colorPeak;
        tile.phaseDur   = cfg.fadeOutMs;
        tile.phaseStart = now;
        break;
      case 'fadeout':
        tile.phase      = 'hidden';
        tile.color      = cfg.colorFade;
        tile.phaseDur   = cfg.hiddenMinMs + Math.random() * (cfg.hiddenMaxMs - cfg.hiddenMinMs);
        tile.phaseStart = now;
        break;
    }
  }

  function _advanceTiles(tiles, cfg, intensity, viewport) {
    const now = Date.now();
    const inView = new Set();
    for (let dy = 0; dy < viewport.viewportH; dy++) {
      for (let dx = 0; dx < viewport.viewportW; dx++) {
        inView.add(`${viewport.camX + dx},${viewport.camY + dy}`);
      }
    }

    for (const key of tiles.keys()) {
      if (!inView.has(key)) tiles.delete(key);
    }

    for (const tile of tiles.values()) {
      _advanceTile(tile, cfg, now);
    }

    const target = Math.floor(viewport.viewportW * viewport.viewportH * cfg.cellFraction * intensity);
    if (tiles.size >= target) return;

    const available = [];
    for (const key of inView) {
      if (!tiles.has(key)) available.push(key);
    }
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }
    const needed = Math.min(target - tiles.size, available.length);
    for (let i = 0; i < needed; i++) {
      const [tx, ty] = available[i].split(',').map(Number);
      tiles.set(available[i], {
        tx, ty,
        phase:      'hidden',
        phaseStart: now,
        phaseDur:   Math.random() * cfg.hiddenMaxMs,
        char:       cfg.glyphs[0],
        color:      cfg.colorFade,
      });
    }
  }

  return {
    types: [TYPE],

    reset() {},

    getCandidates(context) {
      if (WeatherSystem.getEvents().length > 0) return [];

      const electricIntensity = _planetElectricIntensity(context.planet.id);
      const nightBonus = (context.dayPhase > 0.45 && context.dayPhase < 0.80) ? 1.6 : 1.0;
      const baseWeight = 0.04 * electricIntensity * nightBonus;
      if (baseWeight <= WEIGHT_THRESHOLD) return [];

      if (Math.random() > baseWeight * RARITY_GATE) return [];
      return [{ type: TYPE, weight: baseWeight }];
    },

    onSpawn(type) {
      const totalDuration = TOTAL_TURNS_MIN + Math.floor(Math.random() * (TOTAL_TURNS_MAX - TOTAL_TURNS_MIN + 1));
      return {
        type,
        turnsLeft:     totalDuration,
        totalDuration,
        age:           0,
        intensity:     BASE_INTENSITY,
        baseIntensity: BASE_INTENSITY,
        movePenalty:   0,
      };
    },

    onTick(event) {
      const turnsLeft = event.turnsLeft - 1;
      if (turnsLeft <= 0) return null;

      const age = event.age + 1;
      const rampOutTurns = event.totalDuration * RAMP_OUT_FRAC;
      const ramp = turnsLeft < rampOutTurns ? turnsLeft / rampOutTurns : 1.0;
      const intensity = MathUtils.clamp(event.baseIntensity * ramp, 0, 1);
      return { age, turnsLeft, intensity, movePenalty: 0 };
    },

    getSpatialIntensity(event) {
      const intensity = event.intensity ?? 0;
      return () => intensity;
    },

    getLayer(event) {
      const cfg = WeatherLayer.WEATHER_ANIM[event.type];
      const tiles = new Map();

      return {
        id:         event.type,
        zIndex:     10,
        ignoreTint: false,
        label:      'Ion Storm',

        visualTick(viewport) {
          const ev = WeatherSystem.getEvent(event.type) ?? Datastore.get('weatherEvent');
          if (!ev) return;
          _advanceTiles(tiles, cfg, ev.intensity ?? 0, viewport);
        },

        getScreenCells({ cameraX, cameraY, charW, charH }) {
          const cells = Array.from({ length: charH }, () => new Array(charW).fill(null));
          const ev = WeatherSystem.getEvent(event.type) ?? Datastore.get('weatherEvent');
          const age = ev?.age ?? 0;
          for (const tile of tiles.values()) {
            if (tile.phase === 'hidden') continue;
            const charCol = (tile.tx - cameraX) * 2;
            const charRow = (tile.ty - cameraY) * 2;
            if (charCol < 0 || charCol >= charW || charRow < 0 || charRow >= charH) continue;
            let color = tile.color;
            if (tile.phase === 'visible' && _isSurge(tile.tx, tile.ty, age)) {
              color = WeatherLayer.lerpColor(color, SURGE_COLOR, SURGE_MIX);
            }
            cells[charRow][charCol] = { char: tile.char, color };
          }
          return cells;
        },

        destroy() { tiles.clear(); },
      };
    },
  };
})();
