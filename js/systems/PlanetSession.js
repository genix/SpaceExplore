// Mounts and tears down the systems/subviews that exist while visiting a planet.
const PlanetSession = (() => {
  let _active = false;

  function start({ mapContainer, timeBarEl, inspectorEl, actionBarEl, renderer = TerrainRenderer }) {
    if (_active) stop();

    PlanetTimeBar.init(timeBarEl);
    MapView.init(mapContainer, renderer);
    ObjectManager.mount(Datastore.get('currentPlanet').id);
    MapView.addLayer(ShipDirectionLayer);
    TileInspector.init(mapContainer, inspectorEl);
    SuitModules.init();
    ActionBar.mount(actionBarEl);

    DayCycle.start();
    WeatherSystem.start();
    WeatherSystem.advanceTicks(20);
    PowerSystem.start();
    ExtractionSystem.start();
    BeaconSystem.start();
    DustDevilSystem.start(Datastore.get('currentPlanet'));
    SuitSystem.start();
    TurnManager.startAutoTick(1000);

    PlanetTimeBar.refresh();
    MapView.refresh();
    _active = true;
  }

  function stop() {
    if (!_active) return;

    TurnManager.stopAutoTick();
    DayCycle.stop();
    WeatherSystem.stop();
    DustDevilSystem.stop();
    SuitSystem.stop();
    BeaconSystem.stop();
    ExtractionSystem.stop();
    PowerSystem.stop();
    ActionBar.unmount();
    TileInspector.destroy();
    MapView.removeLayer('ship-direction');
    ObjectManager.unmount();
    MapView.destroy();
    PlanetTimeBar.destroy();
    _active = false;
  }

  return { start, stop };
})();
