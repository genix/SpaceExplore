// Main update loop. Systems register tick handlers via GameLoop.register().
const GameLoop = (() => {
  const _systems = [];
  let _running = false;
  let _lastTime = 0;

  function register(system) {
    _systems.push(system);
  }

  function _tick(timestamp) {
    if (!_running) return;
    const dt = timestamp - _lastTime;
    _lastTime = timestamp;
    for (const sys of _systems) sys.update(dt);
    requestAnimationFrame(_tick);
  }

  function start() {
    _running = true;
    requestAnimationFrame((t) => { _lastTime = t; _tick(t); });
  }

  function stop() {
    _running = false;
  }

  return { register, start, stop };
})();
