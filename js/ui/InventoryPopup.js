// Inventory popup: expandable category headings, focusable item rows with 2x2 glyphs,
// drop-to-tile action. Keyboard- and mouse-navigable.
const InventoryPopup = (() => {
  const WIDTH       = 52;
  const HEIGHT      = 26;
  const BAR_WIDTH   = 26;
  const FOCUS_MARK  = Ascii.FOCUS_MARK;

  let _expanded       = new Set(['Powered Equipment']);
  let _focusIndex     = 0;
  let _navList        = [];
  let _buttonActions  = [];
  let _lastError      = null;

  function open(cfg = {}) {
    if (!Datastore.has('playerInventory')) return;
    _buildNavList();
    if (_focusIndex >= _navList.length) _focusIndex = 0;
    PopupManager.show({
      width:            WIDTH,
      height:           HEIGHT,
      title:            ' INVENTORY ',
      border:           'single',
      render:           _render,
      buttons:          _buttonActions,
      keepOpenOnButton: true,
      dismissKeys:      ['Escape', 'i', 'I'],
      onKey:            _onKey,
      onDismiss:        cfg.onClose || null,
    });
  }

  function _buildNavList() {
    const items = Inventory.getItems();
    const groups = {};
    for (const entry of items) {
      const def = Items.get(entry.itemId);
      if (!def) continue;
      if (!groups[def.category]) groups[def.category] = [];
      groups[def.category].push(entry);
    }

    _navList = [];
    const sortedCategories = Object.keys(groups).sort();
    for (const category of sortedCategories) {
      _navList.push({ type: 'category', name: category, count: groups[category].length });
      if (_expanded.has(category)) {
        for (const entry of groups[category]) {
          _navList.push({
            type:          'item',
            itemId:        entry.itemId,
            count:         entry.count,
            uid:           entry.uid ?? null,
            durability:    entry.durability ?? null,
            maxDurability: entry.maxDurability ?? null,
          });
        }
      }
    }
    if (_focusIndex >= _navList.length) _focusIndex = Math.max(0, _navList.length - 1);
  }

  function _render(innerW, innerH) {
    _buttonActions.length = 0;
    const lines = [];

    const used = Inventory.getUsedSize();
    const max  = Inventory.getMaxSize();
    const pct  = max > 0 ? Math.round((used / max) * 100) : 100;
    lines.push({ html: Ascii.colorLine([
      { text: ' size  ', color: Colors.UI.grey },
      { text: `${used}/${max}`, color: Colors.pctColor(pct) },
    ], innerW) });
    const barHtml = Ascii.colorBar(used, max, BAR_WIDTH);
    lines.push({ html: ' ' + barHtml + ' '.repeat(Math.max(0, innerW - 1 - BAR_WIDTH - 2)) });
    lines.push('─'.repeat(innerW));

    if (_navList.length === 0) {
      lines.push('');
      lines.push(Ascii.pad('   (no items)', innerW));
    } else {
      for (let i = 0; i < _navList.length; i++) {
        _appendRow(lines, i, innerW);
      }
    }

    while (lines.length < innerH - 3) lines.push('');

    if (_lastError) {
      lines.push({ html: Ascii.colorLine([{ text: `  ! ${_lastError}`, color: Colors.UI.red }], innerW) });
    } else {
      lines.push('');
    }
    lines.push('─'.repeat(innerW));
    lines.push({ html: Ascii.colorLine([{ text: '  ↑↓:Nav   Enter:Toggle/Drop   I/Esc:Close', color: Colors.UI.grey }], innerW) });

    return lines;
  }

  function _appendRow(lines, navIndex, innerW) {
    const row = _navList[navIndex];
    const focused = navIndex === _focusIndex;
    const markSeg = focused
      ? { text: ` ${FOCUS_MARK} `, color: Colors.UI.green }
      : { text: '   ' };

    if (row.type === 'category') {
      const sym    = _expanded.has(row.name) ? '[-]' : '[+]';
      const catCol = Colors.categoryColor(row.name);
      const html = Ascii.colorPair(
        [markSeg, { text: `${sym} `, color: Colors.UI.grey }, { text: row.name, color: catCol }],
        [{ text: `(${row.count})`, color: Colors.UI.grey }],
        innerW,
      );
      lines.push({ html, clickable: true });
      _buttonActions.push(() => { _focusIndex = navIndex; _toggleCategory(row.name); });
      return;
    }

    const def = Items.get(row.itemId);
    if (!def) return;
    const itemCol     = Colors.itemColor(row.itemId);
    const g           = def.glyph;
    const row1Gly     = g[0][0] + g[0][1];
    const row2Gly     = g[1][0] + g[1][1];
    const sizeStr     = `[${def.size}]`;
    const isInstanced = row.uid != null && row.maxDurability;
    const pct         = isInstanced ? _durPct(row.durability, row.maxDurability) : null;
    const tailStr     = isInstanced
      ? `${_durBar(row.durability, row.maxDurability)} ${String(pct).padStart(3)}%`
      : `x ${row.count}`;
    const tailCol     = isInstanced ? Colors.pctColor(pct) : Colors.UI.grey;

    const html1 = Ascii.colorPair(
      [markSeg, { text: row1Gly, color: itemCol }, { text: `  ${def.name}`, color: itemCol }],
      [{ text: sizeStr, color: Colors.UI.dim }, { text: `  ${tailStr}`, color: tailCol }],
      innerW,
    );
    lines.push({ html: html1, clickable: true });
    _buttonActions.push(() => { _focusIndex = navIndex; _dropItem(row); });

    lines.push({ html: Ascii.colorLine([{ text: '   ' }, { text: row2Gly, color: itemCol }], innerW) });
  }

  function _onKey(e) {
    if (e.key === 'ArrowUp')   { _moveFocus(-1); PopupManager.redraw(); return true; }
    if (e.key === 'ArrowDown') { _moveFocus( 1); PopupManager.redraw(); return true; }
    if (e.key === 'Enter' || e.key === ' ') { _activateFocus(); return true; }
    if (e.key === 'ArrowLeft') {
      const r = _navList[_focusIndex];
      if (r && r.type === 'category' && _expanded.has(r.name)) {
        _expanded.delete(r.name);
        _buildNavList();
        PopupManager.redraw();
      }
      return true;
    }
    if (e.key === 'ArrowRight') {
      const r = _navList[_focusIndex];
      if (r && r.type === 'category' && !_expanded.has(r.name)) {
        _expanded.add(r.name);
        _buildNavList();
        PopupManager.redraw();
      }
      return true;
    }
    return false;
  }

  function _moveFocus(delta) {
    if (_navList.length === 0) return;
    _focusIndex = (_focusIndex + delta + _navList.length) % _navList.length;
  }

  function _activateFocus() {
    const row = _navList[_focusIndex];
    if (!row) return;
    if (row.type === 'category') _toggleCategory(row.name);
    else _dropItem(row);
  }

  function _toggleCategory(name) {
    if (_expanded.has(name)) _expanded.delete(name);
    else _expanded.add(name);
    _buildNavList();
    PopupManager.redraw();
  }

  function _dropItem(row) {
    if (!Datastore.has('playerPos')) return;
    const pos = Datastore.get('playerPos');
    const itemId = row.itemId;

    const def = Items.get(itemId);
    if (!def) return;
    if (!def.objectFactory) return;

    if (typeof def.canPlaceAt === 'function') {
      const check = def.canPlaceAt(pos);
      if (check !== true) { _lastError = (typeof check === 'string') ? check : 'Cannot place here.'; PopupManager.redraw(); return; }
    } else if (ObjectManager.getAt(pos.x, pos.y)) {
      _lastError = 'Tile blocked.'; PopupManager.redraw(); return;
    }

    const objId = `${itemId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const obj = def.objectFactory(objId, pos.x, pos.y);
    if (row.uid != null && row.durability != null) {
      obj.durability    = row.durability;
      obj.maxDurability = row.maxDurability ?? def.maxDurability ?? row.durability;
    }
    if (typeof def.onPlace === 'function') def.onPlace(obj, pos);
    ObjectManager.add(obj);
    if (row.uid != null) Inventory.removeByUid(row.uid);
    else Inventory.remove(itemId, 1);
    PowerSystem.resolve();
    _lastError = null;

    _buildNavList();
    PopupManager.redraw();
  }

  function _durPct(durability, maxDurability) {
    if (!maxDurability) return 100;
    return Math.round(MathUtils.clamp(durability / maxDurability, 0, 1) * 100);
  }

  function _durBar(durability, maxDurability) {
    return Ascii.bar(durability ?? 0, maxDurability || 1, 5);
  }

  return { open };
})();
