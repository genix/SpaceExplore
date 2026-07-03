// GROUND is exported so isPassable and other systems can read the passable flag.
const TileDefs = (() => {
  const GROUND = {
    sand:            { char: '.',  color: '#c4a35a', bg: '#261c0a', passable: true  },
    rock:            { char: 'o',  color: '#5c3d1e', bg: '#1a1008', passable: true  },
    soil:            { char: '.',  color: '#7a5c3d', bg: '#1a1208', passable: true  },
    grass:           { char: '.',  color: '#5a8a3a', bg: '#0a2005', passable: true  },
    'dry-rock':      { char: 'o',  color: '#8a6a4a', bg: '#1c1308', passable: true  },
    gravel:          { char: ':',  color: '#6a5a4a', bg: '#181410', passable: true  },
    'frozen-soil':   { char: '.',  color: '#8a9aaa', bg: '#141a20', passable: true  },
    snow:            { char: '*',  color: '#dde8f0', bg: '#1a1e22', passable: true  },
    ice:             { char: '#',  color: '#a0c8e0', bg: '#0e1a28', passable: true  },
    water:           { char: '~',  color: '#1a5f8a', bg: '#081828', passable: false },
    'deep-ocean':    { char: '~',  color: '#0a3a5a', bg: '#040e18', passable: false },
    'shallow-ocean': { char: '~',  color: '#1a6a9a', bg: '#081520', passable: false },
    lake:            { char: '~',  color: '#2a6a8a', bg: '#071828', passable: false },
    river:           { char: '~',  color: '#2a7aaa', bg: '#0a1e30', passable: true  },
    'frozen-ocean':  { char: '#',  color: '#9fd4ea', bg: '#0b1c2a', passable: true  },
    'frozen-lake':   { char: '#',  color: '#aad8e8', bg: '#0d1e28', passable: true  },
    'frozen-river':  { char: '-',  color: '#c0e4f0', bg: '#101e2c', passable: true  },
  };

  return { GROUND };
})();
