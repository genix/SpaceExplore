// Places final tile ground and vegetation types using per-biome probability tables.
// Returns a 2D grid array of { ground, vegetation } objects.
const Vegetation = (() => {
  const SHALLOW_DEPTH    = 0.10;
  const FREEZE_K         = 273;
  const WATER_PROX_RANGE = 12;

  const VEG_COLD_FLOOR = {
    tree: 260, grass: 245, bush: 248, cactus: 285, scrub: 245, moss: 228, 'rock-plant': 230,
  };

  const VEG_HOT_CEIL = {
    tree: 315, grass: 335, bush: 335, cactus: 390, scrub: 340, moss: 290, 'rock-plant': 310,
  };

  function _buildTables(B) {
    return {
      ground: {
        [B.TROPICAL]:     [{t:'soil',w:60},{t:'grass',w:30},{t:'rock',w:10}],
        [B.SAVANNA]:      [{t:'grass',w:50},{t:'soil',w:30},{t:'dry-rock',w:20}],
        [B.DESERT]:       [{t:'sand',w:70},{t:'dry-rock',w:20},{t:'gravel',w:10}],
        [B.FOREST]:       [{t:'soil',w:60},{t:'grass',w:30},{t:'rock',w:10}],
        [B.GRASSLAND]:    [{t:'grass',w:70},{t:'soil',w:20},{t:'rock',w:10}],
        [B.SHRUBLAND]:    [{t:'dry-rock',w:40},{t:'sand',w:30},{t:'gravel',w:30}],
        [B.TAIGA]:        [{t:'soil',w:50},{t:'rock',w:30},{t:'gravel',w:20}],
        [B.TUNDRA]:       [{t:'frozen-soil',w:50},{t:'rock',w:30},{t:'gravel',w:20}],
        [B.ROCKY_TUNDRA]: [{t:'rock',w:60},{t:'gravel',w:30},{t:'frozen-soil',w:10}],
        [B.ICE_SHEET]:    [{t:'ice',w:80},{t:'snow',w:20}],
        [B.BARREN_ICE]:   [{t:'ice',w:60},{t:'rock',w:40}],
        [B.ALPINE]:       [{t:'rock',w:60},{t:'snow',w:30},{t:'ice',w:10}],
      },
      veg: {
        [B.TROPICAL]:     [{t:'none',w:20},{t:'tree',w:55},{t:'bush',w:25}],
        [B.SAVANNA]:      [{t:'none',w:50},{t:'grass',w:30},{t:'bush',w:20}],
        [B.DESERT]:       [{t:'none',w:80},{t:'cactus',w:15},{t:'scrub',w:5}],
        [B.FOREST]:       [{t:'none',w:25},{t:'tree',w:55},{t:'bush',w:20}],
        [B.GRASSLAND]:    [{t:'none',w:45},{t:'grass',w:45},{t:'bush',w:10}],
        [B.SHRUBLAND]:    [{t:'none',w:55},{t:'scrub',w:35},{t:'bush',w:10}],
        [B.TAIGA]:        [{t:'none',w:35},{t:'tree',w:40},{t:'scrub',w:25}],
        [B.TUNDRA]:       [{t:'none',w:65},{t:'scrub',w:25},{t:'moss',w:10}],
        [B.ROCKY_TUNDRA]: [{t:'none',w:80},{t:'scrub',w:15},{t:'moss',w:5}],
        [B.ICE_SHEET]:    [{t:'none',w:100}],
        [B.BARREN_ICE]:   [{t:'none',w:100}],
        [B.ALPINE]:       [{t:'none',w:85},{t:'rock-plant',w:15}],
      },
    };
  }

  function _zoneTemp(tempZone, x, y, zoneW, zoneH, zoneSize) {
    const zx = Math.min(Math.floor(x / zoneSize), zoneW - 1);
    const zy = Math.min(Math.floor(y / zoneSize), zoneH - 1);
    return tempZone[zy * zoneW + zx];
  }

  function _rollNoise(table, nv) {
    let total = 0;
    for (const e of table) total += e.w;
    let r = nv * total;
    for (const e of table) { r -= e.w; if (r <= 0) return e.t; }
    return table[table.length - 1].t;
  }

  const _BFS_DX = [-1, 1, 0, 0];
  const _BFS_DY = [0, 0, -1, 1];

  function _wrap(v, max) {
    return ((v % max) + max) % max;
  }

  function _buildWaterProxMap(w, h, waterType, WATER_OCEAN, WATER_LAKE, WATER_RIVER) {
    const dist  = new Int16Array(w * h).fill(-1);
    const queue = [];
    for (let i = 0; i < w * h; i++) {
      const wt = waterType[i];
      if (wt === WATER_OCEAN || wt === WATER_LAKE || wt === WATER_RIVER) {
        dist[i] = 0;
        queue.push(i);
      }
    }
    let qi = 0;
    while (qi < queue.length) {
      const ci = queue[qi++];
      const d  = dist[ci];
      if (d >= WATER_PROX_RANGE) continue;
      const cx = ci % w, cy = (ci / w) | 0;
      for (let dir = 0; dir < 4; dir++) {
        const nx = _wrap(cx + _BFS_DX[dir], w);
        const ny = _wrap(cy + _BFS_DY[dir], h);
        const ni = ny * w + nx;
        if (dist[ni] === -1) { dist[ni] = d + 1; queue.push(ni); }
      }
    }
    const prox = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      prox[i] = dist[i] < 0 ? 0 : Math.max(0, 1 - dist[i] / WATER_PROX_RANGE);
    }
    return prox;
  }

  function place(w, h, elevation, waterType, biome, tileTemp, tempZone, zoneW, zoneH, planet) {
    const B           = Biome.BIOME;
    const tables      = _buildTables(B);
    const hasTempData = !!(tempZone && zoneW && zoneH);
    const ZONE_SIZE   = Temperature.ZONE_SIZE;
    const WATER_OCEAN = Hydrology.WATER_OCEAN;
    const WATER_LAKE  = Hydrology.WATER_LAKE;
    const WATER_RIVER = Hydrology.WATER_RIVER;
    const SEA_LEVEL   = Heightmap.SEA_LEVEL;
    const shallowMin  = SEA_LEVEL - SHALLOW_DEPTH;
    const elevRange   = 1.0 - SEA_LEVEL;
    const fallbackG   = tables.ground[B.DESERT];
    const fallbackV   = tables.veg[B.DESERT];

    const seed        = NoiseGen.seedFrom(planet.id);
    const rng         = NoiseGen.mulberry32((seed ^ 0xBEEF) >>> 0);
    const groundNoise = NoiseGen.makeGradientNoise((seed ^ 0xCAFE) >>> 0);
    const vegNoise    = NoiseGen.makeGradientNoise((seed ^ 0xD00D) >>> 0);
    const waterProx   = _buildWaterProxMap(w, h, waterType, WATER_OCEAN, WATER_LAKE, WATER_RIVER);
    const lifeless    = !Atmosphere.supportsLife(planet.atmosphere);

    const grid = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const i  = y * w + x;
        const wt = waterType[i];
        if (wt === WATER_OCEAN) {
          const frozen = tileTemp ? tileTemp[i] < FREEZE_K : hasTempData && _zoneTemp(tempZone, x, y, zoneW, zoneH, ZONE_SIZE) < FREEZE_K;
          const ground = frozen ? 'frozen-ocean' : (elevation[i] >= shallowMin ? 'shallow-ocean' : 'deep-ocean');
          row.push({ ground, vegetation: 'none', elevation: elevation[i] });
        } else if (wt === WATER_LAKE) {
          const frozen = tileTemp ? tileTemp[i] < FREEZE_K : hasTempData && _zoneTemp(tempZone, x, y, zoneW, zoneH, ZONE_SIZE) < FREEZE_K;
          row.push({ ground: frozen ? 'frozen-lake' : 'lake', vegetation: 'none', elevation: elevation[i] });
        } else if (wt === WATER_RIVER) {
          const frozen = tileTemp ? tileTemp[i] < FREEZE_K : hasTempData && _zoneTemp(tempZone, x, y, zoneW, zoneH, ZONE_SIZE) < FREEZE_K;
          row.push({ ground: frozen ? 'frozen-river' : 'river', vegetation: 'none', elevation: elevation[i] });
        } else {
          const b        = biome[i];
          const wp       = waterProx[i];
          const elevNorm = Math.max(0, (elevation[i] - SEA_LEVEL) / elevRange);

          // Ground: coarse patches + fine detail + elevation bias (high = rocky) + proximity pushes organic
          const gn = Math.max(0,
            groundNoise.sample(x / 12, y / 12) * 0.50 +
            groundNoise.sample(x / 3,  y / 3)  * 0.15 +
            elevNorm * 0.20 +
            rng()    * 0.15 -
            wp       * 0.10
          );

          // Vegetation: medium patches + fine detail + proximity boosts density
          const vn = Math.min(1,
            vegNoise.sample(x / 8,   y / 8)   * 0.55 +
            vegNoise.sample(x / 2.5, y / 2.5)  * 0.20 +
            wp    * 0.10 +
            rng() * 0.15
          );

          let   ground = _rollNoise(tables.ground[b] ?? fallbackG, gn);
          let   veg    = lifeless ? 'none' : _rollNoise(tables.veg[b] ?? fallbackV, vn);
          if ((ground === 'snow' || ground === 'ice') && hasTempData) {
            const tempK = tileTemp ? tileTemp[i] : _zoneTemp(tempZone, x, y, zoneW, zoneH, ZONE_SIZE);
            if (tempK >= FREEZE_K) ground = 'rock';
          }
          if (hasTempData && veg !== 'none') {
            const tempK = tileTemp ? tileTemp[i] : _zoneTemp(tempZone, x, y, zoneW, zoneH, ZONE_SIZE);
            const minK  = VEG_COLD_FLOOR[veg];
            const maxK  = VEG_HOT_CEIL[veg];
            if ((minK !== undefined && tempK < minK) ||
                (maxK !== undefined && tempK > maxK)) veg = 'none';
          }
          const tile = { ground, vegetation: veg, elevation: elevation[i] };
          if (ResourceMaterials.isRockGround(ground)) {
            const richness = ground === 'dry-rock' ? 0.75 : 1.0;
            tile.metals = ResourceMaterials.rollDeposit(planet, rng, richness);
          }
          row.push(tile);
        }
      }
      grid.push(row);
    }
    return grid;
  }

  return { place };
})();
