// Places small and heavy boulder objects on a generated map.
// Modifiers: terrain base rate (planet-level), ground type (local), elevation (local),
// noise clustering (creates geological boulder fields), per-planet seed multiplier.
const BoulderGen = (() => {
  const BASE_RATE = {
    scorched:  0.06,
    arid:      0.045,
    temperate: 0.025,
    tundra:    0.018,
    frozen:    0.012,
  };

  const GROUND_FACTOR = {
    'rock':        1.4,
    'dry-rock':    1.4,
    'gravel':      1.2,
    'sand':        0.8,
    'soil':        0.5,
    'grass':       0.4,
    'frozen-soil': 0.5,
    'ice':         0.3,
    'snow':        0.3,
  };

  // Fraction of the boulder probability budget used for heavy (2×2) boulders.
  const HEAVY_FRACTION = 0.12;

  function place(map, planet) {
    const seed = (NoiseGen.seedFrom(planet.id) ^ 0xB01D) >>> 0;
    const rng  = NoiseGen.mulberry32(seed);
    const clusterNoise = NoiseGen.makeGradientNoise((seed ^ 0xC145) >>> 0);

    const baseRate   = BASE_RATE[planet.terrain] ?? 0.025;
    const planetMult = 0.6 + rng() * 0.8;

    const objects  = [];
    const occupied = new Set();
    let   idx      = 0;

    for (let y = 0; y <= map.h - 2; y += 2) {
      for (let x = 0; x <= map.w - 2; x += 2) {
        if (!_allClear(map, x, y, 2, occupied)) continue;
        const p = _prob(map.grid[y][x], x, y, baseRate, planetMult, clusterNoise);
        if (p === 0) continue;
        if (rng() < p * HEAVY_FRACTION) {
          objects.push(BoulderObject.createHeavy(
            `bh-${planet.id}-${idx++}`,
            x,
            y,
            ResourceMaterials.rollDeposit(planet, rng, 1.8)
          ));
          _markOccupied(occupied, x, y, 2, map.w, map.h);
        }
      }
    }

    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (!MapGen.isPassable(map.grid[y][x])) continue;
        if (occupied.has(`${x},${y}`)) continue;
        const p = _prob(map.grid[y][x], x, y, baseRate, planetMult, clusterNoise);
        if (p === 0) continue;
        if (rng() < p) {
          objects.push(BoulderObject.createSmall(
            `bs-${planet.id}-${idx++}`,
            x,
            y,
            ResourceMaterials.rollDeposit(planet, rng, 1.35)
          ));
          occupied.add(`${x},${y}`);
        }
      }
    }

    return objects;
  }

  function _allClear(map, ax, ay, size, occupied) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const tx = (ax + dx) % map.w;
        const ty = (ay + dy) % map.h;
        if (!MapGen.isPassable(map.grid[ty][tx])) return false;
        if (occupied.has(`${tx},${ty}`)) return false;
      }
    }
    return true;
  }

  function _markOccupied(occupied, ax, ay, size, mapW, mapH) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        occupied.add(`${(ax + dx) % mapW},${(ay + dy) % mapH}`);
      }
    }
  }

  // Cluster noise is thresholded and sharpened: zero below cn=0.4, ramps steeply above.
  // This creates contiguous boulder field zones with clear boundaries between rocky and
  // open areas rather than a uniform scatter.
  function _prob(tile, x, y, baseRate, planetMult, clusterNoise) {
    const cn = clusterNoise.sample(x / 35, y / 35);
    const clusterFactor = Math.max(0, cn * 2 - 0.8);
    if (clusterFactor === 0) return 0;

    const elevFactor   = 0.3 + Math.max(0, tile.elevation - Heightmap.SEA_LEVEL) /
                               (1 - Heightmap.SEA_LEVEL) * 0.7;
    const groundFactor = GROUND_FACTOR[tile.ground] ?? 0.6;

    return baseRate * planetMult * clusterFactor * elevFactor * groundFactor;
  }

  return { place };
})();
