/*
 * Chapter 4 — «Крыша» (The rooftop: Day 1 evening → Day 12)
 *
 * The hero comes up the school stairs onto the roof. Three strangers are hiding
 * there — Mina points a pistol at him, then lowers it. Time-lapse: days and
 * nights flicker by, the bare roof becomes a camp (laundry, tarps, the grill,
 * string lights). Day 12, sunset: the stairwell door starts to shake. Hold the
 * roof, then take everyone down the fire escape. Kostya is bitten and hides it.
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { lerp, smoothstep } = Diorama.Palette;
  const Arch = Diorama.Architecture;
  const { BUILDING, ORIGIN_X, ORIGIN_Y, ISO_SCALE } = Diorama.Iso;

  const SC = Diorama.Scenarios.LIST;
  const ENV_GOLDEN = Object.assign({}, SC.find((s) => s.id === 'golden').env);
  const ENV_SQUALL = Object.assign({}, SC.find((s) => s.id === 'squall').env);
  ENV_SQUALL.stringLights = 0.8;
  ENV_SQUALL.laundryCount = 0.8;
  // Day 1: a bare roof — no camp yet
  const ENV_BARE = Object.assign({}, ENV_GOLDEN, {
    laundryCount: 0, tarpsMode: 0, grillActive: 0, stringLights: 0, goldenBoost: 0.3, swallowsActive: 0, cloudCoverage: 0.45,
  });

  const ARRIVE_END = 5.2;
  const LAPSE_START = 5.6;
  const LAPSE_END = 15.6;
  const BURST = 22.2;
  const CONTROL = 23;
  const HOLD = 45;
  const H0 = 16.6; // day 1, 16:36
  const H1 = 18 + 40 / 60 + 24 * 11; // day 12, 18:40

  const DOOR = { u: 9.0, v: 11.6 };
  const ESCAPE = { id: 'F', u: 41.2, v: 20.2, du: 0.7, dv: 0.7, playerExit: true, halfWidth: 2.2, noSpawn: true };
  const CAMP_SPOTS = [[20, 14], [26, 17], [31, 16], [36, 13], [24, 9], [33, 9], [18, 18], [38, 17]];

  const CH4 = {
    id: 'roof',
    number: 4,
    title: 'Крыша',
    place: 'Крыша',
    day: 'ДЕНЬ 1 → 12',
    duration: 900,
    retryAt: CONTROL + 0.2,

    create(api) {
      const rs = {
        env: null, scenario: { id: 'golden', windowPreset: [1, 0, 1, 1, 0, 1, 0, 1] }, time: 0, hours: H0,
        windowOverrides: {}, doorOpen: false, turbineAngle: 0, treeShake: 0, clothesGust: 0, tarpShake: 0,
        grillStoke: 0, snowmanBounce: 0, cinemaChannel: 0, ripples: [], hitList: [],
      };
      let phase = 'arrive'; // arrive → lapse → calm → hold → escape
      let climbT = 2;
      let minaShotT = 1;
      let dayShuffle = 0;
      let holdT = 0;
      let flashT = 0;
      const noHit = [];

      const hoursAt = (t) => {
        const h0 = H0 + LAPSE_START * 0.01;
        if (t < LAPSE_START) return H0 + t * 0.01;
        if (t < LAPSE_END) return lerp(h0, H1, smoothstep(LAPSE_START, LAPSE_END, t));
        return H1 + ((t - LAPSE_END) * 0.55) / 60;
      };

      const S = Diorama.Stage.create(api, {
        U: BUILDING.U, V: BUILDING.V, depth: 0,
        origin: [ORIGIN_X, ORIGIN_Y - BUILDING.Z_ROOF * ISO_SCALE],
        startHours: H0, hoursAt, day: 'День 12',
        env: Object.assign({}, ENV_BARE),
        decayAt: (t) => smoothstep(BURST - 2, BURST + 18, t) * 0.45,
        envAt: (env, t) => {
          if (t < LAPSE_END + 0.1) {
            const k = smoothstep(LAPSE_START, LAPSE_END, t);
            for (const key in ENV_GOLDEN) env[key] = lerp(ENV_BARE[key], ENV_GOLDEN[key], k);
            // clouds race across the sky during the time-lapse
            env.windSpeed = t > LAPSE_START && t < LAPSE_END ? 6 : ENV_GOLDEN.windSpeed;
          } else {
            const k = smoothstep(BURST - 1, BURST + 10, t);
            for (const key in ENV_SQUALL) env[key] = lerp(ENV_GOLDEN[key], ENV_SQUALL[key], k);
            rs.scenario.id = k > 0.5 ? 'squall' : 'golden';
          }
        },
        floatShadow: false,
        boxes: [
          { u0: 3, v0: 3, u1: 15.2, v1: 11.2 },
          { u0: 35.6, v0: 3, u1: 43, v1: 9.2 },
          { u0: 3, v0: 14.4, u1: 11, v1: 21 },
          { u0: 40.5, v0: 17.2, u1: 43, v1: 21 },
          { u0: 29.6, v0: 18.4, u1: 32.8, v1: 20.8 },
        ],
        bounds: { u0: 4.4, v0: 4.4, u1: 41.6, v1: 20.5 },
        exits: [ESCAPE],
        wanderPoints: [{ u: 20, v: 14 }, { u: 28, v: 9 }, { u: 34, v: 15 }, { u: 18, v: 18 }, { u: 25, v: 18 }, { u: 37, v: 12 }],
        clouds: { offsetY: 0 },
        playZoom: 2.0,
        drawBack: (buf, atmo) => {
          Arch.drawBuildingShell(buf, rs, atmo, noHit);
          Arch.drawRoofFloorAndBackParapet(buf, rs, atmo, noHit);
        },
        items: (buf, atmo) => Arch.collectRoofItems(buf, rs, atmo, noHit),
        drawFront: (buf, atmo) => {
          Arch.drawFrontParapet(buf, rs, atmo);
          Arch.drawStringLights(buf, rs, atmo);
          noHit.length = 0;
        },
        drawLights: (buf, atmo, t) => {
          // the neighbour's flashlight from the fire escape when it is time to go
          if (phase !== 'escape') return;
          const on = Math.sin(t * 9) > 0;
          if (!on) return;
          const p = S.project(ESCAPE.u + 1.2, ESCAPE.v + 1.2, -3);
          buf.smoothGlow(p[0], p[1], 22, 12, [255, 246, 200], 0.9, true);
          buf.rect(Math.round(p[0]) - 1, Math.round(p[1]) - 1, 3, 3, [255, 255, 236]);
        },
        camera: (t) => camera(t),
        audioMix: (t) => ({ calm: t < BURST - 3 ? 1 : 0, dread: smoothstep(BURST - 3, BURST + 1, t) * 0.8, murmur: 0 }),
      });
      rs.env = S.env;
      const crowd = S.crowd;
      const sfx = S.sfx;
      const P = S.player;

      // The hero arrives through the stair door; three strangers are already here
      const hero = crowd.add({
        role: 'hero', u: DOOR.u, v: DOOR.v + 0.3, state: 'idle', stay: true, scriptLocked: true, protected: true, noTurn: true, armed: true, facing: 1,
        look: { skin: [234, 198, 168], hair: [46, 36, 30], hairStyle: 'short', shirt: [204, 56, 48], pants: [56, 70, 104], shoes: [38, 38, 46] },
      });
      const mina = crowd.add({
        role: 'mina', u: 19, v: 14.5, state: 'idle', stay: true, scriptLocked: true, noTarget: true, noTurn: true, facing: -1, armed: true,
        look: { skin: [236, 204, 180], hair: [52, 40, 36], hairStyle: 'long', shirt: [214, 220, 206], pants: [70, 84, 116] },
      });
      const petrovich = crowd.add({
        role: 'oldman', u: 24, v: 11.5, state: 'idle', stay: true, scriptLocked: true, facing: -1, noTurn: true,
        look: { skin: [230, 196, 170], hair: [206, 206, 210], hairStyle: 'bald', shirt: [120, 104, 86], pants: [80, 74, 66] },
      });
      const kostya = crowd.add({
        role: 'kostya', u: 22, v: 17.5, state: 'idle', stay: true, scriptLocked: true, facing: -1, noTarget: true, noTurn: true,
        look: { skin: [220, 182, 148], hair: [130, 86, 50], hairStyle: 'short', shirt: [70, 110, 140], pants: [60, 60, 70] },
      });
      kostya.turnAt = -1;
      petrovich.turnAt = -1;

      // ── Arrival ────────────────────────────────────────────────
      S.at(0.3, () => { rs.doorOpen = true; sfx.thud(); });
      S.at(0.6, () => crowd.setScript(hero, [{ type: 'goto', u: 13.5, v: 13.2, speed: 1.6 }]));
      S.at(1.2, () => {
        mina.emote = 'exclaim';
        mina.emoteT = 1.6;
        S.aimAt(mina, hero);
        [petrovich, kostya].forEach((a) => { a.emote = 'exclaim'; a.emoteT = 1.4; crowd.faceToward(a, hero); });
      });
      S.at(2.2, () => { hero.emote = 'dots'; hero.emoteT = 1.6; });
      S.at(3.2, () => {
        mina.armed = false;
        mina.emote = 'heart';
        mina.emoteT = 1.6;
        petrovich.emote = 'note';
        petrovich.emoteT = 1.4;
        crowd.setScript(kostya, [{ type: 'goto', u: 10.5, v: 12.4, speed: 2 }, { type: 'call', fn: () => { rs.doorOpen = false; sfx.thud(); } }]);
      });

      // ── Time-lapse: Day 1 → Day 12 ─────────────────────────────
      S.at(LAPSE_START, () => {
        phase = 'lapse';
        rs.doorOpen = false; // they barricade the stairwell for the next eleven days
        [hero, mina, petrovich, kostya].forEach((a) => { a.script = null; a.emote = null; });
      });
      S.at(LAPSE_END, () => {
        phase = 'calm';
        place(hero, 37.5, 15.5, 1);
        place(mina, 28, 17.4, 1);
        mina.state = 'sit';
        mina.seated = true;
        mina.seatZ = 1.0;
        place(petrovich, 31.4, 17.6, 1);
        place(kostya, 21, 13.4, -1);
      });

      function place(a, u, v, f) {
        a.u = u;
        a.v = v;
        a.vu = 0;
        a.vv = 0;
        a.facing = f;
        a.state = 'idle';
        a.seated = false;
      }

      // ── Day 12: the door ───────────────────────────────────────
      S.at(BURST - 2.6, () => { sfx.thud(); api.shake(0.25); });
      S.at(BURST - 1.8, () => {
        sfx.thud();
        api.shake(0.35);
        [mina, petrovich, kostya, hero].forEach((a) => { a.emote = 'exclaim'; a.emoteT = 1.6; });
      });
      S.at(BURST - 1.0, () => { sfx.thud(); api.shake(0.45); });
      S.at(BURST, () => {
        rs.doorOpen = true;
        sfx.crash();
        api.shake(0.9);
        crowd.panic = true;
        crowd.hunting = true;
        for (let i = 0; i < 3; i++) spawnFromDoor();
        mina.seated = false;
        mina.state = 'idle';
        mina.armed = true;
        petrovich.noTarget = false;
      });
      S.at(CONTROL, () => {
        phase = 'hold';
        S.control(hero, { armed: true, melee: true, hp: 3, speed: 3.6, gun: { mag: 8, ammo: 8, reserve: 24 } });
        S.title('HOLD ON', 2.2);
      });
      // Kostya gets bitten — and gets away with it (for now)
      S.at(CONTROL + 7, () => {
        const z = spawnFromDoor();
        kostya.noTarget = false;
        kostya.scriptLocked = true;
        z.prey = kostya;
        z.state = 'chase';
        z.chaseSpeed = 4.2;
      });

      function spawnFromDoor() {
        return S.spawnZombie(DOOR.u + (Math.random() - 0.5) * 1.2, DOOR.v + 0.2, { chaseSpeed: 3.0 + Math.random() * 0.5 });
      }

      function spawnClimber() {
        const side = Math.random();
        let u;
        let v;
        let du = 0;
        let dv = 0;
        if (side < 0.4) { u = 17 + Math.random() * 17; v = 4.6; dv = 1; }
        else if (side < 0.75) { u = 14 + Math.random() * 14; v = 20.3; dv = -1; }
        else { u = 41.4; v = 10 + Math.random() * 6; du = -1; }
        sfx.groan();
        return S.spawnZombie(u, v, { state: 'climb', zOff: -6, climbFrom: -6, climbDur: 1.6, climbDU: du, climbDV: dv, chaseSpeed: 3.0 + Math.random() * 0.5 });
      }

      function camera(t) {
        if (phase === 'arrive') {
          const h = S.screenOf(hero);
          const m = S.screenOf(mina);
          return { x: (h[0] + m[0]) / 2, y: (h[1] + m[1]) / 2, zoom: 1.9, speed: 1.6 };
        }
        if (phase === 'lapse' || (phase === 'calm' && t < BURST - 2.6)) {
          return { x: 244, y: 160, zoom: 1.6, speed: 1.2 };
        }
        if (t < CONTROL) {
          const d = S.screenOf({ u: DOOR.u, v: DOOR.v });
          return { x: d[0] + 30, y: d[1], zoom: 1.9, speed: 2 };
        }
        return null;
      }

      S.cfg.update = (t, dt) => {
        rs.time = t;
        rs.hours = S.hoursAt(t);
        rs.turbineAngle += dt * (2.5 + S.env.windSpeed * 7.5);
        rs.ripples.length = 0;

        if (phase === 'lapse') {
          // life on the roof, one blink per day
          dayShuffle -= dt;
          if (dayShuffle <= 0) {
            dayShuffle = 0.85;
            [hero, mina, petrovich, kostya].forEach((a, i) => {
              const sp = CAMP_SPOTS[(i * 3 + Math.floor(t * 7)) % CAMP_SPOTS.length];
              place(a, sp[0] + (Math.random() - 0.5), sp[1] + (Math.random() - 0.5), Math.random() < 0.5 ? -1 : 1);
            });
          }
        }

        if (phase === 'hold') {
          holdT += dt;
          climbT -= dt;
          if (climbT <= 0) {
            climbT = 2.4 + Math.random() * 1.6;
            const alive = crowd.actors.filter((a) => a.kind === 'zombie' && a.state !== 'down' && a.state !== 'flung').length;
            if (alive < 11) {
              if (Math.random() < 0.45) spawnFromDoor();
              else spawnClimber();
            }
          }
          minaShotT -= dt;
          if (mina.state !== 'down' && minaShotT <= 0) {
            const tgt = crowd.actors
              .filter((a) => a.kind === 'zombie' && a.state !== 'down' && a.state !== 'flung' && a.state !== 'climb' && Diorama.Actors.dist(a, mina) < 11)
              .sort((a, b) => Diorama.Actors.dist(a, mina) - Diorama.Actors.dist(b, mina))[0];
            if (tgt) {
              S.npcShoot(mina, tgt, { spread: 0.25, dmg: 1 });
              minaShotT = 1.0 + Math.random() * 0.6;
            }
          }
          if (kostya.state === 'grabbed' && kostya.st > 0.55) {
            const z = kostya.grabbedBy;
            if (z) crowd.damageZombie(z, 9, -1, 0, 0.5);
            kostya.bitten = true;
            kostya.noTarget = true;
            kostya.state = 'idle';
            kostya.stay = true;
            kostya.emote = 'double';
            kostya.emoteT = 1.5;
          }
          if (holdT >= HOLD && P.deadT < 0) {
            phase = 'escape';
            S.marker = { u: ESCAPE.u - 0.9, v: ESCAPE.v - 0.9, z: 8 };
            sfx.tone(880, 'sine', 0.05, 0.3);
            sfx.tone(1175, 'sine', 0.05, 0.3, 0.18);
          }
        }
        if (phase === 'escape') flashT += dt;
      };

      S.cfg.onWin = () => {
        [mina, kostya].forEach((a) => {
          if (a.state === 'down') return;
          a.scriptLocked = true;
          a.noTarget = true;
          crowd.setScript(a, [{ type: 'goto', u: ESCAPE.u - 0.8, v: ESCAPE.v - 0.8, speed: 4 }, { type: 'call', fn: (x) => { x.hidden = true; } }]);
        });
        api.after(1.2, () => api.fade(1, 1.2));
        api.after(2.6, () => api.next());
      };

      S.chapter = { hero, mina, kostya, petrovich, get phase() { return phase; } };
      return S.instance();
    },
  };

  Diorama.StoryChapters = Diorama.StoryChapters || [];
  Diorama.StoryChapters.push(CH4);
})(window);
