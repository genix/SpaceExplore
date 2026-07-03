// Per-planet atmospheric density and the world-gen rules that depend on it.
// `density` is a 0..1 abstraction of surface pressure. This module is the single
// owner of the thresholds and curves that decide organic life, surface liquid
// water, weather frequency, precipitation, and day/night temperature swing, so
// the generation steps (Vegetation, Moisture, Hydrology, Temperature, Weather)
// stay consistent with one another.
const Atmosphere = (() => {
  // Assumed for legacy planets saved before atmosphere existed. Sits in the
  // moderate band so life, water, and normal weather are all preserved.
  const DEFAULT_DENSITY = 0.55;

  // Density bands the generator draws from. The gaps between bands keep rolled
  // values clearly inside one category (no ambiguous boundary densities).
  const BANDS = {
    none:     [0.00, 0.07],
    thin:     [0.10, 0.28],
    moderate: [0.35, 0.65],
    thick:    [0.72, 1.00],
  };

  // Per-terrain category weights. Inner worlds skew airless or runaway-thick,
  // temperate worlds skew breathable, outer worlds skew thin/frozen-out.
  const TERRAIN_WEIGHTS = {
    scorched:  { none: 40, thin: 18, moderate: 14, thick: 28 },
    arid:      { none: 26, thin: 46, moderate: 23, thick: 5  },
    temperate: { none: 8,  thin: 20, moderate: 47, thick: 25 },
    tundra:    { none: 16, thin: 30, moderate: 39, thick: 15 },
    frozen:    { none: 30, thin: 35, moderate: 20, thick: 15 },
  };

  const LIFE_MIN   = 0.32;  // organic life needs at least a moderate atmosphere
  const LIQUID_MIN = 0.08;  // stable surface liquid water needs more than a trace

  function _density(d) {
    return Number.isFinite(d) ? MathUtils.clamp(d, 0, 1) : DEFAULT_DENSITY;
  }

  function roll(terrain, rand = Math.random) {
    const weights = TERRAIN_WEIGHTS[terrain] ?? TERRAIN_WEIGHTS.temperate;
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = rand() * total;
    let cat = 'moderate';
    for (const k in weights) { r -= weights[k]; if (r <= 0) { cat = k; break; } }
    const [lo, hi] = BANDS[cat];
    return Math.round((lo + rand() * (hi - lo)) * 1000) / 1000;
  }

  function category(d) {
    d = _density(d);
    if (d <= 0.08) return 'none';
    if (d < 0.32)  return 'thin';
    if (d < 0.70)  return 'moderate';
    return 'thick';
  }

  const _LABELS = { none: 'None', thin: 'Thin', moderate: 'Moderate', thick: 'Thick' };
  function label(d) {
    return _LABELS[category(d)];
  }

  function supportsLife(d) { return _density(d) >= LIFE_MIN; }
  function supportsLiquidWater(d) { return _density(d) > LIQUID_MIN; }

  // Weather-spawn / precipitation multiplier: ~0 when airless, ramps to 1 at a
  // breathable atmosphere, and pushes past 1 for thick atmospheres so dense
  // worlds get substantial weather.
  function weatherFactor(d) {
    d = _density(d);
    if (d <= 0.08) return 0;
    if (d < 0.5)   return (d - 0.08) / (0.5 - 0.08);
    return 1 + (d - 0.5) / 0.5 * 0.6;
  }

  // Day/night temperature-swing multiplier: thin air swings hard, thick air is
  // well buffered. ~1.0 around the default density so balance is unchanged.
  function diurnalFactor(d) {
    return MathUtils.clamp(1.8 - 1.4 * _density(d), 0.5, 1.8);
  }

  return {
    DEFAULT_DENSITY,
    roll, category, label,
    supportsLife, supportsLiquidWater,
    weatherFactor, diurnalFactor,
  };
})();
