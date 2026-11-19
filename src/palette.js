(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});

  // Detect endianness once for Uint32Array RGBA packing
  const testBuf = new ArrayBuffer(4);
  const testU8 = new Uint8Array(testBuf);
  const testU32 = new Uint32Array(testBuf);
  testU32[0] = 0x0a0b0c0d;
  const IS_LITTLE_ENDIAN = testU8[0] === 0x0d;

  function pack(r, g, b, a = 255) {
    const cr = r < 0 ? 0 : r > 255 ? 255 : r | 0;
    const cg = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    const cb = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    const ca = a < 0 ? 0 : a > 255 ? 255 : a | 0;
    if (IS_LITTLE_ENDIAN) {
      return ((ca << 24) | (cb << 16) | (cg << 8) | cr) >>> 0;
    }
    return ((cr << 24) | (cg << 16) | (cb << 8) | ca) >>> 0;
  }

  function packRGB(rgb, a = 255) {
    return pack(rgb[0], rgb[1], rgb[2], a);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function lerpRGB(c1, c2, t) {
    const k = clamp(t, 0, 1);
    return [
      c1[0] + (c2[0] - c1[0]) * k,
      c1[1] + (c2[1] - c1[1]) * k,
      c1[2] + (c2[2] - c1[2]) * k,
    ];
  }

  function mulRGB(c, m) {
    if (typeof m === 'number') {
      return [clamp(c[0] * m, 0, 255), clamp(c[1] * m, 0, 255), clamp(c[2] * m, 0, 255)];
    }
    return [
      clamp(c[0] * m[0], 0, 255),
      clamp(c[1] * m[1], 0, 255),
      clamp(c[2] * m[2], 0, 255),
    ];
  }

  function addRGB(c, d) {
    return [
      clamp(c[0] + d[0], 0, 255),
      clamp(c[1] + d[1], 0, 255),
      clamp(c[2] + d[2], 0, 255),
    ];
  }

  function shiftRGB(c, dr, dg, db) {
    return [
      clamp(c[0] + dr, 0, 255),
      clamp(c[1] + dg, 0, 255),
      clamp(c[2] + db, 0, 255),
    ];
  }

  function rgbToHex(c) {
    const r = clamp(Math.round(c[0]), 0, 255).toString(16).padStart(2, '0');
    const g = clamp(Math.round(c[1]), 0, 255).toString(16).padStart(2, '0');
    const b = clamp(Math.round(c[2]), 0, 255).toString(16).padStart(2, '0');
    return '#' + r + g + b;
  }

  function luminance(c) {
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  }

  // Deterministic integer hash for rock-solid pixel texture noise
  function hash2(x, y) {
    let h = ((x | 0) * 374761393 + (y | 0) * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }

  function hash3(x, y, z) {
    let h = ((x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }

  // 4x4 Bayer ordered dithering matrix (values 0..15 normalized)
  const BAYER4_RAW = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const BAYER4 = BAYER4_RAW.map((row) => row.map((v) => (v + 0.5) / 16));

  // 8x8 Bayer ordered dithering matrix (values 0..63 normalized)
  const BAYER8_RAW = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  const BAYER8 = BAYER8_RAW.map((row) => row.map((v) => (v + 0.5) / 64));

  function bayer4(x, y) {
    return BAYER4[y & 3][x & 3];
  }

  function bayer8(x, y) {
    return BAYER8[y & 7][x & 7];
  }

  // 24-hour keyframe table for smooth continuous lighting
  const TIME_KEYS = [
    {
      h: 0.0,
      bg: [17, 22, 35],
      ambient: [0.46, 0.52, 0.68],
      warmth: 0.0,
      night: 1.0,
      shadowStrength: 0.14,
      skyGlow: [28, 38, 64],
    },
    {
      h: 4.8,
      bg: [22, 28, 44],
      ambient: [0.5, 0.56, 0.72],
      warmth: 0.05,
      night: 0.94,
      shadowStrength: 0.16,
      skyGlow: [44, 56, 86],
    },
    {
      h: 6.2,
      bg: [236, 240, 246],
      ambient: [0.92, 0.91, 0.98],
      warmth: 0.25,
      night: 0.25,
      shadowStrength: 0.26,
      skyGlow: [248, 206, 176],
    },
    {
      h: 8.2,
      bg: [255, 255, 255],
      ambient: [1.03, 1.01, 0.98],
      warmth: 0.18,
      night: 0.0,
      shadowStrength: 0.34,
      skyGlow: [218, 236, 252],
    },
    {
      h: 12.5,
      bg: [255, 255, 255],
      ambient: [1.04, 1.04, 1.04],
      warmth: 0.04,
      night: 0.0,
      shadowStrength: 0.3,
      skyGlow: [212, 232, 250],
    },
    {
      h: 16.8,
      bg: [255, 255, 255],
      ambient: [0.98, 0.99, 1.01],
      warmth: 0.08,
      night: 0.0,
      shadowStrength: 0.32,
      skyGlow: [225, 234, 245],
    },
    {
      h: 18.6,
      bg: [252, 245, 236],
      ambient: [1.08, 0.92, 0.81],
      warmth: 0.85,
      night: 0.18,
      shadowStrength: 0.42,
      skyGlow: [248, 168, 118],
    },
    {
      h: 19.7,
      bg: [36, 44, 68],
      ambient: [0.68, 0.66, 0.8],
      warmth: 0.3,
      night: 0.78,
      shadowStrength: 0.2,
      skyGlow: [110, 76, 98],
    },
    {
      h: 21.2,
      bg: [17, 22, 35],
      ambient: [0.48, 0.54, 0.7],
      warmth: 0.0,
      night: 0.98,
      shadowStrength: 0.14,
      skyGlow: [32, 42, 70],
    },
    {
      h: 24.0,
      bg: [17, 22, 35],
      ambient: [0.46, 0.52, 0.68],
      warmth: 0.0,
      night: 1.0,
      shadowStrength: 0.14,
      skyGlow: [28, 38, 64],
    },
  ];

  function sampleTimeKey(hours) {
    let h = ((hours % 24) + 24) % 24;
    let i = 0;
    while (i < TIME_KEYS.length - 2 && TIME_KEYS[i + 1].h < h) {
      i++;
    }
    const a = TIME_KEYS[i];
    const b = TIME_KEYS[i + 1];
    const span = Math.max(0.0001, b.h - a.h);
    const t = smoothstep(0, 1, (h - a.h) / span);
    return {
      bg: lerpRGB(a.bg, b.bg, t),
      ambient: lerpRGB(a.ambient, b.ambient, t),
      warmth: lerp(a.warmth, b.warmth, t),
      night: lerp(a.night, b.night, t),
      shadowStrength: lerp(a.shadowStrength, b.shadowStrength, t),
      skyGlow: lerpRGB(a.skyGlow, b.skyGlow, t),
    };
  }

  /**
   * Computes the full harmonized color palette for the current frame.
   * @param {number} hours 0..24
   * @param {object} env blended scenario weather parameters
   * @param {number} lightningFlash 0..1
   */
  function computeAtmosphere(hours, env, lightningFlash) {
    const base = sampleTimeKey(hours);
    const storm = clamp(env.storminess || 0, 0, 1);
    const snow = clamp(env.snowLevel || 0, 0, 1);
    const goldenBoost = clamp(env.goldenBoost || 0, 0, 1);
    const flash = clamp(lightningFlash || 0, 0, 1);

    // Background color: keep gallery white crisp in daylight & squall, pale frost in winter,
    // warm cream in golden hour, deep indigo at night.
    let bg = base.bg.slice();
    if (snow > 0.01 && base.night < 0.65) {
      const frosty = [232, 240, 248];
      bg = lerpRGB(bg, frosty, snow * 0.85 * (1 - base.night));
    }
    if (storm > 0.2 && base.night < 0.45) {
      // Pure gallery white like the reference screenshot during daytime squall
      bg = lerpRGB(bg, [255, 255, 255], storm * 0.85 * (1 - base.night));
    }
    if (goldenBoost > 0.05 && base.night < 0.5) {
      bg = lerpRGB(bg, [252, 245, 236], goldenBoost * 0.65);
    }

    // Ambient lighting multiplier on architectural materials
    let ambient = base.ambient.slice();
    // Overcast storm cools & slightly flattens light
    if (storm > 0.01) {
      ambient = lerpRGB(ambient, mulRGB(ambient, [0.91, 0.94, 0.99]), storm * 0.85);
    }
    // Snow adds crisp cool skylight bounce
    if (snow > 0.01) {
      ambient = lerpRGB(ambient, mulRGB(ambient, [0.95, 0.99, 1.06]), snow * 0.7);
    }
    // Lightning flash briefly overexposes everything cool-white
    if (flash > 0.005) {
      ambient = lerpRGB(ambient, [1.34, 1.38, 1.48], flash * 0.75);
    }

    const applyLight = (rgb) => {
      let c = mulRGB(rgb, ambient);
      if (flash > 0.01) {
        c = lerpRGB(c, [242, 248, 255], flash * 0.28);
      }
      return c;
    };

    // Base concrete material palette (harmonized directly to screenshot's cool plaster look)
    const wallTop = applyLight([212, 217, 224]);
    const wallLeft = applyLight([192, 198, 207]);
    const wallRight = applyLight([156, 163, 174]);
    const wallInnerLeft = applyLight([164, 170, 180]);
    const wallInnerRight = applyLight([132, 140, 152]);
    const copingLight = applyLight([224, 229, 236]);
    const copingDark = applyLight([172, 179, 190]);
    const ink = applyLight([54, 60, 72]);

    // Warm terracotta-brown weathered rooftop tiles (matching screenshot)
    const tileBase = applyLight([145, 117, 98]);
    const tileAlt = applyLight([132, 106, 88]);
    const tileGrout = applyLight([108, 86, 72]);
    const tileWet = applyLight([94, 77, 68]);

    // Windows: cool dark teal-slate when unlit, warm amber when lit
    const windowFrame = applyLight([124, 134, 146]);
    const windowSill = applyLight([206, 211, 218]);
    const windowGlass = applyLight([46, 78, 88]);
    const windowGlassDeep = applyLight([30, 52, 62]);
    const windowGlassShine = applyLight([92, 128, 138]);
    const windowLit = [252, 206, 116];
    const windowLitCore = [255, 240, 188];

    // Foliage / garden
    const leafBright = applyLight([124, 166, 92]);
    const leafMid = applyLight([94, 134, 72]);
    const leafDark = applyLight([62, 92, 52]);
    const bark = applyLight([110, 78, 56]);
    const planter = applyLight([156, 98, 72]);
    const planterShade = applyLight([118, 72, 54]);
    const soil = applyLight([78, 56, 44]);

    // Props
    const woodTop = applyLight([198, 166, 126]);
    const woodLeft = applyLight([166, 134, 98]);
    const woodRight = applyLight([134, 104, 74]);
    const blueTarp = applyLight([88, 136, 166]);
    const blueTarpDark = applyLight([58, 96, 124]);
    const ochreTarp = applyLight([212, 182, 106]);
    const ochreTarpDark = applyLight([164, 134, 72]);

    // Snow colors
    const snowBright = applyLight([244, 249, 255]);
    const snowMid = applyLight([216, 228, 242]);
    const snowShade = applyLight([176, 194, 216]);

    // Dynamic sun cast shadow vector (in iso u, v units per unit height)
    const dayPhase = clamp((hours - 6) / 13, 0, 1); // 0 at 6am, 0.5 at 12:30, 1 at 7pm
    const sunAngle = lerp(-1.15, 1.15, dayPhase);
    const shadowScale = lerp(0.55, 1.25, Math.abs(dayPhase - 0.5) * 2);
    const sunDir = [
      Math.sin(sunAngle) * shadowScale * 0.72,
      (0.35 + Math.cos(sunAngle) * 0.35) * shadowScale * 0.65,
    ];

    // Effective shadow darkness weakens under heavy storm clouds or full night
    const shadowAlpha = base.shadowStrength * (1 - storm * 0.55) * (1 - snow * 0.25);

    // Night & lamp activation curve
    const night = base.night;
    const lightsOn = smoothstep(0.16, 0.62, night + (storm * 0.14));

    const isDarkTheme = luminance(bg) < 0.44;

    return {
      hours,
      bg,
      bgHex: rgbToHex(bg),
      bgU32: packRGB(bg),
      isDarkTheme,
      ambient,
      warmth: base.warmth,
      night,
      lightsOn,
      storm,
      snow,
      flash,
      skyGlow: base.skyGlow,
      sunDir,
      shadowAlpha,
      applyLight,
      // Precomputed architectural colors
      wallTop,
      wallLeft,
      wallRight,
      wallInnerLeft,
      wallInnerRight,
      copingLight,
      copingDark,
      ink,
      tileBase,
      tileAlt,
      tileGrout,
      tileWet,
      windowFrame,
      windowSill,
      windowGlass,
      windowGlassDeep,
      windowGlassShine,
      windowLit,
      windowLitCore,
      leafBright,
      leafMid,
      leafDark,
      bark,
      planter,
      planterShade,
      soil,
      woodTop,
      woodLeft,
      woodRight,
      blueTarp,
      blueTarpDark,
      ochreTarp,
      ochreTarpDark,
      snowBright,
      snowMid,
      snowShade,
    };
  }

  Diorama.Palette = {
    pack,
    packRGB,
    clamp,
    lerp,
    smoothstep,
    lerpRGB,
    mulRGB,
    addRGB,
    shiftRGB,
    rgbToHex,
    luminance,
    hash2,
    hash3,
    bayer4,
    bayer8,
    computeAtmosphere,
  };
})(window);
