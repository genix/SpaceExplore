// Shared tiny blinking background stars for fixed-size ASCII views.
const Starfield = (() => {
  function create(cols, rows, count, options = {}) {
    const exclude = options.exclude || (() => false);
    const stars = [];
    const occupied = new Set();
    let attempts = count * 10;

    while (stars.length < count && attempts-- > 0) {
      const row = Math.floor(Math.random() * rows);
      const col = Math.floor(Math.random() * cols);
      const key = `${row},${col}`;
      if (occupied.has(key) || exclude(row, col)) continue;
      occupied.add(key);
      stars.push({ row, col, lit: Math.random() > 0.5 });
    }

    return stars;
  }

  function paint(grid, stars, options = {}) {
    const litColor = options.litColor || '#7799aa';
    const dimColor = options.dimColor || '#334455';
    const glyph = options.glyph || '.';

    for (const s of stars) {
      const row = grid[s.row];
      if (!row || !row[s.col] || row[s.col].char !== ' ') continue;
      row[s.col] = { char: glyph, color: s.lit ? litColor : dimColor };
    }
  }

  function tick(stars, chance = 0.12) {
    let changed = false;
    for (const s of stars) {
      if (Math.random() < chance) {
        s.lit = !s.lit;
        changed = true;
      }
    }
    return changed;
  }

  return { create, paint, tick };
})();
