// Planet-scale weather overview renderer.
// Scales the entire map to fit the viewport; each character represents a block
// of tiles whose median weather intensity determines the glyph and color.
// Weather plugins supply intensity via getSpatialIntensity(event, map).
const WeatherOverviewRenderer = (() => {
  const DENSITY_RAMP = ['.', ':', '+', '*', '#', '%'];
  const CELL_BG      = '#000000';
  const EMPTY_COLOR  = '#333333';

  const TYPE_COLORS = {
    rain:        '#88bbdd',
    heavy_rain:  '#5588bb',
    snow:        '#ddeeff',
    blizzard:    '#ffffff',
    fog:         '#99aabb',
    thick_fog:   '#aabbcc',
    dust_storm:  '#cc8833',
    sandstorm:   '#ddaa44',
    ash_fall:    '#998888',
    electrical:  '#cc88ff',
  };

  function _median(arr) {
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
  }

  function _intensityFn(weatherEvent, map) {
    const plugin = WeatherSystem.getPlugin(weatherEvent.type);
    if (plugin && typeof plugin.getSpatialIntensity === 'function') {
      return plugin.getSpatialIntensity(weatherEvent, map);
    }
    return () => weatherEvent.intensity ?? 0;
  }

  function getFullGrid(map, weatherInput, charW, charH) {
    const weatherEvents = Array.isArray(weatherInput) ? weatherInput : (weatherInput ? [weatherInput] : []);
    const intensityFns = weatherEvents.map(event => ({
      event,
      intensityAt: _intensityFn(event, map),
      color: TYPE_COLORS[event.type] ?? EMPTY_COLOR,
    }));
    const scaleX      = map.w / charW;
    const scaleY      = map.h / charH;
    const rows        = [];

    for (let cy = 0; cy < charH; cy++) {
      const row = [];
      const ty0 = Math.floor(cy * scaleY);
      const ty1 = Math.min(map.h - 1, Math.max(ty0, Math.floor((cy + 1) * scaleY) - 1));
      for (let cx = 0; cx < charW; cx++) {
        const tx0      = Math.floor(cx * scaleX);
        const tx1      = Math.min(map.w - 1, Math.max(tx0, Math.floor((cx + 1) * scaleX) - 1));
        let density = 0;
        let typeColor = EMPTY_COLOR;
        for (const source of intensityFns) {
          const densities = [];
          for (let ty = ty0; ty <= ty1; ty++) {
            for (let tx = tx0; tx <= tx1; tx++) {
              densities.push(source.intensityAt(tx, ty));
            }
          }
          const sourceDensity = _median(densities);
          if (sourceDensity > density) {
            density = sourceDensity;
            typeColor = source.color;
          }
        }
        const glyphIdx = Math.min(DENSITY_RAMP.length - 1, Math.floor(density * DENSITY_RAMP.length));
        row.push({
          char:    DENSITY_RAMP[glyphIdx],
          color:   density < 0.05 ? EMPTY_COLOR : typeColor,
          bgColor: CELL_BG,
        });
      }
      rows.push(row);
    }
    return rows;
  }

  return {
    id:                 'weather_overview',
    label:              'Weather',
    ignoreDayCycleTint: true,
    hideLayers:         true,
    isGlobalView:       true,
    blockInput:         true,
    redraw:             { pos: true, weather: true },
    getFullGrid,
  };
})();
