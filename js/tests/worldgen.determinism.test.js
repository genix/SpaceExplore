// Suite A — worldgen determinism. Guards Phase 1 of PlanetPersistence: build() must
// be a pure function of the planet, and distinct ids must yield distinct worlds.
Test.suite('A — Worldgen determinism', () => {
  const LUM = 1.0;

  // A1 — Heightmap is pure: same inputs twice → identical elevation arrays.
  Test.test('A1 — Heightmap is pure', () => {
    const p = makeTestPlanet('star_a1:p0');
    const a = Heightmap.generate(200, 200, p);
    const b = Heightmap.generate(200, 200, p);
    assertEqual(a.length, b.length, 'elevation lengths differ');
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) throw new Error(`elevation differs at ${i}: ${a[i]} vs ${b[i]}`);
    }
  });

  // A2 — Full build is reproducible: the headline determinism guarantee.
  Test.test('A2 — Full build is reproducible', () => {
    const p = makeTestPlanet('star_a2:p0');
    const one = PlanetGen.build(p, LUM);
    const two = PlanetGen.build(p, LUM);
    assertEqual(hashGrid(one.map), hashGrid(two.map), 'grid hash differs');
    assertEqual(hashObjects(one.objects), hashObjects(two.objects), 'objects hash differs');
    assertEqual(hashDeposits(one.deposits), hashDeposits(two.deposits), 'deposits hash differs');
  });

  // A3 — Distinct ids → distinct worlds. Regression guard for the old p_0 collision.
  Test.test('A3 — Distinct ids -> distinct worlds', () => {
    const a = PlanetGen.build(makeTestPlanet('star_a:p0'), LUM);
    const b = PlanetGen.build(makeTestPlanet('star_b:p0'), LUM);
    assert(hashGrid(a.map) !== hashGrid(b.map),
      'different systems sharing :p0 produced identical terrain (collision bug)');
    const c = PlanetGen.build(makeTestPlanet('star_a:p1'), LUM);
    assert(hashGrid(a.map) !== hashGrid(c.map),
      'same system, different planet index produced identical terrain');
  });

  // A4 — Dimensions are deterministic (seeded, not Math.random).
  Test.test('A4 — Dimensions are deterministic', () => {
    const p = makeTestPlanet('star_a4:p0');
    const one = PlanetGen.build(p, LUM);
    const two = PlanetGen.build(p, LUM);
    assertEqual(one.map.w, two.map.w, 'width differs');
    assertEqual(one.map.h, two.map.h, 'height differs');
  });

  // A5 — Hydrology is deterministic: guards the seeded river-meander fix directly.
  Test.test('A5 — Hydrology is deterministic', () => {
    const p = makeTestPlanet('star_a5:p0');
    const elev = Heightmap.generate(180, 180, p);
    const a = Hydrology.generate(180, 180, elev, p);
    const b = Hydrology.generate(180, 180, elev, p);
    assertEqual(a.waterType.length, b.waterType.length, 'waterType length differs');
    for (let i = 0; i < a.waterType.length; i++) {
      if (a.waterType[i] !== b.waterType[i]) throw new Error(`waterType differs at index ${i}`);
    }
  });

  // A6 — FormationGen stamps the same elevation twice from the seeded planet id, so
  // rock formations add zero save cost and regenerate byte-identically like craters.
  Test.test('A6 — FormationGen is deterministic', () => {
    const p = makeTestPlanet('star_fmt:p0', 'scorched');
    const base = Heightmap.generate(160, 160, p);
    const e1 = base.slice();
    const e2 = base.slice();
    const m1 = FormationGen.modifyElevation(e1, 160, 160, p);
    const m2 = FormationGen.modifyElevation(e2, 160, 160, p);
    assertEqual(m1.length, m2.length, 'formation count differs');
    for (let i = 0; i < e1.length; i++) {
      if (e1[i] !== e2[i]) throw new Error(`stamped elevation differs at ${i}: ${e1[i]} vs ${e2[i]}`);
    }
  });

  // A7 — A spire actually forms: at least one tile is pushed above MOUNTAIN_PEAK
  // (0.85 → ALPINE bare rock) where the original ambient elevation was lower.
  Test.test('A7 — FormationGen raises spires above MOUNTAIN_PEAK', () => {
    const p = makeTestPlanet('star_fmt2:p0', 'scorched');
    const w = 160, h = 160;
    const before = Heightmap.generate(w, h, p);
    const after  = before.slice();
    const meta   = FormationGen.modifyElevation(after, w, h, p);
    assert(meta.length > 0, 'no formations placed on a scorched world');
    let raised = false;
    for (let i = 0; i < after.length; i++) {
      if (after[i] > 0.85 && before[i] <= 0.85) { raised = true; break; }
    }
    assert(raised, 'no tile pushed above MOUNTAIN_PEAK where the ambient was lower');
  });
});
