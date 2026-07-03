// Fabricate popup: two-pane crafting UI opened from the ship popup. Left pane is
// the recipe list (Components then Equipment) with the held count of each output;
// right pane details the focused recipe's ingredients, quantity, and craftable
// count. Keyboard-first: Up/Down picks a recipe, Left/Right adjusts quantity,
// Enter crafts. Clicking a recipe row selects it.
const FabricatePopup = (() => {
  const WIDTH      = 64;
  const HEIGHT     = 26;
  const LEFTW      = 26;
  const FOCUS_MARK = Ascii.FOCUS_MARK;

  const SYNTH_COLOR = '#a99bff';
  const SYNTH_META  = {
    aetherium: { name: 'Aetherium', color: SYNTH_COLOR },
  };

  let _recipes       = [];
  let _focusIndex    = 0;
  let _qty           = 1;
  let _msg           = null;
  let _buttonActions = [];

  function open(cfg = {}) {
    _recipes    = Recipes.all();
    _focusIndex = 0;
    _qty        = 1;
    _msg        = null;
    PopupManager.show({
      width:            WIDTH,
      height:           HEIGHT,
      title:            ' FABRICATE ',
      border:           'single',
      render:           _render,
      buttons:          _buttonActions,
      keepOpenOnButton: true,
      dismissKeys:      ['Escape', 'f', 'F'],
      onKey:            _onKey,
      onDismiss:        cfg.onClose || null,
    });
  }

  function _focusRecipe() {
    return _recipes[_focusIndex] || null;
  }

  function _outputName(r) {
    if (r.output.target) return SYNTH_META[r.output.target]?.name ?? r.output.itemId;
    return Items.get(r.output.itemId)?.name ?? r.output.itemId;
  }

  function _outputColor(r) {
    if (r.output.target) return SYNTH_META[r.output.target]?.color ?? Colors.UI.grey;
    return Colors.itemColor(r.output.itemId);
  }

  function _outputHeld(r) {
    if (r.output.target === 'aetherium') return Math.floor(Datastore.get('aetherium') ?? 0);
    return CraftingSystem.countAvailable(r.output.itemId);
  }

  function _clampQty() {
    const r = _focusRecipe();
    const cap = r ? Math.max(1, CraftingSystem.maxCraftable(r.id)) : 1;
    _qty = MathUtils.clamp(_qty, 1, cap);
  }

  function _buildLeft() {
    const rows = [];
    let lastCat = null;
    _recipes.forEach((r, idx) => {
      if (r.category !== lastCat) {
        let label, catCol;
        if (r.category === 'component')  { label = ' COMPONENTS'; catCol = Colors.UI.cyan; }
        else if (r.category === 'equipment') { label = ' EQUIPMENT';  catCol = Colors.UI.grey; }
        else if (r.category === 'synthesis') { label = ' SYNTHESIS';  catCol = SYNTH_COLOR; }
        rows.push({ html: Ascii.colorLine([{ text: label, color: catCol }], LEFTW), idx: null });
        lastCat = r.category;
      }
      const focused  = idx === _focusIndex;
      const canMake  = CraftingSystem.maxCraftable(r.id) >= 1;
      const name     = _outputName(r);
      const held     = _outputHeld(r);
      const markSeg  = focused ? { text: FOCUS_MARK, color: Colors.UI.green } : { text: ' ' };
      const flagSeg  = { text: canMake ? '+' : ' ', color: canMake ? Colors.UI.green : Colors.UI.dim };
      const nameSeg  = { text: name, color: _outputColor(r) };
      const html = Ascii.colorPair(
        [markSeg, flagSeg, nameSeg],
        [{ text: `x${held}`, color: Colors.UI.grey }],
        LEFTW,
      );
      rows.push({ html, idx });
    });
    return rows;
  }

  function _buildRight(rightW) {
    const r = _focusRecipe();
    if (!r) return [Ascii.colorLine([{ text: '(no recipe)', color: Colors.UI.dim }], rightW)];

    const def     = Items.get(r.output.itemId);
    const outName = _outputName(r);
    const outCol  = _outputColor(r);
    const glyph   = (def?.glyph && def.objectFactory) ? def.glyph : null;

    const lines = [];
    if (glyph) {
      const row1 = glyph[0][0] + glyph[0][1];
      const row2 = glyph[1][0] + glyph[1][1];
      lines.push({ html: Ascii.colorPair(
        [{ text: outName, color: outCol }],
        [{ text: row1, color: outCol }],
        rightW,
      )});
      lines.push({ html: Ascii.colorPair(
        [{ text: '' }],
        [{ text: row2, color: outCol }],
        rightW,
      )});
    } else {
      lines.push({ html: Ascii.colorLine([{ text: outName, color: outCol }], rightW) });
    }
    lines.push(
      { html: Ascii.colorLine([{ text: `Produces: ${r.output.count}`, color: Colors.UI.grey }], rightW) },
    );
    if (r.output.target === 'aetherium') {
      const current = Math.floor(Datastore.get('aetherium') ?? 0);
      lines.push({ html: Ascii.colorLine([{ text: `Current: ${current} Aetherium`, color: SYNTH_COLOR }], rightW) });
    }
    lines.push('─'.repeat(rightW));

    for (const inp of r.inputs) {
      const need   = inp.count * _qty;
      const have   = CraftingSystem.countAvailable(inp.itemId);
      const iname  = Items.get(inp.itemId)?.name ?? inp.itemId;
      const ok     = have >= need;
      const html = Ascii.colorPair(
        [
          { text: ok ? ' ' : '!', color: ok ? Colors.UI.green : Colors.UI.red },
          { text: iname, color: Colors.itemColor(inp.itemId) },
        ],
        [{ text: `x${inp.count}  have ${have}`, color: ok ? Colors.UI.grey : Colors.UI.red }],
        rightW,
      );
      lines.push({ html });
    }

    lines.push('─'.repeat(rightW));

    const canMake = CraftingSystem.maxCraftable(r.id);
    lines.push({ html: Ascii.colorPair(
      [{ text: `qty: < ${_qty} >`, color: Colors.UI.grey }],
      [{ text: `can make: ${canMake}`, color: canMake > 0 ? Colors.UI.green : Colors.UI.grey }],
      rightW,
    ) });
    lines.push('');

    const ready = canMake >= _qty && _qty >= 1;
    const craftLabel = ready ? '[ CRAFT ]   Enter to confirm' : '[ ----- ]   not enough materials';
    lines.push({ html: Ascii.colorLine([{ text: craftLabel, color: ready ? Colors.UI.green : Colors.UI.red }], rightW) });

    return lines;
  }

  // Converts a left/right pane cell to an HTML string of exactly `width` chars.
  function _toHtml(item, width) {
    if (item == null) return ' '.repeat(width);
    if (typeof item === 'string') return Ascii.escape(Ascii.pad(item, width));
    if (item.html !== undefined) return item.html;
    return Ascii.escape(Ascii.pad(item.text ?? '', width));
  }

  function _render(innerW, innerH) {
    _buttonActions.length = 0;
    const rightW = innerW - LEFTW - 1;
    const left   = _buildLeft();
    const right  = _buildRight(rightW);
    const rows   = innerH - 2;
    const lines  = [];

    for (let i = 0; i < rows; i++) {
      const L = left[i];
      const R = right[i];
      const combined = _toHtml(L, LEFTW) + '│' + _toHtml(R, rightW);
      if (L && typeof L === 'object' && L.idx != null) {
        const idx = L.idx;
        lines.push({ html: combined, clickable: true });
        _buttonActions.push(() => { _focusIndex = idx; _clampQty(); _msg = null; PopupManager.redraw(); });
      } else {
        lines.push({ html: combined });
      }
    }

    lines.push('─'.repeat(innerW));
    const hint = _msg ? `  ${_msg}` : '  ↑↓:Recipe  ←→:Qty  Enter:Craft  F/Esc:Close';
    lines.push({ html: Ascii.colorLine([{ text: hint, color: Colors.UI.grey }], innerW) });
    return lines;
  }

  function _onKey(e) {
    if (e.key === 'ArrowUp')    { _move(-1); return true; }
    if (e.key === 'ArrowDown')  { _move( 1); return true; }
    if (e.key === 'ArrowLeft')  { _qty = Math.max(1, _qty - 1); _msg = null; PopupManager.redraw(); return true; }
    if (e.key === 'ArrowRight') { _qty = _qty + 1; _clampQty(); _msg = null; PopupManager.redraw(); return true; }
    if (e.key === 'Enter' || e.key === ' ') { _craft(); return true; }
    return false;
  }

  function _move(delta) {
    if (_recipes.length === 0) return;
    _focusIndex = (_focusIndex + delta + _recipes.length) % _recipes.length;
    _qty = 1;
    _msg = null;
    PopupManager.redraw();
  }

  function _craft() {
    const r = _focusRecipe();
    if (!r) return;
    const made = CraftingSystem.craft(r.id, _qty);
    const name = _outputName(r);
    _msg = made > 0 ? `Crafted ${made} ${name}` : 'Not enough materials / space';
    _clampQty();
    PopupManager.redraw();
  }

  return { open };
})();
