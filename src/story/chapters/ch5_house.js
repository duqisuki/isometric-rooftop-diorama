/*
 * Chapter 5 — «Дом» (A boarded-up house, Day 30, 21:40)
 *
 * Candles, boarded windows, three survivors. Kostya hid the bite from the roof.
 * Tonight he turns. Mina goes to check on him. A candle falls, the fire spreads
 * room by room, the windows give way. Get out through the back door.
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { mulRGB, shiftRGB, hash2, clamp } = Diorama.Palette;
  const Kit = Diorama.StoryKit;

  const U = 40;
  const V = 28;
  const DEPTH = 5;
  const WALL_H = 4.2;
  const BACK_H = 9;
  const ORIGIN = [240 - 1.5 * (U - V), 135 - (U + V) * 0.75 + 8];
  const PROJ = Kit.makeProjector(ORIGIN[0], ORIGIN[1]);
  const project = PROJ.project;

  const WALLS = [
    // kitchen | living (with an arch)
    [0, 9.8, 8, 10.2], [12, 9.8, 18, 10.2],
    // west block | hall (doors to kitchen and living room)
    [17.8, 0, 18.2, 4], [17.8, 6.5, 18.2, 18], [17.8, 20.5, 18.2, 28],
    // hall | east block (doors to storage and bedroom)
    [23.8, 0, 24.2, 6], [23.8, 8.5, 24.2, 20], [23.8, 22.5, 24.2, 28],
    // storage | bedroom
    [24.2, 13.8, 30, 14.2], [32.5, 13.8, 40, 14.2],
  ];
  const FURN = [
    { b: [1, 0.4, 12, 1.8], h: 2.2, col: [196, 190, 176], top: [150, 150, 150] }, // counter
    { b: [13, 0.4, 15, 2], h: 4.6, col: [220, 222, 218] }, // fridge
    { b: [6, 4, 10, 6], h: 1.6, col: [150, 110, 74] }, // kitchen table
    { b: [3, 24.2, 9, 26.2], h: 1.8, col: [120, 70, 70] }, // sofa
    { b: [4.5, 20.4, 7.5, 21.8], h: 1.0, col: [120, 86, 58] }, // coffee table
    { b: [12, 24, 14.2, 26.2], h: 1.8, col: [100, 110, 80] }, // armchair
    { b: [0.3, 13.5, 1.2, 18.5], h: 4.2, col: [128, 92, 62] }, // bookshelf
    { b: [34, 22, 38, 26], h: 1.3, col: [220, 214, 200], top: [190, 196, 214] }, // bed
    { b: [26, 25, 29.5, 27.2], h: 1.2, col: [214, 206, 190], top: [160, 120, 120] }, // mattress
    { b: [37, 14.6, 39.6, 16.2], h: 4.6, col: [130, 96, 66] }, // wardrobe
    { b: [25, 0.4, 31, 1.4], h: 3.6, col: [120, 104, 80] }, // storage shelves
    { b: [26, 10.6, 28.4, 12.8], h: 1.8, col: [176, 140, 92] }, // crates
    { b: [32.6, 22.4, 33.6, 23.4], h: 1.4, col: [130, 96, 66] }, // nightstand
  ];
  const CANDLES = [{ u: 6, v: 21, z: 1.0 }, { u: 8, v: 5, z: 1.6 }, { u: 33.1, v: 22.9, z: 1.4 }, { u: 27, v: 6, z: 0.1 }];
  const WINDOWS_IN = [
    { u: 1.2, v: 21.5, du: 1, dv: 0 },
    { u: 1.2, v: 5.5, du: 1, dv: 0 },
    { u: 5.5, v: 1.2, du: 0, dv: 1 },
  ];
  const BACKDOOR = { id: 'BD', u: U - 0.9, v: 4.2, du: 1, dv: 0, playerExit: true, halfWidth: 1.8, noSpawn: true };
  const FIRE_PATH = [
    [30.5, 22, 1.2], [27, 24, 1.0], [35, 25.5, 1.0], [26.5, 18.5, 1.0], [21, 22, 1.0], [21, 19, 1.0],
    [16, 19.5, 0.9], [21, 16.2, 1.0], [13, 23, 1.0], [10, 19.5, 0.9], [21, 13.4, 0.9], [5.5, 24, 1.0],
    [36, 18, 1.0], [30, 17, 1.0], [3, 19, 0.9], [8, 14, 0.9],
  ];

  function room(u, v) {
    if (u < 18) return v < 10 ? 'kitchen' : 'living';
    if (u < 24) return 'hall';
    return v < 14 ? 'storage' : 'bedroom';
  }

  function bake(L) {
    const top = [project(0, 0), project(U, 0), project(U, V), project(0, V)];
    L.fillPoly(top, (x, y) => {
      const uv = PROJ.unproject(x + 0.5, y + 0.5, 0);
      const u = uv[0];
      const v = uv[1];
      const n = hash2(x, y);
      const r = room(u, v);
      if (r === 'kitchen') return (Math.floor(u * 1.2) + Math.floor(v * 1.2)) % 2 ? [184, 176, 160] : [150, 140, 126];
      if (r === 'living') {
        if (u > 2 && u < 11 && v > 18.5 && v < 23.5) {
          const e = Math.min(u - 2, 11 - u, v - 18.5, 23.5 - v);
          return e < 0.4 ? [196, 160, 90] : n > 0.85 ? [150, 60, 56] : [136, 52, 50]; // rug
        }
      }
      if (r === 'storage') return n > 0.85 ? [128, 124, 118] : [118, 114, 108];
      const plank = Math.floor(u * 1.3);
      const c = hash2(plank, Math.floor((v + plank * 2.1) / 3)) > 0.5 ? [140, 100, 68] : [128, 90, 60];
      if ((u * 1.3) % 1 < 0.08) return mulRGB(c, 0.8);
      return n > 0.92 ? shiftRGB(c, 10, 8, 6) : c;
    });
    const wallFn = (face) => (x, y) => {
      let s;
      let yBot;
      if (face === 'N') {
        s = (x + 0.5 - PROJ.ox) / 3;
        yBot = project(s, 0, 0)[1];
      } else {
        s = -(x + 0.5 - PROJ.ox) / 3;
        yBot = project(0, s, 0)[1];
      }
      const z = (yBot - (y + 0.5)) / 1.5;
      if (z < 0 || z > BACK_H) return null;
      const r = face === 'N' ? room(s, 1) : room(1, s);
      // wallpaper stripes per room
      let c = r === 'kitchen' ? [196, 200, 176] : r === 'living' ? [170, 150, 120] : r === 'storage' ? [150, 146, 140] : [176, 160, 170];
      if (Math.floor(s * 2) % 2 === 0 && r !== 'storage') c = shiftRGB(c, -10, -10, -10);
      if (z < 0.8) c = [96, 76, 58];
      // boarded windows
      const wins = face === 'N' ? [[4, 7], [28, 31]] : [[4, 7], [20, 23]];
      for (let i = 0; i < wins.length; i++) {
        const w = wins[i];
        if (s > w[0] && s < w[1] && z > 3 && z < 6.5) {
          const plank = Math.floor((z - 3) * 2.2);
          if (((z - 3) * 2.2) % 1 < 0.25) return [26, 28, 40]; // gaps: night outside
          return hash2(plank, i * 3) > 0.5 ? [150, 116, 80] : [130, 98, 66];
        }
      }
      // back door frame on the east end of the north wall is not visible; family photo
      if (face === 'W' && s > 12 && s < 13.6 && z > 4.5 && z < 6) return z > 5.8 || z < 4.7 ? [100, 70, 50] : [196, 180, 150];
      return hash2(x * 5, y * 3) > 0.96 ? shiftRGB(c, -16, -16, -16) : c;
    };
    L.fillPoly([project(0, 0, BACK_H), project(U, 0, BACK_H), project(U, 0, 0), project(0, 0, 0)], wallFn('N'));
    L.fillPoly([project(0, 0, BACK_H), project(0, V, BACK_H), project(0, V, 0), project(0, 0, 0)], wallFn('W'));
    const side = (face) => (x, y) => {
      let yTop;
      if (face === 'left') {
        const u = (x + 0.5 - PROJ.ox) / 3 + V;
        yTop = PROJ.oy + (u + V) * 1.5;
      } else {
        const v = U - (x + 0.5 - PROJ.ox) / 3;
        yTop = PROJ.oy + (U + v) * 1.5;
      }
      const zb = (y + 0.5 - yTop) / 1.5;
      const c = zb < 0.6 ? [110, 80, 56] : zb < 1.2 ? [90, 84, 78] : [120, 114, 104];
      return face === 'right' ? mulRGB(c, 0.8) : c;
    };
    L.fillPoly([project(0, V, 0), project(U, V, 0), project(U, V, -DEPTH), project(0, V, -DEPTH)], side('left'));
    L.fillPoly([project(U, V, 0), project(U, 0, 0), project(U, 0, -DEPTH), project(U, V, -DEPTH)], side('right'));
  }

  function boxes() {
    const b = WALLS.map((w) => ({ u0: w[0], v0: w[1], u1: w[2], v1: w[3] }));
    FURN.forEach((f) => b.push({ u0: f.b[0], v0: f.b[1], u1: f.b[2], v1: f.b[3] }));
    return b;
  }

  function items(buf, atmo, t) {
    const L = atmo.applyLight;
    const out = [];
    const wallCol = [200, 184, 160];
    WALLS.forEach((w) => {
      const alongU = w[2] - w[0] > w[3] - w[1];
      const len = alongU ? w[2] - w[0] : w[3] - w[1];
      const n = Math.max(1, Math.ceil(len / 2));
      for (let i = 0; i < n; i++) {
        const a = (len * i) / n;
        const b2 = (len * (i + 1)) / n;
        const u0 = alongU ? w[0] + a : w[0];
        const u1 = alongU ? w[0] + b2 : w[2];
        const v0 = alongU ? w[1] : w[1] + a;
        const v1 = alongU ? w[3] : w[1] + b2;
        out.push({
          depth: (u0 + u1) / 2 + (v0 + v1) / 2 + 0.25,
          draw: () => Kit.box(buf, PROJ, u0, v0, 0, u1, v1, WALL_H, L([226, 214, 196]), L(wallCol), mulRGB(L(wallCol), 0.8), atmo.ink),
        });
      }
    });
    FURN.forEach((f) => {
      out.push({
        depth: f.b[2] + f.b[3] - 0.3,
        draw: () => {
          const c = L(f.col);
          Kit.box(buf, PROJ, f.b[0], f.b[1], 0, f.b[2], f.b[3], f.h, f.top ? L(f.top) : shiftRGB(c, 16, 16, 16), c, mulRGB(c, 0.78), atmo.ink);
        },
      });
    });
    return out;
  }

  const CH5 = {
    id: 'house',
    number: 5,
    title: 'Дом',
    place: 'Заколоченный дом',
    day: 'ДЕНЬ 30',
    duration: 900,
    retryAt: 9.2,

    create(api) {
      let phase = 'calm'; // calm → turn → escape
      let fireIdx = 0;
      let fireT = 0;
      let windowT = 0;

      const S = Diorama.Stage.create(api, {
        U, V, depth: DEPTH, origin: ORIGIN, startHours: 21 + 40 / 60, day: 'День 30',
        env: { cloudCoverage: 0 },
        decayAt: (t) => clamp((t - 7) / 25, 0, 0.6),
        tint: [1.0, 0.82, 0.74],
        dreadBg: [40, 24, 22],
        bgAt: (t, bg) => [14, 14, 22],
        stars: false,
        floatShadow: false,
        bake,
        boxes: boxes(),
        bounds: { u0: 0.7, v0: 0.7, u1: 39.4, v1: 27.3 },
        exits: [BACKDOOR],
        wanderPoints: [{ u: 8, v: 16 }, { u: 9, v: 6 }, { u: 21, v: 8 }, { u: 30, v: 8 }, { u: 30, v: 20 }, { u: 14, v: 21 }],
        nav: true,
        items,
        playZoom: 2.6,
        drawLights: (buf, atmo, t) => {
          CANDLES.forEach((c, i) => {
            if (c.out) return;
            const p = project(c.u, c.v, c.z);
            const fl = 0.85 + 0.15 * Math.sin(t * 13 + i * 2) * Math.sin(t * 5.1 + i);
            buf.ditherGlow(p[0], p[1] - 1, 26 * fl, 15 * fl, [255, 176, 90], 0.55, true);
            buf.setPx(Math.round(p[0]), Math.round(p[1]) - 2, [255, 230, 150]);
            buf.setPx(Math.round(p[0]), Math.round(p[1]) - 1, [240, 236, 220]);
          });
        },
        camera: (t) => camera(t),
        audioMix: (t) => ({ calm: t < 6 ? 0.6 : 0, dread: t < 6 ? 0.25 : 0.9, murmur: 0 }),
      });
      const crowd = S.crowd;
      const sfx = S.sfx;
      const P = S.player;

      const hero = crowd.add({
        role: 'hero', u: 11, v: 22.5, state: 'idle', stay: true, scriptLocked: true, protected: true, noTurn: true, armed: true, rifle: true, facing: 1,
        look: { skin: [234, 198, 168], hair: [46, 36, 30], hairStyle: 'short', shirt: [176, 50, 44], pants: [56, 70, 104], shoes: [38, 38, 46] },
      });
      const mina = crowd.add({
        role: 'mina', u: 2.4, v: 21.6, state: 'idle', stay: true, scriptLocked: true, noTurn: false, facing: -1,
        look: { skin: [236, 204, 180], hair: [52, 40, 36], hairStyle: 'long', shirt: [214, 220, 206], pants: [70, 84, 116] },
      });
      const kostya = crowd.add({
        role: 'kostya', u: 36, v: 24, state: 'sit', seated: true, seatZ: 1.2, facing: -1, stay: true, scriptLocked: true, noTurn: true,
        look: { skin: [206, 178, 150], hair: [130, 86, 50], hairStyle: 'short', shirt: [70, 110, 140], pants: [60, 60, 70] },
      });

      S.at(1.5, () => { kostya.emote = 'dots'; kostya.emoteT = 2; sfx.tone(180, 'sawtooth', 0.03, 0.4); });
      S.at(3.5, () => {
        crowd.setScript(mina, [
          { type: 'goto', u: 16, v: 19.2, speed: 1.4 },
          { type: 'goto', u: 21, v: 19.2, speed: 1.4 },
          { type: 'goto', u: 21, v: 21.2, speed: 1.4 },
          { type: 'goto', u: 31.5, v: 21.2, speed: 1.4 },
          { type: 'emote', emote: 'question', t: 1.5 },
          { type: 'wait', t: 30 },
        ]);
      });
      // Kostya turns
      S.at(6.6, () => {
        phase = 'turn';
        kostya.seated = false;
        kostya.state = 'rise';
        kostya.st = 0.8;
        kostya.u = 33.6;
        kostya.v = 23.6;
        sfx.groan();
        hero.emote = 'exclaim';
        hero.emoteT = 1.6;
      });
      S.at(8.2, () => {
        crowd.panic = true;
        crowd.hunting = true;
        mina.script = null;
        mina.turnAt = 3.5;
        if (kostya.kind === 'zombie') {
          crowd._zombies = crowd.zombies();
          crowd.bite(kostya, mina);
        }
        // the candle goes over
        CANDLES[2].out = true;
        S.fire.add(30.5, 22, 0, 1.2);
        S.world.obstacles.push({ u: 30.5, v: 22, r: 1.1 });
        S.world.nav.rebuild(S.world);
        fireIdx = 1;
        fireT = 1.4;
        api.shake(0.6);
      });
      S.at(9, () => {
        phase = 'escape';
        S.control(hero, { armed: true, melee: true, hp: 3, speed: 3.7, gun: { mag: 20, ammo: 9, reserve: 0, rate: 0.14, dmg: 2, heavy: true } });
        hero.rifle = true;
        S.marker = { u: BACKDOOR.u - 1.2, v: BACKDOOR.v, z: 6 };
        windowT = 0.8;
      });

      function camera(t) {
        if (t < 3.5) return { x: S.screenOf(hero)[0] - 10, y: S.screenOf(hero)[1] - 4, zoom: 2.2, speed: 1 };
        if (t < 9) {
          const m = S.screenOf(mina);
          const k = S.screenOf(kostya);
          return { x: (m[0] + k[0]) / 2, y: (m[1] + k[1]) / 2, zoom: 2.6, speed: 1.4 };
        }
        return null;
      }

      function burnHero() {
        if (hero.invuln > 0 || P.deadT >= 0 || !P.playing) return;
        hero.hp -= 1;
        hero.invuln = 1.3;
        hero.hitFlash = 0.15;
        P.hurtFlash = 0.6;
        api.shake(0.6);
        sfx.heartbeat();
        if (hero.hp <= 0) {
          hero.state = 'down';
          hero.st = 0;
          hero.fallDir = 1;
          crowd.emit('playerDown', hero);
          crowd.emit('death', hero);
        }
        S.pushHud();
      }

      S.cfg.update = (t, dt) => {
        // fire spreads room by room
        if (fireIdx > 0 && fireIdx < FIRE_PATH.length) {
          fireT -= dt;
          if (fireT <= 0) {
            const f = FIRE_PATH[fireIdx++];
            S.fire.add(f[0], f[1], 0, f[2]);
            S.world.obstacles.push({ u: f[0], v: f[1], r: f[2] * 0.95 });
            S.world.nav.rebuild(S.world);
            fireT = 1.5 + Math.random() * 0.6;
            sfx.noise(0.6, 'lowpass', 500, 0.08);
          }
        }
        // fire hurts everyone
        const fires = S.fire.list;
        for (let i = 0; i < fires.length; i++) {
          const e = fires[i];
          const r = 0.8 * e.size + 0.35;
          if (Math.hypot(hero.u - e.u, hero.v - e.v) < r) burnHero();
          for (let k = 0; k < crowd.actors.length; k++) {
            const z = crowd.actors[k];
            if (z.kind === 'zombie' && z.state !== 'down' && Math.hypot(z.u - e.u, z.v - e.v) < r) crowd.damageZombie(z, 9, 0, 0);
          }
        }
        // the boarded windows give way
        if (phase === 'escape') {
          windowT -= dt;
          if (windowT <= 0) {
            windowT = 2.6 + Math.random() * 1.6;
            const alive = crowd.actors.filter((a) => a.kind === 'zombie' && a.state !== 'down' && a.state !== 'flung').length;
            if (alive < 9) {
              const w = WINDOWS_IN[Math.floor(Math.random() * WINDOWS_IN.length)];
              S.spawnZombie(w.u, w.v, { state: 'climb', zOff: -3.5, climbFrom: -3.5, climbDur: 1.4, climbDU: w.du, climbDV: w.dv, chaseSpeed: 3.0 + Math.random() * 0.5 });
              sfx.crash();
              api.shake(0.3);
            }
          }
        }
      };

      S.chapter = { hero, mina, kostya, get phase() { return phase; } };
      return S.instance();
    },
  };

  Diorama.StoryChapters = Diorama.StoryChapters || [];
  Diorama.StoryChapters.push(CH5);
})(window);
