// Meteorite impact craters. modifyElevation() stamps a raised rim around a flat,
// low floor into the raw heightmap before the rest of the pipeline runs, so biome,
// hydrology, temperature, and vegetation all respond to the shape naturally.
// buildObjects() materialises the rim boulder ring and the pre-revealed centre
// metal deposit from that metadata at first visit.
//
// A second variety — broken craters — is stamped after the fresh ones on rocky
// worlds: shallower, floor left uneven (not levelled flat), rim eroded into arcs,
// no centre deposit, in larger numbers, with a sparse rubble-boulder scatter. They
// exist purely to make rocky terrain more interesting. See design/MeteoriteCraters.md
const CraterGen = (() => {
  const TERRAIN = {
    scorched:  { count: [2, 4], radius: [5, 12], boulders: true  },
    arid:      { count: [1, 3], radius: [4, 10], boulders: true  },
    temperate: { count: [0, 2], radius: [3, 7],  boulders: false },
    tundra:    { count: [1, 2], radius: [4, 8],  boulders: true  },
    frozen:    { count: [1, 2], radius: [4, 8],  boulders: true  },
  };

  // Broken craters are rocky-world-only and far more numerous than fresh ones.
  const BROKEN = {
    scorched:  { count: [3, 7], radius: [3, 9] },
    arid:      { count: [2, 5], radius: [3, 8] },
    tundra:    { count: [1, 3], radius: [3, 7] },
  };

  // rimPeak / floorDrop shape the elevation profile; richness scales the deposit.
  const SIZE = {
    small:  { rimPeak: 0.06, floorDrop: 0.05, richness: 2.0 },
    medium: { rimPeak: 0.08, floorDrop: 0.07, richness: 2.5 },
    large:  { rimPeak: 0.10, floorDrop: 0.09, richness: 3.0 },
  };

  const FLOOR_FLAT    = 0.55; // inner fraction held flat as the crater floor
  const FLOOR_T       = 0.70; // floor extent, used when relocating a flooded deposit
  const OUTER_T       = 1.40; // t where the exterior falloff blends back to base terrain
  const FLOOR_TEXTURE = 0.15; // share of the original micro-relief kept on the floor
  const BAND_LO   = 0.85;  // rim boulder band (fraction of radius)
  const BAND_HI   = 1.05;
  const GAP_R     = 1.5;   // boulder-free radius around each rim gap point
  const SEPARATION = 3;    // extra tiles required between two crater rims

  const DEPOSIT_RESOURCE = 'common-metals';
  const NORMAL_AMOUNT    = [20, 60]; // a normal DepositGen deposit; richness multiplies it
  const TEMPERATE_ZERO_CHANCE = 0.40;

  const BROKEN_SCALE   = 0.7;   // broken craters are shallower than a fresh strike
  const BROKEN_TEXTURE = 0.65;  // floor keeps most of its original relief — never flat
  const BROKEN_FLOOR   = 0.35;  // inner fraction before the (broken) rim starts to rise
  const BROKEN_SEP     = 0;     // broken rims may touch each other, unlike fresh craters
  const RUBBLE_T       = 1.10;  // rubble scatters across the floor and inner rim
  const RUBBLE_DENSITY = 0.05;  // per-interior-tile chance of a rubble boulder
  const TAU            = Math.PI * 2;

  // Modifies the elevation array in-place and returns an array of crater
  // descriptors. Fresh craters carry { boulders, boulderTiles, gaps, deposit };
  // broken craters carry { broken: true, rubbleTiles }. Broken craters are placed
  // after the fresh ones so their rolls never perturb existing fresh-crater output.
  function modifyElevation(elevation, w, h, planet, rng) {
    const cfg    = TERRAIN[planet.terrain];
    const broken = BROKEN[planet.terrain];
    if (!cfg && !broken) return [];
    rng = rng || NoiseGen.mulberry32((NoiseGen.seedFrom(planet.id) ^ 0xC7A7E7) >>> 0);

    const craters = [];
    if (cfg)    _placeCraters(craters, elevation, w, h, planet, cfg, rng);
    if (broken) _placeBroken(craters, elevation, w, h, broken, rng);
    return craters;
  }

  function _placeCraters(craters, elevation, w, h, planet, cfg, rng) {
    const count = _rollCount(cfg, planet.terrain, rng);
    let attempts = 0;

    while (craters.length < count && attempts++ < count * 12 + 8) {
      const radius = cfg.radius[0] + rng() * (cfg.radius[1] - cfg.radius[0]);
      const inset  = Math.ceil(radius * 1.5 + 3);
      if (w <= inset * 2 || h <= inset * 2) break;

      const cx = inset + Math.floor(rng() * (w - inset * 2));
      const cy = inset + Math.floor(rng() * (h - inset * 2));
      if (!_separated(craters, cx, cy, radius, false)) continue;

      craters.push(_stamp(elevation, w, h, cx, cy, radius, cfg, rng));
    }
  }

  function _placeBroken(craters, elevation, w, h, cfg, rng) {
    const count  = _randInt(rng, cfg.count[0], cfg.count[1]);
    const target = craters.length + count;
    let attempts = 0;

    while (craters.length < target && attempts++ < count * 12 + 8) {
      const radius = cfg.radius[0] + rng() * (cfg.radius[1] - cfg.radius[0]);
      const inset  = Math.ceil(radius * 1.5 + 3);
      if (w <= inset * 2 || h <= inset * 2) break;

      const cx = inset + Math.floor(rng() * (w - inset * 2));
      const cy = inset + Math.floor(rng() * (h - inset * 2));
      if (!_separated(craters, cx, cy, radius, true)) continue;

      craters.push(_stampBroken(elevation, w, h, cx, cy, radius, rng));
    }
  }

  function _rollCount(cfg, terrain, rng) {
    if (terrain === 'temperate') {
      if (rng() < TEMPERATE_ZERO_CHANCE) return 0;
      return rng() < 0.7 ? 1 : 2;
    }
    return cfg.count[0] + Math.floor(rng() * (cfg.count[1] - cfg.count[0] + 1));
  }

  function _sizeClass(radius) {
    return radius < 5 ? 'small' : radius < 8 ? 'medium' : 'large';
  }

  // Two broken rims may touch (BROKEN_SEP); every other pairing keeps the full gap
  // so a broken crater never swallows a fresh crater's floor or deposit.
  function _separated(craters, cx, cy, radius, broken) {
    for (const c of craters) {
      const sep = (broken && c.broken) ? BROKEN_SEP : SEPARATION;
      if (Math.hypot(cx - c.cx, cy - c.cy) < c.radius + radius + sep) return false;
    }
    return true;
  }

  // Ambient level the impact sits in: the average original elevation over the
  // crater footprint. Levelling the floor and rim against this (instead of just
  // nudging each tile) keeps the floor clearly low even where the underlying
  // terrain noise bumps upward.
  function _ambientBase(elevation, w, h, cx, cy, radius, reach) {
    let sum = 0, n = 0;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.hypot(dx, dy) / radius > 1.0) continue;
        sum += elevation[_wrap(cy + dy, h) * w + _wrap(cx + dx, w)];
        n++;
      }
    }
    return n ? sum / n : 0.5;
  }

  function _stamp(elevation, w, h, cx, cy, radius, cfg, rng) {
    const sizeClass = _sizeClass(radius);
    const size      = SIZE[sizeClass];
    const reach     = Math.ceil(radius * OUTER_T);

    const base       = _ambientBase(elevation, w, h, cx, cy, radius, reach);
    const floorLevel = base - size.floorDrop;
    const rimLevel   = base + size.rimPeak;

    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const t = Math.hypot(dx, dy) / radius;
        if (t > OUTER_T) continue;
        const i = _wrap(cy + dy, h) * w + _wrap(cx + dx, w);
        elevation[i] = MathUtils.clamp(_shape(t, elevation[i], base, floorLevel, rimLevel), 0, 1);
      }
    }

    const rr   = Math.round(radius);
    const gaps = [
      { x: _wrap(cx, w),      y: _wrap(cy - rr, h) },
      { x: _wrap(cx, w),      y: _wrap(cy + rr, h) },
    ];
    const boulderTiles = cfg.boulders ? _ringTiles(w, h, cx, cy, radius, rr) : [];

    return {
      cx, cy, radius, sizeClass,
      boulders: cfg.boulders,
      boulderTiles,
      gaps,
      deposit: {
        resource: DEPOSIT_RESOURCE,
        amount:   Math.round(_randInt(rng, NORMAL_AMOUNT[0], NORMAL_AMOUNT[1]) * size.richness),
      },
    };
  }

  // Absolute target elevation for a tile at t = distance / radius: a flat low
  // floor (t ≤ FLOOR_FLAT), a rim rising to its crest at t = 1.0, then an exterior
  // falloff blending back into the surrounding terrain by t = OUTER_T. The floor
  // keeps a sliver of the original micro-relief so it doesn't look poured. The
  // three junctions each evaluate to the same value from both sides.
  function _shape(t, orig, base, floorLevel, rimLevel) {
    const floor = floorLevel + (orig - base) * FLOOR_TEXTURE;
    if (t <= FLOOR_FLAT) return floor;
    if (t <= 1.0) {
      const k = _smooth((t - FLOOR_FLAT) / (1.0 - FLOOR_FLAT));
      return floor + (rimLevel - floor) * k;
    }
    const k = _smooth((t - 1.0) / (OUTER_T - 1.0));
    return rimLevel + (orig - rimLevel) * k;
  }

  function _smooth(k) {
    return k * k * (3 - 2 * k);
  }

  // A broken crater: an old impact that later tectonics have degraded. The floor is
  // left uneven (most of its original relief survives) rather than levelled flat, the
  // rim rise is shallower, and the rim height is modulated by angle so whole arcs are
  // eroded away — a partial ring instead of a clean one. No centre deposit.
  function _stampBroken(elevation, w, h, cx, cy, radius, rng) {
    const sizeClass  = _sizeClass(radius);
    const size       = SIZE[sizeClass];
    const reach      = Math.ceil(radius * OUTER_T);

    const base       = _ambientBase(elevation, w, h, cx, cy, radius, reach);
    const floorLevel = base - size.floorDrop * BROKEN_SCALE;
    const rimLevel   = base + size.rimPeak * BROKEN_SCALE;
    const phases     = [rng() * TAU, rng() * TAU, rng() * TAU];

    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const t = Math.hypot(dx, dy) / radius;
        if (t > OUTER_T) continue;
        const i = _wrap(cy + dy, h) * w + _wrap(cx + dx, w);
        const a = Math.atan2(dy, dx);
        elevation[i] = MathUtils.clamp(
          _shapeBroken(t, a, elevation[i], base, floorLevel, rimLevel, phases), 0, 1);
      }
    }

    return {
      cx, cy, radius, sizeClass, broken: true,
      rubbleTiles: _rubbleTiles(w, h, cx, cy, radius, rng),
    };
  }

  // Broken-crater target elevation. The floor keeps BROKEN_TEXTURE of the original
  // relief so it stays lumpy; the rim rises only to rimA — the crest scaled by an
  // angular mask that dips to zero on eroded arcs. Continuous at each fixed angle.
  function _shapeBroken(t, a, orig, base, floorLevel, rimLevel, phases) {
    const floor = floorLevel + (orig - base) * BROKEN_TEXTURE;
    if (t <= BROKEN_FLOOR) return floor;
    const rimA = floorLevel + (rimLevel - floorLevel) * _rimMod(a, phases);
    if (t <= 1.0) {
      const k = _smooth((t - BROKEN_FLOOR) / (1.0 - BROKEN_FLOOR));
      return floor + (rimA - floor) * k;
    }
    const k = _smooth((t - 1.0) / (OUTER_T - 1.0));
    return rimA + (orig - rimA) * k;
  }

  // Rim strength in [0, 1] as a function of angle: a few harmonics with rolled
  // phases, biased low so arcs frequently drop to zero (missing rim segments).
  function _rimMod(a, p) {
    const n = 0.55 + 0.35 * Math.sin(2 * a + p[0])
                   + 0.25 * Math.sin(3 * a + p[1])
                   + 0.18 * Math.sin(5 * a + p[2]);
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // Sparse scatter of rubble-boulder positions across the floor and inner rim.
  function _rubbleTiles(w, h, cx, cy, radius, rng) {
    const tiles = [];
    const reach = Math.ceil(radius * RUBBLE_T);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.hypot(dx, dy) / radius > RUBBLE_T) continue;
        if (rng() < RUBBLE_DENSITY) tiles.push({ x: _wrap(cx + dx, w), y: _wrap(cy + dy, h) });
      }
    }
    return tiles;
  }

  // Rim boulder positions: the annulus t in [0.85, 1.05], minus the two gaps.
  function _ringTiles(w, h, cx, cy, radius, rr) {
    const tiles = [];
    const reach = Math.ceil(radius * BAND_HI);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const t = Math.hypot(dx, dy) / radius;
        if (t < BAND_LO || t > BAND_HI) continue;
        if (Math.hypot(dx, dy + rr) <= GAP_R || Math.hypot(dx, dy - rr) <= GAP_R) continue;
        tiles.push({ x: _wrap(cx + dx, w), y: _wrap(cy + dy, h) });
      }
    }
    return tiles;
  }

  // Materialises objects for the deposit and (non-temperate) rim ring from the
  // planet's crater metadata. Returns { objects, deposits } for the caller to
  // merge into objects:<planetId> and planet.deposits at first visit.
  function buildObjects(map, planet) {
    const craters = planet.craterMeta || [];
    const objects = [];
    const deposits = [];
    const metalRng = NoiseGen.mulberry32((NoiseGen.seedFrom(planet.id) ^ 0x0C7A7E) >>> 0);
    const occupied = new Set();
    let di = 0, bi = 0;

    // Fresh craters first so their metalRng draws keep the exact old sequence.
    for (const c of craters) {
      if (c.broken) continue;
      const pos = _depositPos(map, c);
      const id  = `dep-crater-${planet.id}-${di++}`;
      deposits.push({ id, x: pos.x, y: pos.y, resource: c.deposit.resource, amount: c.deposit.amount, revealed: true });
      objects.push(DepositObject.create(id, pos.x, pos.y, c.deposit.resource));
      occupied.add(`${pos.x},${pos.y}`);

      if (!c.boulders || c.boulderTiles.length === 0 || !_gapPassable(map, c)) continue;
      for (const t of c.boulderTiles) {
        const key = `${t.x},${t.y}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        objects.push(BoulderObject.createSmall(
          `bc-${planet.id}-${bi++}`, t.x, t.y,
          ResourceMaterials.rollDeposit(planet, metalRng, 1.5)
        ));
      }
    }

    for (const c of craters) {
      if (!c.broken) continue;
      for (const t of c.rubbleTiles) {
        const key = `${t.x},${t.y}`;
        if (occupied.has(key) || !_passable(map, t.x, t.y)) continue;
        occupied.add(key);
        objects.push(BoulderObject.createSmall(
          `rc-${planet.id}-${bi++}`, t.x, t.y,
          ResourceMaterials.rollDeposit(planet, metalRng, 1.0)
        ));
      }
    }
    return { objects, deposits };
  }

  // Centre tile, or the nearest passable floor tile if the centre flooded into a
  // lake — keeps the reward reachable on foot without moving it out of the crater.
  function _depositPos(map, c) {
    if (_passable(map, c.cx, c.cy)) return { x: _wrap(c.cx, map.w), y: _wrap(c.cy, map.h) };
    const maxR = Math.ceil(c.radius * FLOOR_T);
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (_passable(map, c.cx + dx, c.cy + dy)) {
            return { x: _wrap(c.cx + dx, map.w), y: _wrap(c.cy + dy, map.h) };
          }
        }
      }
    }
    return { x: _wrap(c.cx, map.w), y: _wrap(c.cy, map.h) };
  }

  function _gapPassable(map, c) {
    return c.gaps.some(g => _passable(map, g.x, g.y));
  }

  function _passable(map, x, y) {
    return MapGen.isPassable(map.grid[_wrap(y, map.h)][_wrap(x, map.w)]);
  }

  function _wrap(v, max) {
    return ((v % max) + max) % max;
  }

  function _randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  return { modifyElevation, buildObjects };
})();
