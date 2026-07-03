// Per-planet data model: terrain, landability, resources, day cycle, orbital data, and metals.
const Planet = (() => {

  // distanceAU: orbital distance from star in AU (0.5–30)
  // orbitalPeriod: approximate days per full orbit (flavour; not simulated in real-time)
  // tempBaseC: equilibrium temperature in °C; tempMinC/tempMaxC: approx range (poles vs equator at sea level)
  // atmosphere: 0..1 surface-pressure density; drives life, water, weather, and temperature swing (see Atmosphere.js)
  function create(id, name, terrain, landable, resources, dayLength, distanceAU, orbitalPeriod, tempBaseC, tempMinC, tempMaxC, metalProfile = null, atmosphere = Atmosphere.DEFAULT_DENSITY) {
    return { id, name, terrain, landable, resources, dayLength, distanceAU, orbitalPeriod, tempBaseC, tempMinC, tempMaxC, metalProfile, atmosphere };
  }

  return { create };
})();
