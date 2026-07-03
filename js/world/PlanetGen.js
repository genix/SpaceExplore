// Single source of truth for a planet's first-visit generation recipe. Owning the
// stage order here (rather than inline in SolarSystemScreen) guarantees a planet
// regenerated on return is byte-identical to the one first built. Given a fixed
// luminosity, build(planet, luminosity) is a pure function of planet.id.
// See PlanetPersistence.md.
const PlanetGen = (() => {
  function build(planet, luminosity) {
    // Map dimensions are seeded from the planet instead of Math.random so the grid
    // size (and therefore every downstream placement) reproduces on regeneration.
    const dimRng = NoiseGen.mulberry32((NoiseGen.seedFrom(planet.id) ^ 0x5217) >>> 0);
    const w = 256 + Math.floor(dimRng() * 257);
    const h = 256 + Math.floor(dimRng() * 257);

    const map       = MapGen.generate(w, h, planet, luminosity);
    const lavaVents = LavaVentGen.place(map, planet);  // must precede boulders/deposits: clears vegetation in place
    const crater    = CraterGen.buildObjects(map, planet);
    const objects   = [
      ...BoulderGen.place(map, planet),
      ...MudPitGen.place(map, planet),
      ...lavaVents,
      ...crater.objects,
    ];
    const deposits  = [...DepositGen.place(map, planet, objects), ...crater.deposits];
    return { map, objects, deposits };
  }

  return { build };
})();
