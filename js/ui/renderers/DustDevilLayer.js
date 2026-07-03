// MapView layer (zIndex 8: above terrain/objects at 5, below weather at 10) that
// draws each dust devil as a spinning ring. Cells are a pure function of position
// relative to the devil centre and Date.now() — no per-tile animation state to
// keep, so a moving devil leaves no stale tiles behind. Reads devils straight from
// the 'dustDevils' Datastore key that DustDevilSystem maintains.
//
// The footprint is split by normalized distance t = r / radius:
//   t >= 0.65  outer ring  — '/ \ - |' rotated per quadrant to read as a vortex
//   t >= 0.30  mid cloud   — staggered '.'/':' flicker of swirling dust
//   t <  0.30  eye         — rendered empty
const DustDevilLayer = (() => {
  const OUTER_CHARS = ['/', '\\', '-', '|'];
  const RING_COLOR  = '#cc8833';
  const CLOUD_COLOR = '#997722';

  function getScreenCells({ cameraX, cameraY, viewW, viewH, charW, charH }) {
    const cells = Array.from({ length: charH }, () => new Array(charW).fill(null));
    if (!Datastore.has('dustDevils') || !Datastore.has('planetMap')) return cells;
    const devils = Datastore.get('dustDevils');
    if (!devils || devils.length === 0) return cells;

    const map  = Datastore.get('planetMap');
    const mapW = map.w;
    const mapH = map.h;
    const now       = Date.now();
    const spinPhase = Math.floor(now / 150) % 4;   // one full rotation every 600ms
    const midPhase  = Math.floor(now / 250);

    for (const d of devils) {
      const R = d.radius;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const r = Math.sqrt(dx * dx + dy * dy);
          if (r > R) continue;
          const t = r / R;
          if (t < 0.30) continue;   // eye

          const wx  = ((d.x + dx) % mapW + mapW) % mapW;
          const wy  = ((d.y + dy) % mapH + mapH) % mapH;
          const stx = ((wx - cameraX) % mapW + mapW) % mapW;
          const sty = ((wy - cameraY) % mapH + mapH) % mapH;
          if (stx >= viewW || sty >= viewH) continue;
          const sc = stx * 2;
          const sr = sty * 2;

          let char, color;
          if (t >= 0.65) {
            const sector = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 2)) % 4;
            char  = OUTER_CHARS[(sector + spinPhase) % 4];
            color = RING_COLOR;
          } else {
            const tileHash = (wx * 3 + wy * 7) % 2;
            char  = (midPhase + tileHash) % 2 === 0 ? '.' : ':';
            color = CLOUD_COLOR;
          }

          const cell = { char, color };
          cells[sr][sc] = cell;
          if (sc + 1 < charW)                     cells[sr][sc + 1]     = cell;
          if (sr + 1 < charH)                     cells[sr + 1][sc]     = cell;
          if (sc + 1 < charW && sr + 1 < charH)   cells[sr + 1][sc + 1] = cell;
        }
      }
    }
    return cells;
  }

  return { id: 'dust-devils', zIndex: 8, ignoreTint: false, getScreenCells };
})();
