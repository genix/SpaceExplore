// Places hidden resource deposits on a planet. Deposits stay unrevealed in
// planet.deposits until the Scanner module is used nearby; at that point the
// Scanner adds a DepositObject to the map for each one in range.
const DepositGen = (() => {
  const MIN_COUNT      = 240;
  const MAX_COUNT      = 480;
  const MIN_AMOUNT     = 20;
  const MAX_AMOUNT     = 60;
  const SHIP_BUFFER    = 2;   // tiles around the player's expected landing area
  const PASSABLE_RATIO = 0.5; // minimum share of deposits guaranteed on passable tiles

  // Resource pool per terrain. Drills extract whichever resource the deposit holds.
  const TERRAIN_POOL = {
    scorched:  ['silicon', 'sulfur', 'rare-materials', 'common-metals'],
    arid:      ['iron', 'silica', 'carbon', 'common-metals'],
    temperate: ['carbon', 'organics', 'water', 'iron'],
    tundra:    ['cryolite', 'methane', 'iron'],
    frozen:    ['cryolite', 'rare-gases', 'crystal', 'deuterium'],
  };

  // Each pool resource belongs to a category; the tile a deposit lands on skews
  // selection toward matching categories (vegetation -> organic, rock -> metal, etc).
  const RESOURCE_CATEGORY = {
    organics: 'organic', carbon: 'organic',
    'common-metals': 'metal', 'rare-materials': 'metal', iron: 'metal',
    silicon: 'mineral', silica: 'mineral', sulfur: 'mineral', crystal: 'mineral', cryolite: 'mineral',
    water: 'volatile', methane: 'volatile', 'rare-gases': 'volatile', deuterium: 'volatile',
  };

  const GROUND_BOOST = {
    rock:           { metal: 6, mineral: 3 },
    'dry-rock':     { metal: 6, mineral: 3 },
    gravel:         { metal: 3, mineral: 2 },
    sand:           { mineral: 3 },
    soil:           { organic: 3 },
    grass:          { organic: 3 },
    'frozen-soil':  { volatile: 2, organic: 1 },
    snow:           { volatile: 6 },
    ice:            { volatile: 6 },
    'frozen-ocean': { volatile: 6 },
    'frozen-lake':  { volatile: 6 },
    'frozen-river': { volatile: 6 },
    river:          { volatile: 3 },
  };

  const VEG_BOOST = {
    tree: 8, bush: 8,
    grass: 4, scrub: 4, cactus: 4,
    moss: 3, 'rock-plant': 3,
  };

  function place(map, planet, knownObjects) {
    if (!map || !planet?.landable) return [];

    const seed = (NoiseGen.seedFrom(planet.id) ^ 0xD3F0) >>> 0;
    const rng  = NoiseGen.mulberry32(seed);

    let pool = TERRAIN_POOL[planet.terrain] ?? TERRAIN_POOL.temperate;
    if (!Atmosphere.supportsLife(planet.atmosphere)) pool = pool.filter(r => r !== 'organics');
    const count = _randInt(rng, MIN_COUNT, MAX_COUNT);

    const tiles = _sampleTiles(map, knownObjects, count, rng);

    return tiles.map((t, i) => ({
      id:       `dep-${planet.id}-${i}`,
      x:        t.x,
      y:        t.y,
      resource: _pickResource(rng, pool, map.grid[t.y][t.x]),
      amount:   _randInt(rng, MIN_AMOUNT, MAX_AMOUNT),
      revealed: false,
    }));
  }

  // Sweeps the grid once, reservoir-sampling unblocked tiles into a passable and
  // an impassable pool. Composes the result so at least PASSABLE_RATIO of `count`
  // land on passable tiles, spilling between pools when one runs short.
  function _sampleTiles(map, knownObjects, count, rng) {
    const blocked  = _blockedTileSet(map, knownObjects);
    const passable = _reservoir(count, rng);
    const rest     = _reservoir(count, rng);

    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (blocked.has(`${x},${y}`)) continue;
        (MapGen.isPassable(map.grid[y][x]) ? passable : rest).offer(x, y);
      }
    }

    const passShare = Math.min(Math.ceil(count * PASSABLE_RATIO), passable.items.length);
    const chosen = passable.items.slice(0, passShare);
    for (const t of rest.items)                 { if (chosen.length >= count) break; chosen.push(t); }
    for (const t of passable.items.slice(passShare)) { if (chosen.length >= count) break; chosen.push(t); }
    return chosen;
  }

  // Algorithm R: keeps a uniform random sample of up to `capacity` offered tiles.
  function _reservoir(capacity, rng) {
    const items = [];
    let seen = 0;
    return {
      items,
      offer(x, y) {
        seen++;
        if (items.length < capacity) { items.push({ x, y }); return; }
        const j = Math.floor(rng() * seen);
        if (j < capacity) items[j] = { x, y };
      },
    };
  }

  function _pickResource(rng, pool, tile) {
    const weights = { organic: 1, metal: 1, mineral: 1, volatile: 1 };
    const gb = tile && GROUND_BOOST[tile.ground];
    if (gb) for (const k in gb) weights[k] += gb[k];
    const vb = tile && VEG_BOOST[tile.vegetation];
    if (vb) weights.organic += vb;

    let total = 0;
    for (const r of pool) total += weights[RESOURCE_CATEGORY[r]] ?? 1;
    let roll = rng() * total;
    for (const r of pool) {
      roll -= weights[RESOURCE_CATEGORY[r]] ?? 1;
      if (roll <= 0) return r;
    }
    return pool[pool.length - 1];
  }

  function _blockedTileSet(map, objects) {
    const blocked = new Set();
    for (const o of objects ?? []) {
      const fp = o.footprint ?? [{ dx: 0, dy: 0 }];
      for (const { dx, dy } of fp) {
        for (let by = -SHIP_BUFFER; by <= SHIP_BUFFER; by++) {
          for (let bx = -SHIP_BUFFER; bx <= SHIP_BUFFER; bx++) {
            const wx = ((o.x + dx + bx) % map.w + map.w) % map.w;
            const wy = ((o.y + dy + by) % map.h + map.h) % map.h;
            blocked.add(`${wx},${wy}`);
          }
        }
      }
    }
    return blocked;
  }

  function _randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  return { place };
})();
