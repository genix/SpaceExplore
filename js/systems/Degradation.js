// Shared equipment-wear math used by ExtractionSystem (consumers), PowerSystem
// (producers/relays), and the UI (ObjectLayer tint, TileInspector readout).
// Wear is measured in "wear units"; one unit is consumed per unit of output a
// piece of equipment produces/delivers, scaled by a terrain multiplier. Output
// scales down once durability falls below DEGRADE_THRESHOLD, reaching zero at
// empty. See design/CraftingAndDegradation.md.
const Degradation = (() => {
  const TERRAIN_MULT = {
    temperate: 1.0,
    tundra:    1.3,
    arid:      1.5,
    frozen:    1.8,
    scorched:  2.5,
  };
  const DEGRADE_THRESHOLD = 0.25;
  const ORANGE = '#ff9933';
  const RED    = '#ff3322';

  function terrainMultiplier(terrain) {
    return TERRAIN_MULT[terrain] ?? 1.0;
  }

  function currentTerrainMultiplier() {
    const planet = Datastore.has('currentPlanet') ? Datastore.get('currentPlanet') : null;
    return terrainMultiplier(planet?.terrain);
  }

  // Remaining-durability fraction in [0,1]. Items without durability read as full.
  function fraction(obj) {
    if (!obj || !obj.maxDurability) return 1;
    const d = obj.durability ?? obj.maxDurability;
    return MathUtils.clamp(d / obj.maxDurability, 0, 1);
  }

  // Output multiplier: full above the threshold, linear ramp to 0 at empty.
  function outputFactor(obj) {
    const frac = fraction(obj);
    if (frac >= DEGRADE_THRESHOLD) return 1;
    return frac / DEGRADE_THRESHOLD;
  }

  function isBroken(obj) {
    return !!obj.maxDurability && (obj.durability ?? obj.maxDurability) <= 0;
  }

  // Subtract `wear` (already terrain-scaled) from an object's durability and
  // return a partial-update object suitable for ObjectManager.update, or null
  // when the object has no durability or no wear applies.
  function applyWear(obj, wear) {
    if (!obj.maxDurability || !(wear > 0)) return null;
    const cur = obj.durability ?? obj.maxDurability;
    const next = Math.max(0, cur - wear);
    const update = { durability: next };
    if (next <= 0) update.broken = true;
    return update;
  }

  // Glyph tint for the degraded zone: base -> orange -> red. null when healthy.
  function tintColor(obj, baseColor) {
    if (!obj.maxDurability) return null;
    const frac = fraction(obj);
    if (frac >= DEGRADE_THRESHOLD) return null;
    const t = 1 - frac / DEGRADE_THRESHOLD;   // 0 at threshold, 1 at empty
    if (t <= 0.5) return ColorUtils.mixHex(baseColor, ORANGE, t * 2);
    return ColorUtils.mixHex(ORANGE, RED, (t - 0.5) * 2);
  }

  return {
    terrainMultiplier, currentTerrainMultiplier, fraction,
    outputFactor, isBroken, applyWear, tintColor, DEGRADE_THRESHOLD,
  };
})();
