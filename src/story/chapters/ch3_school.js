/*
 * Chapter 3 — «Школа» (School, ground floor cut-away, Day 1, 15:20)
 *
 * The hero slips in through the side door. Classrooms, a long corridor with
 * lockers, the canteen and the library — and the teachers who never left.
 * The stairs to the roof are at the far end of the corridor.
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { mulRGB, shiftRGB, hash2 } = Diorama.Palette;
  const Kit = Diorama.StoryKit;

  const U = 46;
  const V = 30;
  const DEPTH = 5;
  const WALL_H = 4.2; // cut-away interior walls
  const BACK_H = 10; // outer back walls
  const ORIGIN = [240 - 1.5 * (U - V), 135 - (U + V) * 0.75 + 4];
  const PROJ = Kit.makeProjector(ORIGIN[0], ORIGIN[1]);
  const project = PROJ.project;

  const CORR = [12, 18]; // corridor v-range
  // Interior walls: [u0, v0, u1, v1]
  const WALLS = [
    // corridor north wall with three classroom doors
    [0, 11.8, 5.5, 12.2], [8.5, 11.8, 21, 12.2], [24, 11.8, 37, 12.2], [40, 11.8, 46, 12.2],
    // corridor south wall with two doors
    [0, 17.8, 9, 18.2], [12, 17.8, 33, 18.2], [36, 17.8, 41.8, 18.2],
    // classroom partitions
    [15, 0, 15.4, 11.8], [30.6, 0, 31, 11.8],
    // canteen | library partition
    [22, 18.2, 22.4, 30],
    // stairwell side wall
    [41.8, 18.2, 42.2, 30],
  ];
  const DESKS = [];
  [[2, 13], [17, 29], [32.5, 44.5]].forEach((r) => {
    for (let u = r[0] + 1.2; u < r[1] - 1; u += 3.2) {
      for (let v = 3.2; v < 10; v += 2.6) DESKS.push({ u0: u, v0: v, u1: u + 1.8, v1: v + 0.9 });
    }
  });
  const TABLES = [];
  for (let u = 2.5; u < 20; u += 5) for (let v = 20.5; v < 28; v += 4) TABLES.push({ u0: u, v0: v, u1: u + 3, v1: v + 1.6 });
  const SHELVES = [];
  for (let u = 24.5; u < 40; u += 4) SHELVES.push({ u0: u, v0: 21, u1: u + 2.6, v1: 21.7 }, { u0: u, v0: 25.5, u1: u + 2.6, v1: 26.2 });
  const LOCKERS = [{ u0: 9, v0: 12.2, u1: 20.5, v1: 12.9 }, { u0: 24.5, v0: 12.2, u1: 36.5, v1: 12.9 }, { u0: 13, v0: 17.1, u1: 32, v1: 17.8 }];
  const EXITS = [
    { id: 'W', u: 0.9, v: 15, du: -1, dv: 0, noSpawn: true },
    { id: 'S', u: 44, v: 15, du: 1, dv: 0, playerExit: true, halfWidth: 2.6, noSpawn: true },
    { id: 'N1', u: 7, v: 1.2, du: 0, dv: -1 },
    { id: 'N2', u: 23, v: 1.2, du: 0, dv: -1 },
    { id: 'C', u: 11, v: 28.8, du: 0, dv: 1 },
  ];

  function bake(L) {
    const top = [project(0, 0), project(U, 0), project(U, V), project(0, V)];
    L.fillPoly(top, (x, y) => {
      const uv = PROJ.unproject(x + 0.5, y + 0.5, 0);
      const u = uv[0];
      const v = uv[1];
      const n = hash2(x, y);
      if (v > CORR[0] && v < CORR[1] && u < 42) {
        // corridor linoleum checker
        const chk = (Math.floor(u / 1.5) + Math.floor(v / 1.5)) % 2 === 0;
        const c = chk ? [206, 210, 204] : [176, 196, 192];
        return n > 0.92 ? shiftRGB(c, -10, -10, -10) : c;
      }
      if (u >= 42) {
        // stairwell: concrete steps going up toward +u
        const step = Math.floor((u - 42) * 2.2);
        const c = [170 - step * 6, 168 - step * 6, 162 - step * 6];
        return (u - 42) * 2.2 % 1 < 0.15 ? mulRGB(c, 0.8) : c;
      }
      if (v <= CORR[0]) {
        // classrooms: wooden floor planks
        const plank = Math.floor(v * 1.4);
        const c = hash2(plank, Math.floor((u + plank * 1.7) / 4)) > 0.5 ? [176, 136, 98] : [166, 126, 90];
        if ((v * 1.4) % 1 < 0.08) return mulRGB(c, 0.82);
        return n > 0.9 ? shiftRGB(c, 8, 6, 4) : c;
      }
      if (u < 22.2) {
        // canteen tiles
        const chk = (Math.floor(u) + Math.floor(v)) % 2 === 0;
        return chk ? [226, 222, 214] : [196, 120, 108];
      }
      // library carpet
      return n > 0.85 ? [92, 112, 150] : [84, 104, 142];
    });

    // Outer back walls (inner faces visible): along v=0 and u=0
    const wallFn = (face) => (x, y) => {
      let s;
      let yBot;
      if (face === 'N') {
        s = (x + 0.5 - PROJ.ox) / 3; // u (v = 0)
        yBot = project(s, 0, 0)[1];
      } else {
        s = -(x + 0.5 - PROJ.ox) / 3; // v (u = 0)
        yBot = project(0, s, 0)[1];
      }
      const z = (yBot - (y + 0.5)) / 1.5;
      if (z < 0 || z > BACK_H) return null;
      const n = hash2(x * 3, y * 7);
      let c = z < 1.2 ? [150, 160, 170] : [222, 214, 196];
      if (z > BACK_H - 0.5) c = [196, 188, 172];
      if (face === 'N') {
        // windows high on the outside wall, blackboards in classrooms
        const room = s < 15 ? 0 : s < 31 ? 1 : 2;
        const rc = [7.5, 23, 38.5][room];
        if (Math.abs(s - rc) < 3.2 && z > 3 && z < 5.8) return z > 5.5 || Math.abs(s - rc) > 3 ? [120, 96, 70] : [46, 72, 58];
        const wx = s % 4;
        if (z > 6.4 && z < 9 && wx > 0.8 && wx < 3.2) return z > 8.7 || wx < 1.0 ? [150, 156, 166] : [150, 186, 210];
      } else {
        // west wall: entrance door in the corridor, windows elsewhere
        if (s > 13.2 && s < 16.8 && z < 6) return z > 5.6 ? [120, 96, 70] : null;
        const wx = s % 4;
        if (z > 4 && z < 7.5 && wx > 0.8 && wx < 3.2) return z > 7.2 || wx < 1.0 ? [150, 156, 166] : [150, 186, 210];
        if (s > 18.4 && s < 29 && z > 2 && z < 3.4) return [200, 92, 70]; // canteen menu board
      }
      return n > 0.94 ? shiftRGB(c, -12, -12, -12) : c;
    };
    L.fillPoly([project(0, 0, BACK_H), project(U, 0, BACK_H), project(U, 0, 0), project(0, 0, 0)], wallFn('N'));
    L.fillPoly([project(0, 0, BACK_H), project(0, V, BACK_H), project(0, V, 0), project(0, 0, 0)], wallFn('W'));

    // Slab sides (cut-away floor)
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
      const c = zb < 0.7 ? [196, 188, 172] : zb < 1.4 ? [120, 110, 100] : [150, 146, 140];
      return face === 'right' ? mulRGB(c, 0.82) : c;
    };
    L.fillPoly([project(0, V, 0), project(U, V, 0), project(U, V, -DEPTH), project(0, V, -DEPTH)], side('left'));
    L.fillPoly([project(U, V, 0), project(U, 0, 0), project(U, 0, -DEPTH), project(U, V, -DEPTH)], side('right'));
  }

  function boxes() {
    const b = [];
    WALLS.forEach((w) => b.push({ u0: w[0], v0: w[1], u1: w[2], v1: w[3] }));
    DESKS.concat(TABLES, SHELVES, LOCKERS).forEach((d) => b.push({ u0: d.u0, v0: d.v0, u1: d.u1, v1: d.v1 }));
    b.push({ u0: 42.2, v0: 18.2, u1: 46, v1: 30 }); // under-stair storage
    return b;
  }

  function items(buf, atmo) {
    const L = atmo.applyLight;
    const out = [];
    const wallCol = [222, 214, 196];
    // walls split into short chunks for correct overlap with people
    WALLS.forEach((w) => {
      const alongU = w[2] - w[0] > w[3] - w[1];
      const len = alongU ? w[2] - w[0] : w[3] - w[1];
      const n = Math.max(1, Math.ceil(len / 2));
      for (let i = 0; i < n; i++) {
        const a = (len * i) / n;
        const b = (len * (i + 1)) / n;
        const u0 = alongU ? w[0] + a : w[0];
        const u1 = alongU ? w[0] + b : w[2];
        const v0 = alongU ? w[1] : w[1] + a;
        const v1 = alongU ? w[3] : w[1] + b;
        out.push({
          depth: (u0 + u1) / 2 + (v0 + v1) / 2 + 0.25,
          draw: () => Kit.box(buf, PROJ, u0, v0, 0, u1, v1, WALL_H, L([240, 234, 220]), L(wallCol), mulRGB(L(wallCol), 0.8), atmo.ink),
        });
      }
    });
    DESKS.forEach((d) => {
      out.push({
        depth: d.u1 + d.v1 - 0.3,
        draw: () => {
          Kit.box(buf, PROJ, d.u0, d.v0, 1.3, d.u1, d.v1, 1.6, L([196, 160, 112]), L([170, 134, 92]), L([140, 108, 74]), null);
          const p1 = project(d.u0 + 0.1, d.v1, 0);
          const p2 = project(d.u1 - 0.1, d.v1, 0);
          buf.vline(Math.round(p1[0]), Math.round(p1[1]) - 2, Math.round(p1[1]), L([90, 90, 96]));
          buf.vline(Math.round(p2[0]), Math.round(p2[1]) - 2, Math.round(p2[1]), L([90, 90, 96]));
          const bk = project((d.u0 + d.u1) / 2, d.v0 + 0.3, 1.6);
          if (hash2(d.u0 * 7, d.v0 * 3) > 0.6) buf.rect(Math.round(bk[0]) - 1, Math.round(bk[1]) - 1, 3, 1, L([220, 220, 210]));
        },
      });
    });
    TABLES.forEach((d) => {
      Kit.chunks(d.u0, d.v0, d.u1, d.v1, 1.3).forEach((c) => out.push({
        depth: (c[0] + c[2]) / 2 + (c[1] + c[3]) / 2 + 0.2,
        draw: () => Kit.box(buf, PROJ, c[0], c[1], 1.2, c[2], c[3], 1.6, L([226, 226, 222]), L([180, 180, 178]), L([150, 150, 148]), null),
      }));
    });
    SHELVES.forEach((d, i) => {
      Kit.chunks(d.u0, d.v0, d.u1, d.v1, 1.3).forEach((c, ci) => out.push({
        depth: (c[0] + c[2]) / 2 + (c[1] + c[3]) / 2 + 0.2,
        draw: () => {
          Kit.box(buf, PROJ, c[0], c[1], 0, c[2], c[3], 3.6, L([150, 110, 74]), L([128, 92, 62]), L([104, 76, 52]), null);
          for (let k = 0; k < 3; k++) {
            const z = 0.6 + k * 1.1;
            const pa = project(c[0] + 0.1, c[3], z);
            const pb = project(c[2] - 0.1, c[3], z);
            for (let x = Math.round(pa[0]); x < Math.round(pb[0]); x++) {
              const col = [[180, 60, 56], [60, 100, 160], [210, 180, 80], [70, 130, 90]][(x + k + i + ci) % 4];
              const yy = Math.round(pa[1] + ((pb[1] - pa[1]) * (x - pa[0])) / Math.max(1, pb[0] - pa[0]));
              buf.vline(x, yy - 2, yy - 1, L(col));
            }
          }
        },
      }));
    });
    LOCKERS.forEach((d) => {
      Kit.chunks(d.u0, d.v0, d.u1, d.v1, 1.15).forEach((c) => out.push({
        depth: (c[0] + c[2]) / 2 + (c[1] + c[3]) / 2 + 0.2,
        draw: () => {
          Kit.box(buf, PROJ, c[0], c[1], 0, c[2], c[3], 3.8, L([96, 140, 160]), L([80, 124, 146]), L([62, 100, 120]), null);
          const pa = project(c[2], c[3], 0.2);
          const pb = project(c[2], c[3], 3.6);
          buf.line(pa[0], pa[1], pb[0], pb[1], L([52, 84, 100]));
          const vent = project((c[0] + c[2]) / 2, c[3], 3.1);
          buf.hline(Math.round(vent[0]) - 1, Math.round(vent[0]) + 1, Math.round(vent[1]), L([60, 96, 116]));
        },
      }));
    });
    // Teacher desks
    [[10.5, 2.4], [26, 2.4], [41.5, 2.4]].forEach((p) => {
      out.push({ depth: p[0] + p[1] + 1, draw: () => Kit.shadedBox(buf, PROJ, p[0] - 1.4, p[1] - 0.5, 0, p[0] + 1.4, p[1] + 0.6, 1.9, [120, 84, 58], L, atmo.ink) });
    });
    return out;
  }

  function wanderPoints() {
    const pts = [];
    for (let u = 3; u < 41; u += 4) pts.push({ u, v: 15 });
    [[7, 6], [23, 6], [38, 6], [11, 24], [32, 23.5], [32, 28]].forEach((p) => pts.push({ u: p[0], v: p[1] }));
    return pts;
  }

  const CH3 = {
    id: 'school',
    number: 3,
    title: 'Школа',
    place: 'Школа',
    day: 'ДЕНЬ 1',
    duration: 900,
    retryAt: 2.6,

    create(api) {
      const S = Diorama.Stage.create(api, {
        U, V, depth: DEPTH, origin: ORIGIN, startHours: 15 + 20 / 60, day: 'День 1',
        env: { cloudCoverage: 0.9, cloudDarkness: 0.55 },
        decayAt: () => 0.55,
        dreadBg: [70, 66, 70],
        bgAt: (t, bg) => [36, 38, 46],
        stars: false,
        floatShadow: false,
        bake,
        boxes: boxes(),
        bounds: { u0: 0.8, v0: 0.8, u1: 45.2, v1: 29.2 },
        exits: EXITS,
        wanderPoints: wanderPoints(),
        nav: true,
        items,
        playZoom: 1.9,
        camera: (t) => (t < 2.5 ? { x: S.screenOf(hero)[0] + 30, y: S.screenOf(hero)[1], zoom: 1.9, speed: 2 } : null),
        audioMix: () => ({ calm: 0, dread: 0.7, murmur: 0 }),
      });
      const crowd = S.crowd;
      crowd.panic = true;
      crowd.hunting = true;

      const hero = crowd.add({
        role: 'hero', u: 0.8, v: 15, state: 'walk', scriptLocked: true, protected: true, noTurn: true, armed: true,
        look: { skin: [234, 198, 168], hair: [46, 36, 30], hairStyle: 'short', shirt: [204, 56, 48], pants: [56, 70, 104], shoes: [38, 38, 46] },
      });
      crowd.setScript(hero, [{ type: 'goto', u: 4.2, v: 15, speed: 2.4 }]);

      // The staff who never left
      const staffLook = () => Diorama.Actors.randomLook({ shirt: [[226, 222, 214], [118, 128, 140], [150, 110, 90], [96, 120, 96]][Math.floor(Math.random() * 4)] });
      const spawnAt = [[6, 6], [9, 8], [12, 4], [20, 7], [25, 9], [28, 4], [35, 7], [40, 9], [5, 22], [14, 26], [19, 21], [27, 23.5], [36, 28], [38, 23.5], [24, 15], [33, 15.5]];
      spawnAt.forEach((p) => {
        S.spawnZombie(p[0], p[1], { chaseSpeed: 2.9 + Math.random() * 0.6, shambleSpeed: 0.6 + Math.random() * 0.3, look: staffLook() });
      });
      // Bodies of those who didn't make it
      [[18, 15], [29, 26]].forEach((p) => {
        S.decals.add(p[0], p[1], 1.6, {});
        crowd.add({ u: p[0], v: p[1], state: 'down', noTurn: true, turnAt: -1, fallDir: 1, bloodied: 1 });
      });

      S.at(2.5, () => {
        S.control(hero, { armed: true, melee: true, hp: 3, speed: 3.9, gun: { mag: 8, ammo: 8, reserve: 16 } });
        S.title('UPSTAIRS', 2.2);
        const g = EXITS.find((e) => e.playerExit);
        S.marker = { u: g.u - 1, v: g.v, z: 7 };
        S.trickle = { every: [7, 10], max: 14, n: [1, 2], from: 10 };
      });

      S.chapter = { hero };
      return S.instance();
    },
  };

  Diorama.StoryChapters = Diorama.StoryChapters || [];
  Diorama.StoryChapters.push(CH3);
})(window);
