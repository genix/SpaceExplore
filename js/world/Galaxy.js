// Galaxy generation: banded system placement, starlanes, system-state tracking, ASCII canvas renderer.
// Precondition: SolarSystem must be loaded before this module.
const Galaxy = (() => {

  const STAR_NAMES = [
    'Kerath', 'Vela',   'Solnar', 'Auris',  'Tyven',
    'Carinn', 'Delun',  'Ferox',  'Glaes',  'Harek',
    'Idris',  'Jarnak', 'Koreth', 'Lumis',  'Mydra',
    'Neros',  'Ophen',  'Pyrek',  'Qualis', 'Ruthis',
    'Aelon',  'Brath',  'Centar', 'Duvex',  'Envos',
    'Fexar',  'Galvon', 'Hurek',  'Imoth',  'Jyrex',
  ];

  const GALAXY_PREFIXES = ['Outer', 'Inner', 'Far', 'Deep', 'Lost', 'Ancient'];
  const GALAXY_SUFFIXES = ['Reach', 'Expanse', 'Void', 'Spiral', 'Drift', 'Arc'];

  const STAR_GLYPHS  = { M: '.', K: '*', G: '+', F: '@' };
  const SYSTEM_COLOR = {
    unknown:   '#555577',
    unvisited: '#88aaff',
    visited:   '#ffffff',
    current:   '#ffff55',
    selected:  '#55ffff',
  };

  const LANE_COLOR       = '#335588';  // lanes from the current system (legal moves)
  const LANE_DEST_COLOR  = '#88bbff';  // highlighted lane to the selected destination
  const LANE_FAINT_COLOR = '#223a4a';  // onward preview from a visited selected system
  const LANE_CHARS       = new Set(['-', '|', '\\', '/']);

  const CANVAS_W = 54;
  const CANVAS_H = 44;
  const CENTER_X = Math.floor(CANVAS_W / 2);
  const CENTER_Y = Math.floor(CANVAS_H / 2);
  const Y_SCALE  = 0.72;
  const MARGIN   = 2;
  const BANDS = [
    { min: 3, max: 3, rMin: 3,  rMax: 5,  jitter: 0.35 },
    { min: 5, max: 5, rMin: 8,  rMax: 11, jitter: 0.25 },
    { min: 6, max: 8, rMin: 14, rMax: 17, jitter: 0.18 },
    { min: 2, max: 3, rMin: 20, rMax: 23, jitter: 0.14 },
  ];

  function generate() {
    const namePool = _shuffle([...STAR_NAMES]);
    const stubs    = _placeSystems();

    const systems = stubs.map((stub, i) => {
      const sys     = SolarSystem.generate();
      const name    = namePool[i] || ('Star' + (i + 1));
      sys.star.name = name;
      sys.name      = name + ' System';
      sys.mapPos    = stub.mapPos;
      sys.galaxyBand = stub.bandIndex;
      sys.galaxyAngle = stub.angle;
      return sys;
    });

    const coreSystems = systems.filter(s => s.galaxyBand === 0);
    const startSystem = coreSystems.find(s => s.planets.some(p => p.landable))
                     || systems.find(s => s.planets.some(p => p.landable))
                     || systems[0];

    const connections  = _buildConnections(systems);
    const systemStates = {};
    for (const s of systems) systemStates[s.id] = 'unknown';
    systemStates[startSystem.id] = 'visited';
    for (const e of connections) {
      if (e.from === startSystem.id && systemStates[e.to]   === 'unknown') systemStates[e.to]   = 'unvisited';
      if (e.to   === startSystem.id && systemStates[e.from] === 'unknown') systemStates[e.from] = 'unvisited';
    }

    return {
      id: 'gal_' + _uid(),
      name: _pick(GALAXY_PREFIXES) + ' ' + _pick(GALAXY_SUFFIXES),
      systems,
      connections,
      startSystemId: startSystem.id,
      systemStates,
    };
  }

  function _placeSystems() {
    const stubs = [];

    for (let bandIndex = 0; bandIndex < BANDS.length; bandIndex++) {
      const band = BANDS[bandIndex];
      const count = _randInt(band.min, band.max);
      const offset = Math.random() * Math.PI * 2;

      for (let i = 0; i < count; i++) {
        let angle = offset + i / count * Math.PI * 2 + _randFloat(-band.jitter, band.jitter);
        let radius = _randFloat(band.rMin, band.rMax);
        let mapPos = _bandPoint(angle, radius);

        for (let attempt = 0; attempt < 10 && _tooClose(mapPos, stubs, bandIndex); attempt++) {
          angle += _randFloat(0.25, 0.55);
          radius = _randFloat(band.rMin, band.rMax);
          mapPos = _bandPoint(angle, radius);
        }

        stubs.push({ mapPos, bandIndex, angle });
      }
    }

    return stubs;
  }

  function _bandPoint(angle, radius) {
    return {
      x: MathUtils.clamp(Math.round(CENTER_X + Math.cos(angle) * radius), MARGIN, CANVAS_W - MARGIN - 1),
      y: MathUtils.clamp(Math.round(CENTER_Y + Math.sin(angle) * radius * Y_SCALE), MARGIN, CANVAS_H - MARGIN - 1),
    };
  }

  function _tooClose(mapPos, stubs, bandIndex) {
    const minDist = bandIndex === 0 ? 4 : 3;
    return stubs.some(stub => _dist(mapPos, stub.mapPos) < minDist);
  }

  function _buildConnections(systems) {
    if (systems.length < 2) return [];
    const edges = [];
    const connected = {};
    for (const s of systems) connected[s.id] = new Set();

    function addEdge(a, b) {
      if (!a || !b || a.id === b.id || connected[a.id].has(b.id)) return;
      edges.push({ from: a.id, to: b.id });
      connected[a.id].add(b.id);
      connected[b.id].add(a.id);
    }

    for (let bandIndex = 0; bandIndex < BANDS.length; bandIndex++) {
      const bandSystems = systems
        .filter(s => s.galaxyBand === bandIndex)
        .sort((a, b) => a.galaxyAngle - b.galaxyAngle);

      for (let i = 0; i < bandSystems.length - 1; i++) addEdge(bandSystems[i], bandSystems[i + 1]);

      if (bandIndex === 0) continue;
      const inward = systems.filter(s => s.galaxyBand === bandIndex - 1);
      for (const sys of bandSystems) {
        const nearest = inward
          .slice()
          .sort((a, b) => _dist(sys.mapPos, a.mapPos) - _dist(sys.mapPos, b.mapPos))[0];
        addEdge(sys, nearest);
      }
    }

    return edges;
  }

  // Marks a system visited and reveals its still-unknown neighbors. Mutates the
  // passed galaxy; callers wrap the write in Datastore.withLock. Never downgrades
  // an already-visited system.
  function arriveAt(galaxy, systemId) {
    galaxy.systemStates[systemId] = 'visited';
    for (const conn of galaxy.connections) {
      let other = null;
      if (conn.from === systemId)    other = conn.to;
      else if (conn.to === systemId) other = conn.from;
      if (other && galaxy.systemStates[other] === 'unknown') {
        galaxy.systemStates[other] = 'unvisited';
      }
    }
    return galaxy;
  }

  // Connected systems in starlane order, deduped. Optionally drops unknown ones.
  function neighborsOf(galaxy, systemId, { knownOnly = false } = {}) {
    const seen = new Set();
    const out = [];
    for (const conn of galaxy.connections) {
      let nId = null;
      if (conn.from === systemId)    nId = conn.to;
      else if (conn.to === systemId) nId = conn.from;
      if (!nId || seen.has(nId)) continue;
      seen.add(nId);
      if (knownOnly && (galaxy.systemStates[nId] || 'unknown') === 'unknown') continue;
      const sys = galaxy.systems.find(s => s.id === nId);
      if (sys) out.push(sys);
    }
    return out;
  }

  function render(galaxy, options = {}) {
    return renderCells(galaxy, options).map(row => row.map(cell => cell.char).join(''));
  }

  function renderCells(galaxy, options = {}) {
    const currentSystemId = options.currentSystemId || galaxy.startSystemId;
    const canvas = Array.from({ length: CANVAS_H }, () =>
      Array.from({ length: CANVAS_W }, () => ({ char: ' ', color: '#aaaaaa' })));

    if (options.backgroundStars && typeof Starfield !== 'undefined') {
      Starfield.paint(canvas, options.backgroundStars, {
        litColor: '#667788',
        dimColor: '#253244',
      });
    }

    const selectedSystemId = options.selectedSystemId || null;
    const isSelectionElsewhere = selectedSystemId && selectedSystemId !== currentSystemId;
    const selectedVisited = isSelectionElsewhere &&
      (galaxy.systemStates[selectedSystemId] || 'unknown') === 'visited';
    const posOf = id => {
      const s = galaxy.systems.find(x => x.id === id);
      return s ? s.mapPos : null;
    };
    const drawLane = (aId, bId, color) => {
      const a = posOf(aId), b = posOf(bId);
      if (a && b) _renderLine(canvas, a.x, a.y, b.x, b.y, color);
    };
    const touches = (conn, id) => conn.from === id || conn.to === id;

    // Painted faint-first so brighter lanes win on shared cells.
    if (selectedVisited) {
      for (const conn of galaxy.connections) {
        if (!touches(conn, selectedSystemId) || touches(conn, currentSystemId)) continue;
        drawLane(conn.from, conn.to, LANE_FAINT_COLOR);
      }
    }
    for (const conn of galaxy.connections) {
      if (!touches(conn, currentSystemId)) continue;
      if (isSelectionElsewhere && touches(conn, selectedSystemId)) continue;
      drawLane(conn.from, conn.to, LANE_COLOR);
    }
    if (isSelectionElsewhere &&
        galaxy.connections.some(c => touches(c, currentSystemId) && touches(c, selectedSystemId))) {
      drawLane(currentSystemId, selectedSystemId, LANE_DEST_COLOR);
    }

    for (const sys of galaxy.systems) {
      const state = galaxy.systemStates[sys.id] || 'unknown';
      const { x, y } = sys.mapPos;
      if (y < 0 || y >= CANVAS_H || x < 0 || x >= CANVAS_W) continue;

      const glyph      = STAR_GLYPHS[sys.star.spectralClass] || '.';
      const isCurrent  = sys.id === currentSystemId;
      const isSelected = !isCurrent && sys.id === selectedSystemId;

      if (isCurrent || isSelected) {
        const color = isCurrent ? SYSTEM_COLOR.current : SYSTEM_COLOR.selected;
        if (x - 1 >= 0)       canvas[y][x - 1] = { char: '[', color };
        canvas[y][x] = { char: glyph, color };
        if (x + 1 < CANVAS_W) canvas[y][x + 1] = { char: ']', color };
        if (isCurrent || state === 'visited') _writeName(canvas, y, x + 2, sys.star.name, color);
      } else {
        const color = SYSTEM_COLOR[state] || SYSTEM_COLOR.unknown;
        canvas[y][x] = { char: glyph, color };
        if (state === 'visited') _writeName(canvas, y, x + 1, sys.star.name, color);
      }
    }

    return canvas;
  }

  function _writeName(canvas, y, startX, name, color) {
    for (let i = 0; i < name.length && startX + i < CANVAS_W; i++)
      canvas[y][startX + i] = { char: name[i], color };
  }

  function _renderLine(canvas, x0, y0, x1, y1, color = LANE_COLOR) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err  = dx - dy;
    let x = x0, y = y0;

    while (true) {
      if (x === x1 && y === y1) break;

      const prevX = x, prevY = y;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx)  { err += dx; y += sy; }

      if (x === x1 && y === y1) break;

      if (x >= 0 && x < CANVAS_W && y >= 0 && y < CANVAS_H &&
          (canvas[y][x].char === ' ' || canvas[y][x].char === '.' || LANE_CHARS.has(canvas[y][x].char))) {
        const mx = x - prevX, my = y - prevY;
        let ch;
        if (my === 0)      ch = '-';
        else if (mx === 0) ch = '|';
        else               ch = mx * my > 0 ? '\\' : '/';
        canvas[y][x] = { char: ch, color };
      }
    }
  }

  function _dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function _pick(arr)          { return arr[Math.floor(Math.random() * arr.length)]; }
  function _randInt(min, max)  { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function _randFloat(min, max) { return Math.random() * (max - min) + min; }
  function _uid()              { return Math.random().toString(36).substr(2, 8); }
  function _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  return { generate, render, renderCells, arriveAt, neighborsOf };
})();
