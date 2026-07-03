// One-shot expanding-ring animation, anchored to a world tile. Each tile within
// the scan radius "pings" briefly when the wave-front reaches its Chebyshev
// distance, then fades. The pulse drives its own requestAnimationFrame loop
// and self-removes from MapView when complete.
const ScannerPulse = (() => {
  const DURATION_MS  = 700;
  const TILE_LIFE_MS = 240;
  const GLYPH        = '·';
  const COLOR_PEAK   = '#88ddff';
  const COLOR_FADE   = '#1a3344';

  let _idCounter = 0;
  let _pulses    = [];
  let _rafId     = null;

  function spawn(center, range) {
    if (!center || !range) return;
    const id           = `scanner-pulse-${++_idCounter}`;
    const startTime    = Date.now();
    const expansionDur = Math.max(1, DURATION_MS - TILE_LIFE_MS);
    const speed        = range / expansionDur;

    const layer = {
      id,
      zIndex:     30,
      ignoreTint: true,
      getScreenCells(viewportInfo) {
        return _renderPulse(center, range, startTime, speed, viewportInfo);
      },
    };

    MapView.addLayer(layer);
    _pulses.push({ id, startTime });
    if (!_rafId) _rafId = requestAnimationFrame(_tick);
  }

  function _tick() {
    const now = Date.now();
    const alive = [];
    let needsRefresh = false;
    for (const p of _pulses) {
      if (now - p.startTime >= DURATION_MS) {
        MapView.removeLayer(p.id);
      } else {
        alive.push(p);
        needsRefresh = true;
      }
    }
    _pulses = alive;
    if (needsRefresh) MapView.refresh();
    _rafId = alive.length > 0 ? requestAnimationFrame(_tick) : null;
  }

  function _renderPulse(center, range, startTime, speed, { cameraX, cameraY, viewW, viewH, charW, charH }) {
    const cells = Array.from({ length: charH }, () => Array(charW).fill(null));
    const elapsed = Date.now() - startTime;
    if (elapsed > DURATION_MS) return cells;
    if (!Datastore.has('planetMap')) return cells;
    const map = Datastore.get('planetMap');

    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        if (dx === 0 && dy === 0) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > range) continue;
        const tileLightTime = d / speed;
        const tileAge       = elapsed - tileLightTime;
        if (tileAge < 0 || tileAge > TILE_LIFE_MS) continue;

        const wx  = ((center.x + dx) % map.w + map.w) % map.w;
        const wy  = ((center.y + dy) % map.h + map.h) % map.h;
        const stx = ((wx - cameraX) % map.w + map.w) % map.w;
        const sty = ((wy - cameraY) % map.h + map.h) % map.h;
        if (stx >= viewW || sty >= viewH) continue;
        const sc = stx * 2;
        const sr = sty * 2;

        const t = tileAge / TILE_LIFE_MS;
        const color = ColorUtils.mixHex(COLOR_PEAK, COLOR_FADE, t);
        cells[sr][sc + 1] = { char: GLYPH, color };
        cells[sr + 1][sc] = { char: GLYPH, color };
      }
    }
    return cells;
  }

  return { spawn };
})();
