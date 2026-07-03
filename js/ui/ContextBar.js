// Reusable key-binding hint bar. Call init(el), then setBindings([{key, action},...]).
// Precondition: init() must be called before setBindings().
const ContextBar = (() => {
  let _el = null;
  let _compact = false;
  let _frame = 'none';
  let _width = 80;
  let _inset = 2;

  function init(el, { compact = false, frame = 'none', width = 80, inset = 2 } = {}) {
    _el = el;
    _compact = compact;
    _frame = frame;
    _width = width;
    _inset = inset;
    _el.textContent = '';
  }

  function setBindings(bindings) {
    if (!_el) return;
    const content = bindings.map(b => `${b.key}: ${b.action}`).join('   ');
    if (_frame !== 'none') {
      _el.textContent = _buildFrame(content);
      return;
    }
    _el.textContent = (_compact ? ' ' : '\n ') + content;
  }

  function destroy() {
    _el = null;
    _compact = false;
    _frame = 'none';
    _width = 80;
    _inset = 2;
  }

  function _buildFrame(content) {
    const innerW = Math.max(0, _width - (_inset * 2) - 2);
    const horizontal = '\u2500'.repeat(innerW);
    const middle = ' '.repeat(_inset) + '\u2502' + _center(content, innerW) + '\u2502' + ' '.repeat(_inset);
    const bottom = ' '.repeat(_inset) + '\\' + horizontal + '/' + ' '.repeat(_inset);
    if (_frame === 'bottom-cap') return middle + '\n' + bottom;
    const top = ' '.repeat(_inset) + '/' + horizontal + '\\' + ' '.repeat(_inset);
    return top + '\n' + middle + '\n' + bottom;
  }

  function _center(text, width) {
    const value = String(text).slice(0, width);
    const left = Math.floor((width - value.length) / 2);
    return ' '.repeat(left) + value + ' '.repeat(width - value.length - left);
  }

  return { init, setBindings, destroy };
})();
