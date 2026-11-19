/*
 * Chapter 4 — «Крыша» (The rooftop, Day 12, 18:40)
 *
 * Our rooftop — the very same diorama as the sandbox — twelve days in:
 * laundry, the grill, the string lights. Then the stairwell door starts to
 * shake. Hold the roof until dark, then get everyone down the fire escape.
 * Kostya gets bitten in the fight and hides it (that is chapter 5).
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { lerp, smoothstep, clamp } = Diorama.Palette;
  const Arch = Diorama.Architecture;
  const { BUILDING, ORIGIN_X, ORIGIN_Y, ISO_SCALE } = Diorama.Iso;

  const SC = Diorama.Scenarios.LIST;
  const ENV_GOLDEN = Object.assign({}, SC.find((s) => s.id === 'golden').env);
  const ENV_SQUALL = Object.assign({}, SC.find((s) => s.id === 'squall').env);
  ENV_SQUALL.stringLights = 0.8;
  ENV_SQUALL.laundryCount = 0.8;
  const HOLD = 50;
  const DOOR = { u: 9.0, v: 11.6 };
  const ESCAPE = { id: 'F', u: 41.2, v: 20.2, du: 0.7, dv: 0.7, playerExit: true, halfWidth: 2.2, noSpawn: true };

  const CH4 = {
    id: 'roof',
    number: 4,
    title: 'Крыша',
    place: 'Крыша',
    day: 'ДЕНЬ 12',
    duration: 900,
    retryAt: 12.2,

    create(api) {
      // Fake rooftop state for the original architecture renderer
      const rs = {
        env: null, scenario: { id: 'golden', windowPreset: [1, 0, 1, 1, 0, 1, 0, 1] }, time: 0, hours: 18.6,
        windowOverrides: {}, doorOpen: false, turbineAngle: 0, treeShake: 0, clothesGust: 0, tarpShake: 0,
        grillStoke: 0, snowmanBounce: 0, cinemaChannel: 0, ripples: [], hitList: [],
      };
      let phase = 'calm'; // calm → hold → escape
      let climbT = 2;
      let minaShotT = 1;
      const noHit = [];

      const S = Diorama.Stage.create(api, {
        U: BUILDING.U, V: BUILDING.V, depth: 0,
        origin: [ORIGIN_X, ORIGIN_Y - BUILDING.Z_ROOF * ISO_SCALE],
        startHours: 18 + 40 / 60, minutesPerSecond: 0.55, day: 'День 12',
        env: Object.assign({}, ENV_GOLDEN),
        decayAt: (t) => smoothstep(10, 30, t) * 0.45,
        envAt: (env, t) => {
          const k = smoothstep(10, 22, t);
          for (const key in ENV_SQUALL) env[key] = lerp(ENV_GOLDEN[key], ENV_SQUALL[key], k);
          rs.scenario.id = k > 0.5 ? 'squall' : 'golden';
        },
        floatShadow: false,
        boxes: [
          { u0: 3, v0: 3, u1: 15.2, v1: 11.2 }, // stair penthouse
          { u0: 35.6, v0: 3, u1: 43, v1: 9.2 }, // utility shack
          { u0: 3, v0: 14.4, u1: 11, v1: 21 }, // planter
          { u0: 40.5, v0: 17.2, u1: 43, v1: 21 }, // AC unit
          { u0: 29.6, v0: 18.4, u1: 32.8, v1: 20.8 }, // grill table
        ],
        bounds: { u0: 4.4, v0: 4.4, u1: 41.6, v1: 20.5 },
        exits: [ESCAPE],
        wanderPoints: [{ u: 20, v: 14 }, { u: 28, v: 9 }, { u: 34, v: 15 }, { u: 18, v: 18 }, { u: 25, v: 18 }, { u: 37, v: 12 }],
        clouds: { offsetY: 0 },
        playZoom: 2.6,
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
        camera: (t) => camera(t),
        audioMix: (t) => ({ calm: t < 9 ? 1 : 0, dread: smoothstep(9, 13, t) * 0.8, murmur: 0 }),
      });
      rs.env = S.env;
      const crowd = S.crowd;
      const sfx = S.sfx;
      const P = S.player;

      const hero = crowd.add({
        role: 'hero', u: 37.5, v: 15.5, state: 'idle', stay: true, scriptLocked: true, protected: true, noTurn: true, rifle: true, armed: true, facing: 1,
        look: { skin: [234, 198, 168], hair: [46, 36, 30], hairStyle: 'short', shirt: [204, 56, 48], pants: [56, 70, 104], shoes: [38, 38, 46] },
      });
      const mina = crowd.add({
        role: 'mina', u: 28, v: 17.4, state: 'sit', seated: true, seatZ: 1.0, facing: 1, stay: true, scriptLocked: true, noTarget: true, noTurn: true,
        look: { skin: [236, 204, 180], hair: [52, 40, 36], hairStyle: 'long', shirt: [214, 220, 206], pants: [70, 84, 116] },
      });
      const petrovich = crowd.add({
        role: 'oldman', u: 31.4, v: 17.6, state: 'idle', stay: true, facing: 1, reactMin: 0.8, runSpeed: 2.6, gawkChance: 0,
        look: { skin: [230, 196, 170], hair: [206, 206, 210], hairStyle: 'bald', shirt: [120, 104, 86], pants: [80, 74, 66] },
      });
      const kostya = crowd.add({
        role: 'kostya', u: 21, v: 13.4, state: 'idle', stay: true, facing: -1, noTarget: true, noTurn: true, reactMin: 0.4,
        look: { skin: [220, 182, 148], hair: [130, 86, 50], hairStyle: 'short', shirt: [70, 110, 140], pants: [60, 60, 70] },
      });
      kostya.turnAt = -1;

      // ── The calm, then the door ────────────────────────────────
      S.at(8.6, () => { sfx.thud(); api.shake(0.25); });
      S.at(9.4, () => {
        sfx.thud();
        api.shake(0.35);
        [mina, petrovich, kostya, hero].forEach((a) => { a.emote = 'exclaim'; a.emoteT = 1.6; });
      });
      S.at(10.2, () => { sfx.thud(); api.shake(0.45); });
      S.at(11.2, () => {
        rs.doorOpen = true;
        sfx.crash();
        api.shake(0.9);
        crowd.panic = true;
        crowd.hunting = true;
        for (let i = 0; i < 3; i++) spawnFromDoor(i * 0.5);
        mina.seated = false;
        mina.state = 'idle';
        mina.armed = true;
        petrovich.stay = false;
      });
      S.at(12, () => {
        phase = 'hold';
        S.control(hero, { armed: true, melee: true, hp: 3, speed: 3.6, timer: HOLD, gun: { mag: 20, ammo: 20, reserve: 30, rate: 0.14, dmg: 2, heavy: true } });
        hero.rifle = true;
      });
      // Kostya gets bitten — and gets away with it (for now)
      S.at(19, () => {
        const z = spawnFromDoor(0);
        kostya.noTarget = false;
        z.prey = kostya;
        z.state = 'chase';
        z.chaseSpeed = 4.2;
      });

      function spawnFromDoor(delay) {
        const z = S.spawnZombie(DOOR.u + (Math.random() - 0.5) * 1.2, DOOR.v + 0.2, { chaseSpeed: 3.1 + Math.random() * 0.5 });
        z.wait = delay;
        return z;
      }

      function spawnClimber() {
        // over the parapet: back-right edge (v small) or front-left edge (v large) or the east edge
        const side = Math.random();
        let u;
        let v;
        let du = 0;
        let dv = 0;
        if (side < 0.4) { u = 17 + Math.random() * 17; v = 4.6; dv = 1; }
        else if (side < 0.75) { u = 14 + Math.random() * 14; v = 20.3; dv = -1; }
        else { u = 41.4; v = 10 + Math.random() * 6; du = -1; }
        const z = S.spawnZombie(u, v, { state: 'climb', zOff: -6, climbFrom: -6, climbDur: 1.6, climbDU: du, climbDV: dv, chaseSpeed: 3.1 + Math.random() * 0.5 });
        sfx.groan();
        return z;
      }

      function camera(t) {
        if (t < 8.6) {
          // the camp at sunset: roof in frame, a strip of golden sky above
          return { x: 244 + t * 1.2, y: 158, zoom: 1.75 + t * 0.03, speed: 1 };
        }
        if (t < 12) {
          const d = S.screenOf({ u: DOOR.u, v: DOOR.v });
          return { x: d[0] + 30, y: d[1], zoom: 2.4, speed: 2 };
        }
        if (phase === 'escape') return null;
        return null;
      }

      S.cfg.update = (t, dt) => {
        rs.time = t;
        rs.hours = S.hoursAt(t);
        rs.turbineAngle += dt * (2.5 + S.env.windSpeed * 7.5);
        rs.clothesGust = Math.max(0, rs.clothesGust - dt);
        rs.ripples.length = 0;

        if (phase === 'hold') {
          // the dead keep coming: up the stairs and over the parapet
          climbT -= dt;
          if (climbT <= 0) {
            climbT = 2.4 + Math.random() * 1.6;
            const alive = crowd.actors.filter((a) => a.kind === 'zombie' && a.state !== 'down' && a.state !== 'flung').length;
            if (alive < 12) {
              if (Math.random() < 0.45) spawnFromDoor(0);
              else spawnClimber();
            }
          }
          // Mina covers you with her pistol
          minaShotT -= dt;
          if (mina.state !== 'down' && minaShotT <= 0) {
            const tgt = crowd.actors
              .filter((a) => a.kind === 'zombie' && a.state !== 'down' && a.state !== 'flung' && a.state !== 'climb' && Diorama.Actors.dist(a, mina) < 11)
              .sort((a, b) => Diorama.Actors.dist(a, mina) - Diorama.Actors.dist(b, mina))[0];
            if (tgt) {
              S.npcShoot(mina, tgt, { spread: 0.25, dmg: 2 });
              minaShotT = 0.9 + Math.random() * 0.5;
            }
          }
          // Kostya: the bite he survives
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
          if (P.timer != null && P.timer <= 0 && P.deadT < 0) {
            phase = 'escape';
            P.timer = null;
            S.marker = { u: ESCAPE.u - 0.9, v: ESCAPE.v - 0.9, z: 8 };
            S.pushHud();
          }
        }
      };

      S.cfg.onWin = () => {
        // Mina and Kostya follow the hero down the fire escape
        [mina, kostya].forEach((a, i) => {
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
