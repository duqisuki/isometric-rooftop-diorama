/*
 * Chapter 6 — «Последний день» (The burning city, Day 90, 06:10)
 *
 * Ninety days later the city is ruins and fire. Ash falls like snow. Somewhere
 * above the smoke a helicopter is circling the old helipad. Get there.
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { lerp, lerpRGB, mulRGB, shiftRGB, hash2, clamp, smoothstep } = Diorama.Palette;
  const Kit = Diorama.StoryKit;

  const U = 64;
  const V = 44;
  const DEPTH = 9;
  const ORIGIN = [240 - 1.5 * (U - V), 135 - (U + V) * 0.75 - 2];
  const PROJ = Kit.makeProjector(ORIGIN[0], ORIGIN[1]);
  const project = PROJ.project;

  const RV = [18, 25];
  const RU = [20, 26];
  const PAD = { u: 54, v: 35, r: 5 };
  const RUINS = [
    { u0: 1.5, v0: 1.5, u1: 17, v1: 12, h: 18, seed: 5, wall: [150, 136, 120] },
    { u0: 29, v0: 1.5, u1: 46, v1: 11, h: 22, seed: 9, wall: [136, 140, 146] },
    { u0: 49, v0: 1.5, u1: 62, v1: 13, h: 14, seed: 13, wall: [160, 140, 116] },
    { u0: 1.5, v0: 29, u1: 12, v1: 42, h: 10, seed: 17, wall: [146, 130, 118] },
  ];
  const CARS = [
    { u: 9, v: 20, along: 'u', color: [150, 60, 50], fire: 1.0 },
    { u: 33, v: 23.4, along: 'u', color: [70, 90, 130], fire: 0 },
    { u: 23, v: 33, along: 'v', color: [200, 200, 196], fire: 1.1 },
    { u: 44, v: 20.4, along: 'u', color: [96, 104, 70], fire: 0.9 },
    { u: 30, v: 35, along: 'v', color: [180, 150, 70], fire: 0 },
  ];
  const RUBBLE = [{ u0: 14, v0: 26.5, u1: 17.5, v1: 29.5 }, { u0: 36, v0: 13, u1: 40, v1: 15.5 }, { u0: 40, v0: 29, u1: 43, v1: 33 }, { u0: 27, v0: 27, u1: 29.5, v1: 30.5 }];
  const FIRES = [[24, 8, 1.4], [6, 8, 1.2], [56, 9, 1.3], [8, 36, 1.1], [38, 31, 0.9], [47, 15, 0.8], [16, 15, 0.8]];
  const EXITS = [
    { id: 'A', u: 0.9, v: 21.5, du: -1, dv: 0, noSpawn: true },
    { id: 'B', u: U - 0.9, v: 21.5, du: 1, dv: 0 },
    { id: 'C', u: 23, v: 0.9, du: 0, dv: -1 },
    { id: 'D', u: 23, v: V - 0.9, du: 0, dv: 1 },
    { id: 'E', u: 40, v: V - 0.9, du: 0, dv: 1 },
  ];

  function bake(L) {
    const top = [project(0, 0), project(U, 0), project(U, V), project(0, V)];
    L.fillPoly(top, (x, y) => {
      const uv = PROJ.unproject(x + 0.5, y + 0.5, 0);
      const u = uv[0];
      const v = uv[1];
      const n = hash2(x, y);
      const dp = Math.hypot(u - PAD.u, v - PAD.v);
      if (dp < PAD.r) {
        // helipad: concrete disc, yellow ring, white H
        if (dp > PAD.r - 0.5) return [214, 180, 60];
        const lu = u - PAD.u;
        const lv = v - PAD.v;
        if ((Math.abs(lu) < 1.6 && Math.abs(lv - 1.1) < 0.25) || (Math.abs(lu) < 1.6 && Math.abs(lv + 1.1) < 0.25) || (Math.abs(lu) < 0.25 && Math.abs(lv) < 1.1)) return [226, 222, 214];
        return n > 0.85 ? [128, 124, 118] : [118, 114, 108];
      }
      const road = (v > RV[0] && v < RV[1]) || (u > RU[0] && u < RU[1]);
      let c;
      if (road) {
        c = n > 0.85 ? [76, 74, 76] : [66, 64, 66];
        if (hash2(Math.floor(u * 1.5), Math.floor(v * 1.5)) > 0.93) c = [50, 46, 46]; // cracks
      } else {
        c = n > 0.85 ? [112, 104, 96] : [100, 92, 86];
        if (hash2(Math.floor(u / 1.2), Math.floor(v / 1.2)) > 0.9) c = [86, 80, 74];
      }
      // scorch marks + craters
      const cr = [[30, 21, 3], [12, 26, 2.2], [47, 26, 2.6], [36, 38, 2], [18, 6, 2.4]];
      for (let i = 0; i < cr.length; i++) {
        const d = Math.hypot(u - cr[i][0], v - cr[i][1]) / cr[i][2];
        if (d < 1) c = d < 0.55 ? [34, 30, 30] : mulRGB(c, 0.6 + d * 0.3);
      }
      return c;
    });
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
      const n = hash2(x * 3, y * 5);
      let col = zb < 0.8 ? [90, 84, 78] : [70, 60, 54];
      if (n > 0.9) col = [110, 96, 84];
      if (zb > 2 && hash2(x, Math.floor(zb)) > 0.94) col = [180, 80, 40]; // embers in the soil
      return face === 'right' ? mulRGB(col, 0.8) : col;
    };
    L.fillPoly([project(0, V, 0), project(U, V, 0), project(U, V, -DEPTH), project(0, V, -DEPTH)], side('left'));
    L.fillPoly([project(U, V, 0), project(U, 0, 0), project(U, 0, -DEPTH), project(U, V, -DEPTH)], side('right'));
  }

  function boxes() {
    const b = RUINS.map((r) => ({ u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1 }));
    RUBBLE.forEach((r) => b.push(r));
    CARS.forEach((c) => {
      if (c.along === 'u') b.push({ u0: c.u - 2.2, v0: c.v - 1, u1: c.u + 2.2, v1: c.v + 1 });
      else b.push({ u0: c.u - 1, v0: c.v - 2.2, u1: c.u + 1, v1: c.v + 2.2 });
    });
    return b;
  }

  function drawHeli(buf, u, v, z, t, L, ink) {
    const body = L([70, 78, 70]);
    const dark = mulRGB(body, 0.7);
    const glass = L([96, 130, 150]);
    Kit.box(buf, PROJ, u - 2.2, v - 1.0, z + 0.8, u + 1.6, v + 1.0, z + 3.2, shiftRGB(body, 12, 12, 12), body, dark, ink);
    Kit.box(buf, PROJ, u + 1.6, v - 0.8, z + 1.0, u + 2.6, v + 0.8, z + 2.8, glass, glass, mulRGB(glass, 0.8), ink);
    Kit.box(buf, PROJ, u - 6.5, v - 0.25, z + 2.2, u - 2.2, v + 0.25, z + 2.8, body, body, dark, ink);
    Kit.box(buf, PROJ, u - 6.8, v - 0.2, z + 2.2, u - 6.3, v + 0.2, z + 4.2, body, body, dark, ink);
    // skids
    const s1 = project(u - 1.8, v + 1.1, z);
    const s2 = project(u + 1.4, v + 1.1, z);
    buf.line(s1[0], s1[1], s2[0], s2[1], ink);
    const s3 = project(u - 1.8, v - 1.1, z);
    const s4 = project(u + 1.4, v - 1.1, z);
    buf.line(s3[0], s3[1], s4[0], s4[1], ink, 0.6);
    // main rotor: spinning blur + blades
    const hub = project(u - 0.2, v, z + 3.8);
    buf.vline(Math.round(hub[0]), Math.round(hub[1]), Math.round(project(u - 0.2, v, z + 3.2)[1]), ink);
    const a = t * 28;
    for (let k = 0; k < 2; k++) {
      const ang = a + k * Math.PI / 2;
      const du = Math.cos(ang) * 6.5;
      const dv = Math.sin(ang) * 6.5;
      const p1 = project(u - 0.2 + du, v + dv, z + 3.8);
      const p2 = project(u - 0.2 - du, v - dv, z + 3.8);
      buf.line(p1[0], p1[1], p2[0], p2[1], [40, 40, 44], 0.8);
    }
    buf.smoothGlow(hub[0], hub[1], 22, 7, [180, 176, 170], 0.18, false);
    // tail rotor
    const tr = project(u - 6.6, v + 0.3, z + 3.6);
    buf.line(tr[0] - 2, tr[1] - 2 * Math.cos(t * 30), tr[0] + 2, tr[1] + 2 * Math.cos(t * 30), [40, 40, 44]);
    // searchlight
    const sl = project(u + 2.4, v, z + 1);
    buf.setPx(Math.round(sl[0]), Math.round(sl[1]), [255, 250, 220]);
  }

  const CH6 = {
    id: 'lastday',
    number: 6,
    title: 'Последний день',
    place: 'Город в огне',
    day: 'ДЕНЬ 90',
    duration: 900,
    retryAt: 3.2,

    create(api) {
      let phase = 'walkout'; // walkout → fight → board → liftoff
      const heli = { u: PAD.u + 18, v: PAD.v - 20, z: 34, landed: false, state: 'circle', a: 0 };
      let ashT = 0;

      const S = Diorama.Stage.create(api, {
        U, V, depth: DEPTH, origin: ORIGIN, startHours: 6 + 10 / 60, day: 'День 90',
        env: { cloudCoverage: 1, cloudDarkness: 0.9, windSpeed: 1.2 },
        decayAt: () => 1,
        tint: [1.0, 0.78, 0.66],
        dreadBg: [96, 52, 40],
        bgAt: (t, bg) => lerpRGB([78, 40, 32], [120, 64, 44], 0.5 + 0.5 * Math.sin(t * 0.7) * 0.3),
        bake,
        boxes: boxes(),
        exits: EXITS,
        wanderPoints: [{ u: 10, v: 22 }, { u: 22, v: 15 }, { u: 32, v: 21 }, { u: 45, v: 23 }, { u: 23, v: 37 }, { u: 50, v: 30 }, { u: 35, v: 30 }, { u: 58, v: 22 }],
        nav: true,
        clouds: { offsetY: -36, maxY: 76 },
        items: (buf, atmo, t) => items(buf, atmo, t),
        drawOverlay: (buf, atmo, t) => {
          if (heli.z > 6 || !heli.landed) drawHeli(buf, heli.u, heli.v, heli.z, t, atmo.applyLight, atmo.ink);
        },
        camera: (t) => camera(t),
        audioMix: () => ({ calm: 0, dread: 1, murmur: 0.2 }),
      });
      const crowd = S.crowd;
      crowd.panic = true;
      crowd.hunting = true;
      const sfx = S.sfx;
      const P = S.player;

      FIRES.forEach((f) => {
        S.fire.add(f[0], f[1], 0, f[2]);
        S.world.obstacles.push({ u: f[0], v: f[1], r: f[2] * 0.9 });
      });
      CARS.forEach((c) => {
        if (c.fire) S.fire.add(c.u, c.v, 2.2, c.fire);
      });
      S.world.nav.rebuild(S.world);

      function items(buf, atmo, t) {
        const L = atmo.applyLight;
        const out = [];
        RUINS.forEach((r) => out.push({
          depth: r.u0 + r.v0 + 2,
          draw: () => Kit.drawBlock(buf, PROJ, r.u0, r.v0, r.u1, r.v1, r.h, L, { wall: r.wall, ruined: 0.85, burnt: 0.8, fireWin: true, seed: r.seed, roof: [70, 64, 60] }),
        }));
        CARS.forEach((c) => out.push({ depth: c.u + c.v + 1, draw: () => Kit.drawCar(buf, PROJ, c.u, c.v, c.along, L, { color: c.color, burnt: true, wreck: true }) }));
        RUBBLE.forEach((r, i) => out.push({
          depth: r.u1 + r.v1 - 1,
          draw: () => {
            for (let k = 0; k < 7; k++) {
              const u0 = r.u0 + hash2(i, k) * (r.u1 - r.u0 - 1);
              const v0 = r.v0 + hash2(k, i + 3) * (r.v1 - r.v0 - 1);
              const h = 0.6 + hash2(i + k, 7) * 1.6;
              Kit.shadedBox(buf, PROJ, u0, v0, 0, u0 + 1 + hash2(k, 9), v0 + 0.8 + hash2(9, k), h, k % 2 ? [120, 110, 100] : [96, 88, 80], L, null);
            }
          },
        }));
        if (heli.landed && heli.z <= 6) out.push({ depth: heli.u + heli.v + 2, draw: () => drawHeli(buf, heli.u, heli.v, heli.z, t, L, atmo.ink) });
        return out;
      }

      const hero = crowd.add({
        role: 'hero', u: 0.8, v: 21.5, state: 'walk', scriptLocked: true, protected: true, noTurn: true, armed: true,
        look: { skin: [214, 180, 152], hair: [40, 34, 30], hairStyle: 'long', shirt: [136, 46, 40], pants: [52, 56, 66], shoes: [36, 36, 40] },
      });
      crowd.setScript(hero, [{ type: 'goto', u: 5, v: 21.5, speed: 1.6 }]);

      // The city is full of them
      const pts = [[12, 16], [16, 22], [28, 18], [30, 26], [34, 16], [40, 24], [46, 18], [50, 26], [24, 30], [26, 38], [34, 34], [45, 36], [58, 26], [52, 18], [18, 34], [38, 40]];
      pts.forEach((p) => S.spawnZombie(p[0], p[1], { chaseSpeed: 3.0 + Math.random() * 0.6, shambleSpeed: 0.6 + Math.random() * 0.4 }));

      S.at(3, () => {
        phase = 'fight';
        S.control(hero, { armed: true, melee: true, hp: 3, speed: 3.9, gun: { mag: 8, ammo: 8, reserve: 24 } });
        S.title('LAST DAY', 2.4);
        S.marker = { u: PAD.u, v: PAD.v, z: 9, color: [255, 214, 90] };
        S.trickle = { every: [3.5, 6], max: 22, n: [1, 3], from: 6 };
      });

      function camera(t) {
        if (t < 3) return { x: S.screenOf(hero)[0] + 40, y: S.screenOf(hero)[1] - 6, zoom: 1.7, speed: 1.5 };
        if (phase === 'board' || phase === 'liftoff') {
          const p = project(heli.u, heli.v, heli.z);
          return { x: p[0], y: p[1] - 6, zoom: phase === 'liftoff' ? Math.max(1.2, 2.4 - (heli.z - 2) * 0.03) : 1.8, speed: 1.2 };
        }
        return null;
      }

      function board() {
        phase = 'board';
        S.marker = null;
        S.release(true);
        P.finished = true;
        hero.scriptLocked = true;
        crowd.setScript(hero, [
          { type: 'goto', u: heli.u + 0.5, v: heli.v + 1.6, speed: 3.5, r: 0.5 },
          { type: 'call', fn: (a) => { a.hidden = true; a.seated = true; } },
        ]);
        S.after(1.4, () => {
          phase = 'liftoff';
          heli.landed = false;
          heli.state = 'liftoff';
          sfx.engine(1);
          // a red balloon drifts up out of the ruins — the one from the park, ninety days ago
          crowd.floaters.push({ u: heli.u - 6, v: heli.v + 5, z: 1, vz: 3.2, col: [224, 46, 54], phase: 0 });
        });
        S.after(5.5, () => api.fade(1, 2.2));
        S.after(8.2, () => { sfx.stopEngine(); api.next(); });
      }

      S.cfg.update = (t, dt) => {
        // ash falling over the whole city
        ashT -= dt;
        while (ashT <= 0) {
          ashT += 0.03;
          S.particles.spawn({ kind: 'ash', u: Math.random() * U, v: Math.random() * V, z: 30 + Math.random() * 20, vu: 0.6, vv: -0.2, vz: -1.2, gravity: 0, maxAge: 30, col: Math.random() < 0.5 ? [200, 196, 190] : [120, 116, 112] });
        }
        // helicopter: circles, then lands on the pad when the hero gets close
        if (heli.state === 'circle') {
          heli.a += dt * 0.35;
          heli.u = PAD.u - 4 + Math.cos(heli.a) * 14;
          heli.v = PAD.v - 10 + Math.sin(heli.a) * 9;
          heli.z = 30;
          if (phase === 'fight' && Math.hypot(hero.u - PAD.u, hero.v - PAD.v) < 20) {
            heli.state = 'land';
            sfx.engine(0.8);
          }
        } else if (heli.state === 'land') {
          heli.u = lerp(heli.u, PAD.u, dt * 1.2);
          heli.v = lerp(heli.v, PAD.v, dt * 1.2);
          heli.z = Math.max(0, heli.z - dt * 9);
          if (heli.z <= 0.05 && Math.hypot(heli.u - PAD.u, heli.v - PAD.v) < 0.6) {
            heli.state = 'landed';
            heli.landed = true;
            S.marker = { u: heli.u + 0.5, v: heli.v + 1.6, z: 7, color: [96, 214, 120] };
          }
        } else if (heli.state === 'liftoff') {
          heli.z += dt * (4 + heli.z * 0.5);
          heli.u += dt * 3;
        }
        // rotor wash kicks up dust and ash
        if (heli.z < 12 && heli.state !== 'circle' && Math.random() < dt * 20) {
          const a = Math.random() * Math.PI * 2;
          S.particles.spawn({ kind: 'smoke', u: heli.u + Math.cos(a) * 3, v: heli.v + Math.sin(a) * 3, z: 0.5, vu: Math.cos(a) * 4, vv: Math.sin(a) * 4, vz: 0.6, gravity: 0, maxAge: 1.2, col: [150, 140, 130], size: 3, alpha: 0.35 });
        }
        if (phase === 'fight' && heli.landed && P.playing && Math.hypot(hero.u - (heli.u + 0.5), hero.v - (heli.v + 1.6)) < 1.8) board();
      };

      S.chapter = { hero, heli, get phase() { return phase; } };
      return S.instance();
    },
  };

  Diorama.StoryChapters = Diorama.StoryChapters || [];
  Diorama.StoryChapters.push(CH6);
})(window);
