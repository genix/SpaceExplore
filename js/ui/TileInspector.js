// Planet-side sidebar. Shows an always-on power spine plus a contextual readout.
const TileInspector = (() => {
  // _hoverTile states: a {x,y} tile = mouse over that tile; null = no active hover
  // (use the player's tile); OFF_MAP = mouse is over the panel but off the map grid.
  const OFF_MAP = Symbol('offMap');
  let _el           = null;
  let _mapContainer = null;
  let _moveHandler  = null;
  let _leaveHandler = null;
  let _unsubs       = [];
  let _modeIdx      = 0;
  let _hoverTile    = null;

  function init(mapContainer, inspectorEl) {
    if (_mapContainer) destroy();
    _el           = inspectorEl;
    _modeIdx      = 0;
    _hoverTile    = null;
    _mapContainer = mapContainer;
    _moveHandler  = e => _onMove(e);
    _leaveHandler = () => { _hoverTile = null; _refresh(); };

    _mapContainer.addEventListener('mousemove', _moveHandler);
    _mapContainer.addEventListener('mouseleave', _leaveHandler);
    _subscribe('dayPhase');
    _subscribe('playerSuit');
    _subscribe('playerInventory');
    _subscribe('weatherEvents');
    _subscribe('currentPlanet');
    if (Datastore.has('currentPlanet')) _subscribe(`objects:${Datastore.get('currentPlanet').id}`);
    // Moving the player (e.g. via keyboard) clears any stale hover so the readout
    // tracks the player's tile until the mouse moves again.
    if (Datastore.has('playerPos')) {
      _unsubs.push(Datastore.subscribe('playerPos', () => { _hoverTile = null; _refresh(); }));
    }
    _refresh();
  }

  function _subscribe(key) {
    if (!Datastore.has(key)) return;
    _unsubs.push(Datastore.subscribe(key, _refresh));
  }

  function destroy() {
    if (_mapContainer) {
      _mapContainer.removeEventListener('mousemove', _moveHandler);
      _mapContainer.removeEventListener('mouseleave', _leaveHandler);
    }
    for (const unsub of _unsubs) unsub();
    _unsubs = [];
    _el           = null;
    _mapContainer = null;
    _moveHandler  = null;
    _leaveHandler = null;
    _hoverTile    = null;
  }

  function nextReadout() {
    _modeIdx = (_modeIdx + 1) % InspectorFormat.MODES.length;
    _refresh();
  }

  function _onMove(e) {
    const renderer = MapView.getRenderer();
    const tile = renderer?.isGlobalView
      ? InspectorTargeting.hoverFromGlobal(_mapContainer, e)
      : InspectorTargeting.hoverFromViewport(_mapContainer, e);
    // A null tile here means the pointer is over the panel but off the map grid.
    _hoverTile = tile || OFF_MAP;
    _refresh();
  }

  function _refresh() {
    if (!_el) return;
    const pinned = InspectorFormat.MODES[_modeIdx].id;
    let readout;
    if (_hoverTile === OFF_MAP) {
      readout = [InspectorFormat.header('SCAN'), InspectorFormat.text('no map', InspectorFormat.C.dim)];
    } else {
      // _hoverTile is a tile (hover) or null (no hover -> player's tile).
      const mode = pinned === 'auto' ? InspectorReadouts.autoMode(_hoverTile) : pinned;
      readout = InspectorReadouts.readoutLines(mode, _hoverTile);
    }
    const mode = InspectorFormat.MODES[_modeIdx];
    const content = [
      InspectorFormat.panelHeader(mode.label, pinned === 'auto' ? InspectorFormat.C.cyan : InspectorFormat.C.yellow),
      ...InspectorReadouts.powerSpine(),
      '',
      ...readout,
    ].slice(0, InspectorFormat.H - 1);
    while (content.length < InspectorFormat.H - 1) content.push('');
    const lines = [...content, InspectorFormat.panelFooter()];
    _el.innerHTML = lines.map(InspectorFormat.renderLine).join('\n');
  }

  function onRendererChanged() {
    _hoverTile = null;
    _refresh();
  }

  return { init, destroy, nextReadout, onRendererChanged };
})();
