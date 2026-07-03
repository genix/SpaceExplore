// Sidebar target selection and world-state queries.
const InspectorTargeting = (() => {
  function _wrap(v, max) {
    return ((v % max) + max) % max;
  }

  function defaultTile() {
    return Datastore.has('playerPos') ? Datastore.get('playerPos') : null;
  }

  function tileInfo(pos = defaultTile()) {
    if (pos == null) pos = defaultTile();  // explicit null means "no hover" -> player tile
    if (!pos || !Datastore.has('planetMap')) return null;
    const map = MapGen.reattachClimate(Datastore.get('planetMap'));
    const x = _wrap(pos.x, map.w);
    const y = _wrap(pos.y, map.h);
    const tile = map.grid[y][x];
    const zone = map.climate.getClimateZone(x, y);
    const phase = Datastore.has('dayPhase') ? Datastore.get('dayPhase') : 0;
    const planet = Datastore.has('currentPlanet') ? Datastore.get('currentPlanet') : null;
    const heatBonus = ObjectManager.getLavaHeatBonus(x, y);
    const tempK = Temperature.currentTempK(zone.tempK, phase, planet, zone, heatBonus);
    return {
      x, y, map, tile, zone, planet,
      tempC: Math.round(tempK - 273),
      passable: MapGen.isPassable(tile) && ObjectManager.isPassable(x, y),
    };
  }

  function distanceToObject(pos, obj, map) {
    if (!pos || !obj || !map) return Infinity;
    let best = Infinity;
    for (const { dx, dy } of obj.footprint ?? [{ dx: 0, dy: 0 }]) {
      const ox = _wrap(obj.x + dx, map.w);
      const oy = _wrap(obj.y + dy, map.h);
      let ddx = Math.abs(pos.x - ox);
      let ddy = Math.abs(pos.y - oy);
      if (ddx > map.w / 2) ddx = map.w - ddx;
      if (ddy > map.h / 2) ddy = map.h - ddy;
      best = Math.min(best, Math.max(ddx, ddy));
    }
    return best;
  }

  function nearbyObjects(radius = 1) {
    if (!Datastore.has('playerPos') || !Datastore.has('planetMap')) return [];
    const pos = Datastore.get('playerPos');
    const map = Datastore.get('planetMap');
    return ObjectManager.all()
      .map(obj => ({ obj, d: distanceToObject(pos, obj, map) }))
      .filter(e => e.d <= radius)
      .sort((a, b) => a.d - b.d)
      .map(e => e.obj);
  }

  function targetObject(hoverTile = null) {
    if (hoverTile) {
      const obj = ObjectManager.getAt(hoverTile.x, hoverTile.y);
      if (obj) return obj;
    }
    const nearby = nearbyObjects(1);
    return nearby.find(o => o.interactable) || nearby[0] || null;
  }

  function canInteractWith(obj) {
    if (!obj?.interactable) return false;
    const pos = defaultTile();
    if (!pos || !Datastore.has('planetMap')) return false;
    const map = Datastore.get('planetMap');
    const d = distanceToObject(pos, obj, map);
    return obj.passable ? d === 0 : d <= 1;
  }

  function shipObject() {
    return ObjectManager.all().find(o => o.type === 'ship') || null;
  }

  function shipNet(suit = SuitSystem.status(), power = PowerSystem.status()) {
    return power.graphGen + suit.shipSunRate - power.graphUse - suit.shipChargeDraw;
  }

  function weatherReadings(pos = defaultTile()) {
    if (!pos || !Datastore.has('planetMap')) return [];
    const map = Datastore.get('planetMap');
    const events = WeatherSystem.getEvents
      ? WeatherSystem.getEvents()
      : (Datastore.has('weatherEvent') && Datastore.get('weatherEvent') ? [Datastore.get('weatherEvent')] : []);
    return events.map(event => {
      const plugin = WeatherSystem.getPlugin(event.type);
      const intensityAt = plugin?.getSpatialIntensity?.(event, map);
      const intensity = intensityAt ? intensityAt(pos.x, pos.y) : (event.intensity ?? 0);
      return { event, intensity };
    }).sort((a, b) => b.intensity - a.intensity);
  }

  function depositById(id) {
    const p = Datastore.has('currentPlanet') ? Datastore.get('currentPlanet') : null;
    return p?.deposits?.find(d => d.id === id) ?? null;
  }

  function hoverFromViewport(mapContainer, e) {
    if (!Datastore.has('planetMap') || !Datastore.has('playerPos')) return null;
    const pre = mapContainer.querySelector('pre');
    if (!pre) return null;
    const rect = pre.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const { camX, camY, viewportW, viewportH, charW: contentW } = MapView.getViewport();
    const charW = rect.width / (contentW + 2);
    const charH = rect.height / (viewportH * 2 + 2);
    const contentCol = Math.floor((e.clientX - rect.left) / charW) - 1;
    const contentRow = Math.floor((e.clientY - rect.top) / charH) - 1;

    if (contentCol < 0 || contentCol >= contentW ||
        contentRow < 0 || contentRow >= viewportH * 2) return null;

    const map = Datastore.get('planetMap');
    return {
      x: _wrap(camX + Math.floor(contentCol / 2), map.w),
      y: _wrap(camY + Math.floor(contentRow / 2), map.h),
    };
  }

  function hoverFromGlobal(mapContainer, e) {
    if (!Datastore.has('planetMap')) return null;
    const pre = mapContainer.querySelector('pre');
    if (!pre) return null;
    const rect = pre.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const cw = MapView.charW;
    const ch = MapView.charH;
    const cellW = rect.width / (cw + 2);
    const cellH = rect.height / (ch + 2);
    const col = Math.floor((e.clientX - rect.left) / cellW) - 1;
    const row = Math.floor((e.clientY - rect.top) / cellH) - 1;
    if (col < 0 || col >= cw || row < 0 || row >= ch) return null;

    const map = Datastore.get('planetMap');
    return {
      x: Math.min(map.w - 1, Math.floor(col * map.w / cw)),
      y: Math.min(map.h - 1, Math.floor(row * map.h / ch)),
    };
  }

  return {
    defaultTile, tileInfo, distanceToObject, nearbyObjects, targetObject,
    canInteractWith, shipObject, shipNet, weatherReadings, depositById,
    hoverFromViewport, hoverFromGlobal,
  };
})();
