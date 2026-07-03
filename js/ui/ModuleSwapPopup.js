// Module swap popup: 4 slot rows + inventory module rows. Up/Down navigates;
// Enter on a filled slot uninstalls; Enter on an inventory row installs into
// the first empty slot. Opened from the ship popup.
const ModuleSwapPopup = (() => {
  const WIDTH      = 50;
  const HEIGHT     = 22;
  const FOCUS_MARK = Ascii.FOCUS_MARK;

  let _focusIndex    = 0;
  let _navList       = [];
  let _buttonActions = [];

  function open(cfg = {}) {
    _buildNavList();
    if (_focusIndex >= _navList.length) _focusIndex = 0;
    PopupManager.show({
      width:            WIDTH,
      height:           HEIGHT,
      title:            ' SUIT MODULES ',
      border:           'single',
      render:           _render,
      buttons:          _buttonActions,
      keepOpenOnButton: true,
      dismissKeys:      ['Escape', 'm', 'M'],
      onKey:            _onKey,
      onDismiss:        cfg.onClose || null,
    });
  }

  function _buildNavList() {
    _navList = [];
    const count = SuitModules.getSlotCount();
    const slots = SuitModules.getSlots();
    for (let i = 0; i < count; i++) {
      _navList.push({ type: 'slot', index: i, moduleId: slots[i] });
    }
    const items = Inventory.getItems();
    const modules = items
      .map(e => ({ itemId: e.itemId, count: e.count, def: Items.get(e.itemId) }))
      .filter(e => e.def?.moduleSpec);
    for (const m of modules) {
      _navList.push({ type: 'item', itemId: m.itemId, count: m.count });
    }
    if (_focusIndex >= _navList.length) _focusIndex = Math.max(0, _navList.length - 1);
  }

  function _render(innerW, innerH) {
    _buttonActions.length = 0;
    const lines = [];

    lines.push({ html: Ascii.colorLine([{ text: '  SLOTS', color: Colors.UI.cyan }], innerW) });
    for (let i = 0; i < SuitModules.getSlotCount(); i++) {
      _appendRow(lines, i, innerW);
    }

    lines.push('─'.repeat(innerW));
    lines.push({ html: Ascii.colorLine([{ text: '  INVENTORY (modules)', color: Colors.UI.cyan }], innerW) });

    const invStart = SuitModules.getSlotCount();
    if (_navList.length <= invStart) {
      lines.push(Ascii.pad('     (no modules in inventory)', innerW));
    } else {
      for (let i = invStart; i < _navList.length; i++) _appendRow(lines, i, innerW);
    }

    while (lines.length < innerH - 2) lines.push('');
    lines.push('─'.repeat(innerW));
    lines.push({ html: Ascii.colorLine([{ text: '  ↑↓:Nav   Enter:Install/Uninstall   M/Esc:Close', color: Colors.UI.grey }], innerW) });

    return lines;
  }

  function _appendRow(lines, navIndex, innerW) {
    const row     = _navList[navIndex];
    const focused = navIndex === _focusIndex;
    const markSeg = focused ? { text: ` ${FOCUS_MARK} `, color: Colors.UI.green } : { text: '   ' };

    if (row.type === 'slot') {
      const slotLabel = `Slot ${row.index + 1}`;
      if (row.moduleId) {
        const def    = Items.get(row.moduleId);
        const name   = def ? def.name : row.moduleId;
        const cost   = def?.moduleSpec?.batteryCost ?? 0;
        const modCol = Colors.itemColor(row.moduleId);
        const html = Ascii.colorPair(
          [markSeg, { text: `${slotLabel}  `, color: Colors.UI.grey }, { text: name, color: modCol }],
          [{ text: `(-${cost})`, color: Colors.UI.yellow }],
          innerW,
        );
        lines.push({ html, clickable: true });
        _buttonActions.push(() => { _focusIndex = navIndex; _uninstall(row.index); });
      } else {
        const html = Ascii.colorPair(
          [markSeg, { text: `${slotLabel}  `, color: Colors.UI.grey }, { text: '--  empty', color: Colors.UI.dim }],
          [],
          innerW,
        );
        lines.push({ html, clickable: true });
        _buttonActions.push(() => { _focusIndex = navIndex; });
      }
      return;
    }

    if (row.type === 'item') {
      const def    = Items.get(row.itemId);
      const name   = def ? def.name : row.itemId;
      const cost   = def?.moduleSpec?.batteryCost ?? 0;
      const modCol = Colors.itemColor(row.itemId);
      const html = Ascii.colorPair(
        [markSeg, { text: name, color: modCol }],
        [{ text: `(-${cost})  x ${row.count}`, color: Colors.UI.grey }],
        innerW,
      );
      lines.push({ html, clickable: true });
      _buttonActions.push(() => { _focusIndex = navIndex; _install(row.itemId); });
    }
  }

  function _onKey(e) {
    if (e.key === 'ArrowUp')   { _moveFocus(-1); PopupManager.redraw(); return true; }
    if (e.key === 'ArrowDown') { _moveFocus( 1); PopupManager.redraw(); return true; }
    if (e.key === 'Enter' || e.key === ' ') { _activateFocus(); return true; }
    return false;
  }

  function _moveFocus(delta) {
    if (_navList.length === 0) return;
    _focusIndex = (_focusIndex + delta + _navList.length) % _navList.length;
  }

  function _activateFocus() {
    const row = _navList[_focusIndex];
    if (!row) return;
    if (row.type === 'slot' && row.moduleId) _uninstall(row.index);
    else if (row.type === 'item') _install(row.itemId);
  }

  function _install(itemId) {
    const slots = SuitModules.getSlots();
    const empty = slots.findIndex(s => s === null);
    if (empty < 0) return;
    SuitModules.install(empty, itemId);
    _buildNavList();
    PopupManager.redraw();
  }

  function _uninstall(slotIndex) {
    SuitModules.uninstall(slotIndex);
    _buildNavList();
    PopupManager.redraw();
  }

  return { open };
})();
