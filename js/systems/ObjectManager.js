// Manages map objects for the current planet: CRUD, spatial index, passability query,
// and mount/unmount lifecycle tied to PlanetView show/hide.
const ObjectManager = (() => {
  let _planetId     = null;
  let _spatialIndex = new Map();  // "x,y" -> objectId
  let _teardowns    = [];

  // Cached per-tile light field (darkness factor: 1 = full tint, 0 = fully lit).
  // Rebuilt only when the lit-emitter set changes; see getLightFactor.
  let _lightGrid  = null;   // Float32Array[_lightW * _lightH]
  let _lightW     = 0;
  let _lightH     = 0;
  let _lightSig   = null;   // signature of the emitters that produced _lightGrid
  let _lightStale = true;   // emitter set may have changed since the last build

  function mount(planetId) {
    if (_teardowns.length > 0) {
      console.warn('ObjectManager: mount called without prior unmount — forcing unmount');
      unmount();
    }
    _planetId = planetId;
    _rebuildIndex();
    MapView.addLayer(ObjectLayer);
    _teardowns.push(Datastore.subscribe(`objects:${planetId}`, _rebuildIndex));
  }

  function unmount() {
    _teardowns.forEach(fn => fn());
    _teardowns = [];
    _spatialIndex.clear();
    MapView.removeLayer('objects');
    _planetId = null;
    _lightGrid = null;
    _lightSig  = null;
    _lightStale = true;
  }

  function _rebuildIndex() {
    _lightStale = true;
    _spatialIndex.clear();
    if (!_planetId || !Datastore.has(`objects:${_planetId}`)) return;
    const map = Datastore.get('planetMap');
    for (const obj of Datastore.get(`objects:${_planetId}`)) {
      for (const { dx, dy } of obj.footprint ?? [{ dx: 0, dy: 0 }]) {
        const wx = ((obj.x + dx) % map.w + map.w) % map.w;
        const wy = ((obj.y + dy) % map.h + map.h) % map.h;
        _spatialIndex.set(`${wx},${wy}`, obj.id);
      }
    }
  }

  function all() {
    if (!_planetId || !Datastore.has(`objects:${_planetId}`)) return [];
    return Datastore.get(`objects:${_planetId}`);
  }

  function getAt(x, y) {
    const id = _spatialIndex.get(`${x},${y}`);
    if (!id) return null;
    return all().find(o => o.id === id) ?? null;
  }

  function isPassable(x, y) {
    const id = _spatialIndex.get(`${x},${y}`);
    if (!id) return true;
    const obj = all().find(o => o.id === id);
    return obj ? !!obj.passable : true;
  }

  // Pure passability query that works without mount — reads the planet's object
  // array directly from Datastore. Used by LandingScreen before PlanetView mounts us.
  function isPassableAt(planetId, x, y) {
    const key = `objects:${planetId}`;
    if (!Datastore.has(key) || !Datastore.has('planetMap')) return true;
    const map = Datastore.get('planetMap');
    const wx  = ((x % map.w) + map.w) % map.w;
    const wy  = ((y % map.h) + map.h) % map.h;
    for (const obj of Datastore.get(key)) {
      if (obj.passable) continue;
      for (const { dx, dy } of obj.footprint ?? [{ dx: 0, dy: 0 }]) {
        const ox = ((obj.x + dx) % map.w + map.w) % map.w;
        const oy = ((obj.y + dy) % map.h + map.h) % map.h;
        if (ox === wx && oy === wy) return false;
      }
    }
    return true;
  }

  function add(obj) {
    Datastore.withLock(`objects:${_planetId}`, objs => [...objs, obj]);
  }

  function remove(id) {
    Datastore.withLock(`objects:${_planetId}`, objs => objs.filter(o => o.id !== id));
  }

  // Shallow-merge a partial update into a single object record by id.
  function update(id, partial) {
    Datastore.withLock(`objects:${_planetId}`, objs =>
      objs.map(o => o.id === id ? { ...o, ...partial } : o)
    );
  }

  function findByTypeAt(type, x, y) {
    const objs = all();
    for (const o of objs) {
      if (o.type !== type) continue;
      const fp = o.footprint ?? [{ dx: 0, dy: 0 }];
      for (const { dx, dy } of fp) {
        if (o.x + dx === x && o.y + dy === y) return o;
      }
    }
    return null;
  }

  function findDepositAt(x, y) { return findByTypeAt('deposit',   x, y); }
  function findVentAt(x, y)    { return findByTypeAt('lava-vent', x, y); }

  // Returns a lava vent on any of the 8 tiles surrounding (x, y), or null.
  // Coordinates wrap on the toroidal planet map, matching getLavaHeatBonus.
  function findVentAdjacent(x, y) {
    const map = Datastore.has('planetMap') ? Datastore.get('planetMap') : null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        let nx = x + dx, ny = y + dy;
        if (map) { nx = (nx + map.w) % map.w; ny = (ny + map.h) % map.h; }
        const vent = findVentAt(nx, ny);
        if (vent) return vent;
      }
    }
    return null;
  }

  // Returns 0 (full light, no tint) → 1 (full night tint) for world tile (wx, wy).
  // Each emitter contributes brightness b = max(0, 1 - (d/radius)^3) from its
  // footprint centroid; brightness from multiple emitters stacks multiplicatively
  // as remaining darkness = product of (1 - b_i), so overlapping lights are
  // strictly brighter than either alone.
  //
  // The field only changes when the lit-emitter set (position / power / radius)
  // changes, so it is cached as a per-tile grid (O(1) reads) and rebuilt lazily.
  function getLightFactor(wx, wy) {
    if (_lightStale) _refreshLightGrid();
    if (!_lightGrid) return 1;
    const x = ((wx % _lightW) + _lightW) % _lightW;
    const y = ((wy % _lightH) + _lightH) % _lightH;
    return _lightGrid[y * _lightW + x];
  }

  // Currently-lit emitters with their footprint centroids.
  function _lightEmitters() {
    const out = [];
    for (const obj of all()) {
      if (!obj.lightRadius) continue;
      if (obj.power && !obj.power.powered) continue;
      const fp = obj.footprint ?? [{ dx: 0, dy: 0 }];
      const cx = obj.x + fp.reduce((s, p) => s + p.dx, 0) / fp.length;
      const cy = obj.y + fp.reduce((s, p) => s + p.dy, 0) / fp.length;
      out.push({ id: obj.id, cx, cy, r: obj.lightRadius });
    }
    return out;
  }

  // Rebuild the cached grid, but only when the emitter set actually differs from
  // what produced it. Power resolves every tick (replacing the objects array,
  // which marks us stale), so the signature check skips the rebuild whenever the
  // lit emitters are in fact unchanged.
  function _refreshLightGrid() {
    _lightStale = false;
    if (!Datastore.has('planetMap')) { _lightGrid = null; _lightSig = null; return; }
    const map = Datastore.get('planetMap');
    const emitters = _lightEmitters();
    const sig = `${map.w}x${map.h}|` +
      emitters.map(e => `${e.id}@${e.cx.toFixed(3)},${e.cy.toFixed(3)}:${e.r}`).join(';');
    if (sig === _lightSig && (_lightGrid || !emitters.length)) return;

    _lightSig = sig;
    _lightW = map.w;
    _lightH = map.h;
    if (!emitters.length) { _lightGrid = null; return; }

    const size = map.w * map.h;
    if (!_lightGrid || _lightGrid.length !== size) _lightGrid = new Float32Array(size);
    _lightGrid.fill(1);
    for (const e of emitters) _stampLight(map, e);
  }

  // Multiply each tile within an emitter's radius by its darkness contribution,
  // matching getLightFactor's per-tile math exactly. Distances wrap toroidally;
  // when the disc spans the whole axis we sweep it and use the wrapped distance.
  function _stampLight(map, e) {
    const w = map.w, h = map.h, R = e.r;
    const fullX = (2 * R + 1) >= w;
    const fullY = (2 * R + 1) >= h;
    const yStart = fullY ? 0 : Math.floor(e.cy - R);
    const yEnd   = fullY ? h - 1 : Math.ceil(e.cy + R);
    const xStart = fullX ? 0 : Math.floor(e.cx - R);
    const xEnd   = fullX ? w - 1 : Math.ceil(e.cx + R);
    for (let iy = yStart; iy <= yEnd; iy++) {
      const wy = ((iy % h) + h) % h;
      let dy = fullY ? Math.abs(wy - e.cy) : iy - e.cy;
      if (fullY && dy > h / 2) dy = h - dy;
      const rowBase = wy * w;
      for (let ix = xStart; ix <= xEnd; ix++) {
        const wx = ((ix % w) + w) % w;
        let dx = fullX ? Math.abs(wx - e.cx) : ix - e.cx;
        if (fullX && dx > w / 2) dx = w - dx;
        const d = Math.sqrt(dx * dx + dy * dy);
        const t = d / R;
        if (t >= 1) continue;
        const brightness = 1 - t * t * t;
        _lightGrid[rowBase + wx] *= (1 - brightness);
      }
    }
  }

  // Returns the maximum extra Kelvin contributed by nearby lava vents at world tile (wx, wy).
  // Uses Chebyshev distance so diagonals count equally to cardinals.
  function getLavaHeatBonus(wx, wy) {
    const objects = all();
    if (!objects.length) return 0;
    const map = Datastore.has('planetMap') ? Datastore.get('planetMap') : null;
    if (!map) return 0;
    let bonus = 0;
    for (const obj of objects) {
      if (!obj.heatBonus) continue;
      const ddx  = Math.abs(wx - obj.x);
      const ddy  = Math.abs(wy - obj.y);
      const wdx  = Math.min(ddx, map.w - ddx);
      const wdy  = Math.min(ddy, map.h - ddy);
      const dist = Math.max(wdx, wdy);
      if (dist < obj.heatBonus.length) {
        bonus = Math.max(bonus, obj.heatBonus[dist]);
      }
    }
    return bonus;
  }

  // Route creature turn callbacks through here so unmount() clears them all.
  function registerCreatureTick(id, cb) {
    _teardowns.push(TurnManager.subscribe(cb));
  }

  return { mount, unmount, all, getAt, isPassable, isPassableAt, getLightFactor, getLavaHeatBonus, add, remove, update, findDepositAt, findVentAt, findVentAdjacent, findByTypeAt, registerCreatureTick };
})();
