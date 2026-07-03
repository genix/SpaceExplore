// Two-pane transfer popup. The left pane is always the player's suit inventory;
// the right pane is a pluggable container adapter — ship cargo via open(), or
// any other container (e.g. a Parts Cache) via openWith(). Enter moves a whole
// stack (or a single equipment instance, durability intact) to the other side;
// refused if the destination lacks capacity.
const CargoTransferPopup = (() => {
  const WIDTH      = 56;
  const HEIGHT     = 24;
  const FOCUS_MARK = Ascii.FOCUS_MARK;

  const _suit = {
    label:       'SUIT',
    getItems:    Inventory.getItems,
    getUsedSize: Inventory.getUsedSize,
    getMaxSize:  Inventory.getMaxSize,
    canAdd:      Inventory.canAdd,
    add:         Inventory.add,
    remove:      Inventory.remove,
    removeByUid: Inventory.removeByUid,
  };
  const _ship = {
    label:       'SHIP',
    getItems:    ShipCargo.getItems,
    getUsedSize: ShipCargo.getUsedSize,
    getMaxSize:  ShipCargo.getMaxSize,
    canAdd:      ShipCargo.canAdd,
    add:         ShipCargo.add,
    remove:      ShipCargo.remove,
    removeByUid: ShipCargo.removeByUid,
  };

  let _left          = _suit;
  let _right         = _ship;
  let _title         = ' CARGO TRANSFER ';
  let _dismissKeys   = ['Escape', 't', 'T'];
  let _focusIndex    = 0;
  let _navList       = [];
  let _buttonActions = [];

  function open(cfg = {}) {
    _right       = _ship;
    _title       = ' CARGO TRANSFER ';
    _dismissKeys = ['Escape', 't', 'T'];
    _show(cfg);
  }

  function openWith(rightAdapter, cfg = {}) {
    _right       = rightAdapter;
    _title       = cfg.title || ' TRANSFER ';
    _dismissKeys = ['Escape'];
    _show(cfg);
  }

  function _show(cfg) {
    _left = _suit;
    _buildNavList();
    if (_focusIndex >= _navList.length) _focusIndex = 0;
    PopupManager.show({
      width:            WIDTH,
      height:           HEIGHT,
      title:            _title,
      border:           'single',
      render:           _render,
      buttons:          _buttonActions,
      keepOpenOnButton: true,
      dismissKeys:      _dismissKeys,
      onKey:            _onKey,
      onDismiss:        cfg.onClose || null,
    });
  }

  function _buildNavList() {
    _navList = [];
    for (const e of _left.getItems())  _navList.push({ pane: 'left',  itemId: e.itemId, count: e.count, uid: e.uid ?? null, durability: e.durability ?? null, maxDurability: e.maxDurability ?? null });
    for (const e of _right.getItems()) _navList.push({ pane: 'right', itemId: e.itemId, count: e.count, uid: e.uid ?? null, durability: e.durability ?? null, maxDurability: e.maxDurability ?? null });
    if (_focusIndex >= _navList.length) _focusIndex = Math.max(0, _navList.length - 1);
  }

  function _containerHeader(container, innerW) {
    const used = container.getUsedSize();
    const max  = container.getMaxSize();
    const pct  = max > 0 ? Math.round((used / max) * 100) : 100;
    return { html: Ascii.colorLine([
      { text: '  ' },
      { text: container.label.padEnd(5), color: Colors.UI.cyan },
      { text: ' used ', color: Colors.UI.grey },
      { text: `${used}/${max}`, color: Colors.pctColor(pct) },
    ], innerW) };
  }

  function _render(innerW, innerH) {
    _buttonActions.length = 0;
    const lines = [];

    lines.push(_containerHeader(_left, innerW));
    const barL = Ascii.colorBar(_left.getUsedSize(), _left.getMaxSize(), 32);
    lines.push({ html: '  ' + barL + ' '.repeat(Math.max(0, innerW - 2 - 32 - 2)) });
    const leftItems = _left.getItems();
    if (leftItems.length === 0) lines.push(Ascii.pad('    (empty)', innerW));
    else for (let i = 0; i < leftItems.length; i++) _appendRow(lines, _idxFor('left', i), innerW, '→');

    lines.push('─'.repeat(innerW));

    lines.push(_containerHeader(_right, innerW));
    const barR = Ascii.colorBar(_right.getUsedSize(), _right.getMaxSize(), 32);
    lines.push({ html: '  ' + barR + ' '.repeat(Math.max(0, innerW - 2 - 32 - 2)) });
    const rightItems = _right.getItems();
    if (rightItems.length === 0) lines.push(Ascii.pad('    (empty)', innerW));
    else for (let i = 0; i < rightItems.length; i++) _appendRow(lines, _idxFor('right', i), innerW, '←');

    while (lines.length < innerH - 2) lines.push('');
    lines.push('─'.repeat(innerW));
    lines.push({ html: Ascii.colorLine([{ text: '  ↑↓:Nav  Enter:Transfer all  Esc:Close', color: Colors.UI.grey }], innerW) });
    return lines;
  }

  function _idxFor(pane, paneIndex) {
    if (pane === 'left') return paneIndex;
    return _left.getItems().length + paneIndex;
  }

  function _appendRow(lines, navIndex, innerW, arrow) {
    const row = _navList[navIndex];
    if (!row) return;
    const def     = Items.get(row.itemId);
    const name    = def ? def.name : row.itemId;
    const focused = navIndex === _focusIndex;
    const isInstanced = row.uid != null && row.maxDurability;
    const pct     = isInstanced ? Math.round(MathUtils.clamp(row.durability / row.maxDurability, 0, 1) * 100) : null;
    const qtyStr  = isInstanced ? `${String(pct).padStart(3)}%` : `x ${row.count}`;
    const qtyCol  = isInstanced ? Colors.pctColor(pct) : Colors.UI.grey;
    const markSeg = focused ? { text: ` ${FOCUS_MARK} `, color: Colors.UI.green } : { text: '   ' };
    const html = Ascii.colorPair(
      [markSeg, { text: name, color: Colors.itemColor(row.itemId) }],
      [{ text: `${arrow}  ${qtyStr}`, color: qtyCol }],
      innerW,
    );
    lines.push({ html, clickable: true });
    _buttonActions.push(() => { _focusIndex = navIndex; _transfer(navIndex); });
  }

  function _onKey(e) {
    if (e.key === 'ArrowUp')   { _moveFocus(-1); PopupManager.redraw(); return true; }
    if (e.key === 'ArrowDown') { _moveFocus( 1); PopupManager.redraw(); return true; }
    if (e.key === 'Enter' || e.key === ' ') { _transfer(_focusIndex); return true; }
    return false;
  }

  function _moveFocus(delta) {
    if (_navList.length === 0) return;
    _focusIndex = (_focusIndex + delta + _navList.length) % _navList.length;
  }

  function _transfer(navIndex) {
    const row = _navList[navIndex];
    if (!row) return;
    const src = row.pane === 'left' ? _left : _right;
    const dst = row.pane === 'left' ? _right : _left;
    if (row.uid != null) {
      if (!dst.canAdd(row.itemId, 1)) return;
      dst.add(row.itemId, 1, { durability: row.durability, maxDurability: row.maxDurability });
      src.removeByUid(row.uid);
    } else {
      if (!dst.canAdd(row.itemId, row.count)) return;
      dst.add(row.itemId, row.count);
      src.remove(row.itemId, row.count);
    }
    _buildNavList();
    PopupManager.redraw();
  }

  return { open, openWith };
})();
