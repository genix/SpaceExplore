// Animated MapView layer factory for weather effects.
// WEATHER_ANIM is the single source of truth for all timing and color values.
// createAnimatedLayer() returns a standard layer descriptor with visualTick() for 5fps animation.
const WeatherLayer = (() => {
  const WEATHER_ANIM = {
    rain:       { glyphs: ["'"],            fadeInMs: 300,  fadeOutMs: 200,  visibleMinMs:  400, visibleMaxMs:  900, hiddenMinMs:  600, hiddenMaxMs: 2000, colorFade: '#334466', colorPeak: '#88bbdd', cellFraction: 0.12 },
    heavy_rain: { glyphs: [';', '|'],       fadeInMs: 200,  fadeOutMs: 150,  visibleMinMs:  300, visibleMaxMs:  600, hiddenMinMs:  200, hiddenMaxMs:  800, colorFade: '#223344', colorPeak: '#5588bb', cellFraction: 0.25 },
    snow:       { glyphs: ['*'],            fadeInMs: 0,    fadeOutMs: 360,  visibleMinMs:  140, visibleMaxMs:  260, hiddenMinMs: 2800, hiddenMaxMs: 6400, colorFade: '#889999', colorPeak: '#ddeeff', cellFraction: 0.36 },
    blizzard:   { glyphs: ['*', '%', '+'],  fadeInMs: 200,  fadeOutMs: 200,  visibleMinMs:  300, visibleMaxMs:  700, hiddenMinMs:  100, hiddenMaxMs:  500, colorFade: '#aabbcc', colorPeak: '#ffffff', cellFraction: 0.78 },
    fog:        { glyphs: ['░'],            fadeInMs: 1200, fadeOutMs: 1000, visibleMinMs: 2000, visibleMaxMs: 4000, hiddenMinMs: 1500, hiddenMaxMs: 4000, colorFade: '#445566', colorPeak: '#99aabb', cellFraction: 0.70 },
    thick_fog:  { glyphs: ['▒', '░'],      fadeInMs: 800,  fadeOutMs: 700,  visibleMinMs: 1500, visibleMaxMs: 3500, hiddenMinMs:  500, hiddenMaxMs: 2000, colorFade: '#556677', colorPeak: '#aabbcc', cellFraction: 0.82 },
    dust_storm: { glyphs: ['░', '#'],       fadeInMs: 400,  fadeOutMs: 300,  visibleMinMs:  500, visibleMaxMs: 1200, hiddenMinMs:  300, hiddenMaxMs: 1000, colorFade: '#664422', colorPeak: '#cc8833', cellFraction: 0.20 },
    sandstorm:  { glyphs: ['░', '▒'],      fadeInMs: 200,  fadeOutMs: 200,  visibleMinMs:  300, visibleMaxMs:  700, hiddenMinMs:  100, hiddenMaxMs:  400, colorFade: '#886633', colorPeak: '#ddaa44', cellFraction: 0.40 },
    ash_fall:   { glyphs: [':', '.'],       fadeInMs: 800,  fadeOutMs: 700,  visibleMinMs: 1200, visibleMaxMs: 3000, hiddenMinMs: 1500, hiddenMaxMs: 4000, colorFade: '#554444', colorPeak: '#998888', cellFraction: 0.10 },
    electrical: { glyphs: ['^', '~', '|'], fadeInMs: 80,   fadeOutMs: 120,  visibleMinMs:  100, visibleMaxMs:  300, hiddenMinMs:  200, hiddenMaxMs: 1500, colorFade: '#663399', colorPeak: '#cc88ff', cellFraction: 0.08 },
  };

  function _advanceTile(tile, cfg, now) {
    const elapsed = now - tile.phaseStart;
    if (elapsed < tile.phaseDur) {
      if (tile.phase === 'fadein') {
        tile.color = ColorUtils.mixHex(cfg.colorFade, cfg.colorPeak, elapsed / tile.phaseDur);
      } else if (tile.phase === 'fadeout') {
        tile.color = ColorUtils.mixHex(cfg.colorPeak, cfg.colorFade, elapsed / tile.phaseDur);
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

  // Prune tiles that left the viewport, advance remaining tiles, refill pool to target size.
  // New tiles start in hidden phase with a random stagger delay so appearances are staggered.
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
    if (tiles.size < target) {
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
  }

  function createAnimatedLayer(weatherEvent) {
    const cfg = WEATHER_ANIM[weatherEvent.type];
    if (!cfg) return null;
    const intensity = weatherEvent.intensity ?? 1;
    const _tiles = new Map();

    return {
      id:         weatherEvent.type,
      zIndex:     10,
      ignoreTint: false,

      visualTick(viewport) {
        _advanceTiles(_tiles, cfg, intensity, viewport);
      },

      getScreenCells({ cameraX, cameraY, charW, charH }) {
        const cells = Array.from({ length: charH }, () => new Array(charW).fill(null));
        for (const tile of _tiles.values()) {
          if (tile.phase === 'hidden') continue;
          const charCol = (tile.tx - cameraX) * 2;
          const charRow = (tile.ty - cameraY) * 2;
          if (charCol < 0 || charCol >= charW || charRow < 0 || charRow >= charH) continue;
          cells[charRow][charCol] = { char: tile.char, color: tile.color };
        }
        return cells;
      },

      destroy() {
        _tiles.clear();
      },
    };
  }

  return { createAnimatedLayer, WEATHER_ANIM, lerpColor: ColorUtils.mixHex };
})();
