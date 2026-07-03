// Centered modal popup system. show() pushes onto a stack; dismiss() pops.
// Screen beneath is partially greyscaled while any popup is active.
// The frame is drawn by a pluggable border style (cfg.border: 'single' default,
// 'double', 'circle', 'porthole'; frame:false maps to 'none'); see Borders.js,
// which is shared with non-popup content.
const PopupManager = (() => {
  const ANIM_MS = 220;

  let _stack = [];
  let _layerEl  = null;
  let _screenEl = null;
  let _animFrame = null;
  let _animStart = null;

  function init() {
    _layerEl  = document.getElementById('popup-layer');
    _screenEl = document.getElementById('screen-container');
    document.addEventListener('keydown', _onKey, true);
  }

  function show(cfg) {
    const border = cfg.frame === false ? 'none' : (cfg.border || 'single');
    const style  = Borders.get(border);
    _stack.push({
      w:                 MathUtils.clamp(cfg.width  || 40, style.minSize.w, 80),
      h:                 MathUtils.clamp(cfg.height || 20, style.minSize.h, 50),
      title:             cfg.title       || '',
      render:            cfg.render      || null,
      dismissKeys:       cfg.dismissKeys || ['Escape'],
      onDismiss:         cfg.onDismiss   || null,
      buttons:           cfg.buttons     || [],
      onKey:             cfg.onKey       || null,
      keepOpenOnButton:  !!cfg.keepOpenOnButton,
      border:            border,
      borderColor:       cfg.borderColor || null,
      anim:              cfg.anim || style.defaultAnim,
    });
    if (_stack.length === 1) {
      _screenEl.classList.add('popup-open');
      _layerEl.classList.add('active');
    }
    _startAnim();
  }

  function dismiss() {
    if (!_stack.length) return;
    if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
    const popup = _stack.pop();
    if (popup.onDismiss) popup.onDismiss();
    if (!_stack.length) {
      _screenEl.classList.remove('popup-open');
      _layerEl.classList.remove('active');
      _layerEl.innerHTML = '';
    } else {
      _startAnim();
    }
  }

  function dismissAll() {
    while (_stack.length) dismiss();
  }

  function isOpen() {
    return _stack.length > 0;
  }

  function _onKey(e) {
    if (!_stack.length) return;
    const popup = _stack[_stack.length - 1];
    if (popup.onKey) {
      const consumed = popup.onKey(e);
      if (consumed) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    if (popup.dismissKeys.includes(e.key)) dismiss();
  }

  function redraw() {
    if (!_stack.length || _animFrame) return;
    _drawFrame(1);
  }

  function _startAnim() {
    _animStart = null;
    if (_animFrame) cancelAnimationFrame(_animFrame);
    _animFrame = requestAnimationFrame(_animate);
  }

  function _animate(ts) {
    if (!_animStart) _animStart = ts;
    const t      = Math.min(1, (ts - _animStart) / ANIM_MS);
    const eased  = 1 - Math.pow(1 - t, 3);
    _drawFrame(eased);
    _animFrame = t < 1 ? requestAnimationFrame(_animate) : null;
  }

  function _drawFrame(progress) {
    const popup  = _stack[_stack.length - 1];
    const { w, h } = popup;
    const curW   = Math.max(3, Math.round(w * progress));
    const curH   = Math.max(1, Math.round(h * progress));

    const left = Math.floor((80 - w) / 2) + Math.floor((w - curW) / 2);
    const top  = Math.floor((50 - h) / 2) + Math.floor((h - curH) / 2);

    const style = Borders.get(popup.border);
    const ready = progress >= 1 ? popup : null;

    let contentLines = null;
    if (ready && ready.render) {
      const innerW = curW - style.insets.left - style.insets.right;
      const innerH = curH - style.insets.top - style.insets.bottom;
      contentLines = ready.render(innerW, innerH);
    }

    const lines = style.build(curW, curH, {
      title:       ready ? ready.title : '',
      contentLines,
      borderColor: popup.borderColor,
    });

    let pre = _layerEl.firstElementChild;
    if (!pre || pre.tagName !== 'PRE') {
      _layerEl.innerHTML = '';
      pre = document.createElement('pre');
      pre.addEventListener('click', e => {
        if (e.target.classList.contains('frame-btn')) {
          const popup = _stack[_stack.length - 1];
          const bidx = parseInt(e.target.dataset.bidx, 10);
          const action = popup.buttons && popup.buttons[bidx];
          if (!popup.keepOpenOnButton) dismiss();
          if (action) action();
        }
      });
      _layerEl.appendChild(pre);
    }
    pre.style.left = `${left}ch`;
    pre.style.top  = `calc(${top} * var(--line-height))`;
    pre.innerHTML  = lines.join('<br>');
  }

  return { init, show, dismiss, dismissAll, isOpen, redraw };
})();
