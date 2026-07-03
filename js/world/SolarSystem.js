// Generates a complete solar system: one star and 2–8 orbiting planets.
// Precondition: Planet must be loaded before this module.
const SolarSystem = (() => {

  const STAR_NAMES = [
    'Kerath', 'Vela', 'Solnar', 'Auris', 'Tyven',
    'Carinn', 'Delun', 'Ferox', 'Glaes', 'Harek',
    'Idris', 'Jarnak', 'Koreth', 'Lumis', 'Mydra',
    'Neros', 'Ophen', 'Pyrek', 'Qualis', 'Ruthis',
  ];

  const PLANET_NAMES = [
    'Terranova', 'Ashveil', 'Coldreach', 'Dustmere', 'Eremis',
    'Frostholm', 'Grimholt', 'Havenside', 'Ironfall', 'Juniper',
    'Keldrast', 'Lowmere', 'Misthold', 'Nullsphere', 'Orvast',
    'Pelagis', 'Quellan', 'Rimvast', 'Stoneholt', 'Tumaris',
  ];

  // Weighted spectral classes; luminosity scales the habitable zone.
  const SPECTRAL_CLASSES = [
    { cls: 'M', luminosity: 0.1,  weight: 35 },
    { cls: 'K', luminosity: 0.4,  weight: 30 },
    { cls: 'G', luminosity: 1.0,  weight: 22 },
    { cls: 'F', luminosity: 2.5,  weight: 13 },
  ];

  const RESOURCE_POOLS = {
    scorched:  ['silicon', 'sulfur'],
    arid:      ['silica', 'carbon'],
    temperate: ['carbon', 'organics', 'water'],
    tundra:    ['cryolite', 'methane'],
    frozen:    ['cryolite', 'rare-gases', 'crystal', 'deuterium'],
  };

  function generate() {
    const star = _generateStar();
    const planets = _buildPlanets(star);
    return {
      id: 'sys_' + _uid(),
      name: star.name + ' System',
      star,
      planets,
    };
  }

  function _generateStar() {
    const cls = _weightedPick(SPECTRAL_CLASSES);
    return {
      id: 'star_' + _uid(),
      name: _pick(STAR_NAMES),
      spectralClass: cls.cls,
      luminosity: cls.luminosity,
    };
  }

  function _tempRange(luminosity, distAU) {
    const base = Temperature.baseTempK(luminosity, distAU);
    return {
      tempBaseC: Math.round(base - 273),
      tempMinC:  Math.round(Math.max(base * 0.80, 50) - 273),
      tempMaxC:  Math.round(Math.min(base * 1.20, 600) - 273),
    };
  }

  function _buildPlanets(star) {
    const hz = Math.sqrt(star.luminosity);
    const targetCount = _randInt(3, 8);
    const namePool = _shuffle([...PLANET_NAMES]);

    const planets = [];
    let dist = hz * _randFloat(0.4, 0.75);

    for (let i = 0; i < targetCount && dist <= 30; i++) {
      const terrain = _terrainForDist(dist, hz);
      // Gas giants only roll in outer zones where pressure/mass supports them.
      const isGas = (terrain === 'tundra' || terrain === 'frozen') && Math.random() < 0.35;
      const landable = !isGas;
      const planetId = `${star.id}:p${i}`;
      const planetTerrain = isGas ? 'gas' : terrain;
      const metalProfile = ResourceMaterials.buildPlanetProfile(planetId, planetTerrain, landable);
      const atmosphere = Atmosphere.roll(planetTerrain);
      const resources = landable
        ? _filterLifeless(ResourceMaterials.normalizeResources(_pickResources(terrain), metalProfile), atmosphere)
        : [];
      const distAU = parseFloat(dist.toFixed(2));
      const { tempBaseC, tempMinC, tempMaxC } = _tempRange(star.luminosity, distAU);

      planets.push(Planet.create(
        planetId,
        namePool[i] || ('Planet ' + (i + 1)),
        planetTerrain,
        landable,
        resources,
        _randInt(120, 300),
        distAU,
        Math.round(365 * Math.pow(distAU, 1.5)),
        tempBaseC,
        tempMinC,
        tempMaxC,
        metalProfile,
        atmosphere
      ));

      dist += hz * _randFloat(0.15, 0.70);
    }

    _ensureMinLandable(planets, star, hz, 2);
    planets.sort((a, b) => a.distanceAU - b.distanceAU);
    return planets;
  }

  // If fewer than min landable planets exist, convert gas giants (inner-first) until satisfied.
  function _ensureMinLandable(planets, star, hz, min) {
    let count = planets.filter(p => p.landable).length;
    for (let i = 0; i < planets.length && count < min; i++) {
      if (!planets[i].landable) {
        const p = planets[i];
        const terrain = _terrainForDist(p.distanceAU, hz);
        const { tempBaseC, tempMinC, tempMaxC } = _tempRange(star.luminosity, p.distanceAU);
        const metalProfile = ResourceMaterials.buildPlanetProfile(p.id, terrain, true);
        const atmosphere = Atmosphere.roll(terrain);
        planets[i] = Planet.create(
          p.id, p.name, terrain, true,
          _filterLifeless(ResourceMaterials.normalizeResources(_pickResources(terrain), metalProfile), atmosphere),
          p.dayLength, p.distanceAU, p.orbitalPeriod,
          tempBaseC, tempMinC, tempMaxC,
          metalProfile, atmosphere
        );
        count++;
      }
    }
  }

  // Habitable zone centre: hz = sqrt(luminosity). Zone boundaries scale from there.
  function _terrainForDist(dist, hz) {
    if (dist < hz * 0.5) return 'scorched';
    if (dist < hz * 0.8) return 'arid';
    if (dist < hz * 2.0) return 'temperate';
    if (dist < hz * 5.0) return 'tundra';
    return 'frozen';
  }

  function _pickResources(terrain) {
    const pool = RESOURCE_POOLS[terrain];
    const shuffled = _shuffle([...pool]);
    return shuffled.slice(0, _randInt(2, Math.min(3, pool.length)));
  }

  // Worlds without a life-supporting atmosphere can't host organics.
  function _filterLifeless(resources, atmosphere) {
    if (Atmosphere.supportsLife(atmosphere)) return resources;
    return resources.filter(r => r !== 'organics');
  }

  function _weightedPick(items) {
    const total = items.reduce((s, it) => s + it.weight, 0);
    let r = Math.random() * total;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  function _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function _randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function _randFloat(min, max) {
    return Math.random() * (max - min) + min;
  }

  function _uid() {
    return Math.random().toString(36).substr(2, 8);
  }

  return { generate };
})();
