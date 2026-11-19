(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { lerp } = Diorama.Palette;

  const SCENARIOS = [
    {
      id: 'morning',
      key: 1,
      name: 'Morning Laundry',
      subtitle: 'Crisp breeze, fresh sheets & pecking pigeons',
      defaultHour: 8.25, // 08:15
      timeSpeed: 0.035, // ~2.1 in-world mins per real second
      env: {
        rainIntensity: 0.0,
        snowIntensity: 0.0,
        snowLevel: 0.0,
        puddleLevel: 0.0,
        storminess: 0.0,
        cloudCoverage: 0.36,
        cloudDarkness: 0.08,
        cloudWarmth: 0.12,
        windSpeed: 0.42,
        lightningChance: 0.0,
        goldenBoost: 0.0,
        stringLights: 0.0,
        cinemaMode: 0.0,
        grillActive: 0.0,
        tarpsMode: 0.0, // 0=chairs, 1=pitched rain tarps
        laundryCount: 1.0,
        pigeonsActive: 1.0,
        firefliesActive: 0.0,
        swallowsActive: 0.0,
        snowmanActive: 0.0,
      },
      windowPreset: [0, 0, 0, 0, 0, 0, 0, 0],
    },
    {
      id: 'squall',
      key: 2,
      name: 'Sudden Squall',
      subtitle: 'Rolling storm bank, diagonal rain & laundry dash',
      defaultHour: 16 + 47 / 60, // 16:47
      timeSpeed: 0.028,
      env: {
        rainIntensity: 1.0,
        snowIntensity: 0.0,
        snowLevel: 0.0,
        puddleLevel: 0.92,
        storminess: 0.95,
        cloudCoverage: 1.0,
        cloudDarkness: 0.92,
        cloudWarmth: 0.0,
        windSpeed: 1.35,
        lightningChance: 0.22,
        goldenBoost: 0.0,
        stringLights: 0.15,
        cinemaMode: 0.0,
        grillActive: 0.0,
        tarpsMode: 1.0,
        laundryCount: 0.65,
        pigeonsActive: 0.0,
        firefliesActive: 0.0,
        swallowsActive: 0.0,
        snowmanActive: 0.0,
      },
      windowPreset: [0, 1, 0, 0, 1, 0, 1, 0],
    },
    {
      id: 'golden',
      key: 3,
      name: 'Golden Rooftop',
      subtitle: 'Long amber shadows, charcoal grill & parapet cat',
      defaultHour: 18.75, // 18:45
      timeSpeed: 0.03,
      env: {
        rainIntensity: 0.0,
        snowIntensity: 0.0,
        snowLevel: 0.0,
        puddleLevel: 0.08,
        storminess: 0.0,
        cloudCoverage: 0.56,
        cloudDarkness: 0.22,
        cloudWarmth: 0.95,
        windSpeed: 0.34,
        lightningChance: 0.0,
        goldenBoost: 0.95,
        stringLights: 0.72,
        cinemaMode: 0.0,
        grillActive: 1.0,
        tarpsMode: 0.15,
        laundryCount: 0.25,
        pigeonsActive: 0.0,
        firefliesActive: 0.15,
        swallowsActive: 1.0,
        snowmanActive: 0.0,
      },
      windowPreset: [1, 0, 1, 1, 0, 1, 0, 1],
    },
    {
      id: 'cinema',
      key: 4,
      name: 'Rooftop Cinema',
      subtitle: 'Starlit screening, warm string lights & fireflies',
      defaultHour: 21.5, // 21:30
      timeSpeed: 0.025,
      env: {
        rainIntensity: 0.0,
        snowIntensity: 0.0,
        snowLevel: 0.0,
        puddleLevel: 0.0,
        storminess: 0.0,
        cloudCoverage: 0.24,
        cloudDarkness: 0.68,
        cloudWarmth: 0.0,
        windSpeed: 0.22,
        lightningChance: 0.0,
        goldenBoost: 0.0,
        stringLights: 1.0,
        cinemaMode: 1.0,
        grillActive: 0.0,
        tarpsMode: 0.0,
        laundryCount: 0.0,
        pigeonsActive: 0.0,
        firefliesActive: 1.0,
        swallowsActive: 0.0,
        snowmanActive: 0.0,
      },
      windowPreset: [1, 1, 0, 1, 1, 1, 1, 0],
    },
    {
      id: 'snowfall',
      key: 5,
      name: 'First Snowfall',
      subtitle: 'Frosty dawn, drifting flakes & warm coffee',
      defaultHour: 6 + 50 / 60, // 06:50
      timeSpeed: 0.03,
      env: {
        rainIntensity: 0.0,
        snowIntensity: 1.0,
        snowLevel: 0.95,
        puddleLevel: 0.0,
        storminess: 0.22,
        cloudCoverage: 0.84,
        cloudDarkness: 0.34,
        cloudWarmth: 0.04,
        windSpeed: 0.48,
        lightningChance: 0.0,
        goldenBoost: 0.0,
        stringLights: 0.45,
        cinemaMode: 0.0,
        grillActive: 0.0,
        tarpsMode: 0.6,
        laundryCount: 0.0,
        pigeonsActive: 0.0,
        firefliesActive: 0.0,
        swallowsActive: 0.0,
        snowmanActive: 1.0,
      },
      windowPreset: [1, 0, 1, 0, 1, 1, 0, 1],
    },
  ];

  function cloneEnv(env) {
    return Object.assign({}, env);
  }

  function stepEnvTowards(cur, target, rate) {
    const keys = Object.keys(target);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      cur[k] = lerp(cur[k], target[k], rate);
      if (Math.abs(cur[k] - target[k]) < 0.002) cur[k] = target[k];
    }
  }

  function formatTime(hours) {
    const norm = ((hours % 24) + 24) % 24;
    const totalMins = Math.floor(norm * 60 + 0.0001) % 1440;
    const hh = Math.floor(totalMins / 60);
    const mm = totalMins % 60;
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  Diorama.Scenarios = {
    LIST: SCENARIOS,
    DEFAULT_INDEX: 1, // Start on "Sudden Squall" (16:47) as in reference
    TOUR_DURATION: 10.0, // 5 x 10s
    cloneEnv,
    stepEnvTowards,
    formatTime,
  };
})(window);
