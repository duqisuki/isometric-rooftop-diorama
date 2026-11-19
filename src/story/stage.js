/*
 * Stage — shared runtime for story chapters.
 *
 * A chapter describes its location (bake / items / obstacles / exits), cast and
 * timeline; the stage provides everything else: lighting & weather, crowd sim,
 * blood, fire, vehicles, the player (run / sprint / optional gun & melee),
 * one-touch gore deaths, HUD, goal markers, camera and chapter transitions.
 *
 *   const S = Diorama.Stage.create(api, cfg);
 *   S.at(12, () => ...);            // timeline
 *   S.control(hero, { armed, oneTouch, goal, timer });
 *   return S.instance();             // what Story expects
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { computeAtmosphere, clamp, lerp, lerpRGB, mulRGB, smoothstep, packRGB, rgbToHex } = Diorama.Palette;
  const Kit = Diorama.StoryKit;
  const Actors = Diorama.Actors;
  const Weather = Diorama.Weather;
  const { CANVAS_W, CANVAS_H } = Diorama.Iso;

  const BASE_ENV = {
    rainIntensity: 0, snowIntensity: 0, snowLevel: 0, puddleLevel: 0, storminess: 0,
    cloudCoverage: 0.3, cloudDarkness: 0.05, cloudWarmth: 0.1, windSpeed: 0.4,
    lightningChance: 0, goldenBoost: 0, stringLights: 0, cinemaMode: 0, grillActive: 0,
    tarpsMode: 0, laundryCount: 0, pigeonsActive: 0, firefliesActive: 0, swallowsActive: 0, snowmanActive: 0,
  };

  function create(api, cfg) {
    const S = { api, cfg, t: 0 };
    const proj = Kit.makeProjector(cfg.origin[0], cfg.origin[1]);
    const project = proj.project;
    S.proj = proj;
    S.project = project;
    const env = (S.env = Object.assign({}, BASE_ENV, cfg.env || {}));
    const startHours = cfg.startHours;
    const mps = cfg.minutesPerSecond != null ? cfg.minutesPerSecond : 0.25;
    S.hoursAt = cfg.hoursAt || ((t) => startHours + (t * mps) / 60);
    const atmo0 = computeAtmosphere(startHours, env, 0);
    const weather = (S.weather = Weather.createWeather());
    const decals = (S.decals = new Kit.Decals(proj));
    const particles = (S.particles = new Kit.Particles(proj, decals));
    const fire = (S.fire = new Kit.FireFX(proj, particles));
    const sfx = (S.sfx = api.sfx);
    sfx.stopEngine();

    const world = (S.world = {
      U: cfg.U, V: cfg.V,
      obstacles: cfg.obstacles || [],
      boxes: cfg.boxes || [],
      exits: cfg.exits || [],
      wanderPoints: cfg.wanderPoints || [{ u: cfg.U / 2, v: cfg.V / 2 }],
      proj,
      bounds: cfg.bounds || null,
    });
    if (cfg.nav) world.nav = new Kit.NavGrid(world);

    const ground = new Kit.LitLayer(CANVAS_W, CANVAS_H);
    if (cfg.bake) cfg.bake(ground, { project, proj, unproject: proj.unproject, sunDir: atmo0.sunDir, S });
    ground.finalize();

    const events = [];
    const crowd = (S.crowd = new Actors.Crowd(world, {
      decals, particles, audio: sfx,
      onEvent: (type, data) => events.push({ type, data }),
    }));

    // ── Timeline ──────────────────────────────────────────────────
    const timeline = [];
    S.at = (t, fn) => timeline.push({ t, fn, done: false });
    S.after = (sec, fn) => api.after(sec, fn);
    S.caption = (text, dur) => api.caption(text, dur);
    S.title = (word, dur) => api.title(word, dur);

    // ── Player ────────────────────────────────────────────────────
    const P = (S.player = {
      hero: null, playing: false, armed: false, melee: false, oneTouch: false, maxHp: 3,
      gun: { mag: 0, ammo: 0, reserve: 0, reloadT: 0, fireCD: 0, meleeCD: 0 },
      stamina: 1, sprintLock: false, goal: '', timer: null, timerLabel: '',
      deadT: -1, finished: false, cross: [240, 135], crossOnZombie: false, hurtFlash: 0,
    });
    const tracers = [];
    const flashes = [];
    S.marker = null; // { u, v, z } — pulsing goal arrow

    function hintHtml() {
      let h = '<span><b>WASD</b> бег</span><span><b>Shift</b> рывок</span>';
      if (P.armed) h += '<span><b>Мышь</b> прицел</span><span><b>ЛКМ</b> выстрел</span><span><b>R</b> перезарядка</span>';
      if (P.melee) h += '<span><b>ПКМ / Пробел</b> удар</span>';
      return h + '<span><b>Esc</b> пауза</span>';
    }

    function pushHud() {
      const hero = P.hero;
      if (!hero) return;
      api.hud({
        hp: Math.max(0, hero.hp), maxHp: P.maxHp, oneTouch: P.oneTouch,
        armed: P.armed, ammo: P.gun.ammo, mag: P.gun.mag, reserve: P.gun.reserve, reloading: P.gun.reloadT > 0,
        stamina: P.stamina, kills: crowd.kills, goal: P.goal,
        timer: P.timer != null ? Math.max(0, P.timer) : null, timerLabel: P.timerLabel,
      });
    }
    S.pushHud = pushHud;

    S.control = (hero, o) => {
      o = o || {};
      P.hero = hero;
      hero.controlled = true;
      hero.protected = false;
      hero.scriptLocked = false;
      hero.stay = false;
      hero.script = null;
      hero.forcedExit = null;
      hero.seated = false;
      hero.hidden = false;
      hero.turnAt = -1;
      hero.emote = null;
      hero.noTarget = false;
      P.armed = !!o.armed;
      hero.armed = P.armed;
      P.melee = o.melee != null ? !!o.melee : P.armed;
      P.oneTouch = !!o.oneTouch;
      P.maxHp = P.oneTouch ? 1 : o.hp || 3;
      hero.hp = P.maxHp;
      hero.runSpeed = o.speed || 3.9;
      if (o.gun) P.gun = Object.assign({ mag: 8, ammo: 8, reserve: 16, reloadT: 0, fireCD: 0, meleeCD: 0, rate: 0.38, dmg: 1, spread: 0.07 }, o.gun);
      P.goal = o.goal || '';
      P.timer = o.timer != null ? o.timer : null;
      P.timerLabel = o.timerLabel || 'Продержись';
      P.playing = true;
      P.stamina = 1;
      if (hero.item && hero.item !== 'gun') crowd.dropItem(hero);
      api.setPlayable(true);
      pushHud();
    };

    // Temporarily take control away (cutscenes). Hero is ignored by zombies while protected.
    S.release = (protect) => {
      P.playing = false;
      api.setPlayable(false);
      api.hint(false);
      if (P.hero) {
        P.hero.input = { mu: 0, mv: 0 };
        P.hero.controlled = false;
        P.hero.state = 'idle';
        P.hero.stay = true;
        P.hero.vu = 0;
        P.hero.vv = 0;
        if (protect) P.hero.protected = true;
      }
    };

    S.resume = () => {
      const hero = P.hero;
      if (!hero) return;
      hero.controlled = true;
      hero.protected = false;
      hero.stay = false;
      hero.script = null;
      P.playing = true;
      api.setPlayable(true);
      pushHud();
    };

    S.giveGun = (gun) => {
      P.armed = true;
      P.melee = true;
      if (P.hero) P.hero.armed = true;
      P.gun = Object.assign({ mag: 8, ammo: 8, reserve: 16, reloadT: 0, fireCD: 0, meleeCD: 0, rate: 0.38, dmg: 1, spread: 0.07 }, gun || {});
      pushHud();
    };
    S.hintHtml = hintHtml;

    // ── Combat ────────────────────────────────────────────────────
    function zombieBox(z) {
      const p = project(z.u, z.v, z.zOff || 0);
      const top = z.state === 'feed' ? 11 : 15;
      return [p[0] - 3.5, p[1] - top, p[0] + 3.5, p[1] + 1];
    }

    function rayHit(ox, oy, dx, dy, maxLen, from) {
      let best = null;
      const acts = crowd.actors;
      for (let i = 0; i < acts.length; i++) {
        const z = acts[i];
        if (z.kind !== 'zombie' || z.state === 'down' || z.state === 'flung' || z.removed) continue;
        if (from && Math.hypot(z.u - from.u, z.v - from.v) > 26) continue;
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
          best = { z, t: tmin, hx: ox + dx * tmin, hy, head: hy < b[1] + 3.5 };
        }
      }
      return best;
    }

    function gunPos(a) {
      const hp = project(a.u, a.v, a.zOff || 0);
      const ox = a.muzzleX != null ? a.muzzleX : hp[0] + (a.aimSX || a.facing || 1) * 7;
      const oy = a.muzzleY != null ? a.muzzleY : hp[1] - 7 + (a.aimSY || 0) * 5;
      return [ox, oy];
    }

    // Fire one round from any shooter along a screen direction
    function fireFrom(shooter, dx, dy, o) {
      o = o || {};
      const g = gunPos(shooter);
      const hit = rayHit(g[0], g[1], dx, dy, 240, shooter);
      let ex = g[0] + dx * 240;
      let ey = g[1] + dy * 240;
      let killed = false;
      if (hit) {
        ex = hit.hx;
        ey = hit.hy;
        const wu = shooter.aimWU || 0;
        const wv = shooter.aimWV || 0;
        killed = crowd.damageZombie(hit.z, hit.head ? 3 : o.dmg || 2, wu * 3.5, wv * 3.5, 0.45);
        if (hit.head) particles.bloodBurst(hit.z.u, hit.z.v, 9, 6, 2.6);
      }
      tracers.push({ x0: g[0], y0: g[1], x1: ex, y1: ey, age: 0 });
      flashes.push({ x: g[0], y: g[1], age: 0 });
      shooter.recoil = 1;
      sfx.shot(o.heavy);
      crowd.noise(shooter, 20);
      particles.spawn({
        kind: 'shell', u: shooter.u, v: shooter.v, z: 6,
        vu: -(shooter.aimWV || 0) * 1.6 + (Math.random() - 0.5), vv: (shooter.aimWU || 0) * 1.6 + (Math.random() - 0.5),
        vz: 7, gravity: 34, maxAge: 5, col: [214, 178, 92],
      });
      return { hit, killed };
    }

    // Aim an NPC at a target actor (screen + world directions)
    function aimAt(a, t) {
      const ap = project(a.u, a.v, 0);
      const tp = project(t.u, t.v, (t.zOff || 0));
      const ax = tp[0] - ap[0];
      const ay = tp[1] - 8 - (ap[1] - 7);
      const l = Math.hypot(ax, ay) || 1;
      a.aimSX = ax / l;
      a.aimSY = ay / l;
      const wu = t.u - a.u;
      const wv = t.v - a.v;
      const wl = Math.hypot(wu, wv) || 1;
      a.aimWU = wu / wl;
      a.aimWV = wv / wl;
      a.facing = a.aimSX >= 0 ? 1 : -1;
    }
    S.aimAt = aimAt;

    // NPC shot with some spread; returns true if it killed something
    S.npcShoot = (a, target, o) => {
      o = o || {};
      aimAt(a, target);
      const spread = (Math.random() - 0.5) * (o.spread != null ? o.spread : 0.12);
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const dx = a.aimSX * c - a.aimSY * s;
      const dy = a.aimSX * s + a.aimSY * c;
      return fireFrom(a, dx, dy, o).killed;
    };

    function reload() {
      const g = P.gun;
      if (g.reloadT > 0 || g.ammo >= g.mag || g.reserve <= 0) return;
      g.reloadT = 1.1;
      api.soundscape.playReload();
    }

    function heroShoot() {
      const g = P.gun;
      if (g.reloadT > 0 || g.fireCD > 0) return;
      if (g.ammo <= 0) {
        if (g.reserve > 0) reload();
        else sfx.tone(900, 'square', 0.03, 0.05);
        return;
      }
      g.ammo--;
      g.fireCD = g.rate || 0.2;
      const sp = (Math.random() - 0.5) * (g.spread || 0);
      const c = Math.cos(sp);
      const sn = Math.sin(sp);
      const r = fireFrom(P.hero, P.hero.aimSX * c - P.hero.aimSY * sn, P.hero.aimSX * sn + P.hero.aimSY * c, { dmg: g.dmg, heavy: g.heavy });
      if (r.hit) api.soundscape.playZombieHit();
      api.shake(r.killed ? 0.22 : 0.15);
      if (g.ammo === 0 && g.reserve > 0) api.after(0.25, reload);
    }

    function heroMelee() {
      const g = P.gun;
      const hero = P.hero;
      if (g.meleeCD > 0) return;
      g.meleeCD = 0.55;
      hero.meleeT = 0.25;
      sfx.whoosh();
      let hitAny = false;
      const acts = crowd.actors;
      for (let i = 0; i < acts.length; i++) {
        const z = acts[i];
        if (z.kind !== 'zombie' || z.state === 'down' || z.state === 'flung' || z.removed) continue;
        const du = z.u - hero.u;
        const dv = z.v - hero.v;
        const d = Math.hypot(du, dv);
        if (d > 2.2 || d < 0.01) continue;
        if ((du * (hero.aimWU || 0) + dv * (hero.aimWV || 0)) / d < 0.05) continue;
        crowd.damageZombie(z, 1, (du / d) * 5, (dv / d) * 5, 0.8);
        hitAny = true;
      }
      if (hitAny) {
        sfx.thud();
        api.soundscape.playZombieHit();
        api.shake(0.28);
      }
    }

    function zombieUnderCross() {
      const acts = crowd.actors;
      for (let i = 0; i < acts.length; i++) {
        const z = acts[i];
        if (z.kind !== 'zombie' || z.state === 'down' || z.state === 'flung' || z.removed || !z.revealed) continue;
        const b = zombieBox(z);
        if (P.cross[0] >= b[0] - 1 && P.cross[0] <= b[2] + 1 && P.cross[1] >= b[1] - 1 && P.cross[1] <= b[3]) return true;
      }
      return false;
    }

    function updatePlayer(dt) {
      const hero = P.hero;
      const inp = api.input;
      const k = inp.keys;
      const mx = (k.d ? 1 : 0) - (k.a ? 1 : 0);
      const my = (k.s ? 1 : 0) - (k.w ? 1 : 0);
      let mu = mx + my;
      let mv = -mx + my;
      const ml = Math.hypot(mu, mv);
      if (ml > 0) {
        mu /= ml;
        mv /= ml;
      }
      // Sprint with stamina
      let boost = 1;
      if (k.shift && ml > 0 && !P.sprintLock && P.stamina > 0) {
        boost = 1.45;
        P.stamina = Math.max(0, P.stamina - dt / 2.4);
        if (P.stamina <= 0) P.sprintLock = true;
      } else {
        P.stamina = Math.min(1, P.stamina + dt / 3.4);
        if (P.stamina > 0.35) P.sprintLock = false;
      }
      hero.input = { mu: mu * boost, mv: mv * boost };

      const g = P.gun;
      g.fireCD -= dt;
      g.meleeCD -= dt;
      if (g.reloadT > 0) {
        g.reloadT -= dt;
        if (g.reloadT <= 0) {
          const take = Math.min(g.mag - g.ammo, g.reserve);
          g.ammo += take;
          g.reserve -= take;
        }
      }

      if (P.armed || P.melee) {
        P.cross = api.mouse();
        const hp = project(hero.u, hero.v, 0);
        const ax = P.cross[0] - hp[0];
        const ay = P.cross[1] - (hp[1] - 7);
        const al = Math.hypot(ax, ay) || 1;
        hero.aimSX = ax / al;
        hero.aimSY = ay / al;
        const w = proj.unproject(P.cross[0], P.cross[1] + 7, 0);
        const wu = w[0] - hero.u;
        const wv = w[1] - hero.v;
        const wl = Math.hypot(wu, wv) || 1;
        hero.aimWU = wu / wl;
        hero.aimWV = wv / wl;
        if (P.armed && inp.fire > 0) heroShoot();
        if (P.melee && inp.melee > 0) heroMelee();
        if (P.armed && inp.reload > 0) reload();
        P.crossOnZombie = P.armed && zombieUnderCross();
      } else {
        hero.aimSX = null;
        hero.aimSY = null;
      }
      inp.fire = 0;
      inp.melee = 0;
      inp.reload = 0;
      if (P.timer != null) P.timer -= dt;
      pushHud();
    }

    // ── Vehicles ──────────────────────────────────────────────────
    const vehicles = (S.vehicles = []);
    S.addVehicle = (o) => {
      const veh = Object.assign({
        kind: 'truck', u: 0, v: 0, speed: 0, targetSpeed: 0, accel: 8, path: [], pathIdx: 0,
        doorOpen: 0, lightsOn: true, smash: true, box: null, hidden: false,
      }, o);
      veh.box = { u0: 0, v0: 0, u1: 0, v1: 0 };
      vehicles.push(veh);
      return veh;
    };

    function updateVehicles(dt) {
      for (let i = 0; i < vehicles.length; i++) {
        const veh = vehicles[i];
        const wp = veh.path[veh.pathIdx];
        if (wp) {
          const du = wp.u - veh.u;
          const dv = wp.v - veh.v;
          const d = Math.hypot(du, dv);
          const want = wp.stop && d < 4 ? Math.max(0.6, veh.targetSpeed * (d / 4)) : veh.targetSpeed;
          veh.speed += (want - veh.speed) * Math.min(1, dt * (veh.speed > want ? 3 : 1.5));
          if (d < 0.3 || veh.speed * dt >= d) {
            veh.u = wp.u;
            veh.v = wp.v;
            veh.pathIdx++;
            if (wp.stop) veh.speed = 0;
            if (wp.fn) wp.fn(veh);
          } else {
            veh.u += (du / d) * veh.speed * dt;
            veh.v += (dv / d) * veh.speed * dt;
          }
        } else {
          veh.speed = Math.max(0, veh.speed - dt * 10);
        }
        veh.box.u0 = veh.u - 2.6;
        veh.box.u1 = veh.u + 2.4;
        veh.box.v0 = veh.v - 1.15;
        veh.box.v1 = veh.v + 1.15;
        // Smash anything in front of the bumper
        if (veh.smash && veh.speed > 1.5) {
          const acts = crowd.actors;
          for (let k = 0; k < acts.length; k++) {
            const a = acts[k];
            if (a.removed || a.hidden) continue;
            if (a.u < veh.box.u0 - 0.4 || a.u > veh.box.u1 + 0.6 || a.v < veh.box.v0 - 0.5 || a.v > veh.box.v1 + 0.5) continue;
            if (a.kind === 'zombie' && a.state !== 'down' && a.state !== 'flung') {
              const side = a.v >= veh.v ? 1 : -1;
              crowd.fling(a, veh.speed * 0.9 + Math.random() * 2, side * (2 + Math.random() * 3), 7 + Math.random() * 4);
              sfx.thud();
              api.shake(0.35);
            } else if (a.kind !== 'zombie' && a.state !== 'down') {
              // shove people aside
              a.v = a.v >= veh.v ? veh.box.v1 + 0.6 : veh.box.v0 - 0.6;
            }
          }
        }
      }
    }

    // ── Spawning ──────────────────────────────────────────────────
    S.spawnZombie = (u, v, o) => crowd.add(Object.assign({
      kind: 'zombie', state: 'shamble', u, v,
      chaseSpeed: 3.4 + Math.random() * 0.6,
      look: Actors.randomLook(),
    }, o || {}));

    S.wave = (exitId, n, o) => {
      const e = world.exits.find((x) => x.id === exitId);
      if (!e) return [];
      const out = [];
      for (let i = 0; i < n; i++) {
        const side = (i - (n - 1) / 2) * 1.3;
        const z = S.spawnZombie(
          e.u - e.du * (0.4 + i * 0.6) + (e.dv !== 0 ? side : 0),
          e.v - e.dv * (0.4 + i * 0.6) + (e.du !== 0 ? side : 0),
          o
        );
        if (o && o.hunt && P.hero && !P.hero.protected) {
          z.prey = P.hero;
          z.state = 'chase';
        }
        out.push(z);
      }
      sfx.groan();
      return out;
    };

    // Keep the pressure on while the player is in control
    S.trickle = null; // { every: [6, 9], max: 18, n: [1, 2], from: t }
    let trickleT = 3;

    // ── Events: death, win ────────────────────────────────────────
    function onPlayerDown(hero) {
      P.playing = false;
      P.deadT = S.t;
      P.hurtFlash = 1;
      api.setPlayable(false);
      api.hint(false);
      api.shake(1.3);
      sfx.scream(1.05);
      decals.add(hero.u, hero.v, 2.8, { grow: 1.1 });
      // the dead attract the hungry: nearest zombies pile on
      const near = crowd.actors
        .filter((z) => z.kind === 'zombie' && z.state !== 'down' && z.state !== 'flung' && z.victim !== hero)
        .sort((a, b) => Actors.dist(a, hero) - Actors.dist(b, hero))
        .slice(0, 3);
      near.forEach((z, i) => {
        if (Actors.dist(z, hero) > 12) return;
        crowd.setScript(z, [
          { type: 'approach', who: hero, speed: 3.6, r: 0.8 + i * 0.2 },
          { type: 'call', fn: (a) => { a.state = 'feed'; a.st = 0; a.victim = hero; a.feedDur = 60; } },
        ]);
      });
      pushHud();
    }

    // No text, no cards: the gore plays out, the screen goes black, we try again
    function onHeroDead() {
      api.after(1.9, () => api.fade(1, 1.1));
      api.after(3.3, () => api.retry());
    }

    S.win = () => {
      if (P.finished) return;
      P.finished = true;
      if (P.playing) S.release(true);
      if (cfg.onWin) cfg.onWin(S);
      else {
        api.after(0.6, () => api.fade(1, 1.2));
        api.after(2.0, () => api.next());
      }
    };

    function handleEvents() {
      while (events.length) {
        const e = events.shift();
        if (cfg.onEvent && cfg.onEvent(e, S) === false) continue;
        if (e.type === 'bite') {
          const t = e.data.t;
          if (t.turnAt < 0 && !t.noTurn && t !== P.hero) {
            t.turnAt = Math.random() < (cfg.turnChance != null ? cfg.turnChance : 0.6) ? 3 + Math.random() * 3.5 : -1;
          }
          if (S.t > 1) api.shake(0.35);
        } else if (e.type === 'playerHurt') {
          api.shake(0.7);
          P.hurtFlash = 0.45;
          sfx.heartbeat();
        } else if (e.type === 'playerDown') {
          onPlayerDown(e.data);
        } else if (e.type === 'death' && e.data === P.hero) {
          onHeroDead();
        } else if (e.type === 'playerExit') {
          S.win();
        }
      }
    }

    // ── Atmosphere ────────────────────────────────────────────────
    let atmoCache = null;
    const decayAt = cfg.decayAt || (() => 0);
    const tintTo = cfg.tint || [0.9, 0.84, 0.86];
    const dreadBg = cfg.dreadBg || [222, 208, 206];

    function computeAtmo(t) {
      const d = decayAt(t);
      const atmo = computeAtmosphere(S.hoursAt(t), env, weather.lightningFlash || 0);
      const tint = lerpRGB([1, 1, 1], tintTo, d);
      const base = atmo.applyLight;
      atmo.applyLight = (rgb) => mulRGB(base(rgb), tint);
      atmo.ambientTinted = [atmo.ambient[0] * tint[0], atmo.ambient[1] * tint[1], atmo.ambient[2] * tint[2]];
      let bg = lerpRGB(atmo.bg, dreadBg, d * 0.9);
      if (cfg.bgAt) bg = cfg.bgAt(t, bg, atmo, S);
      atmo.bg = bg;
      atmo.bgU32 = packRGB(bg);
      atmo.bgHex = rgbToHex(bg);
      atmo.isDarkTheme = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 < 0.44;
      atmo.ink = atmo.applyLight([54, 60, 72]);
      atmo.decay = d;
      atmoCache = atmo;
      return atmo;
    }
    S.computeAtmo = computeAtmo;

    // ── Update ────────────────────────────────────────────────────
    function update(t, dt) {
      S.t = t;
      for (let i = 0; i < timeline.length; i++) {
        const e = timeline[i];
        if (!e.done && t >= e.t) {
          e.done = true;
          e.fn(S);
        }
      }
      if (dt <= 0) return;
      if (cfg.envAt) cfg.envAt(env, t, decayAt(t), S);
      Weather.updateWeather(weather, { env, ripples: [], time: t, atmo: atmoCache }, dt, api.soundscape);

      if (P.playing && P.hero) updatePlayer(dt);
      if (P.hurtFlash > 0) P.hurtFlash = Math.max(0, P.hurtFlash - dt * 1.1);
      for (let i = tracers.length - 1; i >= 0; i--) {
        tracers[i].age += dt;
        if (tracers[i].age > 0.09) tracers.splice(i, 1);
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].age += dt;
        if (flashes[i].age > 0.07) flashes.splice(i, 1);
      }

      updateVehicles(dt);
      crowd.update(dt);
      decals.update(dt);
      fire.update(dt, env.windSpeed);
      particles.update(dt);
      handleEvents();

      // Gore: keep the blood coming while they feed on the hero
      if (P.deadT >= 0 && P.hero && t - P.deadT < 3.2) {
        const h = P.hero;
        if (Math.random() < dt * 9) particles.bloodBurst(h.u + (Math.random() - 0.5) * 0.8, h.v + (Math.random() - 0.5) * 0.8, 2 + Math.random() * 5, 6, 3.6);
        if (Math.random() < dt * 5) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.8 + Math.random() * 2.2;
          decals.add(h.u + Math.cos(a) * r, h.v + Math.sin(a) * r, 0.2 + Math.random() * 0.35, { kind: 'splat' });
        }
      }

      // Trickle of new zombies
      if (S.trickle && P.playing && t > (S.trickle.from || 0)) {
        trickleT -= dt;
        if (trickleT <= 0) {
          const tr = S.trickle;
          trickleT = tr.every[0] + Math.random() * (tr.every[1] - tr.every[0]);
          const alive = crowd.actors.filter((a) => a.kind === 'zombie' && a.state !== 'down' && a.state !== 'flung').length;
          if (alive < (tr.max || 18)) {
            const far = world.exits.filter((e) => !e.noSpawn && (!P.hero || Math.hypot(e.u - P.hero.u, e.v - P.hero.v) > 12));
            const e = far[Math.floor(Math.random() * far.length)];
            if (e) S.wave(e.id, tr.n[0] + Math.floor(Math.random() * (tr.n[1] - tr.n[0] + 1)), { hunt: tr.hunt });
          }
        }
      }

      if (cfg.update) cfg.update(t, dt, S);
    }

    // ── Camera ────────────────────────────────────────────────────
    let lastHero = null;
    function screenOf(a, lift) {
      const p = project(a.u, a.v, a.zOff || 0);
      return [p[0], p[1] - (lift == null ? 8 : lift)];
    }
    S.screenOf = screenOf;

    function camera(t) {
      const c = cfg.camera ? cfg.camera(t, S) : null;
      if (c) return c;
      const hero = P.hero;
      if (hero && !hero.removed && !hero.hidden) lastHero = screenOf(hero);
      const hp = lastHero || [CANVAS_W / 2, CANVAS_H / 2];
      const zoom = cfg.playZoom || 1.75;
      if (P.playing) {
        if (P.armed) {
          return { x: hp[0] + (P.cross[0] - hp[0]) * 0.22, y: hp[1] + (P.cross[1] - hp[1]) * 0.22, zoom, speed: 5 };
        }
        const lead = 4;
        return { x: hp[0] + (hero.vu - hero.vv) * lead * 0.5, y: hp[1] + (hero.vu + hero.vv) * lead * 0.25, zoom, speed: 4 };
      }
      return { x: hp[0], y: hp[1], zoom: P.deadT >= 0 ? zoom * 1.25 : zoom, speed: P.deadT >= 0 ? 1.2 : 2 };
    }

    // ── Render ────────────────────────────────────────────────────
    function drawFloatShadow(buf) {
      if (cfg.floatShadow === false) return;
      const dz = -(cfg.depth || 9);
      const pL = project(0, cfg.V, dz);
      const pF = project(cfg.U, cfg.V, dz);
      const pR = project(cfg.U, 0, dz);
      const col = [170, 168, 178];
      for (let dy = 1; dy <= 5; dy++) {
        const a = (6 - dy) * 0.07;
        buf.line(pL[0] + 2, pL[1] + dy, pF[0], pF[1] + dy, col, a);
        buf.line(pF[0], pF[1] + dy, pR[0] - 2, pR[1] + dy, col, a);
      }
    }

    function vehicleItems(buf, atmo) {
      return vehicles.filter((v) => !v.hidden).map((veh) => ({
        depth: veh.u + veh.v + 1.6,
        draw: () => Kit.drawTruck(buf, proj, veh.u, veh.v, atmo.applyLight, {
          doorOpen: veh.doorOpen, lightsOn: veh.lightsOn, wreck: veh.wreck, burnt: veh.burnt, color: veh.color, canvas: veh.canvas,
        }),
      }));
    }

    function drawShots(buf) {
      for (let i = 0; i < tracers.length; i++) {
        const tr = tracers[i];
        buf.line(tr.x0, tr.y0, tr.x1, tr.y1, [255, 236, 170], 0.85 * (1 - tr.age / 0.09));
        buf.setPx(Math.round(tr.x1), Math.round(tr.y1), [255, 255, 230]);
      }
      for (let i = 0; i < flashes.length; i++) {
        const f = flashes[i];
        const fx = Math.round(f.x);
        const fy = Math.round(f.y);
        buf.smoothGlow(fx, fy, 14, 10, [255, 198, 92], 0.6, true);
        buf.rect(fx - 1, fy - 1, 3, 3, [255, 250, 226]);
        buf.setPx(fx - 2, fy, [255, 206, 78]);
        buf.setPx(fx + 2, fy, [255, 206, 78]);
        buf.setPx(fx, fy - 2, [255, 206, 78]);
        buf.setPx(fx, fy + 2, [255, 152, 54]);
      }
    }

    function drawMarker(buf, t) {
      const m = S.marker;
      if (!m) return;
      const p = project(m.u, m.v, (m.z || 8) + Math.sin(t * 4) * 1.2);
      const x = Math.round(p[0]);
      const y = Math.round(p[1]);
      const col = m.color || [96, 214, 120];
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

    function drawVignette(buf, d, col, k0, k1) {
      if (d < 0.02) return;
      const w = CANVAS_W;
      const h = CANVAS_H;
      for (let y = 0; y < h; y++) {
        const dy = (y - h / 2) / (h / 2);
        for (let x = 0; x < w; x++) {
          const dx = (x - w / 2) / (w / 2);
          const r = dx * dx * 0.8 + dy * dy;
          if (r < k0) continue;
          const a = clamp((r - k0) * k1, 0, 0.6) * d;
          if (a > 0.01) buf.blendPx(x, y, col, a);
        }
      }
    }

    function drawCrosshair(buf) {
      const x = Math.round(P.cross[0]);
      const y = Math.round(P.cross[1]);
      const col = P.gun.reloadT > 0 ? [170, 176, 190] : P.crossOnZombie ? [255, 64, 64] : [255, 255, 255];
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

    function render(buf, t) {
      const atmo = computeAtmo(t);
      const pseudo = { env, time: t, atmo, ripples: [] };
      buf.clearU32(atmo.bgU32);
      if (cfg.drawSky) cfg.drawSky(buf, atmo, t, S);
      if (cfg.stars !== false) Weather.drawSkyAndFarWeather(buf, weather, pseudo, atmo);
      if (cfg.drawBack) cfg.drawBack(buf, atmo, t, S);
      drawFloatShadow(buf);
      ground.composite(buf, atmo.ambientTinted);
      if (cfg.drawGround) cfg.drawGround(buf, atmo, t, S);
      decals.draw(buf, atmo);

      let items = crowd.collectItems(buf, atmo).concat(vehicleItems(buf, atmo));
      if (cfg.items) items = items.concat(cfg.items(buf, atmo, t, S));
      items.sort((a, b) => a.depth - b.depth);
      for (let i = 0; i < items.length; i++) items[i].draw();

      if (cfg.drawFront) cfg.drawFront(buf, atmo, t, S);
      fire.drawGlow(buf, atmo, t);
      particles.draw(buf, atmo);
      drawShots(buf);
      if (P.playing) drawMarker(buf, t);
      if (cfg.drawLights) cfg.drawLights(buf, atmo, t, S);
      if (cfg.clouds) {
        Weather.drawDitheredClouds(buf, weather, pseudo, atmo, null, Object.assign({ dreadTint: atmo.decay }, cfg.clouds));
      }
      if (env.rainIntensity > 0.05) Weather.drawForegroundWeather(buf, weather, pseudo, atmo, []);
      drawVignette(buf, atmo.decay, [40, 14, 20], 0.5, 0.45);
      if (P.hurtFlash > 0) drawVignette(buf, P.hurtFlash, [190, 16, 26], 0.3, 0.75);
      crowd.drawOverlay(buf, atmo);
      if (cfg.drawOverlay) cfg.drawOverlay(buf, atmo, t, S);
      if (P.playing && P.armed) drawCrosshair(buf);
      return atmo;
    }

    S.instance = () => ({
      update,
      render,
      camera,
      hours: (t) => S.hoursAt(t),
      audioMix: (t) => {
        if (cfg.audioMix) return cfg.audioMix(t, S);
        const runners = crowd.actors.some((a) => a.state === 'flee');
        return { calm: 0, dread: decayAt(t), murmur: runners ? 0.8 : 0.2 };
      },
      audioState: () => ({ env, atmo: atmoCache || atmo0 }),
      debug: S,
    });

    return S;
  }

  Diorama.Stage = { create, BASE_ENV };
})(window);
