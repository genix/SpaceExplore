// Orchestrates new-game world creation; populates all required Datastore keys.
const WorldGen = (() => {
  const SUIT_MAX_BATTERY = 1000;
  const INVENTORY_MAX_SIZE = 50;
  const AETHERIUM_START = 10;
  const WORLD_KEYS = ['galaxy', 'currentSolarSystem', 'currentPlanet', 'planetMap', 'playerPos', 'playerSuit', 'playerInventory', 'dayTurn', 'dayPhase', 'currentDay', 'weatherEvent', 'weatherEvents', 'stardate', 'aetherium'];
  // playerPos is NOT written by generate() — LandingScreen writes it after the player chooses a spot.

  function generate() {
    _clearKeys();
    PlanetGrids.reset();   // drop any resident grids from a previous playthrough

    const galaxy = Galaxy.generate();
    Datastore.init('galaxy', galaxy, DatastoreTypes.GALAXY);

    const startSystem = galaxy.systems.find(s => s.id === galaxy.startSystemId);
    Datastore.init('currentSolarSystem', startSystem, DatastoreTypes.SOLAR_SYSTEM);

    Datastore.init('stardate', 0, DatastoreTypes.STARDATE);
    Datastore.init('aetherium', AETHERIUM_START, DatastoreTypes.AETHERIUM);

    const startModules = Array(SuitModules.SLOT_COUNT).fill(null);
    startModules[0] = 'scanner-module';
    Datastore.init('playerSuit', {
      battery:    SUIT_MAX_BATTERY,
      maxBattery: SUIT_MAX_BATTERY,
      modules:    startModules,
    }, DatastoreTypes.PLAYER);

    Datastore.init('playerInventory', {
      maxSize: INVENTORY_MAX_SIZE,
      items:   [],
    }, DatastoreTypes.PLAYER);

    // Equipment is non-stackable, so seed through Inventory.add: each unit
    // becomes its own instanced entry starting at full durability.
    Inventory.add('power-relay',       3);
    Inventory.add('portable-salvager', 1);
    Inventory.add('auto-drill',        1);
    Inventory.add('atmo-condenser',    1);
    Inventory.add('geothermal-tap',    1);
    Inventory.add('solar-array',       1);
    Inventory.add('beacon',            1);
  }

  function _clearKeys() {
    for (const key of WORLD_KEYS) {
      if (Datastore.has(key)) Datastore.remove(key);
    }
  }

  return { generate };
})();
