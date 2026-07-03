// Salvage popup: opened from the ship popup. Lists equipment the player is
// carrying (in suit or ship cargo) with its condition; Enter breaks the focused
// unit down into ~30% of its components (returned to suit, overflow to cargo).
// This is the no-Portable-Salvager path: haul broken gear back to the ship and
// salvage it here. See design/CraftingAndDegradation.md.
const SalvagePopup = (() => {
  const WIDTH      = 52;
  const HEIGHT     = 24;
  const FOCUS_MARK = Ascii.FOCUS_MARK;

  let _focusIndex    = 0;
  let _navList       = [];
  let _buttonActions = [];
  let _msg           = null;

  function open(cfg = {}) {
    _focusIndex = 0;
    _msg        = null;
    _build();
    PopupManager.show({
      width:            WIDTH,
      height:           HEIGHT,
      title:            ' SALVAGE ',
      border:           'single',
      render:           _render,
      buttons:          _buttonActions,
      keepOpenOnButton: true,
      dismissKeys:      ['Escape', 'v', 'V'],
      onKey:            _onKey,
      onDismiss:        cfg.onClose || null,
    });
  }

  function _build() {
    _navList = [];
    for (const e of Inventory.getItems())  if (e.uid != null && e.maxDurability) _navList.push({ where: 'suit', uid: e.uid, itemId: e.itemId, durability: e.durability, maxDurability: e.maxDurability });
    for (const e of ShipCargo.getItems())  if (e.uid != null && e.maxDurability) _navList.push({ where: 'ship', uid: e.uid, itemId: e.itemId, durability: e.durability, maxDurability: e.maxDurability });
    if (_focusIndex >= _navList.length) _focusIndex = Math.max(0, _navList.length - 1);
  }

  function _render(innerW, innerH) {
    _buttonActions.length = 0;
    const lines = [
      Ascii.pad('  Carried equipment — Enter to salvage (~30%)', innerW),
      '─'.repeat(innerW),
    ];
    if (_navList.length === 0) {
      lines.push('');
      lines.push(Ascii.pad('   (no equipment to salvage)', innerW));
    } else {
      for (let i = 0; i < _navList.length; i++) _appendRow(lines, i, innerW);
    }
    while (lines.length < innerH - 2) lines.push('');
    lines.push('─'.repeat(innerW));
    const hint = _msg ? `  ${_msg}` : '  ↑↓:Nav   Enter:Salvage   V/Esc:Close';
    lines.push({ html: Ascii.colorLine([{ text: hint, color: Colors.UI.grey }], innerW) });
    return lines;
  }

  function _appendRow(lines, idx, innerW) {
    const r   = _navList[idx];
    const def = Items.get(r.itemId);
    const name = def ? def.name : r.itemId;
    const pct  = Math.round(MathUtils.clamp(r.durability / r.maxDurability, 0, 1) * 100);
    const focused = idx === _focusIndex;
    const where = r.where === 'ship' ? '(ship)' : '(suit)';
    const markSeg = focused ? { text: ` ${FOCUS_MARK} `, color: Colors.UI.green } : { text: '   ' };
    const html = Ascii.colorPair(
      [markSeg, { text: `${name} `, color: Colors.itemColor(r.itemId) }, { text: where, color: Colors.UI.dim }],
      [{ text: `${pct}%`, color: Colors.pctColor(pct) }],
      innerW,
    );
    lines.push({ html, clickable: true });
    _buttonActions.push(() => { _focusIndex = idx; _salvage(idx); });
  }

  function _onKey(e) {
    if (e.key === 'ArrowUp')   { _move(-1); return true; }
    if (e.key === 'ArrowDown') { _move( 1); return true; }
    if (e.key === 'Enter' || e.key === ' ') { _salvage(_focusIndex); return true; }
    return false;
  }

  function _move(delta) {
    if (_navList.length === 0) return;
    _focusIndex = (_focusIndex + delta + _navList.length) % _navList.length;
    PopupManager.redraw();
  }

  function _salvage(idx) {
    const r = _navList[idx];
    if (!r) return;
    const ret = SalvageSystem.salvageInstance(r.uid);
    const name = Items.get(r.itemId)?.name ?? r.itemId;
    if (ret) {
      const parts = ret.reduce((s, x) => s + x.count, 0);
      _msg = `Salvaged ${name} (+${parts} parts)`;
    } else {
      _msg = 'Cannot salvage';
    }
    _build();
    PopupManager.redraw();
  }

  return { open };
})();
