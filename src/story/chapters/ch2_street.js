/*
 * Chapter 2 — «Слишком много» (Crossroads, Day 1, 14:46)
 *
 * The army truck has crashed into a lamp post at a crossroads. Its driver, a
 * soldier, gets out and holds the street with his rifle — until the magazine is
 * empty and there are simply too many of them. His rifle drops on the asphalt.
 * The player picks it up and fights east to the school gate.
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { clamp, lerp, mulRGB, shiftRGB, hash2, smoothstep } = Diorama.Palette;
  const Kit = Diorama.StoryKit;

  const U = 60;
  const V = 40;
  const DEPTH = 8;
  const RV = [15, 23]; // road along u
  const RU = [26, 34]; // road along v
  const SW = 2.5; // sidewalk width
  const ORIGIN = [240 - 1.5 * (U - V), 135 - (U + V) * 0.75 - 4];
  const PROJ = Kit.makeProjector(ORIGIN[0], ORIGIN[1]);
  const project = PROJ.project;

  const BUILDINGS = [
    { u0: 1.5, v0: 1.5, u1: 21.5, v1: 10.5, h: 15, wall: [198, 176, 150], seed: 3, lit: 0.08, shop: true, sign: [176, 62, 54] },
    { u0: 38.5, v0: 1.5, u1: 58.5, v1: 10.5, h: 19, wall: [176, 186, 196], seed: 7, lit: 0.05, shop: true, sign: [52, 96, 160] },
    { u0: 1.5, v0: 27.5, u1: 9, v1: 38.5, h: 9, wall: [206, 196, 178], seed: 11, lit: 0.1 },
  ];
  const TREES = [{ u: 14, v: 26.6 }, { u: 20, v: 26.6 }, { u: 40, v: 26.8 }, { u: 47, v: 26.8 }, { u: 54, v: 26.8 }, { u: 22, v: 11.6 }];
  const PARKED = [
    { u: 15, v: 30.5, along: 'u', color: [70, 110, 170] },
    { u: 15, v: 35.5, along: 'u', color: [210, 196, 120] },
    { u: 46, v: 16.6, along: 'u', color: [168, 60, 56], wreck: true },
    { u: 30.6, v: 33, along: 'v', color: [90, 96, 104], wreck: true },
  ];
  const LAMPS = [{ u: 12, v: 13.6 }, { u: 44, v: 13.6 }, { u: 12, v: 24.4 }, { u: 50, v: 24.4 }, { u: 24.6, v: 30 }];
  const EXITS = [
    { id: 'A', u: 0.9, v: 19, du: -1, dv: 0 },
    { id: 'B', u: U - 0.9, v: 19, du: 1, dv: 0, playerExit: true, halfWidth: 4.2, noSpawn: true },
    { id: 'C', u: 30, v: 0.9, du: 0, dv: -1 },
    { id: 'D', u: 30, v: V - 0.9, du: 0, dv: 1 },
  ];
  const TRUCK = { u: 27.5, v: 18.6 };

  function onRoad(u, v) {
    return (v > RV[0] && v < RV[1]) || (u > RU[0] && u < RU[1]);
  }
  function onWalk(u, v) {
    return (v > RV[0] - SW && v < RV[1] + SW) || (u > RU[0] - SW && u < RU[1] + SW);
  }

  function bake(L) {
    const top = [project(0, 0), project(U, 0), project(U, V), project(0, V)];
    L.fillPoly(top, (x, y) => {
      const uv = PROJ.unproject(x + 0.5, y + 0.5, 0);
      const u = uv[0];
      const v = uv[1];
      const n = hash2(x, y);
      if (onRoad(u, v)) {
        let c = [92, 94, 100];
        if (n > 0.88) c = [104, 106, 112];
        else if (n < 0.08) c = [80, 82, 88];
        // centre dashes
        const inCross = u > RU[0] && u < RU[1] && v > RV[0] && v < RV[1];
        if (!inCross) {
          if (Math.abs(v - 19) < 0.13 && u % 3 < 1.6) return [228, 222, 196];
          if (Math.abs(u - 30) < 0.13 && v % 3 < 1.6) return [228, 222, 196];
          // zebra crossings
          if (v > RV[0] && v < RV[1] && ((u > RU[0] - 3 && u < RU[0] - 0.6) || (u > RU[1] + 0.6 && u < RU[1] + 3)) && Math.floor(v * 1.2) % 2 === 0) return [232, 232, 226];
          if (u > RU[0] && u < RU[1] && ((v > RV[0] - 3 && v < RV[0] - 0.6) || (v > RV[1] + 0.6 && v < RV[1] + 3)) && Math.floor(u * 1.2) % 2 === 0) return [232, 232, 226];
        }
        if (hash2(Math.floor(u * 2), Math.floor(v * 2)) > 0.985) return [60, 62, 66]; // oil stains
        return c;
      }
      if (onWalk(u, v)) {
        const edge = Math.min(Math.abs(v - RV[0]), Math.abs(v - RV[1]), Math.abs(u - RU[0]), Math.abs(u - RU[1]));
        if (edge < 0.35) return [168, 166, 160];
        if (u % 1.5 < 0.1 || v % 1.5 < 0.1) return [160, 158, 152];
        return n > 0.8 ? [192, 190, 184] : [184, 182, 176];
      }
      // lots / yards
      if (v > RV[1] + SW && u < RU[0] - SW && u > 10.5) {
        // parking lot
        if (Math.abs((v - 28) % 5) < 0.12 && u > 11) return [226, 224, 210];
        return n > 0.85 ? [118, 120, 124] : [110, 112, 116];
      }
      if (v > RV[1] + SW && u > RU[1] + SW) {
        // small park strip
        return n > 0.86 ? [134, 170, 96] : n < 0.1 ? [100, 140, 72] : [118, 160, 86];
      }
      return n > 0.85 ? [176, 170, 160] : [168, 162, 152];
    });
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
      let col = zb < 0.8 ? [150, 150, 148] : zb < 3 ? [120, 116, 112] : [98, 92, 86];
      if (zb > 3 && n > 0.9) col = [138, 128, 116];
      if (Math.abs(zb - 5) < 0.4 && hash2(x, 3) > 0.4) col = [70, 74, 80]; // pipe
      return face === 'right' ? mulRGB(col, 0.82) : col;
    };
    L.fillPoly([project(0, V, 0), project(U, V, 0), project(U, V, -DEPTH), project(0, V, -DEPTH)], sideFn('left'));
    L.fillPoly([project(U, V, 0), project(U, 0, 0), project(U, 0, -DEPTH), project(U, V, -DEPTH)], sideFn('right'));
  }

  function obstacles() {
    const o = [];
    TREES.forEach((t) => o.push({ u: t.u, v: t.v, r: 0.6 }));
    LAMPS.forEach((l) => o.push({ u: l.u, v: l.v, r: 0.3 }));
    return o;
  }

  function boxes() {
    const b = BUILDINGS.map((B) => ({ u0: B.u0, v0: B.v0, u1: B.u1, v1: B.v1 }));
    PARKED.forEach((c) => {
      if (c.along === 'u') b.push({ u0: c.u - 2.2, v0: c.v - 1, u1: c.u + 2.2, v1: c.v + 1 });
      else b.push({ u0: c.u - 1, v0: c.v - 2.2, u1: c.u + 1, v1: c.v + 2.2 });
    });
    b.push({ u0: TRUCK.u - 2.6, v0: TRUCK.v - 1.15, u1: TRUCK.u + 2.4, v1: TRUCK.v + 1.15 });
    b.push({ u0: 38, v0: 25.6, u1: 41, v1: 26.4 }); // bus stop
    b.push({ u0: 56.5, v0: 11.5, u1: 58.5, v1: 13.5 }); // kiosk
    return b;
  }

  function items(buf, atmo, t, S) {
    const L = atmo.applyLight;
    const out = [];
    BUILDINGS.forEach((B) => {
      out.push({ depth: B.u0 + B.v0 + 2, draw: () => Kit.drawBlock(buf, PROJ, B.u0, B.v0, B.u1, B.v1, B.h, L, B) });
    });
    PARKED.forEach((c) => {
      out.push({ depth: c.u + c.v + 1, draw: () => Kit.drawCar(buf, PROJ, c.u, c.v, c.along, L, { color: c.color, wreck: c.wreck }) });
    });
    const pal = { leafBright: L([128, 172, 94]), leafMid: L([96, 140, 74]), leafDark: L([64, 98, 54]), bark: L([110, 78, 56]), ink: atmo.ink };
    const sway = Math.sin(t * 2.2) * 0.8;
    TREES.forEach((tr, i) => {
      out.push({ depth: tr.u + tr.v, draw: () => { const p = project(tr.u, tr.v, 0); Kit.drawTree(buf, p[0], p[1], TREE_SHAPES[i], sway, pal); } });
    });
    LAMPS.forEach((l) => {
      out.push({
        depth: l.u + l.v,
        draw: () => {
          const p = project(l.u, l.v, 0);
          const x = Math.round(p[0]);
          const y = Math.round(p[1]);
          const m = L([62, 66, 72]);
          buf.vline(x, y - 18, y, m);
          buf.hline(x, x + 4, y - 18, m);
          buf.rect(x + 3, y - 18, 3, 2, L([236, 230, 200]));
        },
      });
    });
    // bus stop shelter
    out.push({
      depth: 38 + 26,
      draw: () => {
        Kit.box(buf, PROJ, 38, 25.6, 0, 41, 26.4, 5.2, L([120, 150, 170]), L([150, 186, 206]), L([118, 146, 164]), atmo.ink);
        const s = project(41, 26.4, 4.3);
        buf.rect(Math.round(s[0]) - 2, Math.round(s[1]) - 2, 4, 3, L([240, 200, 60]));
      },
    });
    // kiosk
    out.push({ depth: 57 + 12, draw: () => Kit.shadedBox(buf, PROJ, 56.5, 11.5, 0, 58.5, 13.5, 4.2, [214, 180, 92], L, atmo.ink) });
    // school fence + gate posts at the east edge
    out.push({
      depth: U + 26,
      draw: () => {
        const fence = L([70, 80, 74]);
        for (let v = 24.6; v < V - 0.5; v += 0.8) {
          const p = project(U - 0.4, v, 0);
          buf.vline(Math.round(p[0]), Math.round(p[1]) - 6, Math.round(p[1]), fence);
        }
        const a = project(U - 0.4, 24.6, 5);
        const b = project(U - 0.4, V - 0.5, 5);
        buf.line(a[0], a[1], b[0], b[1], fence);
        const g = project(U - 0.4, 24.4, 0);
        buf.rect(Math.round(g[0]) - 1, Math.round(g[1]) - 12, 3, 12, L([170, 60, 50]));
        // school sign: yellow board with a tiny pixel book
        buf.rect(Math.round(g[0]) - 5, Math.round(g[1]) - 17, 11, 6, L([238, 196, 64]));
        buf.rect(Math.round(g[0]) - 2, Math.round(g[1]) - 16, 5, 3, L([60, 90, 160]));
      },
    });
    out.push({
      depth: U + 12,
      draw: () => {
        const fence = L([70, 80, 74]);
        for (let v = 0.6; v < 13.4; v += 0.8) {
          const p = project(U - 0.4, v, 0);
          buf.vline(Math.round(p[0]), Math.round(p[1]) - 6, Math.round(p[1]), fence);
        }
        const g = project(U - 0.4, 13.6, 0);
        buf.rect(Math.round(g[0]) - 1, Math.round(g[1]) - 12, 3, 12, L([170, 60, 50]));
      },
    });
    return out;
  }

  const TREE_SHAPES = TREES.map((t, i) => Kit.makeTreeShape(i * 5.1 + 2, 0.9, 'round'));

  function wanderPoints() {
    const pts = [];
    for (let u = 3; u < U - 2; u += 5) pts.push({ u, v: 17 }, { u: u + 2, v: 21 });
    for (let v = 3; v < V - 2; v += 5) pts.push({ u: 28, v }, { u: 32, v: v + 2 });
    return pts;
  }

  const CH2 = {
    id: 'street',
    number: 2,
    title: 'Слишком много',
    place: 'Перекрёсток',
    day: 'ДЕНЬ 1',
    duration: 900,
    retryAt: 18.0,

    create(api) {
      let phase = 'stand'; // stand → pickup → fight
      let rifleProp = null;
      let soldierAmmo = 24;
      let shotT = 0.6;

      const S = Diorama.Stage.create(api, {
        U, V, depth: DEPTH, origin: ORIGIN, startHours: 14 + 46 / 60, day: 'День 1',
        env: { cloudCoverage: 0.95, cloudDarkness: 0.6, windSpeed: 0.9 },
        decayAt: () => 0.85,
        bake,
        obstacles: obstacles(),
        boxes: boxes(),
        exits: EXITS,
        wanderPoints: wanderPoints(),
        nav: true,
        clouds: { offsetY: -36, maxY: 70 },
        items,
        camera: (t) => camera(t),
        audioMix: (t) => ({ calm: 0, dread: 0.85, murmur: 0.3 }),
      });
      const crowd = S.crowd;
      crowd.panic = true;
      crowd.hunting = true;
      const sfx = S.sfx;
      const P = S.player;

      // The truck from the park comes tearing down the street — and doesn't make the turn
      const T0 = 2.8;
      let crashed = false;
      sfx.engine(1);
      const truck = S.addVehicle({
        u: -7, v: TRUCK.v, speed: 12, targetSpeed: 12, lightsOn: true,
        path: [{ u: TRUCK.u, v: TRUCK.v, fn: crash }],
      });
      function crash(veh) {
        crashed = true;
        veh.speed = 0;
        veh.targetSpeed = 0;
        veh.path = [];
        veh.wreck = true;
        veh.lightsOn = false;
        veh.smash = false;
        sfx.stopEngine();
        sfx.crash();
        api.shake(1.2);
        S.fire.add(TRUCK.u + 2.6, TRUCK.v - 0.3, 1.4, 0.6);
        S.particles.bloodBurst(TRUCK.u + 2.6, TRUCK.v, 2, 0, 0);
        for (let k = 0; k < 14; k++) {
          S.particles.spawn({ kind: 'shell', u: TRUCK.u + 2.6, v: TRUCK.v + (Math.random() - 0.5) * 2, z: 2.5, vu: 2 + Math.random() * 3, vv: (Math.random() - 0.5) * 4, vz: 4 + Math.random() * 4, gravity: 30, maxAge: 6, col: [220, 232, 240] });
        }
        S.after(0.9, () => {
          veh.doorOpen = 1;
          hero.hidden = false;
          soldier.hidden = false;
          soldier.noTarget = false;
          hero.emote = 'double';
          hero.emoteT = 1.2;
        });
      }

      const hero = crowd.add({
        role: 'hero', u: TRUCK.u + 0.5, v: TRUCK.v + 2.1, state: 'idle', stay: true, hidden: true, scriptLocked: true, protected: true, noTurn: true, facing: -1,
        look: { skin: [234, 198, 168], hair: [46, 36, 30], hairStyle: 'short', shirt: [204, 56, 48], pants: [56, 70, 104], shoes: [38, 38, 46] },
      });
      const soldier = crowd.add({
        role: 'soldier', u: TRUCK.u - 1.5, v: TRUCK.v + 2.0, state: 'idle', stay: true, scriptLocked: true, noTurn: true,
        armed: true, rifle: true, reactMin: 99, hidden: true, noTarget: true,
        look: { skin: [214, 176, 140], hair: [40, 36, 30], hairStyle: 'cap', cap: [86, 98, 64], shirt: [96, 108, 72], pants: [84, 92, 64], shoes: [40, 40, 36] },
      });
      soldier.turnAt = -1;

      // The horde, closing in from all four streets
      const ring = [[8, 18], [12, 21], [50, 18], [55, 21], [29, 5], [31, 8], [30, 33], [28, 36]];
      ring.forEach((p) => S.spawnZombie(p[0], p[1], { chaseSpeed: 2.6 + Math.random() * 0.5 }));
      S.at(T0 + 2, () => S.wave('A', 3));
      S.at(T0 + 4, () => S.wave('C', 3));
      S.at(T0 + 6, () => S.wave('D', 3));
      S.at(T0 + 8.5, () => S.wave('A', 2));
      S.at(T0 + 10, () => S.wave('C', 3));

      // The end of the soldier is not optional
      S.at(T0 + 12.5, () => {
        if (soldier.state === 'down' || soldier.state === 'grabbed') return;
        const z = crowd.actors
          .filter((a) => a.kind === 'zombie' && a.state !== 'down' && a.state !== 'flung')
          .sort((a, b) => Diorama.Actors.dist(a, soldier) - Diorama.Actors.dist(b, soldier))[0] || S.spawnZombie(soldier.u - 4, soldier.v + 1);
        crowd.setScript(z, [
          { type: 'approach', who: soldier, speed: 4.5, r: 0.9 },
          { type: 'call', fn: (a) => { crowd._zombies = crowd.zombies(); crowd.bite(a, soldier); } },
        ]);
      });

      function giveControl() {
        phase = 'pickup';
        rifleProp = crowd.addProp({ type: 'pistol', u: soldier.u + 1.1, v: soldier.v + 0.4 });
        hero.v = Math.max(hero.v, TRUCK.v + 1.9);
        S.control(hero, { armed: false, melee: false, hp: 3, speed: 4.0 });
        S.marker = { u: rifleProp.u, v: rifleProp.v, z: 5, color: [255, 214, 90] };
        S.trickle = { every: [5, 8], max: 14, n: [1, 2], from: 18 };
      }

      function camera(t) {
        if (!crashed) {
          const p = S.screenOf({ u: truck.u + 1, v: truck.v });
          return { x: p[0] + 20, y: p[1], zoom: 1.6, speed: 3 };
        }
        if (phase === 'stand') {
          const a = S.screenOf(soldier);
          const b = S.screenOf(hero);
          return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 - 2, zoom: t < 1.5 ? 1.6 : 1.95, speed: 1.6 };
        }
        return null;
      }

      S.cfg.update = (t, dt) => {
        if (phase === 'stand') {
          // The soldier holds the crossroads
          hero.facing = -1;
          if (soldier.state === 'idle' || soldier.state === 'walk') {
            shotT -= dt;
            const targets = crowd.actors.filter((a) => a.kind === 'zombie' && a.revealed && a.state !== 'down' && a.state !== 'flung' && Diorama.Actors.dist(a, soldier) < 16);
            if (targets.length && soldierAmmo > 0 && shotT <= 0 && t > T0 + 1.0 && !soldier.hidden) {
              targets.sort((a, b) => Diorama.Actors.dist(a, soldier) - Diorama.Actors.dist(b, soldier));
              S.npcShoot(soldier, targets[0], { spread: 0.2, heavy: true, dmg: 2 });
              soldierAmmo--;
              shotT = 0.32 + Math.random() * 0.12;
              if (soldierAmmo === 0) {
                soldier.armed = false;
                soldier.emote = 'double';
                soldier.emoteT = 2;
                sfx.tone(900, 'square', 0.03, 0.05);
              }
            } else if (targets.length) {
              S.aimAt(soldier, targets[0]);
            }
          }
          if (soldier.state === 'down' && soldier.st > 0.4) giveControl();
        } else if (phase === 'pickup' && rifleProp) {
          if (Math.hypot(hero.u - rifleProp.u, hero.v - rifleProp.v) < 1.3 && P.playing) {
            const i = crowd.props.indexOf(rifleProp);
            if (i >= 0) crowd.props.splice(i, 1);
            rifleProp = null;
            S.giveGun({ mag: 8, ammo: 8, reserve: 8 });
            S.title('RUN', 2.2);
            api.soundscape.playReload();
            phase = 'fight';
            const g = EXITS.find((e) => e.playerExit);
            S.marker = { u: g.u - 1.5, v: g.v, z: 9 };
          }
        }
      };

      S.chapter = { hero, soldier, get phase() { return phase; } };
      return S.instance();
    },
  };

  Diorama.StoryChapters = Diorama.StoryChapters || [];
  Diorama.StoryChapters.push(CH2);
})(window);
