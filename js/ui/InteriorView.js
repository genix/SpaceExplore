// Ship interior screen: a navigable tile grid laid over the interior MapView, with
// a station sidebar and a context bar. Movement reads interiorPos/interiorMap; E
// interacts with the fixture the player stands beside, routing cargo / fabricate /
// salvage to the existing popups, the flight console to return-to-system / module
// configuration, and the airlock back to the planet surface.
const InteriorView = (() => {
  const STATION_LEGEND = [
    { glyph: '▛▜', label: 'Flight Console', color: '#5fd7af' },
    { glyph: '╔╗', label: 'Cargo Hold',  color: '#c8a85a' },
    { glyph: '▼─', label: 'Fabrication', color: '#55c8ff' },
    { glyph: '»─', label: 'Salvage',     color: '#ff9650' },
    { glyph: '╔╗', label: 'Aetherium',   color: '#a99bff' },
    { glyph: '◄►', label: 'Airlock',     color: '#c6d24a' },
  ];

  let _el           = null;
  let _mapContainer = null;
  let _infoEl       = null;
  let _keyHandler   = null;

  function init() {
    _el         = document.getElementById('interior-view');
    _keyHandler = _onKey;
  }

  function show() {
    _el.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'interior-layout';
    _el.appendChild(layout);

    const titleEl = document.createElement('div');
    titleEl.className = 'interior-titlebar';
    titleEl.textContent = ' SHIP INTERIOR';
    layout.appendChild(titleEl);

    _mapContainer = document.createElement('div');
    _mapContainer.className = 'map-container';
    layout.appendChild(_mapContainer);

    _infoEl = document.createElement('div');
    _infoEl.className = 'interior-info';
    layout.appendChild(_infoEl);

    InteriorSession.start({ mapContainer: _mapContainer });

    const contextEl = document.createElement('div');
    contextEl.className = 'interior-context';
    layout.appendChild(contextEl);
    ContextBar.init(contextEl, { frame: 'bottom-cap', width: 80, inset: 2 });

    _renderInfo();
    _refreshBindings();

    _el.style.display = 'block';
    document.addEventListener('keydown', _keyHandler);
  }

  function hide() {
    document.removeEventListener('keydown', _keyHandler);
    ContextBar.destroy();
    InteriorSession.stop();
    _el.innerHTML = '';
    _el.style.display = 'none';
    _mapContainer = null;
    _infoEl       = null;
  }

  function _onKey(e) {
    if (e.repeat) return;

    if (e.key === 'e' || e.key === 'E') {
      const obj = InteriorSession.interactableNear(Datastore.get('interiorPos'));
      if (obj) _interact(obj);
      return;
    }

    const dirs = {
      ArrowUp:    { dx:  0, dy: -1 },
      ArrowDown:  { dx:  0, dy:  1 },
      ArrowLeft:  { dx: -1, dy:  0 },
      ArrowRight: { dx:  1, dy:  0 },
    };
    const dir = dirs[e.key];
    if (!dir) return;
    e.preventDefault();

    const pos = Datastore.get('interiorPos');
    const nx  = pos.x + dir.dx;
    const ny  = pos.y + dir.dy;
    if (!InteriorSession.isPassable(nx, ny)) return;

    Datastore.withLock('interiorPos', () => ({ x: nx, y: ny }));
    TurnManager.tick();
    _renderInfo();
    _refreshBindings();
  }

  function _interact(obj) {
    switch (obj.action) {
      case 'cargo':     CargoTransferPopup.open({ onClose: _afterPopup }); break;
      case 'fabricate': FabricatePopup.open({ onClose: _afterPopup });     break;
      case 'salvage':   SalvagePopup.open({ onClose: _afterPopup });       break;
      case 'console':   _showConsolePopup();                               break;
      case 'engine':    _showEnginePopup();                                break;
      case 'airlock':   _exitToSurface();                                  break;
    }
  }

  function _exitToSurface() {
    ScreenManager.show('planet-view', { type: 'crt' });
  }

  function _showConsolePopup() {
    PopupManager.show({
      width: 46, height: 14, title: ' FLIGHT CONSOLE ', border: 'single',
      render(innerW) {
        function centered(text, color) {
          const pad = Math.max(0, Math.floor((innerW - text.length) / 2));
          return { html: Ascii.colorLine([{ text: ' '.repeat(pad) }, { text, color }], innerW) };
        }
        return [
          '',
          centered('Helm Control',              Colors.UI.bright),
          centered('Engine: NOMINAL  Nav: READY', Colors.UI.green),
          '',
          '─'.repeat(innerW),
          '',
          { ...centered('[ S  RETURN TO SYSTEM ]',  Colors.UI.yellow), clickable: true },
          { ...centered('[ M  CONFIGURE MODULES ]', Colors.UI.cyan),   clickable: true },
          '',
          { ...centered('[ CANCEL ]  Esc', Colors.UI.grey), clickable: true },
        ];
      },
      buttons: [_returnToSystem, _openModuleSwap, null],
      dismissKeys: ['Escape'],
      onKey(e) {
        if (e.key === 's' || e.key === 'S') { _returnToSystem(); return true; }
        if (e.key === 'm' || e.key === 'M') { _openModuleSwap(); return true; }
        return false;
      },
      onDismiss: _afterPopup,
    });
  }

  function _openModuleSwap() {
    PopupManager.dismiss();
    ModuleSwapPopup.open({ onClose: _afterPopup });
  }

  // Return to the solar system from inside the ship. The planet surface is already
  // torn down (PlanetSession stopped on entry), so ObjectManager is unmounted —
  // remove the ship record straight from its Datastore namespace instead.
  function _returnToSystem() {
    PopupManager.dismiss();
    if (Datastore.has('currentPlanet')) {
      const key = `objects:${Datastore.get('currentPlanet').id}`;
      if (Datastore.has(key)) {
        Datastore.withLock(key, objs => objs.filter(o => o.id !== 'ship-1'));
      }
    }
    ScreenManager.show('solar-system-screen', {
      type: 'handoff',
      direction: 'up',
      afterSwap() {
        if (Datastore.has('playerPos')) Datastore.remove('playerPos');
      },
    });
  }

  function _afterPopup() {
    _renderInfo();
    _refreshBindings();
  }

  function _showEnginePopup() {
    const aetherium = Datastore.has('aetherium') ? Datastore.get('aetherium') : 0;
    PopupManager.show({
      width: 46, height: 13, title: ' AETHERIUM CORE ', border: 'single',
      render(innerW) {
        function centered(text, color) {
          const pad = Math.max(0, Math.floor((innerW - text.length) / 2));
          return { html: Ascii.colorLine([{ text: ' '.repeat(pad) }, { text, color }], innerW) };
        }
        return [
          '',
          centered('Hyperdrive Reactor',        Colors.UI.bright),
          centered(`Aetherium fuel: ${aetherium.toFixed(1)}`, '#a99bff'),
          centered('Engine        : NOMINAL',   Colors.UI.green),
          '',
          '─'.repeat(innerW),
          '',
          centered('Return to the system from',  Colors.UI.grey),
          centered('the Flight Console.',        Colors.UI.grey),
          '',
          { ...centered('[ OK ]  Esc', Colors.UI.grey), clickable: true },
        ];
      },
      buttons: [null],
      dismissKeys: ['Escape', 'Enter', ' '],
      onDismiss: _afterPopup,
    });
  }

  function _refreshBindings() {
    const bindings = [
      { key: 'Arrows', action: 'Move' },
    ];
    const obj = InteriorSession.interactableNear(Datastore.get('interiorPos'));
    if (obj) bindings.push({ key: 'E', action: obj.hint });
    ContextBar.setBindings(bindings);
  }

  function _renderInfo() {
    if (!_infoEl) return;
    const near = InteriorSession.interactableNear(Datastore.get('interiorPos'));
    const lines = [
      { text: ' SHIP INTERIOR', color: Colors.UI.cyan },
      { text: ' ─────────────', color: Colors.UI.dim },
      { text: '' },
      { text: ' Hull · Deck 1', color: Colors.UI.grey },
      { text: '' },
      { text: ' STATIONS', color: Colors.UI.yellow },
    ];
    for (const s of STATION_LEGEND) {
      lines.push({ text: `  ${s.glyph} ${s.label}`, color: s.color });
    }
    lines.push({ text: '' });
    if (near) {
      lines.push({ text: ' ► ' + near.label, color: Colors.UI.green });
      lines.push({ text: '   E to use', color: Colors.UI.grey });
    } else {
      lines.push({ text: ' Move with arrows', color: Colors.UI.grey });
      lines.push({ text: ' to a station.', color: Colors.UI.grey });
    }
    _infoEl.innerHTML = lines.map(l => Ascii.span(l.text, l.color || Colors.UI.grey)).join('\n');
  }

  return { init, show, hide };
})();
