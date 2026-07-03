// Bootstrap: register screens and show the title.
(function () {
  Debug.init();
  SpaceBackdrop.init();
  PopupManager.init();
  ScreenFX.init();
  StardateClock.start();
  WeatherSystem.registerPlugin(RainWeather);
  WeatherSystem.registerPlugin(SnowWeather);
  WeatherSystem.registerPlugin(FogWeather);
  WeatherSystem.registerPlugin(DustStormWeather);
  WeatherSystem.registerPlugin(AshFallWeather);
  WeatherSystem.registerPlugin(IonStormWeather);

  ScreenManager.register('title', TitleScreen);
  ScreenManager.register('galaxy-screen', GalaxyScreen);
  ScreenManager.register('solar-system-screen', SolarSystemScreen);
  ScreenManager.register('landing-screen', LandingScreen);
  ScreenManager.register('planet-view', PlanetView);
  ScreenManager.register('interior-view', InteriorView);

  TitleScreen.init();
  GalaxyScreen.init();
  SolarSystemScreen.init();
  LandingScreen.init();
  PlanetView.init();
  InteriorView.init();

  ScreenManager.show('title');

  // Ctrl/Cmd+S quicksaves the current game to the default slot. No-op with no world
  // loaded (snapshot needs a galaxy); load is offered from the Title screen only.
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (Save.save()) console.log('Game saved.');
    }
  });
}());
