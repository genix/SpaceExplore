// Central colour palette. UI colours match the DOS CGA palette used throughout
// the game. CAT colours assign a consistent hue to each item category so every
// popup renders the same visual language.
const Colors = (() => {
  const UI = {
    dim:    '#333333',
    grey:   '#aaaaaa',
    bright: '#ffffff',
    cyan:   '#55ffff',
    yellow: '#ffff55',
    green:  '#55ff55',
    red:    '#ff5555',
    blue:   '#5555ff',
  };

  // Muted colours for capacity / progress bars — easier on the eyes than bright green.
  const BAR_FILL  = '#2d7a2d';
  const BAR_EMPTY = '#111f11';

  const CAT = {
    'Resources':        UI.yellow,
    'Components':       UI.cyan,
    'Powered Equipment':'#aaaaaa',
    'Power Source':     '#ffcc44',
    'Navigation':       '#88aaff',
    'Suit Module':      UI.cyan,
  };

  function itemColor(itemId) {
    return Items.get(itemId)?.color ?? UI.grey;
  }

  function categoryColor(category) {
    return CAT[category] ?? UI.grey;
  }

  // Green above 75%, yellow above 35%, red below.
  function pctColor(pct) {
    if (pct > 75) return UI.green;
    if (pct > 35) return UI.yellow;
    return UI.red;
  }

  return { UI, CAT, BAR_FILL, BAR_EMPTY, itemColor, categoryColor, pctColor };
})();
