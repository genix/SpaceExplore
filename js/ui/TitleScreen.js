// Title screen: ASCII art banner (inlined from title.txt), keyboard-navigable menu, triggers world gen on New Game.
const TitleScreen = (() => {
  const ART = [
    ".                        .:--:..::..                                            ",
    "  .:                                                                            ",
    ":=+=:                                                                           ",
    ":*#+*%*-.                .-+-                                                   ",
    "-*%%%%@%#=:::.            .:.                                                   ",
    "..=*++#%%%%**=             ..                                                   ",
    "   .:::-=--::-:.           .+-.                                                 ",
    "           ...         ..                                                       ",
    "                       .       ..                 .:+#%%%%%%%#+:                ",
    "                                ..            .-+##%@@@@@@@@@@@@@#=.            ",
    "                    :-=+=:.. .                ...::  .:-#%%@@@@@@@@%-           ",
    "                   .:-*##*#+:.              .**=#*-.      ..-%@@@@=+#=          ",
    "                  .::..--::..      .       :%=..-#@%+.   .. .-*%@%#*.           ",
    "                   .                      :*=    :=-.     .    .:-#=            ",
    "                               .          --                     =%@@%:         ",
    "                                     .    ..                     +---.          ",
    "                             ..  :+-      ..                           .....    ",
    "       :.                    :-.          -:                   :+.   :%@%%@@%%%+",
    "                             .:.         ..=.   .           .....   .-....:#@@@@",
    "                         :                 .+:            .-...:     .     -#%#-",
    "                                           :*@-       ..:.  .   ::              ",
    "                                         -#@@@+-                  :*#=.         ",
    "                                       .#@@%%%%+.              .-*=+#@@@@%#+.   ",
    "                                     .=@@@#+-#%%+             -*:-%@@@@@@@@@*:  ",
    "                                    :#%##=.   +*=.   ..     :-:-%@@@@@@@@%*+-:. ",
    "                                   :###%+=. :-**==+#%%*++:   +%%###++*#%@@@@%-. ",
    "                                 .=%##%+=.    :---%@@%+.:.   ==-:.#%#@%@@@@@@@# ",
    "                                .*@@@*:=+- .:    .-::*+    ...   .*%@@@%#%#=..:*",
    "                               .+%#=::.          :=.:**. :*=.    +###@@%=:+:    ",
    "                              .*##@#-:        :-==:#%@%. -#+--.   .+#%%%@#     .",
    "                             .%@@%%#==.     :        ..      .     =%+--*# :-=. ",
    "                           -#*@@@@@%*-       .               :+=   :=##@@%-:*#=:",
    "                           =%+#%@@%+::      . .                .:  .*%#---=*#*++",
    "                          .=*#%#%@%.              :.               .*%%%%*#@#=. ",
    "                         =#%%%%%#+:.            .-..    .:.       .+%@@@@%##=.  ",
    "                        .##+-...  :            -+.      .-+  .:+#%@@@@#%%*=-:.  ",
    "                       .-=..+@%@%-           :*- .        .=*%@@@@@@@@@@%*+=.   ",
    "                           +@@@@#:         .=:   .      .*@@@@@@@%%=-*#*=:.     ",
  ];

  const BORDER_W = 80;
  const BORDER_H = 50;
  const BORDER = {
    tl: '┌', tr: '┐', bl: '└', br: '┘',
    h:  '─', v:  '│',
  };

  let _el = null;
  let _selected = 0;
  let _menu = ['New Game'];
  let _keyHandler = null;

  function init() {
    _el = document.getElementById('title-screen');
    _keyHandler = _onKey;
  }

  // "Continue" is offered only when a save exists (load is allowed from the Title
  // screen alone, so restore never runs under a live planet session — LoadAndSave §3.5).
  function _buildMenu() {
    return Save.hasAnySave() ? ['New Game', 'Continue'] : ['New Game'];
  }

  function show() {
    _menu = _buildMenu();
    _selected = 0;
    _render();
    _el.style.display = 'flex';
    document.addEventListener('keydown', _keyHandler);
  }

  function hide() {
    _el.style.display = 'none';
    document.removeEventListener('keydown', _keyHandler);
  }

  function _render() {
    const art = ART.map(l => `<div>${_esc(l) || '&nbsp;'}</div>`).join('');
    const cursorClass = 'menu-cursor' + (_blinkStatic() ? ' static' : '');
    const items = _menu.map((label, i) => {
      const selected = i === _selected;
      const cursor = selected ? ` <span class="${cursorClass}">█</span>` : '';
      return `<div class="menu-item${selected ? ' selected' : ''}">${_esc(label)}${cursor}</div>`;
    }).join('');

    _el.innerHTML =
      `<pre class="title-border">${_buildBorder()}</pre>` +
      `<div class="title-art">${art}</div>` +
      `<div class="title-menu">${items}</div>`;

    _el.querySelectorAll('.menu-item').forEach((el, i) => {
      el.addEventListener('click', () => _activate(i));
    });
  }

  function _renderGenerating(text = 'Generating World...') {
    _el.innerHTML =
      `<pre class="title-border">${_buildBorder()}</pre>` +
      `<div class="title-generating">${_esc(text)}</div>`;
  }

  function _buildBorder() {
    const top = BORDER.tl + BORDER.h.repeat(BORDER_W - 2) + BORDER.tr;
    const mid = BORDER.v  + ' '.repeat(BORDER_W - 2) + BORDER.v;
    const bot = BORDER.bl + BORDER.h.repeat(BORDER_W - 2) + BORDER.br;
    const lines = [top];
    for (let i = 0; i < BORDER_H - 2; i++) lines.push(mid);
    lines.push(bot);
    return lines.join('\n');
  }

  function _onKey(e) {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        _selected = (_selected - 1 + _menu.length) % _menu.length;
        _render();
        break;
      case 'ArrowDown':
        e.preventDefault();
        _selected = (_selected + 1) % _menu.length;
        _render();
        break;
      case 'Enter':
        _activate(_selected);
        break;
    }
  }

  function _activate(index) {
    if (_menu[index] === 'New Game') _newGame();
    else if (_menu[index] === 'Continue') _continue();
  }

  // Loads the most recent save and returns to the galaxy map — a clean hub from
  // which the restored world (objects, deposits, discovery) is intact and grids
  // regenerate on return.
  function _continue() {
    document.removeEventListener('keydown', _keyHandler);
    _renderGenerating('Loading...');
    setTimeout(() => {
      try {
        if (!Save.load(Save.latestSlot())) throw new Error('no save found');
        ScreenManager.show('galaxy-screen');
      } catch (err) {
        console.error('Load failed:', err);
        _menu = _buildMenu();
        _selected = 0;
        _render();
        document.addEventListener('keydown', _keyHandler);
      }
    }, 50);
  }

  function _newGame() {
    document.removeEventListener('keydown', _keyHandler);
    _renderGenerating();
    // Yield to the browser so the "Generating World..." message paints before gen runs.
    setTimeout(() => {
      try {
        Datastore.clear();
        WorldGen.generate();
        ScreenManager.show('galaxy-screen');
      } catch (err) {
        console.error('World generation failed:', err);
        _selected = 0;
        _render();
        document.addEventListener('keydown', _keyHandler);
      }
    }, 50);
  }

  // Cursor blink is an idle ambient effect, so it follows the shared motion
  // preference: it keeps blinking under 'full'/'reduced' and holds solid under 'off'.
  function _blinkStatic() {
    return typeof ScreenFX !== 'undefined' && ScreenFX.effectiveMotion() === 'off';
  }

  function _esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { init, show, hide };
})();
