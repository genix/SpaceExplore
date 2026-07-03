// MapView layer that marks the edge direction of the landed ship when it is off-screen.
const ShipDirectionLayer = (() => {
  const ID = 'ship-direction';
  const COLOR = '#ffff55';
  const EPSILON = 0.001;

  function _blank(charW, charH) {
    return Array.from({ length: charH }, () => Array(charW).fill(null));
  }

  function _wrapDelta(from, to, size) {
    let delta = ((to - from) % size + size) % size;
    if (delta > size / 2) delta -= size;
    return delta;
  }

  function _shipCenter(ship, map) {
    const footprint = ship.footprint ?? [{ dx: 0, dy: 0 }];
    const avg = footprint.reduce((sum, p) => ({
      x: sum.x + p.dx,
      y: sum.y + p.dy,
    }), { x: 0, y: 0 });
    return {
      x: ((ship.x + avg.x / footprint.length) % map.w + map.w) % map.w,
      y: ((ship.y + avg.y / footprint.length) % map.h + map.h) % map.h,
    };
  }

  function _isShipVisible(ship, map, cameraX, cameraY, viewW, viewH) {
    for (const { dx, dy } of ship.footprint ?? [{ dx: 0, dy: 0 }]) {
      const wx = ((ship.x + dx) % map.w + map.w) % map.w;
      const wy = ((ship.y + dy) % map.h + map.h) % map.h;
      const sx = ((wx - cameraX) % map.w + map.w) % map.w;
      const sy = ((wy - cameraY) % map.h + map.h) % map.h;
      if (sx >= 0 && sx < viewW && sy >= 0 && sy < viewH) return true;
    }
    return false;
  }

  function _findShip() {
    return ObjectManager.all().find(obj => obj.type === 'ship') ?? null;
  }

  function _arrowLabel(dx, dy) {
    const h = dx < -EPSILON ? '←' : dx > EPSILON ? '→' : '';
    const v = dy < -EPSILON ? '↑' : dy > EPSILON ? '↓' : '';
    const arrows = `${v}${h}` || '?';
    const distance = Math.round(Math.hypot(dx, dy));
    return `${arrows} SHIP ${distance}`;
  }

  function _edgePoint(dx, dy, viewW, viewH) {
    const midX = (viewW - 1) / 2;
    const midY = (viewH - 1) / 2;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (absX < EPSILON) return { x: Math.round(midX), y: dy < 0 ? 0 : viewH - 1 };
    if (absY < EPSILON) return { x: dx < 0 ? 0 : viewW - 1, y: Math.round(midY) };

    const scale = Math.min(midX / absX, midY / absY);
    return {
      x: MathUtils.clamp(Math.round(midX + dx * scale), 0, viewW - 1),
      y: MathUtils.clamp(Math.round(midY + dy * scale), 0, viewH - 1),
    };
  }

  function _writeLabel(cells, label, point, dx, dy, charW, charH) {
    let row = point.y * 2;
    if (dy < -EPSILON) row = 0;
    if (dy > EPSILON) row = charH - 1;

    let col = point.x * 2 - Math.floor(label.length / 2);
    if (dx < -EPSILON && point.x === 0) col = 0;
    if (dx > EPSILON && point.x === Math.floor((charW - 1) / 2)) col = charW - label.length;
    col = MathUtils.clamp(col, 0, Math.max(0, charW - label.length));

    for (let i = 0; i < label.length; i++) {
      cells[row][col + i] = { char: label[i], color: COLOR };
    }
  }

  function getScreenCells({ cameraX, cameraY, viewW, viewH, charW, charH }) {
    const cells = _blank(charW, charH);
    if (!Datastore.has('planetMap') || !Datastore.has('playerPos')) return cells;

    const map = Datastore.get('planetMap');
    const player = Datastore.get('playerPos');
    const ship = _findShip();
    if (!ship || _isShipVisible(ship, map, cameraX, cameraY, viewW, viewH)) return cells;

    const center = _shipCenter(ship, map);
    const dx = _wrapDelta(player.x, center.x, map.w);
    const dy = _wrapDelta(player.y, center.y, map.h);
    if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return cells;

    const label = _arrowLabel(dx, dy);
    const point = _edgePoint(dx, dy, viewW, viewH);
    _writeLabel(cells, label, point, dx, dy, charW, charH);
    return cells;
  }

  return {
    id: ID,
    zIndex: 40,
    ignoreTint: true,
    getScreenCells,
  };
})();
