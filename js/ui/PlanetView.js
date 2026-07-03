// Planet surface view: screen lifecycle, player movement input, delegates rendering to subviews.
const PlanetView = (() => {
  const BASE_BINDINGS = [
    { key: 'Space', action: 'Wait' },
    { key: 'Tab',   action: 'Info' },
    { key: 'V',     action: 'View' },
    { key: 'I',     action: 'Pack' },
    { key: '1-4',   action: 'Use' },
  ];
  const BLOCKED_VIEW_BINDINGS = [
    { key: 'V', action: 'View' },
  ];
  const _renderModes = [TerrainRenderer, HeightmapRenderer, WeatherOverviewRenderer];

  let _el = null;
  let _mapContainer = null;
  let _keyHandler = null;
  let _keyUpHandler = null;
  let _tickInterval = null;
  let _renderModeIdx = 0;

  function init() {
    _el = document.getElementById('planet-view');
    _keyHandler   = _onKey;
    _keyUpHandler = _onKeyUp;
  }

  function show() {
    _el.innerHTML = '';
    _renderModeIdx = 0;

    const layoutEl = document.createElement('div');
    layoutEl.className = 'planet-layout';
    _el.appendChild(layoutEl);

    const timeBarEl = document.createElement('div');
    timeBarEl.id = 'planet-time-bar';
    layoutEl.appendChild(timeBarEl);

    _mapContainer = document.createElement('div');
    _mapContainer.className = 'map-container';
    layoutEl.appendChild(_mapContainer);

    const inspectorEl = document.createElement('div');
    inspectorEl.id = 'tile-inspector';
    layoutEl.appendChild(inspectorEl);

    const actionBarEl = document.createElement('div');
    actionBarEl.id = 'action-bar';
    layoutEl.appendChild(actionBarEl);

    PlanetSession.start({
      mapContainer: _mapContainer,
      timeBarEl,
      inspectorEl,
      actionBarEl,
      renderer: _renderModes[_renderModeIdx],
    });
    _mapContainer.addEventListener('click', _onMapClick);

    const contextBarEl = document.createElement('div');
    contextBarEl.id = 'context-bar';
    layoutEl.appendChild(contextBarEl);
    ContextBar.init(contextBarEl, { frame: 'bottom-cap', width: 80, inset: 2 });
    _refreshBindings();

    _el.style.display = 'block';
    document.addEventListener('keydown', _keyHandler);
    document.addEventListener('keyup', _keyUpHandler);
  }

  function hide() {
    document.removeEventListener('keydown', _keyHandler);
    document.removeEventListener('keyup', _keyUpHandler);
    _stopTickRepeat();
    if (_mapContainer) _mapContainer.removeEventListener('click', _onMapClick);
    ContextBar.destroy();
    PlanetSession.stop();
    _el.innerHTML = '';
    _el.style.display = 'none';
    _mapContainer = null;
  }

  function _onKey(e) {
    if (e.repeat) return;
    if (e.key === 'v' || e.key === 'V') {
      _renderModeIdx = (_renderModeIdx + 1) % _renderModes.length;
      MapView.setRenderer(_renderModes[_renderModeIdx]);
      TileInspector.onRendererChanged();
      _refreshBindings();
      return;
    }
    if (_renderModes[_renderModeIdx].blockInput) {
      if (Debug.isActive() && e.key === ' ') {
        e.preventDefault();
        TurnManager.tick();
        _startTickRepeat();
      }
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      const obj = _getInteractable();
      if (obj) _interact(obj);
      return;
    }
    if (e.key === 'i' || e.key === 'I') {
      InventoryPopup.open({ onClose: _refreshBindings });
      _refreshBindings();
      return;
    }
    if (e.key >= '1' && e.key <= '4') {
      const slotIndex = parseInt(e.key, 10) - 1;
      SuitModules.activate(slotIndex);
      ActionBar.refresh();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      TurnManager.tick();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      TileInspector.nextReadout();
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

    const pos = Datastore.get('playerPos');
    const map = Datastore.get('planetMap');
    const nx  = ((pos.x + dir.dx) % map.w + map.w) % map.w;
    const ny  = ((pos.y + dir.dy) % map.h + map.h) % map.h;

    if (!MapGen.isPassable(map.grid[ny][nx])) return;
    if (!ObjectManager.isPassable(nx, ny)) return;
    if (_weatherBlocksMove()) {
      TurnManager.tick();
      return;
    }

    Datastore.withLock('playerPos', () => ({ x: nx, y: ny }));
    TurnManager.tick();
    _refreshBindings();
  }

  // Interaction targets the player's own tile. Placeable equipment is passable,
  // so the player stands on it to pick up / drain / salvage it — no adjacency
  // ambiguity. The only adjacent fallback is for impassable interactables the
  // player can't stand on (the ship).
  function _getInteractable() {
    if (!Datastore.has('playerPos') || !Datastore.has('planetMap')) return null;
    const pos = Datastore.get('playerPos');
    const map = Datastore.get('planetMap');
    const own = ObjectManager.getAt(pos.x, pos.y);
    if (own && own.interactable) return own;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ((pos.x + dx) % map.w + map.w) % map.w;
        const ny = ((pos.y + dy) % map.h + map.h) % map.h;
        const obj = ObjectManager.getAt(nx, ny);
        if (obj && obj.interactable && !obj.passable) return obj;
      }
    }
    return null;
  }

  function _weatherBlocksMove() {
    const events = WeatherSystem.getEvents ? WeatherSystem.getEvents() : [];
    const legacyEvent = Datastore.has('weatherEvent') ? Datastore.get('weatherEvent') : null;
    const allEvents = events.length ? events : (legacyEvent ? [legacyEvent] : []);
    const penalty = MathUtils.clamp(
      allEvents.reduce((max, event) => Math.max(max, event?.movePenalty ?? 0), 0),
      0,
      0.5
    );
    return penalty > 0 && Math.random() < penalty;
  }

  function _interact(obj) {
    if (typeof obj.onInteract === 'function') {
      const result = obj.onInteract(obj, { playerPos: Datastore.get('playerPos') });
      if (result && result.consumed) {
        _refreshBindings();
        return;
      }
    }
    if (obj.type === 'parts-cache') { _openPartsCache(obj); return; }
    if (obj.type === 'beacon') { _showBeaconPopup(obj); return; }
    if (obj.carryable) {
      if (Recipes.forOutput(obj.itemId) && _hasPortableSalvager()) {
        _showSalvagePrompt(obj);
        return;
      }
      _pickUp(obj);
      return;
    }
    if (obj.type === 'ship') _enterShip();
  }

  function _pickUp(obj) {
    if (!Inventory.canAdd(obj.itemId)) return false;
    const def = Items.get(obj.itemId);
    if (def && def.stackable === false) {
      Inventory.add(obj.itemId, 1, { durability: obj.durability, maxDurability: obj.maxDurability });
    } else {
      Inventory.add(obj.itemId, 1);
    }
    ObjectManager.remove(obj.id);
    PowerSystem.resolve();
    _refreshBindings();
    return true;
  }

  function _hasPortableSalvager() {
    return SuitModules.getSlots().some(m => m === 'portable-salvager');
  }

  function _showSalvagePrompt(obj) {
    const name  = Items.get(obj.itemId)?.name ?? obj.type;
    const parts = SalvageSystem.previewReturns(obj.itemId).reduce((s, x) => s + x.count, 0);
    PopupManager.show({
      width: 44, height: 12, title: ' SALVAGE ', border: 'single',
      render(innerW) {
        function centeredHtml(text, color) {
          const pad = Math.max(0, Math.floor((innerW - text.length) / 2));
          return { html: Ascii.colorLine([{ text: ' '.repeat(pad) }, { text, color }], innerW) };
        }
        const partsLine = `returns ~${parts} components`;
        return [
          '',
          centeredHtml(name, Colors.itemColor(obj.itemId)),
          centeredHtml(partsLine, Colors.UI.grey),
          '',
          '─'.repeat(innerW),
          '',
          { ...centeredHtml('[ S  SALVAGE ]',  Colors.UI.yellow), clickable: true },
          { ...centeredHtml('[ P  PICK UP ]',  Colors.UI.cyan),   clickable: true },
          { ...centeredHtml('[ CANCEL ]  Esc', Colors.UI.grey),   clickable: true },
        ];
      },
      buttons: [
        () => { SalvageSystem.salvageObject(obj); _refreshBindings(); },
        () => { _pickUp(obj); },
        null,
      ],
      dismissKeys: ['Escape'],
      onKey(e) {
        if (e.key === 's' || e.key === 'S') { PopupManager.dismiss(); SalvageSystem.salvageObject(obj); _refreshBindings(); return true; }
        if (e.key === 'p' || e.key === 'P') { PopupManager.dismiss(); _pickUp(obj); return true; }
        return false;
      },
      onDismiss: _refreshBindings,
    });
  }

  function _openPartsCache(obj) {
    const cacheId = obj.id;
    CargoTransferPopup.openWith(PartsCacheObject.adapter(cacheId), {
      title: ' PARTS CACHE ',
      onClose: () => {
        if (PartsCacheObject.isEmpty(cacheId)) ObjectManager.remove(cacheId);
        _refreshBindings();
      },
    });
  }

  function _showBeaconPopup(obj) {
    const broken = Degradation.isBroken(obj);
    const pct    = Math.round(Degradation.fraction(obj) * 100);
    PopupManager.show({
      width: 46, height: 13, title: ' BEACON ', border: 'single',
      render(innerW) {
        function centeredHtml(text, color) {
          const pad = Math.max(0, Math.floor((innerW - text.length) / 2));
          return { html: Ascii.colorLine([{ text: ' '.repeat(pad) }, { text, color }], innerW) };
        }
        const recallText = broken ? '[ R  RECALL SHIP ]  worn out' : '[ R  RECALL SHIP ]';
        const recallCol  = broken ? Colors.UI.dim : Colors.UI.cyan;
        return [
          '',
          centeredHtml('Signal Beacon',        Colors.UI.bright),
          centeredHtml(`Condition: ${pct}%`,   Colors.pctColor(pct)),
          '',
          '─'.repeat(innerW),
          '',
          { ...centeredHtml(recallText,          recallCol),      clickable: true },
          { ...centeredHtml('[ P  PICK UP ]',    Colors.UI.cyan), clickable: true },
          { ...centeredHtml('[ CANCEL ]  Esc',   Colors.UI.grey), clickable: true },
        ];
      },
      buttons: [() => _recallToBeacon(obj), () => _pickUp(obj), null],
      dismissKeys: ['Escape'],
      onKey(e) {
        if (e.key === 'r' || e.key === 'R') { PopupManager.dismiss(); _recallToBeacon(obj); return true; }
        if (e.key === 'p' || e.key === 'P') { PopupManager.dismiss(); _pickUp(obj); return true; }
        return false;
      },
      onDismiss: _refreshBindings,
    });
  }

  function _recallToBeacon(obj) {
    const result = BeaconObject.recall(obj);
    if (result.ok) { _refreshBindings(); return; }
    _showNotice(' BEACON ', result.reason);
  }

  function _showNotice(title, message) {
    PopupManager.show({
      width: 46, height: 9, title, border: 'single',
      render(innerW) {
        function centeredHtml(text, color) {
          const pad = Math.max(0, Math.floor((innerW - text.length) / 2));
          return { html: Ascii.colorLine([{ text: ' '.repeat(pad) }, { text, color }], innerW) };
        }
        return [
          '',
          centeredHtml(message,       Colors.UI.grey),
          '',
          '─'.repeat(innerW),
          '',
          { ...centeredHtml('[ OK ]  Esc', Colors.UI.grey), clickable: true },
        ];
      },
      buttons: [null],
      dismissKeys: ['Escape', 'Enter', ' '],
      onDismiss: _refreshBindings,
    });
  }

  // Standing adjacent to the ship and pressing E steps straight into the interior;
  // all of the old ship-popup actions now live on equipment inside the hull.
  function _enterShip() {
    ScreenManager.show('interior-view', { type: 'crt' });
  }

  function _onMapClick(e) {
    if (!Debug.isActive() || !_renderModes[_renderModeIdx].isGlobalView) return;

    const rect    = _mapContainer.getBoundingClientRect();
    const relX    = e.clientX - rect.left;
    const relY    = e.clientY - rect.top;

    // Rendered grid is (charW+2) cols × (charH+2) rows; col/row 0 are border characters
    const { charW, charH } = MapView;
    const dataCol = Math.floor(relX / rect.width  * (charW + 2)) - 1;
    const dataRow = Math.floor(relY / rect.height * (charH + 2)) - 1;
    if (dataCol < 0 || dataCol >= charW || dataRow < 0 || dataRow >= charH) return;

    const map = Datastore.get('planetMap');
    const tx  = Math.min(map.w - 1, Math.floor(dataCol * map.w / charW));
    const ty  = Math.min(map.h - 1, Math.floor(dataRow * map.h / charH));

    Datastore.withLock('playerPos', () => ({ x: tx, y: ty }));
  }

  function _onKeyUp(e) {
    if (e.key === ' ') _stopTickRepeat();
  }

  function _startTickRepeat() {
    if (_tickInterval) return;
    _tickInterval = setInterval(() => {
      if (Debug.isActive() && _renderModes[_renderModeIdx].blockInput) {
        TurnManager.tick();
      } else {
        _stopTickRepeat();
      }
    }, Math.round(1000 / 3));
  }

  function _stopTickRepeat() {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }

  function _refreshBindings() {
    const renderer = _renderModes[_renderModeIdx];
    if (renderer.blockInput) {
      const bindings = [...BLOCKED_VIEW_BINDINGS];
      if (Debug.isActive()) bindings.push({ key: 'Space', action: 'Pass Time' });
      ContextBar.setBindings(bindings);
      return;
    }
    const bindings = [...BASE_BINDINGS];
    const target = _getInteractable();
    if (target) {
      const action = target.type === 'ship' ? 'Enter Ship'
                   : target.carryable        ? 'Pickup'
                   : 'Interact';
      bindings.push({ key: 'E', action });
    }
    ContextBar.setBindings(bindings);
  }

  return { init, show, hide };
})();
