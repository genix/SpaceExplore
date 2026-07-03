// Shared numeric helpers used by rendering, simulation, and UI code.
const MathUtils = (() => {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(start, end, t) {
    return start + (end - start) * t;
  }

  function wrap(value, max) {
    return ((value % max) + max) % max;
  }

  return { clamp, lerp, wrap };
})();
