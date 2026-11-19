/*
 * Chapter 1 — «Обычный день» (City park, Day 1, 14:20)
 *
 * A calm sunny park. A sick-looking man stumbles in, a passer-by tries to help,
 * gets bitten — panic spreads, people run for the exits, more of "them" arrive
 * from the streets. Our hero (red jacket, backpack) escapes through the east gate.
 * The camera ends on an empty plaza and a red balloon rising into the darkening sky.
 *
 * Layout (world units, u → screen right-down, v → screen left-down):
 *   main path along u at v = 22, cross path along v at u = 32, round plaza + fountain
 *   in the centre, playground front-right, picnic lawn front-left.
 *   Exits: A (west, u=0)  B (east, u=64)  C (north, v=0)  D (south, v=44)
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { computeAtmosphere, clamp, lerp, lerpRGB, mulRGB, shiftRGB, hash2, bayer4, smoothstep, packRGB, rgbToHex } = Diorama.Palette;
  const Kit = Diorama.StoryKit;
  const { Crowd } = Diorama.Actors;
  const Weather = Diorama.Weather;
  const { CANVAS_W, CANVAS_H } = Diorama.Iso;

  // ── World layout ──────────────────────────────────────────────────
  const U = 64;
  const V = 44;
  const DEPTH = 9;
  const PATH_HALF = 2.3;
  const MAIN_V = 22;
  const CROSS_U = 32;
  const PLAZA_R = 9;
  const FOUNTAIN = { u: 32, v: 22, r: 4.2 };
  const SANDBOX = { u0: 45, u1: 55, v0: 30, v1: 39 };
  const BLANKET = { u0: 9, u1: 13.6, v0: 30.4, v1: 34.2 };
  const FLOWERBEDS = [
    { u: 5.5, v: 39, r: 3.0 },
    { u: 58, v: 15.5, r: 2.7 },
    { u: 22.5, v: 30.5, r: 1.8 },
    { u: 41.5, v: 30.5, r: 1.8 },
  ];
  const TREES = [
    { u: 8, v: 8, kind: 'round', size: 1.15 },
    { u: 18, v: 5.5, kind: 'tall', size: 1.0 },
    { u: 24, v: 13, kind: 'blossom', size: 0.95 },
    { u: 4.5, v: 15, kind: 'tall', size: 0.9 },
    { u: 47, v: 6.5, kind: 'round', size: 1.25 },
    { u: 57, v: 9.5, kind: 'blossom', size: 1.0 },
    { u: 41, v: 9.5, kind: 'round', size: 0.95 },
    { u: 16, v: 37, kind: 'round', size: 1.05 },
    { u: 4, v: 27, kind: 'round', size: 0.9 },
    { u: 60, v: 31, kind: 'round', size: 1.05 },
    { u: 39, v: 39.5, kind: 'tall', size: 0.85 },
    { u: 25, v: 40.5, kind: 'round', size: 0.8 },
  ];
  // Benches: centre, orientation of length ('u' or 'v'), which way the sitter faces (screen)
  const BENCHES = [
    { u: 12, v: 18.5, along: 'u', back: -1 },
    { u: 22, v: 18.5, along: 'u', back: -1 },
    { u: 44, v: 25.5, along: 'u', back: 1 },
    { u: 54, v: 25.5, along: 'u', back: 1 },
    { u: 28.5, v: 34, along: 'v', back: -1 },
    { u: 35.5, v: 8, along: 'v', back: 1 },
  ];
  const LAMPS = [
    { u: 16, v: 25 }, { u: 26.5, v: 19 }, { u: 40, v: 25 }, { u: 50, v: 19 }, { u: 29, v: 39 }, { u: 35, v: 4.5 },
  ];
  const BINS = [{ u: 14.3, v: 25.1 }, { u: 47.6, v: 18.9 }];
  const CART = { u: 37.6, v: 15.6 };
  const SWING = { u0: 46.5, u1: 53.5, v: 34.5, top: 7, seats: [48.5, 51.5] };
  const EXITS = [
    { id: 'A', u: 0.9, v: MAIN_V, du: -1, dv: 0 },
    { id: 'B', u: U - 0.9, v: MAIN_V, du: 1, dv: 0, playerExit: true, halfWidth: 3.8 },
    { id: 'C', u: CROSS_U, v: 0.9, du: 0, dv: -1 },
    { id: 'D', u: CROSS_U, v: V - 0.9, du: 0, dv: 1 },
  ];

  const PROJ = Kit.makeProjector(210, 84);
  const project = PROJ.project;

  // Unlit material palette
  const C = {
    grass: [120, 168, 86],
    grassAlt: [112, 160, 80],
    grassLight: [146, 192, 102],
    grassDark: [92, 140, 66],
    grassLip: [150, 198, 110],
    paver: [214, 205, 192],
    paverAlt: [204, 195, 182],
    grout: [176, 167, 154],
    curb: [188, 180, 170],
    plazaRing: [180, 170, 158],
    sand: [228, 208, 166],
    sandDark: [214, 192, 150],
    wood: [156, 116, 80],
    soil: [132, 96, 68],
    soilDark: [104, 74, 54],
    soilDeep: [86, 62, 46],
    stone: [158, 148, 136],
    hedge: [86, 132, 66],
    hedgeLight: [110, 158, 80],
    hedgeDark: [64, 104, 52],
    bark: [110, 78, 56],
    leafBright: [128, 172, 94],
    leafMid: [96, 140, 74],
    leafDark: [64, 98, 54],
    blossom: [244, 196, 210],
    blossomHi: [252, 226, 232],
    metal: [56, 64, 64],
    benchTop: [196, 150, 100],
    benchSide: [160, 118, 78],
    benchDark: [126, 90, 60],
    water: [104, 166, 204],
    waterHi: [196, 230, 246],
    stoneTop: [210, 204, 196],
    stoneSide: [176, 170, 162],
    stoneDark: [146, 140, 134],
  };

  function onPath(u, v) {
    const dp = Math.hypot(u - FOUNTAIN.u, v - FOUNTAIN.v);
    const inner = Math.max(PATH_HALF - Math.abs(v - MAIN_V), PATH_HALF - Math.abs(u - CROSS_U), PLAZA_R - dp);
    return { inner, dp };
  }

  // ── Static ground bake ───────────────────────────────────────────
  function bakeGround(sunDir) {
    const L = new Kit.LitLayer(CANVAS_W, CANVAS_H);
    const top = [project(0, 0), project(U, 0), project(U, V), project(0, V)];

    L.fillPoly(top, (x, y) => {
      const uv = PROJ.unproject(x + 0.5, y + 0.5, 0);
      const u = uv[0];
      const v = uv[1];
      const n = hash2(x, y);
      const { inner, dp } = onPath(u, v);

      if (inner > 0) {
        if (inner < 0.4) return n > 0.5 ? C.curb : shiftRGB(C.curb, -8, -8, -8);
        if (dp < PLAZA_R) {
          if (dp > 4.4 && dp < 5.3) return n > 0.3 ? C.plazaRing : shiftRGB(C.plazaRing, -10, -10, -10);
          const ring = Math.floor(dp / 1.4);
          if (dp % 1.4 < 0.16) return C.grout;
          const ang = Math.atan2(v - FOUNTAIN.v, u - FOUNTAIN.u) + Math.PI;
          const segs = 6 + ring * 4;
          const sf = (ang / (Math.PI * 2)) * segs;
          if (sf % 1 < 0.06 * (1 + ring * 0.2)) return C.grout;
          const base = hash2(ring, Math.floor(sf)) > 0.5 ? C.paver : C.paverAlt;
          return shiftRGB(base, (n - 0.5) * 8, (n - 0.5) * 8, (n - 0.5) * 8);
        }
        // Running-bond paving along each path
        const alongU = Math.abs(v - MAIN_V) < PATH_HALF;
        const a = alongU ? u : v;
        const b = alongU ? v : u;
        const row = Math.floor(b * 1.0);
        if (b % 1 < 0.13) return C.grout;
        const off = (row % 2) * 1.0;
        if ((a + off) % 2 < 0.12) return C.grout;
        const base = hash2(Math.floor((a + off) / 2), row) > 0.5 ? C.paver : C.paverAlt;
        return shiftRGB(base, (n - 0.5) * 8, (n - 0.5) * 8, (n - 0.5) * 8);
      }

      // Sandbox
      if (u > SANDBOX.u0 && u < SANDBOX.u1 && v > SANDBOX.v0 && v < SANDBOX.v1) {
        const e = Math.min(u - SANDBOX.u0, SANDBOX.u1 - u, v - SANDBOX.v0, SANDBOX.v1 - v);
        if (e < 0.45) return n > 0.4 ? C.wood : shiftRGB(C.wood, -14, -12, -10);
        return n > 0.82 ? C.sandDark : shiftRGB(C.sand, (n - 0.5) * 10, (n - 0.5) * 10, (n - 0.5) * 8);
      }

      // Picnic blanket
      if (u > BLANKET.u0 && u < BLANKET.u1 && v > BLANKET.v0 && v < BLANKET.v1) {
        const chk = (Math.floor(u * 1.5) + Math.floor(v * 1.5)) % 2 === 0;
        const e = Math.min(u - BLANKET.u0, BLANKET.u1 - u, v - BLANKET.v0, BLANKET.v1 - v);
        if (e < 0.2) return [236, 228, 214];
        return chk ? [206, 66, 62] : [242, 234, 222];
      }

      // Flower beds
      for (let i = 0; i < FLOWERBEDS.length; i++) {
        const fb = FLOWERBEDS[i];
        const d = Math.hypot(u - fb.u, v - fb.v);
        if (d < fb.r) {
          if (d > fb.r - 0.45) return n > 0.5 ? C.soilDark : C.soil;
          const fn = hash2(x * 5 + i, y * 3);
          if (fn > 0.62) {
            const pal = [[232, 72, 78], [246, 206, 84], [244, 240, 232], [170, 110, 200], [246, 150, 70]];
            return pal[Math.floor(hash2(x, y * 7 + i) * pal.length)];
          }
          return fn > 0.3 ? [84, 128, 60] : [70, 112, 52];
        }
      }

      // Grass with mowing stripes, blades and tiny flowers
      const stripe = Math.floor((u + v * 0.15) / 4) % 2 === 0;
      let col = stripe ? C.grass : C.grassAlt;
      if (n > 0.86) col = C.grassLight;
      else if (n < 0.1) col = C.grassDark;
      const fl = hash2(x * 7 + 3, y * 3 + 1);
      if (fl > 0.994) col = [244, 244, 232];
      else if (fl > 0.989) col = [246, 214, 92];
      // ambient occlusion near back hedges
      const ao = Math.min(u, v);
      if (ao < 2.6) col = mulRGB(col, 0.86 + ao * 0.05);
      // bright sunlit lip on the front edges
      if (u > U - 0.45 || v > V - 0.45) col = C.grassLip;
      return col;
    });

    // Front-left face (v = V) and front-right face (u = U): grass lip + soil strata
    const sideFn = (face) => (x, y) => {
      let yTop;
      if (face === 'left') {
        const u = (x + 0.5 - PROJ.ox) / 3 + V;
        yTop = PROJ.oy + (u + V) * 1.5;
      } else {
        const v = U - (x + 0.5 - PROJ.ox) / 3;
        yTop = PROJ.oy + (U + v) * 1.5;
      }
      const zb = (y + 0.5 - yTop) / 1.5;
      const n = hash2(x * 3, y * 5);
      let col;
      if (zb < 0.9) col = C.grassDark;
      else if (zb < 1.5) col = n > 0.5 ? [80, 112, 56] : C.soilDark;
      else if (zb > DEPTH - 0.9) col = C.soilDeep;
      else {
        col = C.soil;
        if (Math.abs(zb - 3.6 - Math.sin(x * 0.21) * 0.4) < 0.45) col = C.soilDark;
        if (Math.abs(zb - 6.4 - Math.sin(x * 0.13 + 2) * 0.5) < 0.4) col = C.soilDark;
        if (n > 0.93) col = C.stone;
        else if (n < 0.06) col = C.soilDeep;
        if (zb < 2.6 && hash2(x, 91) > 0.9 && n > 0.4) col = [150, 112, 76];
      }
      return face === 'right' ? mulRGB(col, 0.82) : col;
    };
    L.fillPoly([project(0, V, 0), project(U, V, 0), project(U, V, -DEPTH), project(0, V, -DEPTH)], sideFn('left'));
    L.fillPoly([project(U, V, 0), project(U, 0, 0), project(U, 0, -DEPTH), project(U, V, -DEPTH)], sideFn('right'));

    // Edge ink lines for a crisp diorama silhouette
    const ink = [54, 60, 72];
    const lineInk = (p0, p1, a) => {
      const n = Math.max(Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]));
      for (let i = 0; i <= n; i++) {
        L.blendPx(Math.round(p0[0] + ((p1[0] - p0[0]) * i) / n), Math.round(p0[1] + ((p1[1] - p0[1]) * i) / n), ink, a);
      }
    };
    lineInk(project(0, V, 0), project(0, V, -DEPTH), 0.8);
    lineInk(project(U, 0, 0), project(U, 0, -DEPTH), 0.8);
    lineInk(project(0, V, -DEPTH), project(U, V, -DEPTH), 0.85);
    lineInk(project(U, V, -DEPTH), project(U, 0, -DEPTH), 0.85);
    lineInk(project(U, V, 0), project(U, V, -DEPTH), 0.25);
    lineInk(project(0, 0, 0), project(U, 0, 0), 0.5);
    lineInk(project(0, 0, 0), project(0, V, 0), 0.5);

    // Back hedges with gaps for gates A and C (drawn as low leafy boxes)
    const hedgeBox = (u0, v0, u1, v1, h) => {
      const tp = [project(u0, v0, h), project(u1, v0, h), project(u1, v1, h), project(u0, v1, h)];
      const lf = [project(u0, v1, h), project(u1, v1, h), project(u1, v1, 0), project(u0, v1, 0)];
      const rf = [project(u1, v1, h), project(u1, v0, h), project(u1, v0, 0), project(u1, v1, 0)];
      const leafy = (base) => (x, y) => {
        const n = hash2(x * 5 + 1, y * 3 + 7);
        if (n > 0.8) return C.hedgeLight;
        if (n < 0.18) return C.hedgeDark;
        return base;
      };
      L.fillPoly(lf, leafy(C.hedge));
      L.fillPoly(rf, leafy(mulRGB(C.hedge, 0.82)));
      L.fillPoly(tp, leafy(C.hedgeLight));
    };
    hedgeBox(0, 0, CROSS_U - 2.8, 1.3, 2.6);
    hedgeBox(CROSS_U + 2.8, 0, U, 1.3, 2.6);
    hedgeBox(0, 1.3, 1.3, MAIN_V - 2.8, 2.6);
    hedgeBox(0, MAIN_V + 2.8, 1.3, V, 2.6);

    // Baked soft shadows (sun is high, early afternoon)
    const shade = [40, 52, 50];
    const castShadow = (u, v, h, r, a) => {
      const c = project(u + sunDir[0] * h * 0.5, v + sunDir[1] * h * 0.5, 0);
      Kit.ditherEllipse(L, c[0], c[1], r * 3, r * 1.5, shade, a);
    };
    TREES.forEach((t) => castShadow(t.u, t.v, 9, 3.3 * t.size, 0.26));
    BENCHES.forEach((b) => castShadow(b.u, b.v, 1.5, 1.4, 0.2));
    castShadow(CART.u, CART.v, 3, 1.9, 0.22);
    castShadow(FOUNTAIN.u, FOUNTAIN.v, 2, 4.8, 0.14);
    LAMPS.forEach((l) => castShadow(l.u, l.v, 4, 0.5, 0.2));

    L.finalize();
    return L;
  }

  // ── Small iso box for props ───────────────────────────────────────
  function box(buf, u0, v0, z0, u1, v1, z1, top, left, right, ink) {
    const p = (u, v, z) => project(u, v, z);
    buf.fillPoly([p(u0, v1, z1), p(u1, v1, z1), p(u1, v1, z0), p(u0, v1, z0)], left);
    buf.fillPoly([p(u1, v1, z1), p(u1, v0, z1), p(u1, v0, z0), p(u1, v1, z0)], right);
    buf.fillPoly([p(u0, v0, z1), p(u1, v0, z1), p(u1, v1, z1), p(u0, v1, z1)], top);
    if (ink) {
      const a = p(u0, v1, z0);
      const b = p(u1, v1, z0);
      const c = p(u1, v0, z0);
      buf.line(a[0], a[1], b[0], b[1], ink, 0.5);
      buf.line(b[0], b[1], c[0], c[1], ink, 0.5);
    }
  }

  // ── Chapter definition ────────────────────────────────────────────
  const CH1 = {
    id: 'park',
    number: 1,
    title: 'Обычный день',
    place: 'Городской парк',
    day: 'ДЕНЬ 1',
    duration: 900, // playable: ends when the hero escapes or dies
    nextTeaser: 'Глава 2 · «Слишком много» — в работе',

    create(api) {
      const startHours = 14 + 20 / 60;
      const weather = Weather.createWeather();
      const env = {
        rainIntensity: 0, snowIntensity: 0, snowLevel: 0, puddleLevel: 0, storminess: 0,
        cloudCoverage: 0.3, cloudDarkness: 0.05, cloudWarmth: 0.15, windSpeed: 0.35,
        lightningChance: 0, goldenBoost: 0, stringLights: 0, cinemaMode: 0, grillActive: 0,
        tarpsMode: 0, laundryCount: 0, pigeonsActive: 1, firefliesActive: 0, swallowsActive: 0, snowmanActive: 0,
      };
      const atmo0 = computeAtmosphere(startHours, env, 0);
      const ground = bakeGround(atmo0.sunDir);
      const decals = new Kit.Decals(PROJ);
      const particles = new Kit.Particles(PROJ, decals);
      const treeShapes = TREES.map((t, i) => Kit.makeTreeShape(i * 7.3 + 3, t.size, t.kind === 'tall' ? 'tall' : 'round'));
      const sfx = api.sfx;

      const obstacles = [];
      TREES.forEach((t) => obstacles.push({ u: t.u, v: t.v, r: 0.7 }));
      obstacles.push({ u: FOUNTAIN.u, v: FOUNTAIN.v, r: FOUNTAIN.r + 0.3 });
      BENCHES.forEach((b) => {
        if (b.along === 'u') {
          obstacles.push({ u: b.u - 0.9, v: b.v, r: 0.55 }, { u: b.u + 0.9, v: b.v, r: 0.55 });
        } else {
          obstacles.push({ u: b.u, v: b.v - 0.9, r: 0.55 }, { u: b.u, v: b.v + 0.9, r: 0.55 });
        }
      });
      LAMPS.forEach((l) => obstacles.push({ u: l.u, v: l.v, r: 0.3 }));
      BINS.forEach((b) => obstacles.push({ u: b.u, v: b.v, r: 0.4 }));
      obstacles.push({ u: CART.u, v: CART.v, r: 1.3 });
      obstacles.push({ u: SWING.u0, v: SWING.v, r: 0.5 }, { u: SWING.u1, v: SWING.v, r: 0.5 });
      FLOWERBEDS.forEach((f) => obstacles.push({ u: f.u, v: f.v, r: f.r * 0.85 }));

      const wanderPoints = [];
      for (let u = 5; u <= 59; u += 6) {
        wanderPoints.push({ u, v: MAIN_V - 1.1 }, { u: u + 3, v: MAIN_V + 1.1 });
      }
      for (let v = 4; v <= 40; v += 6) {
        wanderPoints.push({ u: CROSS_U - 1.1, v }, { u: CROSS_U + 1.1, v: v + 3 });
      }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        wanderPoints.push({ u: FOUNTAIN.u + Math.cos(a) * 6.8, v: FOUNTAIN.v + Math.sin(a) * 6.8 });
      }
      wanderPoints.push({ u: 15, v: 12 }, { u: 52, v: 13 }, { u: 20, v: 33 }, { u: 40, v: 34 }, { u: 10, v: 28 });

      const world = { U, V, obstacles, exits: EXITS, wanderPoints, proj: PROJ };
      const events = [];
      const crowd = new Crowd(world, {
        decals,
        particles,
        audio: sfx,
        onEvent: (type, data) => events.push({ type, data }),
      });

      // ── Cast ────────────────────────────────────────────────────
      const hero = crowd.add({
        role: 'hero', u: 1.5, v: 22.6, state: 'walk',
        look: { skin: [234, 198, 168], hair: [46, 36, 30], hairStyle: 'short', shirt: [204, 56, 48], pants: [56, 70, 104], shoes: [38, 38, 46] },
        protected: true, walkSpeed: 1.5, runSpeed: 4.0, reactMin: 0.25, reactRange: 0, gawkChance: 0,
        forcedExit: 'B', item: 'phone', panicArms: false, scriptLocked: true,
      });
      crowd.setScript(hero, [
        { type: 'goto', u: 10.5, v: 21.0, speed: 1.6 },
        { type: 'goto', u: 12, v: 19.5, speed: 1.2 },
        { type: 'sit', u: 12, v: 18.5, facing: -1 },
      ]);

      const helper = crowd.add({
        role: 'helper', u: 31, v: 21.2, state: 'walk', scriptLocked: true,
        look: { shirt: [84, 126, 186], pants: [134, 120, 98], hairStyle: 'short', hair: [78, 52, 36], skin: [224, 184, 150] },
        walkSpeed: 1.5, turnAt: 3.2,
      });
      crowd.setScript(helper, [
        { type: 'goto', u: 21, v: 21.4, speed: 1.45 },
        { type: 'wait', t: 1.2 },
        { type: 'goto', u: 16.5, v: 21.2, speed: 1.3 },
        { type: 'wait', t: 60 },
      ]);

      const oldman = crowd.add({
        role: 'oldman', u: 22, v: 18.5, state: 'sit', seated: true, facing: -1, stay: true,
        look: { hair: [206, 206, 210], hairStyle: 'bald', shirt: [136, 122, 98], pants: [92, 86, 78], skin: [230, 196, 170] },
        item: 'cane', runSpeed: 2.2, reactMin: 1.0, reactRange: 0.8, turnAt: 4.2,
      });

      const mom = crowd.add({
        role: 'mom', u: 26, v: 26.5, state: 'walk', walkSpeed: 1.1, area: { u: 31, v: 27.5, r: 5 },
        look: { shirt: [214, 134, 160], pants: [58, 72, 104], hairStyle: 'long', hair: [122, 82, 46] },
        runSpeed: 4.6, reactMin: 0.2,
      });
      mom.target = { u: 34, v: 30 };
      mom.stroller = crowd.addProp({ type: 'stroller', attached: mom });
      const kid = crowd.add({
        role: 'kid', size: 'kid', u: 25, v: 28, state: 'walk', follow: mom, followOff: [-1.0, 1.0], parent: mom,
        item: 'balloon', balloonColor: [224, 46, 54], noTarget: true, walkSpeed: 1.8, runSpeed: 4.9,
        look: { shirt: [240, 200, 72], pants: [86, 98, 122], hairStyle: 'long', hair: [122, 82, 46], skin: [242, 210, 184] },
      });

      const dogwalker = crowd.add({
        role: 'dogwalker', u: 31, v: 40, state: 'walk', walkSpeed: 1.3,
        route: [{ u: 30.9, v: 31 }, { u: 25, v: 23.2 }, { u: 12, v: 23.2 }, { u: 25, v: 23.2 }, { u: 30.9, v: 38 }],
        look: { shirt: [96, 152, 112], pants: [48, 52, 62], hairStyle: 'cap', cap: [236, 232, 220] },
      });
      dogwalker.target = { u: 30.9, v: 31 };
      crowd.add({ kind: 'dog', owner: dogwalker, state: 'follow', u: 32.4, v: 40.5, fur: [186, 132, 82], runSpeed: 7 });

      const jogger = crowd.add({
        role: 'jogger', jog: true, u: 52, v: 21.3, state: 'walk', walkSpeed: 1.7,
        route: [{ u: 61, v: 21.3 }, { u: 44, v: 23.0 }, { u: 24, v: 21.0 }, { u: 6, v: 22.8 }, { u: 24, v: 23.0 }, { u: 44, v: 21.0 }],
        look: { shirt: [238, 152, 70], pants: [40, 44, 58], hairStyle: 'cap', cap: [52, 88, 150] },
        runSpeed: 5.6,
      });
      jogger.target = { u: 61, v: 21.3 };

      const coupleA = crowd.add({
        role: 'couple', u: 33.2, v: 36, state: 'walk', walkSpeed: 1.0,
        route: [{ u: 33.2, v: 30 }, { u: 38, v: 27.5 }, { u: 33.2, v: 30 }, { u: 33.2, v: 41 }],
        look: { shirt: [152, 106, 172], hairStyle: 'long' },
      });
      coupleA.target = { u: 33.2, v: 30 };
      crowd.add({ role: 'couple', u: 34.2, v: 36.6, state: 'walk', follow: coupleA, followOff: [0.9, 0.2], walkSpeed: 1.0, look: { shirt: [72, 78, 94], hairStyle: 'short' } });

      crowd.add({ role: 'vendor', u: 39.3, v: 14.6, state: 'idle', stay: true, facing: -1, look: { shirt: [240, 236, 228], pants: [72, 78, 94], hairStyle: 'cap', cap: [214, 72, 84] } });
      const customer = crowd.add({ role: 'customer', u: 47, v: 20.8, state: 'walk', look: { shirt: [118, 172, 198], hairStyle: 'bun' } });
      crowd.setScript(customer, [
        { type: 'goto', u: 39.6, v: 17.2, speed: 1.4 },
        { type: 'face', dir: -1 },
        { type: 'wait', t: 2.2 },
        { type: 'call', fn: (a) => { a.item = 'icecream'; } },
        { type: 'goto', u: 36.5, v: 27.5, speed: 1.2 },
        { type: 'goto', u: 44, v: 27, speed: 1.2 },
      ]);

      crowd.add({ role: 'teen', u: 51, v: 14.2, state: 'sit', seated: true, seatZ: 0, facing: -1, stay: true, item: 'phone', look: { shirt: [72, 78, 94], hairStyle: 'cap', cap: [204, 60, 56] } });
      crowd.add({ role: 'teen', u: 52.6, v: 13.0, state: 'sit', seated: true, seatZ: 0, facing: -1, stay: true, look: { shirt: [232, 196, 86], hairStyle: 'long' } });
      crowd.add({ role: 'reader', u: 44, v: 25.5, state: 'sit', seated: true, facing: 1, stay: true, item: 'book', look: { shirt: [180, 86, 98], hairStyle: 'bun', hair: [200, 164, 98] } });
      crowd.add({ role: 'bench', u: 54.4, v: 25.5, state: 'sit', seated: true, facing: 1, stay: true, item: 'phone', look: { shirt: [110, 116, 74], hairStyle: 'short' } });
      crowd.add({ role: 'bench', u: 28.5, v: 34, state: 'sit', seated: true, facing: 1, stay: true, item: 'bag', look: { shirt: [226, 226, 220], hairStyle: 'short', hair: [156, 154, 156] }, runSpeed: 3.2, reactMin: 0.7 });

      // Playground: parent + 3 kids
      const parent2 = crowd.add({ role: 'parent', u: 47.5, v: 40.3, state: 'idle', stay: true, facing: -1, look: { shirt: [96, 152, 112], hairStyle: 'bun', hair: [42, 34, 30] } });
      const kidLook = () => ({ shirt: [[240, 120, 90], [120, 190, 230], [250, 210, 90]][Math.floor(Math.random() * 3)], pants: [86, 98, 122], hairStyle: 'short', skin: [238, 204, 176] });
      SWING.seats.forEach((su) => {
        crowd.add({ role: 'kid', size: 'kid', u: su, v: SWING.v, state: 'swing', swingTopZ: SWING.top, parent: parent2, noTarget: true, runSpeed: 4.7, look: kidLook() });
      });
      crowd.add({ role: 'kid', size: 'kid', u: 52.5, v: 31.6, state: 'sit', seated: true, seatZ: 0, facing: -1, stay: true, parent: parent2, noTarget: true, runSpeed: 4.6, look: kidLook() });
      crowd.addProp({ type: 'bucket', u: 53.6, v: 31.2 });

      crowd.add({ role: 'tourist', u: 25.2, v: 27.2, state: 'photo', stay: true, facing: 1, item: 'camera', look: { shirt: [232, 196, 86], hairStyle: 'cap', cap: [236, 232, 220] } });

      crowd.add({ role: 'picnic', u: 10.3, v: 31.6, state: 'sit', seated: true, seatZ: 0, facing: 1, stay: true, look: { shirt: [86, 128, 186], hairStyle: 'long' } });
      crowd.add({ role: 'picnic', u: 12.4, v: 32.8, state: 'sit', seated: true, seatZ: 0, facing: -1, stay: true, look: { shirt: [228, 228, 222], hairStyle: 'short' } });
      crowd.addProp({ type: 'basket', u: 11.6, v: 33.6 });

      for (let i = 0; i < 7; i++) {
        const wp = wanderPoints[(i * 5 + 3) % wanderPoints.length];
        crowd.add({ u: wp.u + (Math.random() - 0.5), v: wp.v + (Math.random() - 0.5), state: 'idle', wait: Math.random() * 3, item: Math.random() < 0.3 ? 'bag' : null });
      }

      for (let i = 0; i < 10; i++) {
        crowd.addBird(28 + Math.random() * 8, 25.5 + Math.random() * 4.5);
      }

      // ── Timeline ────────────────────────────────────────────────
      let p0 = null;
      let lastT = 0;
      let panicStarted = false;
      let panicT = 0;
      let screamT = 0;
      const timeline = [];
      const at = (t, fn) => timeline.push({ t, fn, done: false });

      at(0.0, () => {
        api.hideCard();
        api.fade(0, 0);
      });
      at(10.6, () => {
        p0 = crowd.add({
          kind: 'zombie', role: 'p0', u: 0.6, v: 21.7, state: 'idle', revealed: false, zombify: 0.32,
          look: { skin: [222, 200, 178], hair: [64, 58, 54], hairStyle: 'short', shirt: [118, 122, 132], pants: [64, 62, 70] },
          chaseSpeed: 3.7, shambleSpeed: 0.85,
        });
        crowd.setScript(p0, [
          { type: 'goto', u: 4.5, v: 21.3, speed: 0.75 },
          { type: 'goto', u: 7.6, v: 21.9, speed: 0.6 },
          { type: 'wait', t: 60 },
        ]);
      });
      at(12.4, () => {
        crowd.setScript(helper, [
          { type: 'emote', emote: 'question', t: 1.6 },
          { type: 'approach', who: p0, speed: 1.9, r: 1.05 },
          { type: 'emote', emote: 'dots', t: 1.4 },
          { type: 'wait', t: 60 },
        ]);
      });
      at(16.2, () => {
        // The bite — everything changes
        p0.script = null;
        p0.revealed = true;
        p0.zombify = 1;
        p0.state = 'shamble';
        helper.script = null;
        helper.scriptLocked = false;
        crowd.panic = true;
        crowd.hunting = true;
        crowd.bite(p0, helper);
        p0.feedBonus = 1;
        api.shake(0.9);
        sfx.stinger();
        panicStarted = true;
        panicT = 16.2;
        // Hero freezes in shock for a moment
        hero.script = null;
        hero.seated = false;
        hero.state = 'idle';
        hero.stay = true;
        hero.emote = 'exclaim';
        hero.emoteT = 2.0;
        crowd.faceToward(hero, p0);
      });
      // ── The player takes control ────────────────────────────────
      const CONTROL_AT = 17.6;
      const GUN = { mag: 12, ammo: 12, reserve: 24, reloadT: 0, fireCD: 0, meleeCD: 0 };
      let playing = false;
      let heroDeadT = -1;
      let trickleT = 6;
      let muzzleFlash = 0;
      let hurtFlash = 0;
      let cross = [240, 135];
      let crossOnZombie = false;
      const tracers = [];
      const GOAL = 'Доберись до восточных ворот';

      at(CONTROL_AT, () => {
        hero.scriptLocked = false;
        hero.stay = false;
        hero.protected = false;
        hero.forcedExit = null;
        hero.controlled = true;
        hero.armed = true;
        hero.hp = 3;
        hero.runSpeed = 3.9;
        hero.turnAt = -1;
        hero.emote = null;
        hero.seated = false;
        hero.v = 19.9; // step off the bench onto the path
        crowd.dropItem(hero);
        playing = true;
        api.setPlayable(true);
        api.hint(true);
        api.after(8, () => api.hint(false));
        pushHud();
      });

      function pushHud() {
        api.hud({
          hp: Math.max(0, hero.hp), maxHp: 3, ammo: GUN.ammo, reserve: GUN.reserve,
          reloading: GUN.reloadT > 0, kills: crowd.kills, goal: GOAL,
        });
      }

      // More of "them" pour in from the streets — gates stop being safe
      const wave = (exitId, n) => {
        const e = EXITS.find((x) => x.id === exitId);
        for (let i = 0; i < n; i++) {
          const side = (i - (n - 1) / 2) * 1.4;
          crowd.add({
            kind: 'zombie', state: 'shamble',
            u: e.u - e.du * (0.4 + i * 0.7) + (e.dv !== 0 ? side : 0),
            v: e.v - e.dv * (0.4 + i * 0.7) + (e.du !== 0 ? side : 0),
            chaseSpeed: 3.5 + Math.random() * 0.6,
            look: Diorama.Actors.randomLook(),
          });
        }
        sfx.groan();
      };
      at(CONTROL_AT + 2, () => wave('C', 2));
      at(CONTROL_AT + 4, () => wave('D', 2));
      at(CONTROL_AT + 6.5, () => {
        // They block the way out and come straight for the hero
        const before = crowd.actors.length;
        wave('B', 4);
        for (let i = before; i < crowd.actors.length; i++) {
          const z = crowd.actors[i];
          if (z.kind === 'zombie' && hero.controlled && hero.state !== 'down') {
            z.prey = hero;
            z.state = 'chase';
          }
        }
      });
      at(CONTROL_AT + 9, () => wave('A', 2));

      function finishWin() {
        const saved = Math.max(0, crowd.escaped - (hero.removed ? 1 : 0));
        api.end({
          kicker: 'Конец главы 1',
          title: 'Ты выбрался из парка',
          sub: `Убито зомби: ${crowd.kills} · Спаслись: ${saved} · Погибли: ${crowd.victims}`,
          retry: 'Пройти ещё раз',
        });
      }

      function finishDeath() {
        api.end({
          kicker: 'День 1 · ' + Diorama.formatClock(startHours + lastT / 240),
          title: 'Тебя укусили',
          sub: `Убито зомби: ${crowd.kills}. Попробуй ещё раз.`,
          retry: 'Ещё раз',
          death: true,
        });
      }

      // Victims: some of them come back; player events end the chapter
      const handleEvents = () => {
        while (events.length) {
          const e = events.shift();
          if (e.type === 'bite') {
            const t = e.data.t;
            if (t.turnAt < 0 && t.role !== 'helper' && t.role !== 'oldman' && t.role !== 'hero') {
              t.turnAt = Math.random() < 0.6 ? 3 + Math.random() * 3.5 : -1;
            }
            if (lastT > 17) api.shake(0.35);
          } else if (e.type === 'playerHurt') {
            api.shake(0.7);
            hurtFlash = 0.45;
            sfx.heartbeat();
          } else if (e.type === 'playerDown') {
            playing = false;
            heroDeadT = lastT;
            hurtFlash = 0.8;
            api.setPlayable(false);
            api.hint(false);
            pushHud();
          } else if (e.type === 'death' && e.data === hero) {
            api.after(1.4, () => api.fade(0.92, 1.4));
            api.after(2.9, finishDeath);
          } else if (e.type === 'playerExit') {
            playing = false;
            api.setPlayable(false);
            api.hint(false);
            api.after(0.9, () => api.fade(1, 1.4));
            api.after(2.5, finishWin);
          }
        }
      };

      // ── Combat ──────────────────────────────────────────────────
      function heroGun() {
        const hp = project(hero.u, hero.v, 0);
        const ox = hero.muzzleX != null ? hero.muzzleX : hp[0] + (hero.aimSX || 1) * 7;
        const oy = hero.muzzleY != null ? hero.muzzleY : hp[1] - 7 + (hero.aimSY || 0) * 5;
        return [ox, oy];
      }

      function zombieBox(z) {
        const p = project(z.u, z.v, 0);
        const top = z.state === 'feed' ? 11 : 15;
        return [p[0] - 3.5, p[1] - top, p[0] + 3.5, p[1] + 1];
      }

      // Screen-space ray vs zombie boxes: what you aim at is what you hit
      function rayHit(ox, oy, dx, dy, maxLen) {
        let best = null;
        const acts = crowd.actors;
        for (let i = 0; i < acts.length; i++) {
          const z = acts[i];
          if (z.kind !== 'zombie' || z.state === 'down' || z.removed) continue;
          if (Math.hypot(z.u - hero.u, z.v - hero.v) > 26) continue;
          const b = zombieBox(z);
          let tmin = 0;
          let tmax = maxLen;
          if (Math.abs(dx) < 1e-6) {
            if (ox < b[0] || ox > b[2]) continue;
          } else {
            let t1 = (b[0] - ox) / dx;
            let t2 = (b[2] - ox) / dx;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
          }
          if (Math.abs(dy) < 1e-6) {
            if (oy < b[1] || oy > b[3]) continue;
          } else {
            let t1 = (b[1] - oy) / dy;
            let t2 = (b[3] - oy) / dy;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
          }
          if (tmax < tmin) continue;
          if (!best || tmin < best.t) {
            const hy = oy + dy * tmin;
            best = { z, t: tmin, hx: ox + dx * tmin, hy, head: hy < b[1] + 5 };
          }
        }
        return best;
      }

      function zombieUnderCross() {
        const acts = crowd.actors;
        for (let i = 0; i < acts.length; i++) {
          const z = acts[i];
          if (z.kind !== 'zombie' || z.state === 'down' || z.removed || !z.revealed) continue;
          const b = zombieBox(z);
          if (cross[0] >= b[0] - 1 && cross[0] <= b[2] + 1 && cross[1] >= b[1] - 1 && cross[1] <= b[3]) return true;
        }
        return false;
      }

      function reload() {
        if (GUN.reloadT > 0 || GUN.ammo >= GUN.mag || GUN.reserve <= 0) return;
        GUN.reloadT = 1.1;
        api.soundscape.playReload();
      }

      function shoot() {
        if (GUN.reloadT > 0 || GUN.fireCD > 0) return;
        if (GUN.ammo <= 0) {
          if (GUN.reserve > 0) reload();
          else sfx.tone(900, 'square', 0.03, 0.05);
          return;
        }
        GUN.ammo--;
        GUN.fireCD = 0.2;
        hero.recoil = 1;
        muzzleFlash = 0.07;
        const o = heroGun();
        const dx = hero.aimSX;
        const dy = hero.aimSY;
        const hit = rayHit(o[0], o[1], dx, dy, 240);
        let ex = o[0] + dx * 240;
        let ey = o[1] + dy * 240;
        if (hit) {
          ex = hit.hx;
          ey = hit.hy;
          const killed = crowd.damageZombie(hit.z, hit.head ? 3 : 2, hero.aimWU * 3.5, hero.aimWV * 3.5, 0.45);
          api.soundscape.playZombieHit();
          if (hit.head) particles.bloodBurst(hit.z.u, hit.z.v, 9, 6, 2.6);
          if (killed) api.shake(0.2);
        }
        tracers.push({ x0: o[0], y0: o[1], x1: ex, y1: ey, age: 0 });
        api.soundscape.playGunshot();
        api.shake(0.16);
        crowd.noise(hero, 20);
        particles.spawn({
          kind: 'shell', u: hero.u, v: hero.v, z: 6,
          vu: -hero.aimWV * 1.6 + (Math.random() - 0.5), vv: hero.aimWU * 1.6 + (Math.random() - 0.5),
          vz: 7, gravity: 34, maxAge: 5, col: [214, 178, 92],
        });
        if (GUN.ammo === 0 && GUN.reserve > 0) api.after(0.25, reload);
      }

      function melee() {
        if (GUN.meleeCD > 0) return;
        GUN.meleeCD = 0.42;
        hero.meleeT = 0.25;
        sfx.flap();
        let hitAny = false;
        const acts = crowd.actors;
        for (let i = 0; i < acts.length; i++) {
          const z = acts[i];
          if (z.kind !== 'zombie' || z.state === 'down' || z.removed) continue;
          const du = z.u - hero.u;
          const dv = z.v - hero.v;
          const d = Math.hypot(du, dv);
          if (d > 2.2 || d < 0.01) continue;
          if ((du * hero.aimWU + dv * hero.aimWV) / d < 0.05) continue;
          crowd.damageZombie(z, 1, (du / d) * 6.5, (dv / d) * 6.5, 1.0);
          hitAny = true;
        }
        if (hitAny) {
          sfx.thud();
          api.soundscape.playZombieHit();
          api.shake(0.28);
        }
      }

      function updatePlayer(dt) {
        const inp = api.input;
        const k = inp.keys;
        // Screen-relative WASD → iso world axes
        const mx = (k.d ? 1 : 0) - (k.a ? 1 : 0);
        const my = (k.s ? 1 : 0) - (k.w ? 1 : 0);
        let mu = mx + my;
        let mv = -mx + my;
        const ml = Math.hypot(mu, mv);
        if (ml > 0) {
          mu /= ml;
          mv /= ml;
        }
        hero.input = { mu, mv };

        cross = api.mouse();
        const hp = project(hero.u, hero.v, 0);
        const ax = cross[0] - hp[0];
        const ay = cross[1] - (hp[1] - 7);
        const al = Math.hypot(ax, ay) || 1;
        hero.aimSX = ax / al;
        hero.aimSY = ay / al;
        const w = PROJ.unproject(cross[0], cross[1] + 7, 0);
        let wu = w[0] - hero.u;
        let wv = w[1] - hero.v;
        const wl = Math.hypot(wu, wv) || 1;
        hero.aimWU = wu / wl;
        hero.aimWV = wv / wl;

        GUN.fireCD -= dt;
        GUN.meleeCD -= dt;
        if (GUN.reloadT > 0) {
          GUN.reloadT -= dt;
          if (GUN.reloadT <= 0) {
            const take = Math.min(GUN.mag - GUN.ammo, GUN.reserve);
            GUN.ammo += take;
            GUN.reserve -= take;
          }
        }
        if (inp.fire > 0) {
          inp.fire = 0;
          shoot();
        }
        if (inp.melee > 0) {
          inp.melee = 0;
          melee();
        }
        if (inp.reload > 0) {
          inp.reload = 0;
          reload();
        }
        crossOnZombie = zombieUnderCross();
        pushHud();
      }

      // ── Camera direction ────────────────────────────────────────
      const screenOf = (a, lift) => {
        const p = project(a.u, a.v, 0);
        return [p[0], p[1] - (lift == null ? 8 : lift)];
      };
      let lastHeroPos = null;

      function camera(t) {
        const ease = Kit.easeInOut;
        if (t < 10.8) {
          const k = ease(t / 10.8);
          return { x: lerp(240, 230, k), y: lerp(140, 146, k), zoom: lerp(1.0, 1.1, k), speed: 3 };
        }
        if (t < CONTROL_AT) {
          // Close on the stranger, the helper and the hero's bench
          const f = p0 ? screenOf(p0) : [150, 140];
          const g = screenOf(helper);
          const h = screenOf(hero);
          const cx = f[0] * 0.4 + g[0] * 0.3 + h[0] * 0.3;
          const cy = f[1] * 0.4 + g[1] * 0.3 + h[1] * 0.3;
          return { x: cx, y: cy, zoom: t < 16.2 ? 2.5 : 2.8, speed: 1.4 };
        }
        // Gameplay: follow the hero, leaning a little toward the crosshair
        if (!hero.removed) lastHeroPos = screenOf(hero);
        const hp = lastHeroPos || [200, 150];
        if (playing) {
          return {
            x: hp[0] + (cross[0] - hp[0]) * 0.22,
            y: hp[1] + (cross[1] - hp[1]) * 0.22,
            zoom: 2.3,
            speed: 5,
          };
        }
        return { x: hp[0], y: hp[1], zoom: heroDeadT >= 0 ? 2.9 : 2.3, speed: 1.5 };
      }

      function decayAt(t) {
        return smoothstep(16.2, 34, t) * 0.92;
      }

      let atmoCache = null;

      function update(t, dt) {
        lastT = t;
        for (let i = 0; i < timeline.length; i++) {
          const e = timeline[i];
          if (!e.done && t >= e.t) {
            e.done = true;
            e.fn();
          }
        }
        if (dt <= 0) return;

        // Weather/environment drift toward dread
        const d = decayAt(t);
        env.cloudCoverage = lerp(0.3, 0.98, d);
        env.cloudDarkness = lerp(0.05, 0.62, d);
        env.cloudWarmth = lerp(0.15, 0.0, d);
        env.windSpeed = lerp(0.35, 1.0, d);
        env.pigeonsActive = t < 16 ? 1 : 0;
        Weather.updateWeather(weather, { env, ripples: [], time: t, atmo: atmoCache }, dt, null);

        if (playing) updatePlayer(dt);
        if (muzzleFlash > 0) muzzleFlash -= dt;
        if (hurtFlash > 0) hurtFlash = Math.max(0, hurtFlash - dt * 1.2);
        for (let i = tracers.length - 1; i >= 0; i--) {
          tracers[i].age += dt;
          if (tracers[i].age > 0.09) tracers.splice(i, 1);
        }

        crowd.update(dt);
        decals.update(dt);
        particles.update(dt);
        handleEvents();

        // Keep the pressure on: stragglers keep wandering in from the city
        if (playing && t > CONTROL_AT + 16) {
          trickleT -= dt;
          if (trickleT <= 0) {
            trickleT = 6 + Math.random() * 3;
            const alive = crowd.actors.filter((a) => a.kind === 'zombie' && a.state !== 'down').length;
            if (alive < 18) {
              const far = EXITS.filter((e) => Math.hypot(e.u - hero.u, e.v - hero.v) > 14);
              const e = far[Math.floor(Math.random() * far.length)];
              if (e) wave(e.id, 1 + (Math.random() < 0.4 ? 1 : 0));
            }
          }
        }

        // Fountain water
        if (Math.random() < dt * 26) {
          const a = Math.random() * Math.PI * 2;
          particles.spawn({
            kind: 'water', u: FOUNTAIN.u, v: FOUNTAIN.v, z: 6.6,
            vu: Math.cos(a) * 0.9, vv: Math.sin(a) * 0.9, vz: 2.5 + Math.random() * 1.5, gravity: 16,
            floor: 1.3, maxAge: 2, col: C.waterHi,
          });
        }

        // Distant screams while people are still fleeing
        if (panicStarted) {
          screamT -= dt;
          if (screamT <= 0) {
            screamT = 0.9 + Math.random() * 1.6;
            const runners = crowd.actors.filter((a) => a.kind === 'human' && a.state === 'flee');
            if (runners.length) {
              const r = runners[Math.floor(Math.random() * runners.length)];
              crowd.scream(r.u, r.v, r);
            }
          }
        }
      }

      function computeAtmo(t) {
        const d = decayAt(t);
        const hours = startHours + t / 240;
        const atmo = computeAtmosphere(hours, env, 0);
        const tint = lerpRGB([1, 1, 1], [0.9, 0.84, 0.86], d);
        const base = atmo.applyLight;
        atmo.applyLight = (rgb) => mulRGB(base(rgb), tint);
        atmo.ambientTinted = [atmo.ambient[0] * tint[0], atmo.ambient[1] * tint[1], atmo.ambient[2] * tint[2]];
        const bg = lerpRGB(atmo.bg, [222, 208, 206], d * 0.9);
        atmo.bg = bg;
        atmo.bgU32 = packRGB(bg);
        atmo.bgHex = rgbToHex(bg);
        atmo.ink = atmo.applyLight([54, 60, 72]);
        atmo.decay = d;
        atmoCache = atmo;
        return atmo;
      }

      // ── Rendering ───────────────────────────────────────────────
      function drawFloatShadow(buf, atmo) {
        const pL = project(0, V, -DEPTH);
        const pF = project(U, V, -DEPTH);
        const pR = project(U, 0, -DEPTH);
        const col = [170, 168, 178];
        for (let dy = 1; dy <= 5; dy++) {
          const a = (6 - dy) * 0.07;
          buf.line(pL[0] + 2, pL[1] + dy, pF[0], pF[1] + dy, col, a);
          buf.line(pF[0], pF[1] + dy, pR[0] - 2, pR[1] + dy, col, a);
        }
      }

      function staticItems(buf, atmo, t) {
        const L = atmo.applyLight;
        const items = [];
        const pal = {
          leafBright: L(C.leafBright), leafMid: L(C.leafMid), leafDark: L(C.leafDark), bark: L(C.bark), ink: atmo.ink,
        };
        const palBlossom = Object.assign({}, pal, { blossom: L(C.blossom), blossomHi: L(C.blossomHi) });
        const sway = Math.sin(t * (1.6 + env.windSpeed * 2)) * (0.5 + env.windSpeed * 1.2);

        TREES.forEach((tr, i) => {
          items.push({
            depth: tr.u + tr.v,
            draw: () => {
              const b = project(tr.u, tr.v, 0);
              Kit.drawTree(buf, b[0], b[1], treeShapes[i], sway * (0.8 + (i % 3) * 0.2), tr.kind === 'blossom' ? palBlossom : pal);
            },
          });
        });

        BENCHES.forEach((b) => {
          items.push({
            depth: b.u + b.v - 0.3,
            draw: () => {
              const top = L(C.benchTop);
              const side = L(C.benchSide);
              const dark = L(C.benchDark);
              const metal = L(C.metal);
              let u0, u1, v0, v1;
              if (b.along === 'u') { u0 = b.u - 1.5; u1 = b.u + 1.5; v0 = b.v - 0.45; v1 = b.v + 0.45; }
              else { u0 = b.u - 0.45; u1 = b.u + 0.45; v0 = b.v - 1.5; v1 = b.v + 1.5; }
              // legs
              const legs = b.along === 'u'
                ? [[u0 + 0.3, v1 - 0.1], [u1 - 0.3, v1 - 0.1]]
                : [[u1 - 0.1, v0 + 0.3], [u1 - 0.1, v1 - 0.3]];
              legs.forEach((l) => {
                const p = project(l[0], l[1], 0);
                buf.vline(Math.round(p[0]), Math.round(p[1]) - 2, Math.round(p[1]), metal);
              });
              box(buf, u0, v0, 1.0, u1, v1, 1.45, top, side, dark, atmo.ink);
              // backrest on the far side
              if (b.along === 'u') {
                const bv = b.back < 0 ? v0 : v1 - 0.2;
                box(buf, u0, bv, 1.45, u1, bv + 0.2, 3.1, top, side, dark, null);
              } else {
                const bu = b.back < 0 ? u0 : u1 - 0.2;
                box(buf, bu, v0, 1.45, bu + 0.2, v1, 3.1, top, side, dark, null);
              }
            },
          });
        });

        LAMPS.forEach((l) => {
          items.push({
            depth: l.u + l.v,
            draw: () => {
              const p = project(l.u, l.v, 0);
              const x = Math.round(p[0]);
              const y = Math.round(p[1]);
              const metal = L(C.metal);
              buf.vline(x, y - 15, y, metal);
              buf.vline(x + 1, y - 14, y, mulRGB(metal, 0.75));
              buf.hline(x - 1, x + 2, y, metal);
              buf.rect(x - 1, y - 18, 4, 3, L([236, 228, 190]));
              buf.hline(x - 2, x + 3, y - 19, metal);
              buf.hline(x - 1, x + 2, y - 20, metal);
            },
          });
        });

        BINS.forEach((b) => {
          items.push({
            depth: b.u + b.v,
            draw: () => {
              const p = project(b.u, b.v, 0);
              const x = Math.round(p[0]);
              const y = Math.round(p[1]);
              const g = L([70, 96, 82]);
              buf.rect(x - 2, y - 5, 4, 5, g);
              buf.vline(x + 1, y - 5, y - 1, mulRGB(g, 0.75));
              buf.hline(x - 2, x + 1, y - 6, L([96, 124, 108]));
            },
          });
        });

        // Ice-cream cart with striped umbrella
        items.push({
          depth: CART.u + CART.v,
          draw: () => {
            box(buf, CART.u - 1.1, CART.v - 0.6, 0.6, CART.u + 1.1, CART.v + 0.6, 2.8, L([246, 240, 232]), L([236, 170, 186]), L([206, 136, 154]), atmo.ink);
            const w1 = project(CART.u - 0.7, CART.v + 0.6, 0.5);
            const w2 = project(CART.u + 0.8, CART.v + 0.6, 0.5);
            buf.rect(Math.round(w1[0]) - 1, Math.round(w1[1]) - 1, 2, 2, L([50, 50, 58]));
            buf.rect(Math.round(w2[0]) - 1, Math.round(w2[1]) - 1, 2, 2, L([50, 50, 58]));
            const pole = project(CART.u, CART.v, 2.8);
            const top = project(CART.u, CART.v, 8.2);
            buf.vline(Math.round(pole[0]), Math.round(top[1]), Math.round(pole[1]), L([90, 90, 96]));
            const cx = Math.round(top[0]);
            const cy = Math.round(top[1]);
            for (let yy = -3; yy <= 2; yy++) {
              const half = Math.round(9 * Math.sqrt(1 - ((yy + 0.5) / 3.6) ** 2));
              for (let xx = -half; xx <= half; xx++) {
                const stripe = Math.floor((xx + 20) / 3) % 2 === 0;
                buf.setPx(cx + xx, cy + yy, stripe ? L([238, 92, 112]) : L([250, 246, 238]));
              }
            }
            buf.hline(cx - 8, cx + 8, cy + 3, atmo.ink, 0.25);
            // Sign: tiny cone icon on the cart
            const s = project(CART.u + 0.2, CART.v + 0.6, 1.8);
            buf.setPx(Math.round(s[0]), Math.round(s[1]), L([214, 168, 104]));
            buf.setPx(Math.round(s[0]), Math.round(s[1]) - 1, L([248, 186, 204]));
          },
        });

        // Swing set frame (+ empty seats when the kids have run away)
        items.push({
          depth: SWING.u1 + SWING.v,
          draw: () => {
            const metal = L([196, 82, 64]);
            const metalDk = mulRGB(metal, 0.75);
            [SWING.u0, SWING.u1].forEach((su) => {
              const b0 = project(su, SWING.v - 1.2, 0);
              const b1 = project(su, SWING.v + 1.2, 0);
              const tp = project(su, SWING.v, SWING.top);
              buf.line(b0[0], b0[1], tp[0], tp[1], metalDk);
              buf.line(b1[0], b1[1], tp[0], tp[1], metal);
            });
            const t0 = project(SWING.u0, SWING.v, SWING.top);
            const t1 = project(SWING.u1, SWING.v, SWING.top);
            buf.line(t0[0], t0[1], t1[0], t1[1], metal);
            buf.line(t0[0], t0[1] + 1, t1[0], t1[1] + 1, metalDk, 0.6);
            SWING.seats.forEach((su) => {
              const occupied = crowd.actors.some((a) => a.state === 'swing' && Math.abs(a.u - su) < 0.2);
              if (occupied) return;
              const sw = Math.sin(t * 1.8 + su) * 0.25;
              const top = project(su, SWING.v, SWING.top);
              const seat = project(su, SWING.v + sw, 1.8);
              const rope = L([120, 122, 128]);
              buf.line(top[0] - 1, top[1], seat[0] - 2, seat[1], rope);
              buf.line(top[0] + 1, top[1], seat[0] + 2, seat[1], rope);
              buf.hline(Math.round(seat[0]) - 2, Math.round(seat[0]) + 2, Math.round(seat[1]), L([170, 92, 62]));
            });
          },
        });

        // Fountain
        items.push({
          depth: FOUNTAIN.u + FOUNTAIN.v,
          draw: () => drawFountain(buf, atmo, t),
        });

        return items;
      }

      function drawFountain(buf, atmo, t) {
        const L = atmo.applyLight;
        const R = FOUNTAIN.r;
        const H = 1.6;
        const c0 = project(FOUNTAIN.u, FOUNTAIN.v, H);
        const rx = Math.ceil(R * 3 * 1.42) + 1;
        const ry = Math.ceil(R * 1.5 * 1.42) + 2;
        const stoneTop = L(C.stoneTop);
        const stoneSide = L(C.stoneSide);
        const stoneDk = L(C.stoneDark);
        const bloodK = clamp(crowd.victims * 0.08, 0, 0.45);
        const water = L(lerpRGB(C.water, [150, 70, 78], bloodK));
        const waterHi = L(lerpRGB(C.waterHi, [210, 150, 150], bloodK));
        // Outer wall (front half): vertical strips
        for (let a = 0; a <= Math.PI; a += 0.02) {
          const u = FOUNTAIN.u + Math.cos(a - Math.PI / 4) * R;
          const v = FOUNTAIN.v + Math.sin(a - Math.PI / 4) * R;
          const p1 = project(u, v, H);
          const p0 = project(u, v, 0);
          const shade = a < Math.PI / 2 ? stoneSide : stoneDk;
          buf.vline(Math.round(p1[0]), Math.round(p1[1]), Math.round(p0[1]), shade);
        }
        // Rim + water surface
        for (let y = Math.round(c0[1]) - ry; y <= Math.round(c0[1]) + ry; y++) {
          for (let x = Math.round(c0[0]) - rx; x <= Math.round(c0[0]) + rx; x++) {
            const uv = PROJ.unproject(x + 0.5, y + 0.5, H);
            const d = Math.hypot(uv[0] - FOUNTAIN.u, uv[1] - FOUNTAIN.v);
            if (d > R) continue;
            if (d > R - 0.65) {
              buf.setPx(x, y, hash2(x, y) > 0.8 ? stoneSide : stoneTop);
              continue;
            }
            const ripple = Math.sin(d * 3.2 - t * 3.4);
            let col = water;
            if (ripple > 0.82 && hash2(x, y + Math.floor(t * 4)) > 0.4) col = waterHi;
            buf.setPx(x, y, col);
          }
        }
        // Central column + bowl
        const base = project(FOUNTAIN.u, FOUNTAIN.v, H);
        const top = project(FOUNTAIN.u, FOUNTAIN.v, 5.2);
        const bx = Math.round(base[0]);
        buf.rect(bx - 2, Math.round(top[1]), 4, Math.round(base[1] - top[1]), stoneTop);
        buf.vline(bx + 1, Math.round(top[1]), Math.round(base[1]) - 1, stoneDk);
        const bowl = project(FOUNTAIN.u, FOUNTAIN.v, 5.4);
        const by = Math.round(bowl[1]);
        buf.hline(bx - 6, bx + 5, by, stoneTop);
        buf.hline(bx - 5, bx + 4, by + 1, stoneSide);
        buf.hline(bx - 3, bx + 2, by + 2, stoneDk);
        buf.hline(bx - 4, bx + 3, by - 1, water);
        buf.setPx(bx, by - 3, waterHi);
        buf.setPx(bx - 1, by - 2, waterHi);
        buf.setPx(bx, by - 2, waterHi);
      }

      function drawVignette(buf, d) {
        if (d < 0.04) return;
        const w = CANVAS_W;
        const h = CANVAS_H;
        const col = [40, 14, 20];
        for (let y = 0; y < h; y++) {
          const dy = (y - h / 2) / (h / 2);
          for (let x = 0; x < w; x++) {
            const dx = (x - w / 2) / (w / 2);
            const r = dx * dx * 0.8 + dy * dy;
            if (r < 0.5) continue;
            const a = clamp((r - 0.5) * 0.45, 0, 0.4) * d;
            if (a > 0.01) buf.blendPx(x, y, col, a);
          }
        }
      }

      function render(buf, t) {
        const atmo = computeAtmo(t);
        buf.clearU32(atmo.bgU32);
        drawFloatShadow(buf, atmo);
        ground.composite(buf, atmo.ambientTinted);
        decals.draw(buf, atmo);

        const items = staticItems(buf, atmo, t).concat(crowd.collectItems(buf, atmo));
        items.sort((a, b) => a.depth - b.depth);
        for (let i = 0; i < items.length; i++) items[i].draw();

        particles.draw(buf, atmo);
        drawShots(buf);
        if (playing) drawGateMarker(buf, t);
        Weather.drawDitheredClouds(buf, weather, { env, time: t }, atmo, null, { offsetY: -24, dreadTint: atmo.decay, maxY: 96 });
        drawVignette(buf, atmo.decay);
        if (hurtFlash > 0) drawHurt(buf, hurtFlash);
        crowd.drawOverlay(buf, atmo);
        if (playing) drawCrosshair(buf);
        return atmo;
      }

      function drawShots(buf) {
        for (let i = 0; i < tracers.length; i++) {
          const tr = tracers[i];
          const a = 1 - tr.age / 0.09;
          buf.line(tr.x0, tr.y0, tr.x1, tr.y1, [255, 236, 170], 0.85 * a);
          buf.setPx(Math.round(tr.x1), Math.round(tr.y1), [255, 255, 230]);
        }
        if (muzzleFlash > 0 && hero.muzzleX != null) {
          const fx = Math.round(hero.muzzleX);
          const fy = Math.round(hero.muzzleY);
          buf.ditherGlow(fx, fy, 14, 10, [255, 198, 92], 0.6, true);
          buf.rect(fx - 1, fy - 1, 3, 3, [255, 250, 226]);
          buf.setPx(fx - 2, fy, [255, 206, 78]);
          buf.setPx(fx + 2, fy, [255, 206, 78]);
          buf.setPx(fx, fy - 2, [255, 206, 78]);
          buf.setPx(fx, fy + 2, [255, 152, 54]);
        }
      }

      // Pulsing chevron above the east gate (the goal)
      function drawGateMarker(buf, t) {
        const g = EXITS.find((e) => e.playerExit);
        const p = project(g.u - 1.2, g.v, 9 + Math.sin(t * 4) * 1.2);
        const x = Math.round(p[0]);
        const y = Math.round(p[1]);
        const col = [96, 214, 120];
        const ink = [30, 60, 40];
        const rows = ['XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < rows[r].length; c++) {
            if (rows[r][c] !== 'X') continue;
            buf.blendPx(x - 3 + c, y + r + 1, ink, 0.5);
            buf.setPx(x - 3 + c, y + r, col);
          }
        }
      }

      function drawHurt(buf, k) {
        const w = CANVAS_W;
        const h = CANVAS_H;
        const col = [190, 16, 26];
        for (let y = 0; y < h; y++) {
          const dy = (y - h / 2) / (h / 2);
          for (let x = 0; x < w; x++) {
            const dx = (x - w / 2) / (w / 2);
            const r = dx * dx * 0.7 + dy * dy;
            if (r < 0.35) continue;
            buf.blendPx(x, y, col, clamp((r - 0.35) * 0.7, 0, 0.6) * k);
          }
        }
      }

      function drawCrosshair(buf) {
        const x = Math.round(cross[0]);
        const y = Math.round(cross[1]);
        const col = GUN.reloadT > 0 ? [170, 176, 190] : crossOnZombie ? [255, 64, 64] : [255, 255, 255];
        const ink = [18, 20, 28];
        const pts = [[x, y]];
        for (let i = 2; i <= 4; i++) pts.push([x - i, y], [x + i, y], [x, y - i], [x, y + i]);
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          buf.blendPx(p[0] + 1, p[1], ink, 0.6);
          buf.blendPx(p[0] - 1, p[1], ink, 0.6);
          buf.blendPx(p[0], p[1] + 1, ink, 0.6);
          buf.blendPx(p[0], p[1] - 1, ink, 0.6);
        }
        for (let i = 0; i < pts.length; i++) buf.setPx(pts[i][0], pts[i][1], col);
      }

      return {
        update,
        render,
        camera,
        hours: (t) => startHours + t / 240,
        audioMix: (t) => {
          const calm = t < 16.2 ? clamp(t / 3, 0, 1) : clamp(1 - (t - 16.2) * 2, 0, 1);
          const dread = smoothstep(16.2, 19, t);
          const runners = crowd.actors.some((a) => a.state === 'flee');
          return { calm, dread, murmur: t < 16.2 ? 0.6 : runners ? 0.9 : 0.25 };
        },
        audioState: () => ({ env, atmo: atmoCache || atmo0 }),
        debug: { crowd, hero, decals, GUN, isPlaying: () => playing },
      };
    },
  };

  Diorama.StoryChapters = Diorama.StoryChapters || [];
  Diorama.StoryChapters.push(CH1);
})(window);
