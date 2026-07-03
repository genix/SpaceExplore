// Single-line instrument rail showing 4 suit module slots. Lifecycle tied to PlanetView.
// Subscribes to playerSuit so it redraws when battery or modules change.
const ActionBar = (() => {
  const SLOT_WIDTH = 17;
  const INNER_WIDTH = 74;

  let _el            = null;
  let _unsubSuit     = null;

  function mount(el) {
    _el = el;
    _render();
    if (Datastore.has('playerSuit')) {
      _unsubSuit = Datastore.subscribe('playerSuit', _render);
    }
  }

  function unmount() {
    if (_unsubSuit) { _unsubSuit(); _unsubSuit = null; }
    if (_el) { _el.innerHTML = ''; _el = null; }
  }

  function refresh() {
    _render();
  }

  function _render() {
    if (!_el) return;
    const count = SuitModules.getSlotCount();
    const slots = SuitModules.getSlots();
    const parts = [];
    for (let i = 0; i < count; i++) {
      parts.push(_slotCell(i + 1, slots[i]));
    }
    const separators = Math.max(0, parts.length - 1);
    const used = parts.length * SLOT_WIDTH + separators;
    const left = Math.max(0, Math.floor((INNER_WIDTH - used) / 2));
    const right = Math.max(0, INNER_WIDTH - used - left);
    _el.innerHTML =
      `<span class="ab-frame">  /${'\u2500'.repeat(left)}</span>` +
      parts.join('<span class="ab-frame">\u2502</span>') +
      `<span class="ab-frame">${'\u2500'.repeat(right)}\\  </span>`;
  }

  function _slotCell(num, moduleId) {
    if (!moduleId) {
      const text = `[${num}] EMPTY`.padEnd(SLOT_WIDTH, ' ');
      return `<span class="ab-empty">${_esc(text)}</span>`;
    }
    const def = Items.get(moduleId);
    if (!def) {
      const text = `[${num}] ???`.padEnd(SLOT_WIDTH, ' ');
      return `<span class="ab-empty">${_esc(text)}</span>`;
    }
    const label   = (def.moduleSpec?.label || def.name).slice(0, 8);
    const cost    = def.moduleSpec?.batteryCost ?? 0;
    const canFire = SuitModules.canActivate(num - 1);
    const cls     = canFire ? 'ab-ready' : 'ab-lowpower';
    const costText = ('-' + cost).padStart(4, ' ').slice(-4);
    const text = `[${num}] ${label.padEnd(8)} ${costText}`.slice(0, SLOT_WIDTH);
    return `<span class="${cls}">${_esc(text)}</span>`;
  }

  function _esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { mount, unmount, refresh };
})();
