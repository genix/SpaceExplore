// Debug menu, opened by a single backtick while debug mode is active (see Debug.js).
// A small modal listing debug actions; each action is a hotkey + clickable row.
// Actions run in place (keepOpenOnButton) and report back through a status line, so
// the menu stays open for repeated use. Add entries to ACTIONS to extend it.
const DebugPopup = (() => {
  let _status      = '';
  let _statusColor = null;

  const ACTIONS = [
    { key: 'D', label: 'Spawn Dust Devil', run: _spawnDustDevil },
  ];

  function open() {
    _status      = '';
    _statusColor = null;
    PopupManager.show({
      width: 50, height: 13, title: ' DEBUG MENU ', border: 'double',
      keepOpenOnButton: true,
      render: _render,
      buttons: [...ACTIONS.map(a => () => _invoke(a)), _disableDebug, _close],
      dismissKeys: ['Escape', '`'],
      onKey(e) {
        const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        const action = ACTIONS.find(a => a.key === k);
        if (action) { _invoke(action); return true; }
        if (k === 'X') { _disableDebug(); return true; }
        return false;   // Escape / backtick fall through to dismissKeys
      },
    });
  }

  function _invoke(action) {
    const result = action.run();
    _status      = result.msg;
    _statusColor = result.color;
    PopupManager.redraw();
  }

  function _spawnDustDevil() {
    return DustDevilSystem.debugSpawnNearPlayer()
      ? { msg: 'Dust devil spawned near you.', color: Colors.UI.green }
      : { msg: 'Unavailable — land on an arid/scorched world.', color: Colors.UI.red };
  }

  function _disableDebug() {
    PopupManager.dismiss();
    Debug.deactivate();
  }

  function _close() {
    PopupManager.dismiss();
  }

  function _render(innerW) {
    const center = (text, color) => {
      const pad = Math.max(0, Math.floor((innerW - text.length) / 2));
      return { html: Ascii.colorLine([{ text: ' '.repeat(pad) }, { text, color }], innerW) };
    };
    const lines = [''];
    for (const a of ACTIONS) {
      lines.push({ ...center(`[ ${a.key}  ${a.label.toUpperCase()} ]`, Colors.UI.yellow), clickable: true });
    }
    lines.push({ ...center('[ X  DISABLE DEBUG MODE ]', Colors.UI.cyan), clickable: true });
    lines.push('');
    lines.push(center(_status || ' ', _statusColor || Colors.UI.grey));
    lines.push('');
    lines.push({ ...center('[ CLOSE ]  Esc / `', Colors.UI.grey), clickable: true });
    return lines;
  }

  return { open };
})();
