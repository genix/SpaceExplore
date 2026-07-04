// Rock formations — spire fields and buttes. Like CraterGen, modifyElevation()
// stamps pure elevation features into the raw heightmap before the rest of the
// pipeline runs, so hydrology, temperature, biome, and vegetation all respond to
// the shape naturally. Any tile pushed above Biome.MOUNTAIN_PEAK (0.85) resolves to
// ALPINE (bare rock), so a raised tile reads as a rock formation with no custom
// rendering and no placed objects.
//
// A spire field scatters its spikes, flattens a small apron around each one (their
// union is an irregular pan rather than one big circle) toward a shared lowered
// basin level, then raises the spikes so the pinnacles stand clear of the flat pan.
// A butte is a single flat-topped 3×3 mesa raised sharply above its surroundings.
// All rolls come from one seeded stream in a fixed order (fields, then buttes) so
// regeneration is byte-identical.
// See design/RockFormations.md
const FormationGen = (() => {
  const TERRAIN = {
    scorched:  { fields: [2, 4], buttes: [0, 2] },
    arid:      { fields: [2, 4], buttes: [1, 2] },
    temperate: { fields: [0, 2], buttes: [0, 1] },
    tundra:    { fields: [1, 3], buttes: [0, 1] },
    frozen:    { fields: [1, 2], buttes: [0, 1] },
  };

  const FIELD_RADIUS = [5, 8];   // tiles
  const SPIRES_PER   = [4, 10];  // spikes per field

  const FIELD_TEXTURE = 0.45; // fraction of original micro-relief kept in the basin
  const SPIRE_APRON_R = 3;    // flattened radius around each spire; their union is the pan
  const OUTER_T       = 1.35; // t where a spire's apron blends back to surrounding terrain
  const LOWER_MIN     = 0.03; // basin drop when ambient is already low
  const LOWER_MAX     = 0.20; // basin drop when ambient is high (scales with ambient)
  const LOWER_REF_LO  = 0.40; // ambient at/below which LOWER_MIN applies
  const LOWER_REF_HI  = 0.85; // ambient at/above which LOWER_MAX applies
  const SPIKE_FLOOR   = 0.88; // minimum spike elevation (≥ MOUNTAIN_PEAK → ALPINE)
  const SPIKE_RISE    = 0.35; // spike height above the local apron floor
  const BLOB_CHANCE   = 0.25; // chance a spire grows to a 2–3 tile blob
  const SEPARATION    = 3;

  const BUTTE_FLOOR = 0.90; // flat-top elevation floor (ALPINE)
  const BUTTE_RISE  = 0.30; // top height above ambient
  const BUTTE_SIZE  = 3;    // 3×3

  // Modifies the elevation array in-place and returns an array of formation
  // descriptors ({ kind, cx, cy, radius }). All spire fields are rolled first, then
  // all buttes, from one stream — a fixed order guarantees byte-identical regen.
  function modifyElevation(elevation, w, h, planet, rng) {
    const cfg = TERRAIN[planet.terrain];
    if (!cfg) return [];
    rng = rng || NoiseGen.mulberry32((NoiseGen.seedFrom(planet.id) ^ 0x5B17E5) >>> 0);

    const formations = [];
    _placeFields(formations, elevation, w, h, planet, cfg, rng);
    _placeButtes(formations, elevation, w, h, planet, cfg, rng);
    return formations;
  }

  function _placeFields(formations, elevation, w, h, planet, cfg, rng) {
    const count  = _randInt(rng, cfg.fields[0], cfg.fields[1]);
    const target = formations.length + count;
    let attempts = 0;

    while (formations.length < target && attempts++ < count * 12 + 8) {
      const radius = FIELD_RADIUS[0] + rng() * (FIELD_RADIUS[1] - FIELD_RADIUS[0]);
      const inset  = Math.ceil(radius + SPIRE_APRON_R * OUTER_T + 2);
      if (w <= inset * 2 || h <= inset * 2) break;

      const cx = inset + Math.floor(rng() * (w - inset * 2));
      const cy = inset + Math.floor(rng() * (h - inset * 2));
      if (!_separated(formations, planet, cx, cy, radius)) continue;

      _stampField(elevation, w, h, cx, cy, radius, rng);
      formations.push({ kind: 'spire', cx, cy, radius });
    }
  }

  function _placeButtes(formations, elevation, w, h, planet, cfg, rng) {
    const count  = _randInt(rng, cfg.buttes[0], cfg.buttes[1]);
    const target = formations.length + count;
    const radius = BUTTE_SIZE;
    const inset  = Math.ceil(radius * OUTER_T + 2);
    if (w <= inset * 2 || h <= inset * 2) return;
    let attempts = 0;

    while (formations.length < target && attempts++ < count * 12 + 8) {
      const cx = inset + Math.floor(rng() * (w - inset * 2));
      const cy = inset + Math.floor(rng() * (h - inset * 2));
      if (!_separated(formations, planet, cx, cy, radius)) continue;

      _stampButte(elevation, w, h, cx, cy);
      formations.push({ kind: 'butte', cx, cy, radius });
    }
  }

  // Reject a center within SEPARATION of any existing formation or any crater.
  function _separated(formations, planet, cx, cy, radius) {
    for (const f of formations) {
      if (Math.hypot(cx - f.cx, cy - f.cy) < f.radius + radius + SEPARATION) return false;
    }
    for (const c of planet.craterMeta || []) {
      if (Math.hypot(cx - c.cx, cy - c.cy) < c.radius + radius + SEPARATION) return false;
    }
    return true;
  }

  // Stamp a spire field in three steps: scatter the spike positions, flatten a small
  // apron around each one (their union is an irregular pan, not a single circle), then
  // raise the spikes. All aprons flatten toward one shared targetBase — sampled over
  // the whole field footprint and lowered proportionally to how high the ambient
  // terrain is — so the union reads as one coherent low, flat basin with a lumpy edge.
  function _stampField(elevation, w, h, cx, cy, radius, rng) {
    const A     = _ambientBase(elevation, w, h, cx, cy, radius, Math.ceil(radius));
    const lower = MathUtils.lerp(LOWER_MIN, LOWER_MAX,
      _smooth(MathUtils.clamp((A - LOWER_REF_LO) / (LOWER_REF_HI - LOWER_REF_LO), 0, 1)));
    const targetBase = A - lower;

    const { spires, tiles } = _scatterSpikes(cx, cy, radius, rng);
    _stampApron(elevation, w, h, cx, cy, radius, spires, A, targetBase);
    for (const s of tiles) _raiseSpike(elevation, w, h, s.x, s.y);
  }

  // Reject-and-retry scatter (MudPitGen's cluster idiom) inside the field radius.
  // Returns the spire centres (which anchor the aprons) and the full set of tiles to
  // raise — each spire, plus the 1–2 neighbours of any spire grown into a 2–3 tile
  // blob. Blob tiles stay inside the field radius so they land on the flattened pan.
  function _scatterSpikes(cx, cy, radius, rng) {
    const count    = _randInt(rng, SPIRES_PER[0], SPIRES_PER[1]);
    const DIRS     = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const occupied = new Set();
    const spires   = [];
    const tiles    = [];
    let placed = 0, attempts = count * 10;

    while (placed < count && attempts-- > 0) {
      const rx = Math.round((rng() * 2 - 1) * radius);
      const ry = Math.round((rng() * 2 - 1) * radius);
      const key = rx + ',' + ry;
      if (Math.hypot(rx, ry) > radius || occupied.has(key)) continue;
      occupied.add(key);

      const sx = cx + rx, sy = cy + ry;
      spires.push({ x: sx, y: sy });
      tiles.push({ x: sx, y: sy });

      if (rng() < BLOB_CHANCE) {
        const extra = rng() < 0.5 ? 1 : 2;
        for (let k = 0; k < extra; k++) {
          const d  = DIRS[Math.floor(rng() * 4)];
          const nx = sx + d[0], ny = sy + d[1];
          if (Math.hypot(nx - cx, ny - cy) <= radius) tiles.push({ x: nx, y: ny });
        }
      }
      placed++;
    }
    return { spires, tiles };
  }

  // Flatten a SPIRE_APRON_R apron around every spire. Each tile takes the shape from
  // its nearest spire, so overlapping aprons merge into one irregular flattened region
  // whose outline follows the union of the small circles rather than a big circle.
  function _stampApron(elevation, w, h, cx, cy, radius, spires, A, targetBase) {
    const reach = Math.ceil(radius + SPIRE_APRON_R * OUTER_T);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const tx = cx + dx, ty = cy + dy;
        let t = Infinity;
        for (const s of spires) {
          const d = Math.hypot(tx - s.x, ty - s.y) / SPIRE_APRON_R;
          if (d < t) t = d;
        }
        if (t > OUTER_T) continue;
        const i = _wrap(ty, h) * w + _wrap(tx, w);
        elevation[i] = MathUtils.clamp(_apronShape(t, elevation[i], A, targetBase), 0, 1);
      }
    }
  }

  // Absolute apron elevation at t = (distance to nearest spire) / SPIRE_APRON_R: the
  // basin floor keeps FIELD_TEXTURE of the original micro-relief, then blends back to
  // the surrounding terrain between t = 1.0 (k=0 → apron) and t = OUTER_T (k=1 → orig).
  function _apronShape(t, orig, A, targetBase) {
    const apron = targetBase + (orig - A) * FIELD_TEXTURE;
    if (t <= 1.0) return apron;
    const k = _smooth((t - 1.0) / (OUTER_T - 1.0));
    return apron + (orig - apron) * k;
  }

  // Raise one tile to a bare-rock pinnacle rising straight from the flattened pan.
  function _raiseSpike(elevation, w, h, x, y) {
    const i = _wrap(y, h) * w + _wrap(x, w);
    elevation[i] = MathUtils.clamp(Math.max(SPIKE_FLOOR, elevation[i] + SPIKE_RISE), 0, 1);
  }

  // A single sharp mesa: set the 3×3 top to a flat ALPINE level above ambient,
  // leaving the surrounding tiles untouched so the sides read as a sharp cliff.
  function _stampButte(elevation, w, h, cx, cy) {
    const half = Math.floor(BUTTE_SIZE / 2);
    let sum = 0, n = 0;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        sum += elevation[_wrap(cy + dy, h) * w + _wrap(cx + dx, w)];
        n++;
      }
    }
    const A   = sum / n;
    const top = MathUtils.clamp(Math.max(BUTTE_FLOOR, A + BUTTE_RISE), 0, 1);

    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        elevation[_wrap(cy + dy, h) * w + _wrap(cx + dx, w)] = top;
      }
    }
  }

  // Ambient level the formation sits in: average original elevation over the
  // footprint (t ≤ 1.0). Mirrors CraterGen's _ambientBase.
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

  function _smooth(k) {
    return k * k * (3 - 2 * k);
  }

  function _wrap(v, max) {
    return ((v % max) + max) % max;
  }

  function _randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  return { modifyElevation };
})();
