// Ash fall plugin for WeatherSystem. Handles the single 'ash_fall' type (displayed as "Ash Fall").
// Ash fall is passive atmospheric precipitation on scorched (volcanic) worlds. There is no cloud
// entity: when active the whole planet is under ash, so intensity is uniform everywhere. Spawn
// weight and intensity derive from a volcanic proxy based on the player zone's surface temperature
// (hotter zones = more active volcanism). Long duration, mild ramps, no movement penalty.
const AshFallWeather = (() => {
  const TYPE = 'ash_fall';

  const TOTAL_TURNS_MIN = 30;
  const TOTAL_TURNS_MAX = 70;
  const RAMP_IN_FRAC    = 0.10;
  const RAMP_OUT_FRAC   = 0.15;
  const MIN_PROXY       = 0.10;   // below this the air is too cool for ash
  const SPAWN_WEIGHT    = 0.8;    // slightly less likely than dust storms on the same world

  // Surface heat as a stand-in for volcanic activity: 290K -> 0.0, 390K -> 1.0.
  function _volcanoProxy(zone) {
    return MathUtils.clamp(((zone?.tempK ?? 0) - 290) / 100, 0, 1);
  }

  return {
    types: [TYPE],

    reset() {},

    getCandidates(context) {
      if (context.terrain !== 'scorched') return [];
      const vProxy = _volcanoProxy(context.zone);
      if (vProxy <= MIN_PROXY) return [];
      return [{ type: TYPE, weight: vProxy * SPAWN_WEIGHT }];
    },

    onSpawn(type, context) {
      const vProxy        = _volcanoProxy(context.zone);
      const intensity     = MathUtils.clamp(0.3 + vProxy * 0.6, 0, 1);
      const totalDuration = TOTAL_TURNS_MIN + Math.floor(Math.random() * (TOTAL_TURNS_MAX - TOTAL_TURNS_MIN + 1));
      return {
        type,
        turnsLeft:     totalDuration,
        totalDuration,
        age:           0,
        intensity,
        baseIntensity: intensity,
        movePenalty:   0,
      };
    },

    onTick(event) {
      const turnsLeft = event.turnsLeft - 1;
      if (turnsLeft <= 0) return null;

      const age          = event.age + 1;
      const rampInTurns  = event.totalDuration * RAMP_IN_FRAC;
      const rampOutTurns = event.totalDuration * RAMP_OUT_FRAC;
      let ramp = 1.0;
      if (age < rampInTurns)        ramp = Math.min(ramp, age / rampInTurns);
      if (turnsLeft < rampOutTurns) ramp = Math.min(ramp, turnsLeft / rampOutTurns);

      const intensity = MathUtils.clamp(event.baseIntensity * ramp, 0, 1);
      return { age, turnsLeft, intensity, movePenalty: 0 };
    },

    getSpatialIntensity(event) {
      const intensity = event.intensity ?? 0;
      return () => intensity;
    },

    getLayer(event) {
      const layer = WeatherLayer.createAnimatedLayer(event);
      if (layer) layer.label = 'Ash Fall';
      return layer;
    },
  };
})();
