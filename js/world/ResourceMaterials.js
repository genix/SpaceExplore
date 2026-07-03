// Shared resource and ore definitions for planet summaries and worldgen deposits.
const ResourceMaterials = (() => {
  const RESOURCE_LABELS = {
    'common-metals': 'Common Metals',
    'rare-materials': 'Rare Materials',
    silicon: 'Silicon',
    sulfur: 'Sulfur',
    silica: 'Silica',
    carbon: 'Carbon',
    organics: 'Organics',
    water: 'Water',
    cryolite: 'Cryolite',
    deuterium: 'Deuterium',
    methane: 'Methane',
    'rare-gases': 'Rare Gases',
    crystal: 'Crystal',
  };

  const RESOURCE_CODES = {
    'common-metals': 'Cm',
    'rare-materials': 'Rm',
    silicon: 'Si',
    sulfur: 'Su',
    silica: 'Sc',
    carbon: 'Cb',
    organics: 'Or',
    water: 'H2',
    cryolite: 'Cy',
    deuterium: 'Dt',
    methane: 'Mn',
    'rare-gases': 'Rg',
    crystal: 'Cr',
  };

  const METALS = {
    iron:       { label: 'Iron',       group: 'common', weight: 34 },
    copper:     { label: 'Copper',     group: 'common', weight: 18 },
    aluminum:   { label: 'Aluminum',   group: 'common', weight: 25 },
    nickel:     { label: 'Nickel',     group: 'common', weight: 12 },
    titanium:   { label: 'Titanium',   group: 'common', weight: 8  },
    tungsten:   { label: 'Tungsten',   group: 'common', weight: 3  },
    cobalt:     { label: 'Cobalt',     group: 'rare',   weight: 8  },
    lithium:    { label: 'Lithium',    group: 'rare',   weight: 7  },
    neodymium:  { label: 'Neodymium',  group: 'rare',   weight: 4  },
    dysprosium: { label: 'Dysprosium', group: 'rare',   weight: 2  },
    yttrium:    { label: 'Yttrium',    group: 'rare',   weight: 3  },
  };

  const COMMON_METALS = Object.keys(METALS).filter(id => METALS[id].group === 'common');
  const RARE_MATERIALS = Object.keys(METALS).filter(id => METALS[id].group === 'rare');

  const TERRAIN_RULES = {
    scorched:  { rare: 0.45, commonCount: [3, 5], rareCount: [1, 2] },
    arid:      { rare: 0.25, commonCount: [2, 4], rareCount: [1, 1] },
    temperate: { rare: 0.16, commonCount: [2, 4], rareCount: [1, 1] },
    tundra:    { rare: 0.22, commonCount: [2, 3], rareCount: [1, 1] },
    frozen:    { rare: 0.32, commonCount: [2, 3], rareCount: [1, 2] },
  };

  const ROCK_GROUNDS = new Set(['rock', 'dry-rock']);

  function buildPlanetProfile(seedKey, terrain, landable) {
    if (!landable) {
      return {
        groups: { common: false, rare: false },
        supportedMetals: [],
      };
    }

    const rule = TERRAIN_RULES[terrain] ?? TERRAIN_RULES.temperate;
    const rng = NoiseGen.mulberry32(NoiseGen.seedFrom(`${seedKey}:metal-profile`));
    const hasRare = rng() < rule.rare;
    const commonCount = _randInt(rng, rule.commonCount[0], rule.commonCount[1]);
    const rareCount = hasRare ? _randInt(rng, rule.rareCount[0], rule.rareCount[1]) : 0;
    const common = _weightedTake(COMMON_METALS, commonCount, rng, 1.0);
    const rare = _weightedTake(RARE_MATERIALS, rareCount, rng, 1.0);

    return {
      groups: { common: common.length > 0, rare: rare.length > 0 },
      supportedMetals: [...common, ...rare],
    };
  }

  function normalizeResources(resources, metalProfile) {
    const out = [];
    if (metalProfile?.groups?.common) out.push('common-metals');
    if (metalProfile?.groups?.rare) out.push('rare-materials');
    for (const r of resources) {
      if (r === 'iron' || r === 'rare-metals') continue;
      if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  function isRockGround(ground) {
    return ROCK_GROUNDS.has(ground);
  }

  function rollDeposit(planet, rng, richness = 1) {
    const supported = planet?.metalProfile?.supportedMetals || planet?.supportedMetals || [];
    if (!supported.length) return null;

    const maxCount = Math.min(3, supported.length);
    let count = 1;
    if (maxCount >= 2 && rng() < 0.50) count++;
    if (maxCount >= 3 && rng() < 0.15) count++;

    const chosen = _weightedTake(supported, count, rng, 0.18);
    const result = {};
    for (const id of chosen) {
      const def = METALS[id];
      const common = def.group === 'common';
      const min = common ? 0.25 : 0.02;
      const max = common ? 3.50 : 0.50;
      const pct = (min + rng() * (max - min)) * richness;
      result[id] = Math.max(0.01, Math.round(pct * 100) / 100);
    }
    return Object.keys(result).length ? result : null;
  }

  function resourceLabel(id) {
    return RESOURCE_LABELS[id] || id;
  }

  function resourceCode(id) {
    return RESOURCE_CODES[id] || id.slice(0, 2);
  }

  function metalLabel(id) {
    return METALS[id]?.label || id;
  }

  function formatDeposit(metals) {
    if (!metals || Object.keys(metals).length === 0) return [];
    return Object.entries(metals)
      .sort((a, b) => b[1] - a[1])
      .map(([id, pct]) => `${metalLabel(id)} ${pct.toFixed(2)}%`);
  }

  function _weightedTake(ids, count, rng, rareScale) {
    const pool = [...ids];
    const chosen = [];
    while (pool.length > 0 && chosen.length < count) {
      const pick = _weightedPick(pool, rng, rareScale);
      chosen.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
    return chosen;
  }

  function _weightedPick(ids, rng, rareScale) {
    const total = ids.reduce((sum, id) => {
      const def = METALS[id];
      const scale = def.group === 'rare' ? rareScale : 1;
      return sum + def.weight * scale;
    }, 0);
    let roll = rng() * total;
    for (const id of ids) {
      const def = METALS[id];
      const scale = def.group === 'rare' ? rareScale : 1;
      roll -= def.weight * scale;
      if (roll <= 0) return id;
    }
    return ids[ids.length - 1];
  }

  function _randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  return {
    buildPlanetProfile,
    normalizeResources,
    isRockGround,
    rollDeposit,
    resourceLabel,
    resourceCode,
    metalLabel,
    formatDeposit,
  };
})();
