// Depression fill, river tracing, and lake formation on top of a heightmap.
// Returns waterType Uint8Array (NONE/RIVER/LAKE/OCEAN) and depression-filled elevation copy.
const Hydrology = (() => {
  const WATER_NONE  = 0;
  const WATER_RIVER = 1;
  const WATER_LAKE  = 2;
  const WATER_OCEAN = 3;

  const EPSILON             = 1e-5;
  const ELEVATION_RAISE_CAP = 0.10;
  const MAX_RIVERS = { scorched: 0, arid: 1, temperate: 5, tundra: 4, frozen: 3 };
  // Per-terrain ocean threshold (fraction of normalised elevation).
  // Scorched/arid are too hot for liquid water; others get smaller seas than the default SEA_LEVEL.
  const OCEAN_LEVEL = { scorched: -1, arid: -1, temperate: 0.22, tundra: 0.25, frozen: 0.28 };

  const DIRS4 = [[-1,0],[1,0],[0,-1],[0,1]];
  const DIRS8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  function _makeHeap() {
    const d = [];
    function _swap(a, b) {
      const te = d[a*2], ti = d[a*2+1];
      d[a*2] = d[b*2]; d[a*2+1] = d[b*2+1];
      d[b*2] = te;     d[b*2+1] = ti;
    }
    function push(elev, idx) {
      d.push(elev, idx);
      let i = d.length / 2 - 1;
      while (i > 0) {
        const p = Math.floor((i - 1) / 2);
        if (d[p*2] <= d[i*2]) break;
        _swap(p, i); i = p;
      }
    }
    function pop() {
      const elev = d[0], idx = d[1];
      const last = d.length / 2 - 1;
      if (last === 0) { d.length = 0; return { elev, idx }; }
      d[0] = d[last*2]; d[1] = d[last*2+1];
      d.length -= 2;
      let i = 0;
      for (;;) {
        const l = 2*i+1, r = 2*i+2, sz = d.length/2;
        let s = i;
        if (l < sz && d[l*2] < d[s*2]) s = l;
        if (r < sz && d[r*2] < d[s*2]) s = r;
        if (s === i) break;
        _swap(i, s); i = s;
      }
      return { elev, idx };
    }
    function size() { return d.length / 2; }
    return { push, pop, size };
  }

  function _wrap(v, max) {
    return ((v % max) + max) % max;
  }

  function _idx(x, y, w, h) {
    return _wrap(y, h) * w + _wrap(x, w);
  }

  function _dist(x1, y1, x2, y2, w, h) {
    let dx = Math.abs(x1 - x2), dy = Math.abs(y1 - y2);
    dx = Math.min(dx, w - dx);
    dy = Math.min(dy, h - dy);
    return Math.sqrt(dx*dx + dy*dy);
  }

  function _absorbCoastalLakes(w, h, waterType) {
    const queue = [];
    for (let i = 0; i < w * h; i++) {
      if (waterType[i] === WATER_OCEAN) queue.push(i);
    }
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % w, cy = Math.floor(cur / w);
      for (const [dx, dy] of DIRS8) {
        const n = _idx(cx + dx, cy + dy, w, h);
        if (waterType[n] === WATER_LAKE) {
          waterType[n] = WATER_OCEAN;
          queue.push(n);
        }
      }
    }
  }

  function _absorbCoastalRivers(w, h, waterType) {
    const next = new Uint8Array(waterType);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (waterType[idx] !== WATER_RIVER) continue;

        let oceanNeighbors = 0;
        for (const [dx, dy] of DIRS8) {
          if (waterType[_idx(x + dx, y + dy, w, h)] === WATER_OCEAN) oceanNeighbors++;
        }
        if (oceanNeighbors >= 4) next[idx] = WATER_OCEAN;
      }
    }
    waterType.set(next);
  }

  function _syncWrappedEdges(w, h, waterType) {
    for (let y = 0; y < h; y++) {
      const left  = y * w;
      const right = left + w - 1;
      const wt    = Math.max(waterType[left], waterType[right]);
      waterType[left] = wt;
      waterType[right] = wt;
    }
    for (let x = 0; x < w; x++) {
      const top    = x;
      const bottom = (h - 1) * w + x;
      const wt     = Math.max(waterType[top], waterType[bottom]);
      waterType[top] = wt;
      waterType[bottom] = wt;
    }
  }

  function generate(w, h, elevation, planet) {
    const SEA_LEVEL          = Heightmap.SEA_LEVEL;
    const MOUNTAIN_THRESHOLD = Heightmap.MOUNTAIN_THRESHOLD;

    // Atmosphere gates the water cycle. Airless worlds have no flowing rivers;
    // warm airless worlds also lose liquid seas and lakes (water sublimes),
    // while cold airless worlds keep their water frozen as ice.
    const airless        = !Atmosphere.supportsLiquidWater(planet.atmosphere);
    const suppressLiquid = airless && (planet.tempBaseC ?? -50) > 0;
    const oceanThreshold = suppressLiquid ? -1 : (OCEAN_LEVEL[planet.terrain] ?? 0.22);

    const waterType  = new Uint8Array(w * h);
    const filledElev = new Float32Array(elevation);

    for (let i = 0; i < w * h; i++) {
      if (elevation[i] < oceanThreshold) waterType[i] = WATER_OCEAN;
    }

    // Depression fill: priority-queue Planchon-Darboux
    const processed = new Uint8Array(w * h);
    const heap = _makeHeap();
    for (let i = 0; i < w * h; i++) {
      if (waterType[i] === WATER_OCEAN) { processed[i] = 1; heap.push(filledElev[i], i); }
    }
    while (heap.size() > 0) {
      const { elev: curElev, idx: cur } = heap.pop();
      const cx = cur % w, cy = Math.floor(cur / w);
      for (const [dx, dy] of DIRS8) {
        const n = _idx(cx + dx, cy + dy, w, h);
        if (processed[n]) continue;
        processed[n] = 1;
        if (filledElev[n] < curElev + EPSILON) {
          filledElev[n] = Math.max(filledElev[n],
            Math.min(curElev + EPSILON, elevation[n] + ELEVATION_RAISE_CAP));
        }
        heap.push(filledElev[n], n);
      }
    }

    // River sources
    const targetCount = airless ? 0 : (MAX_RIVERS[planet.terrain] ?? 3);
    if (targetCount > 0) {
      const candidates = [];
      for (let i = 0; i < w * h; i++) {
        if (elevation[i] > MOUNTAIN_THRESHOLD && waterType[i] === WATER_NONE)
          candidates.push({ i, elev: elevation[i] });
      }
      candidates.sort((a, b) => b.elev - a.elev);

      const sources = [];
      const minDist = Math.floor(Math.min(w, h) / 4);
      for (const cand of candidates) {
        const cx = cand.i % w, cy = Math.floor(cand.i / w);
        if (sources.every(s => _dist(s.x, s.y, cx, cy, w, h) >= minDist))
          sources.push({ i: cand.i, x: cx, y: cy });
        if (sources.length >= targetCount) break;
      }

      const MAX_LEN           = 2 * Math.max(w, h);
      const MEANDER_TOLERANCE = 0.03;
      const INERTIA           = 0.4;
      const NOISE             = 0.6;

      // Seeded so a planet's rivers regenerate identically from its id.
      const riverRng = NoiseGen.mulberry32((NoiseGen.seedFrom(planet.id) ^ 0x71DE) >>> 0);

      for (const src of sources) {
        const path    = [];
        const visited = new Set();
        let cur = src.i, committed = false;
        let dirX = 0, dirY = 0;

        for (let step = 0; step <= MAX_LEN; step++) {
          if (waterType[cur] === WATER_OCEAN || waterType[cur] === WATER_RIVER) {
            committed = true; break;
          }
          path.push(cur);
          visited.add(cur);
          const cx2 = cur % w, cy2 = Math.floor(cur / w);

          let minElev = Infinity;
          const nbrs = [];
          for (const [dx, dy] of DIRS8) {
            const n = _idx(cx2 + dx, cy2 + dy, w, h);
            if (visited.has(n)) continue;
            const e = filledElev[n];
            if (e < minElev) minElev = e;
            nbrs.push({ n, e, dx, dy });
          }
          if (nbrs.length === 0) break;

          let best = null, bestScore = -Infinity;
          for (const c of nbrs) {
            if (c.e > minElev + MEANDER_TOLERANCE) continue;
            const len = Math.sqrt(c.dx * c.dx + c.dy * c.dy);
            const score = (dirX * c.dx / len + dirY * c.dy / len) * INERTIA
                        + (riverRng() - 0.5) * NOISE;
            if (score > bestScore) { bestScore = score; best = c; }
          }
          if (!best) break;

          const blen = Math.sqrt(best.dx * best.dx + best.dy * best.dy);
          const ndx = best.dx / blen, ndy = best.dy / blen;
          dirX = dirX * 0.6 + ndx * 0.4;
          dirY = dirY * 0.6 + ndy * 0.4;
          const dlen = Math.sqrt(dirX * dirX + dirY * dirY);
          if (dlen > 0) { dirX /= dlen; dirY /= dlen; }

          cur = best.n;
        }

        if (committed) {
          for (const tile of path) {
            if (waterType[tile] === WATER_NONE) waterType[tile] = WATER_RIVER;
          }
        }
      }
    }

    _absorbCoastalRivers(w, h, waterType);

    // Lake formation: fill depression basins above ocean level
    for (let i = 0; !suppressLiquid && i < w * h; i++) {
      if (elevation[i] <= oceanThreshold || waterType[i] !== WATER_NONE) continue;
      if (filledElev[i] <= elevation[i] + EPSILON) continue;

      const saddleElev = filledElev[i];
      const basin = [i];
      const queue = [i];
      const seen  = new Set([i]);

      while (queue.length > 0) {
        const t = queue.shift();
        const tx = t % w, ty = Math.floor(t / w);
        for (const [dx, dy] of DIRS4) {
          const n = _idx(tx + dx, ty + dy, w, h);
          if (seen.has(n) || elevation[n] > saddleElev || elevation[n] <= oceanThreshold) continue;
          if (waterType[n] === WATER_OCEAN || waterType[n] === WATER_RIVER) continue;
          seen.add(n); basin.push(n); queue.push(n);
        }
      }

      for (const tile of basin) {
        if (waterType[tile] === WATER_NONE) waterType[tile] = WATER_LAKE;
      }
    }

    _absorbCoastalLakes(w, h, waterType);
    _syncWrappedEdges(w, h, waterType);

    return { waterType, filledElev };
  }

  return { generate, WATER_NONE, WATER_RIVER, WATER_LAKE, WATER_OCEAN };
})();
