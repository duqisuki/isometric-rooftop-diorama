/*
 * Crowd simulation for story chapters.
 * Humans: idle / walk / sit / swing / photo → alert → flee → exit (escaped)
 *                                     ↘ grabbed → down (dead) → rise → zombie
 * Zombies: shamble → chase → bite → feed → shamble
 * Plus: dogs on leashes, pigeons, released balloons and dropped props.
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { clamp, lerpRGB, mulRGB, shiftRGB, hash2, bayer4 } = Diorama.Palette;
  const { drawEmote } = Diorama.StoryKit;

  const SKINS = [[238, 204, 176], [224, 184, 150], [200, 152, 114], [168, 120, 86], [126, 88, 62], [244, 214, 190]];
  const HAIRS = [[42, 34, 30], [78, 52, 36], [122, 82, 46], [200, 164, 98], [156, 154, 156], [30, 28, 34], [170, 76, 44]];
  const SHIRTS = [
    [86, 128, 186], [228, 228, 222], [198, 94, 74], [96, 152, 112], [232, 196, 86], [152, 106, 172],
    [72, 78, 94], [214, 134, 160], [118, 172, 198], [180, 86, 98], [238, 152, 70], [110, 116, 74],
  ];
  const PANTS = [[58, 72, 104], [48, 52, 62], [134, 120, 98], [86, 98, 122], [40, 44, 58], [160, 152, 136], [92, 70, 58]];
  const CAPS = [[204, 60, 56], [52, 88, 150], [236, 232, 220], [64, 112, 74]];
  const HAIR_STYLES = ['short', 'short', 'short', 'long', 'long', 'bun', 'cap', 'bald'];
  const ZSKIN = [140, 176, 118];
  const ZSKIN_DK = [96, 128, 82];
  const SHOE = [44, 44, 52];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function randomLook(o) {
    const style = pick(HAIR_STYLES);
    return Object.assign({
      skin: pick(SKINS),
      hair: pick(HAIRS),
      shirt: pick(SHIRTS),
      pants: pick(PANTS),
      shoes: SHOE,
      hairStyle: style,
      cap: pick(CAPS),
    }, o || {});
  }

  function dist(a, b) {
    return Math.hypot(a.u - b.u, a.v - b.v);
  }

  function distPointSeg(p, a, b) {
    const abu = b.u - a.u;
    const abv = b.v - a.v;
    const l2 = abu * abu + abv * abv || 1;
    const t = clamp(((p.u - a.u) * abu + (p.v - a.v) * abv) / l2, 0, 1);
    return Math.hypot(p.u - (a.u + abu * t), p.v - (a.v + abv * t));
  }

  let NEXT_ID = 1;

  function makeActor(o) {
    const a = Object.assign({
      id: NEXT_ID++,
      kind: 'human',
      role: 'walker',
      size: 'adult',
      u: 0, v: 0, vu: 0, vv: 0,
      facing: 1,
      phase: Math.random() * 6.28,
      state: 'idle',
      st: 0,
      wait: 0.5 + Math.random() * 3,
      walkSpeed: 1.6 + Math.random() * 0.6,
      runSpeed: 3.5 + Math.random() * 0.9,
      chaseSpeed: 3.4 + Math.random() * 0.7,
      shambleSpeed: 0.9 + Math.random() * 0.4,
      reactMin: 0.35,
      reactRange: 1.3,
      gawkChance: 0.28,
      target: null,
      react: 0,
      alpha: 1,
      zombify: 0,
      turnAt: -1,
      emote: null,
      emoteT: 0,
      item: null,
      seated: false,
      protected: false,
      noTarget: false,
      revealed: true,
      script: null,
      speedNow: 0,
      reExit: 0,
      bloodySteps: 0,
      footT: 0,
      bloodied: 0,
      stay: false,
      hp: 3,
      hitFlash: 0,
      invuln: 0,
      meleeT: 0,
      recoil: 0,
    }, o);
    a.look = randomLook(a.look);
    if (a.kind === 'zombie') a.zombify = 1;
    return a;
  }

  class Crowd {
    /**
     * world: { U, V, obstacles:[{u,v,r}], exits:[{id,u,v,du,dv}], wanderPoints:[{u,v}], proj }
     * fx: { decals, particles, audio, onEvent(type, data) }
     */
    constructor(world, fx) {
      this.world = world;
      this.fx = fx;
      this.actors = [];
      this.birds = [];
      this.props = [];
      this.floaters = [];
      this.screams = [];
      this.panic = false;
      this.hunting = false;
      this.time = 0;
      this.escaped = 0;
      this.victims = 0;
      this.kills = 0;
    }

    add(o) {
      const a = makeActor(o);
      this.actors.push(a);
      return a;
    }

    byRole(role) {
      return this.actors.find((a) => a.role === role) || null;
    }

    addBird(u, v) {
      this.birds.push({
        u, v, z: 0, vu: 0, vv: 0, vz: 0,
        state: 'peck', phase: Math.random() * 6, hopT: Math.random() * 2, facing: Math.random() < 0.5 ? -1 : 1,
        col: Math.random() < 0.3 ? [168, 170, 182] : [124, 128, 144],
      });
    }

    addProp(p) {
      const prop = Object.assign({ vu: 0, vv: 0, u: 0, v: 0, attached: null }, p);
      this.props.push(prop);
      return prop;
    }

    // ── Events ──────────────────────────────────────────────────────
    emit(type, data) {
      if (this.fx.onEvent) this.fx.onEvent(type, data);
    }

    scream(u, v, who) {
      this.screams.push({ u, v, age: 0 });
      if (this.fx.audio) this.fx.audio.scream(who && who.size === 'kid' ? 1.3 : 0.85 + Math.random() * 0.35);
    }

    zombies() {
      return this.actors.filter((a) => a.kind === 'zombie' && a.revealed && a.state !== 'down' && a.state !== 'flung');
    }

    // ── Main update ─────────────────────────────────────────────────
    update(dt) {
      this.time += dt;
      for (let i = this.screams.length - 1; i >= 0; i--) {
        this.screams[i].age += dt;
        if (this.screams[i].age > 1.4) this.screams.splice(i, 1);
      }

      this._zombies = this.zombies();

      const acts = this.actors;
      for (let i = 0; i < acts.length; i++) {
        const a = acts[i];
        a.st += dt;
        if (a.emoteT > 0) a.emoteT -= dt;
        if (a.hitFlash > 0) a.hitFlash -= dt;
        if (a.invuln > 0) a.invuln -= dt;
        if (a.meleeT > 0) a.meleeT -= dt;
        if (a.recoil > 0) a.recoil = Math.max(0, a.recoil - dt * 8);
        if (a.kind === 'zombie') this.updateZombie(a, dt);
        else if (a.kind === 'dog') this.updateDog(a, dt);
        else this.updateHuman(a, dt);
      }

      this.separate();

      for (let i = acts.length - 1; i >= 0; i--) {
        if (acts[i].removed) acts.splice(i, 1);
      }

      this.updateBirds(dt);
      this.updateProps(dt);
      this.updateFloaters(dt);
    }

    // ── Movement helpers ────────────────────────────────────────────
    obstacleSteer(a, wu, wv) {
      const sp = Math.hypot(wu, wv);
      if (sp < 0.01) return [0, 0];
      const fu = wu / sp;
      const fv = wv / sp;
      let su = 0;
      let sv = 0;
      const obs = this.world.obstacles;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        const du = o.u - a.u;
        const dv = o.v - a.v;
        const d = Math.hypot(du, dv);
        const reach = o.r + 2.4;
        if (d > reach) continue;
        const ahead = du * fu + dv * fv;
        if (ahead < 0) continue;
        const lat = du * -fv + dv * fu;
        if (Math.abs(lat) > o.r + 0.8) continue;
        const side = lat >= 0 ? -1 : 1;
        const k = (1 - d / reach) * sp * 1.5;
        su += -fv * side * k;
        sv += fu * side * k;
      }
      return [su, sv];
    }

    moveToward(a, tu, tv, speed, dt, accel, extra) {
      const du = tu - a.u;
      const dv = tv - a.v;
      const d = Math.hypot(du, dv);
      let wu = 0;
      let wv = 0;
      if (d > 0.05) {
        const k = d < 0.6 ? d / 0.6 : 1;
        wu = (du / d) * speed * k;
        wv = (dv / d) * speed * k;
      }
      if (extra) {
        wu += extra[0];
        wv += extra[1];
        const m = Math.hypot(wu, wv);
        if (m > speed * 1.15) {
          wu = (wu / m) * speed * 1.15;
          wv = (wv / m) * speed * 1.15;
        }
      }
      const av = this.obstacleSteer(a, wu, wv);
      wu += av[0];
      wv += av[1];
      const k = Math.min(1, dt * (accel || 6));
      a.vu += (wu - a.vu) * k;
      a.vv += (wv - a.vv) * k;
      this.integrate(a, dt);
      return d;
    }

    // Like moveToward, but walks around walls using the nav grid when needed.
    // Returns the remaining distance to the final target.
    goTo(a, tu, tv, speed, dt, accel, extra) {
      const nav = this.world.nav;
      if (!nav || nav.lineClear(a.u, a.v, tu, tv)) {
        a.path = null;
        return this.moveToward(a, tu, tv, speed, dt, accel, extra);
      }
      a.pathT = (a.pathT || 0) - dt;
      if (!a.path || a.pathT <= 0 || !a.pathGoal || Math.hypot(a.pathGoal.u - tu, a.pathGoal.v - tv) > 1.5) {
        a.path = nav.findPath(a.u, a.v, tu, tv);
        a.pathT = 0.5 + Math.random() * 0.4;
        a.pathGoal = { u: tu, v: tv };
        a.pathIdx = 0;
      }
      if (!a.path || !a.path.length) return this.moveToward(a, tu, tv, speed, dt, accel, extra);
      while (a.pathIdx < a.path.length - 1 && nav.lineClear(a.u, a.v, a.path[a.pathIdx + 1].u, a.path[a.pathIdx + 1].v)) a.pathIdx++;
      const wp = a.path[a.pathIdx];
      this.moveToward(a, wp.u, wp.v, speed, dt, accel, extra);
      if (Math.hypot(wp.u - a.u, wp.v - a.v) < 0.45 && a.pathIdx < a.path.length - 1) a.pathIdx++;
      return Math.hypot(tu - a.u, tv - a.v);
    }

    brake(a, dt) {
      const k = Math.min(1, dt * 8);
      a.vu -= a.vu * k;
      a.vv -= a.vv * k;
      this.integrate(a, dt);
    }

    integrate(a, dt) {
      const W = this.world;
      a.u += a.vu * dt;
      a.v += a.vv * dt;
      if (a.state !== 'exit') {
        const obs = W.obstacles;
        for (let i = 0; i < obs.length; i++) {
          const o = obs[i];
          const du = a.u - o.u;
          const dv = a.v - o.v;
          const d = Math.hypot(du, dv);
          const m = o.r + 0.35;
          if (d < m && d > 0.0001) {
            a.u = o.u + (du / d) * m;
            a.v = o.v + (dv / d) * m;
          }
        }
        // Axis-aligned walls / furniture
        const boxes = W.boxes;
        if (boxes) {
          const r = a.kind === 'dog' ? 0.22 : 0.3;
          for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            if (a.u > b.u0 - r && a.u < b.u1 + r && a.v > b.v0 - r && a.v < b.v1 + r) {
              const pl = a.u - (b.u0 - r);
              const pr = b.u1 + r - a.u;
              const pt = a.v - (b.v0 - r);
              const pb = b.v1 + r - a.v;
              const m = Math.min(pl, pr, pt, pb);
              if (m === pl) a.u = b.u0 - r;
              else if (m === pr) a.u = b.u1 + r;
              else if (m === pt) a.v = b.v0 - r;
              else a.v = b.v1 + r;
            }
          }
        }
        const bd = W.bounds;
        if (bd) {
          a.u = clamp(a.u, bd.u0, bd.u1);
          a.v = clamp(a.v, bd.v0, bd.v1);
        } else {
          a.u = clamp(a.u, 0.8, W.U - 0.8);
          a.v = clamp(a.v, 0.8, W.V - 0.8);
        }
      }
      const sx = a.vu - a.vv;
      if (Math.abs(sx) > 0.12) a.facing = sx > 0 ? 1 : -1;
      a.speedNow = Math.hypot(a.vu, a.vv);
      a.phase += a.speedNow * dt * 2.4;
    }

    faceToward(a, t) {
      const sx = (t.u - a.u) - (t.v - a.v);
      if (Math.abs(sx) > 0.05) a.facing = sx > 0 ? 1 : -1;
    }

    separate() {
      const acts = this.actors;
      const n = acts.length;
      for (let i = 0; i < n; i++) {
        const a = acts[i];
        if (!this.isSolid(a)) continue;
        for (let j = i + 1; j < n; j++) {
          const b = acts[j];
          if (!this.isSolid(b)) continue;
          if (a.victim === b || b.victim === a || a.follow === b || b.follow === a) continue;
          const du = b.u - a.u;
          const dv = b.v - a.v;
          const d = Math.hypot(du, dv);
          const min = a.kind === 'dog' || b.kind === 'dog' ? 0.55 : 0.85;
          if (d < min && d > 0.0001) {
            const push = (min - d) * 0.5;
            const nu = du / d;
            const nv = dv / d;
            a.u -= nu * push;
            a.v -= nv * push;
            b.u += nu * push;
            b.v += nv * push;
          }
        }
      }
    }

    isSolid(a) {
      if (a.removed || a.seated) return false;
      const s = a.state;
      return !(s === 'down' || s === 'flung' || s === 'grabbed' || s === 'exit' || s === 'rise' || s === 'bite' || s === 'feed' || s === 'swing' || s === 'climb');
    }

    // ── Scripts (simple per-actor command queue) ────────────────────
    setScript(a, steps) {
      a.script = steps.slice();
      a.scriptT = 0;
    }

    runScript(a, dt) {
      const step = a.script && a.script[0];
      if (!step) {
        a.script = null;
        return;
      }
      a.scriptT = (a.scriptT || 0) + dt;
      let done = false;
      if (step.type === 'goto') {
        if (a.state !== 'walk' && a.kind === 'human') a.state = 'walk';
        const d = this.goTo(a, step.u, step.v, step.speed || a.walkSpeed, dt, 5);
        if (d < (step.r || 0.35)) done = true;
      } else if (step.type === 'approach') {
        if (a.state !== 'walk' && a.kind === 'human') a.state = 'walk';
        const w = step.who;
        const d = this.goTo(a, w.u, w.v, step.speed || a.walkSpeed, dt, 5);
        if (d < (step.r || 1.0)) {
          this.faceToward(a, w);
          a.vu = 0;
          a.vv = 0;
          done = true;
        }
      } else if (step.type === 'wait') {
        this.brake(a, dt);
        if (a.scriptT >= step.t) done = true;
      } else if (step.type === 'sit') {
        a.u = step.u;
        a.v = step.v;
        a.vu = 0;
        a.vv = 0;
        a.state = 'sit';
        a.seated = true;
        a.facing = step.facing || a.facing;
        done = true;
      } else if (step.type === 'state') {
        a.state = step.state;
        a.st = 0;
        done = true;
      } else if (step.type === 'emote') {
        a.emote = step.emote;
        a.emoteT = step.t || 1.6;
        done = true;
      } else if (step.type === 'face') {
        a.facing = step.dir;
        done = true;
      } else if (step.type === 'call') {
        step.fn(a, this);
        done = true;
      } else {
        done = true;
      }
      if (done) {
        a.script.shift();
        a.scriptT = 0;
        if (!a.script.length) {
          a.script = null;
          if (a.kind === 'human' && a.state === 'walk') {
            a.state = 'idle';
            a.wait = 0.5 + Math.random() * 2;
          }
        }
      }
    }

    // ── Humans ──────────────────────────────────────────────────────
    isCalm(a) {
      const s = a.state;
      return s === 'idle' || s === 'walk' || s === 'sit' || s === 'swing' || s === 'photo';
    }

    findThreat(a) {
      const zs = this._zombies;
      const zr = a.seated ? 9.5 : 11.5;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.state === 'idle' || z.lurking) continue;
        if (dist(a, z) < zr) return z;
      }
      for (let i = 0; i < this.screams.length; i++) {
        const s = this.screams[i];
        if (Math.hypot(a.u - s.u, a.v - s.v) < 17) return s;
      }
      const acts = this.actors;
      for (let i = 0; i < acts.length; i++) {
        const h = acts[i];
        if (h === a || h.kind !== 'human') continue;
        if ((h.state === 'flee' || h.state === 'grabbed') && dist(a, h) < 6) return h;
      }
      return null;
    }

    alert(a, threat) {
      a.state = 'alert';
      a.st = 0;
      a.seated = false;
      a.react = a.reactMin + Math.random() * a.reactRange;
      a.threat = threat || null;
      a.emote = 'exclaim';
      a.emoteT = 1.6;
      a.script = null;
      // Some people walk closer to see what is going on — a fatal curiosity
      a.gawk = a.size !== 'kid' && !a.protected && a.kind === 'human' && Math.random() < a.gawkChance;
      if (a.item === 'balloon') this.releaseBalloon(a);
      if (a.stroller) this.detachStroller(a);
      if (a.item === 'icecream' || a.item === 'bag' || a.item === 'phone' || a.item === 'hat') this.dropItem(a);
    }

    startFlee(a) {
      a.state = 'flee';
      a.st = 0;
      a.reExit = 0;
      if (a.forcedExit) a.exit = this.world.exits.find((e) => e.id === a.forcedExit) || this.chooseExit(a);
      else a.exit = this.chooseExit(a);
      if (Math.random() < 0.35) {
        a.emote = 'double';
        a.emoteT = 1.2;
      }
    }

    chooseExit(a) {
      const zs = this._zombies || [];
      let best = null;
      let bestScore = -1e9;
      const exits = this.world.exits;
      for (let i = 0; i < exits.length; i++) {
        const e = exits[i];
        if (e.closed) continue;
        const myD = dist(a, e);
        let minZ = 30;
        let block = 0;
        for (let k = 0; k < zs.length; k++) {
          const z = zs[k];
          minZ = Math.min(minZ, dist(z, e));
          const sd = distPointSeg(z, a, e);
          if (sd < 3.5 && dist(z, a) < myD) block += (3.5 - sd) * 7;
        }
        const score = Math.min(minZ, 26) * 1.25 - myD * 0.8 - block + (e.bias || 0);
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      return best || exits[0];
    }

    pickWander(a) {
      const pts = this.world.wanderPoints;
      if (a.route) {
        a.routeIdx = ((a.routeIdx == null ? -1 : a.routeIdx) + 1) % a.route.length;
        return a.route[a.routeIdx];
      }
      if (a.area) {
        return {
          u: a.area.u + (Math.random() - 0.5) * a.area.r * 2,
          v: a.area.v + (Math.random() - 0.5) * a.area.r * 2,
        };
      }
      return pts[Math.floor(Math.random() * pts.length)];
    }

    // ── Player-controlled hero ──────────────────────────────────────
    updatePlayer(a, dt) {
      const inp = a.input || { mu: 0, mv: 0 };
      const tu = inp.mu * a.runSpeed;
      const tv = inp.mv * a.runSpeed;
      const k = Math.min(1, dt * 10);
      a.vu += (tu - a.vu) * k;
      a.vv += (tv - a.vv) * k;
      const moving = Math.abs(inp.mu) + Math.abs(inp.mv) > 0.01;
      a.state = moving ? 'walk' : 'idle';
      this.integrate(a, dt);
      if (a.aimSX != null) a.facing = a.aimSX >= 0 ? 1 : -1;
      // Leaving through a gate ends the chapter
      const exits = this.world.exits;
      for (let i = 0; i < exits.length; i++) {
        const e = exits[i];
        if (!e.playerExit) continue;
        // Gate is as wide as the path: reach the edge anywhere across it
        const ru = a.u - e.u;
        const rv = a.v - e.v;
        const along = ru * e.du + rv * e.dv;
        const lateral = Math.abs(ru * -e.dv + rv * e.du);
        if (along > -1.9 && lateral < (e.halfWidth || 2.6)) {
          a.state = 'exit';
          a.exit = e;
          a.st = 0;
          this.emit('playerExit', a);
          break;
        }
      }
    }

    hurtPlayer(t, z) {
      const du = t.u - z.u;
      const dv = t.v - z.v;
      const d = Math.hypot(du, dv) || 1;
      z.state = 'stun';
      z.st = 0;
      z.stunDur = t.invuln > 0 ? 0.4 : 0.9;
      z.vu = (-du / d) * 2.5;
      z.vv = (-dv / d) * 2.5;
      if (t.invuln > 0) return;
      t.hp -= 1;
      t.invuln = 1.4;
      t.hitFlash = 0.15;
      t.vu += (du / d) * 8;
      t.vv += (dv / d) * 8;
      if (this.fx.particles) this.fx.particles.bloodBurst(t.u, t.v, 7, 6, 2.4);
      if (this.fx.decals) this.fx.decals.add(t.u, t.v, 0.5, { kind: 'splat' });
      if (this.fx.audio) this.fx.audio.bite();
      this.emit('playerHurt', t);
    }

    // Damage a zombie; returns true when it goes down for good
    damageZombie(z, dmg, ku, kv, stun) {
      if (!z || z.state === 'down' || z.removed) return false;
      z.hp -= dmg;
      z.hitFlash = 0.12;
      z.revealed = true;
      z.script = null;
      if (this.fx.particles) this.fx.particles.bloodBurst(z.u, z.v, 6, 4, 2.2);
      const v = z.victim;
      if (v && v.state === 'grabbed') {
        v.state = 'alert';
        v.react = 0.15;
        v.threat = z;
        v.grabbedBy = null;
        v.gawk = false;
      }
      z.victim = null;
      if (z.hp <= 0) {
        z.state = 'down';
        z.st = 0;
        z.deadT = 0;
        z.turnAt = -1;
        z.fallDir = (ku - kv) >= 0 ? 1 : -1;
        z.vu = 0;
        z.vv = 0;
        if (this.fx.decals) this.fx.decals.add(z.u + z.fallDir * 0.4, z.v, 1.0 + Math.random() * 0.5, { grow: 0.6 });
        if (this.fx.particles) this.fx.particles.bloodBurst(z.u, z.v, 4, 8, 3);
        this.kills++;
        this.emit('zombieKilled', z);
        return true;
      }
      z.state = 'stun';
      z.st = 0;
      z.stunDur = stun || 0.35;
      z.vu = ku;
      z.vv = kv;
      return false;
    }

    // Throw a zombie through the air; it dies on landing
    fling(z, vu, vv, vz) {
      if (!z || z.state === 'down' || z.state === 'flung' || z.removed) return;
      const v = z.victim;
      if (v && v.state === 'grabbed') {
        v.state = 'alert';
        v.react = 0.15;
        v.threat = z;
      }
      z.victim = null;
      z.script = null;
      z.state = 'flung';
      z.st = 0;
      z.hp = 0;
      z.turnAt = -1;
      z.revealed = true;
      z.vu = vu;
      z.vv = vv;
      z.fvz = vz;
      z.zOff = 0.5;
      z.fallDir = (vu - vv) >= 0 ? 1 : -1;
      if (this.fx.particles) this.fx.particles.bloodBurst(z.u, z.v, 6, 12, 4);
      this.kills++;
      this.emit('zombieKilled', z);
    }

    // A loud noise (gunshot) makes nearby zombies come for the source
    noise(src, radius) {
      const zs = this._zombies || this.zombies();
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if ((z.state === 'shamble' || z.state === 'idle') && !z.script && dist(z, src) < radius && this.isPrey(src)) {
          z.prey = src;
          z.state = 'chase';
          z.st = 0;
        }
      }
    }

    updateHuman(a, dt) {
      if (a.controlled && a.state !== 'grabbed' && a.state !== 'down' && a.state !== 'exit' && a.state !== 'rise') {
        this.updatePlayer(a, dt);
        return;
      }
      switch (a.state) {
        case 'idle':
        case 'walk':
        case 'sit':
        case 'swing':
        case 'photo': {
          if (this.panic && !a.scriptLocked) {
            const th = this.findThreat(a);
            if (th) {
              this.alert(a, th);
              break;
            }
          }
          if (a.script) {
            this.runScript(a, dt);
            break;
          }
          if (a.state === 'sit' || a.state === 'swing' || a.state === 'photo') {
            a.vu = 0;
            a.vv = 0;
            if (a.state === 'photo' && a.st > 3.2 + (a.id % 3)) {
              a.st = 0;
              a.flash = 0.18;
            }
            if (a.flash > 0) a.flash -= dt;
            break;
          }
          if (a.follow && !a.follow.removed) {
            const f = a.follow;
            const ou = a.followOff ? a.followOff[0] : 0.9;
            const ov = a.followOff ? a.followOff[1] : 0.9;
            const d = this.goTo(a, f.u + ou, f.v + ov, Math.max(f.speedNow, 0.1) + 0.6, dt, 6);
            a.state = d > 0.3 ? 'walk' : 'idle';
            if (d < 0.3) this.brake(a, dt);
            break;
          }
          if (a.state === 'idle') {
            this.brake(a, dt);
            a.wait -= dt;
            if (a.wait <= 0 && !a.stay) {
              a.target = this.pickWander(a);
              a.state = 'walk';
            }
          } else if (!a.target) {
            a.state = 'idle';
            a.wait = 0.5 + Math.random();
          } else {
            const sp = a.jog ? a.walkSpeed * 2.1 : a.walkSpeed;
            const d = this.goTo(a, a.target.u, a.target.v, sp, dt, 4);
            if (d < 0.5) {
              a.state = 'idle';
              a.wait = a.jog ? 0 : 1.2 + Math.random() * 4;
            }
          }
          break;
        }
        case 'alert': {
          this.brake(a, dt);
          if (a.threat) this.faceToward(a, a.threat);
          a.react -= dt;
          if (a.react <= 0) {
            if (a.gawk && a.threat) {
              a.state = 'gawk';
              a.st = 0;
              a.emote = 'question';
              a.emoteT = 1.4;
            } else {
              this.startFlee(a);
            }
          }
          break;
        }
        case 'gawk': {
          const th = a.threat;
          let nearZ = 99;
          const zs = this._zombies;
          for (let i = 0; i < zs.length; i++) nearZ = Math.min(nearZ, dist(a, zs[i]));
          if (!th || a.st > 2.6 || nearZ < 3.2) {
            a.gawk = false;
            a.emote = 'double';
            a.emoteT = 1.2;
            this.startFlee(a);
            break;
          }
          const d = this.goTo(a, th.u, th.v, a.walkSpeed * 1.1, dt, 4);
          if (d < 4) this.brake(a, dt);
          break;
        }
        case 'flee':
          this.updateFlee(a, dt);
          break;
        case 'exit': {
          const e = a.exit;
          a.vu = e.du * a.runSpeed;
          a.vv = e.dv * a.runSpeed;
          this.integrate(a, dt);
          a.alpha -= dt * 1.5;
          if (a.alpha <= 0) {
            a.removed = true;
            this.escaped++;
            this.emit('escaped', a);
          }
          break;
        }
        case 'grabbed':
          a.vu = 0;
          a.vv = 0;
          break;
        case 'down':
          a.deadT = (a.deadT || 0) + dt;
          if (a.turnAt >= 0 && a.deadT > a.turnAt) {
            a.state = 'rise';
            a.st = 0;
            if (this.fx.audio) this.fx.audio.groan();
          }
          break;
        case 'rise':
          a.zombify = clamp(a.st / 1.6, 0, 1);
          if (a.st > 1.9) {
            a.kind = 'zombie';
            a.state = 'shamble';
            a.st = 0;
            a.zombify = 1;
            a.revealed = true;
            a.target = null;
            a.chaseSpeed = 3.3 + Math.random() * 0.8;
            a.shambleSpeed = 1.0 + Math.random() * 0.4;
            a.emote = null;
            this.emit('turned', a);
          }
          break;
        default:
          break;
      }
    }

    updateFlee(a, dt) {
      // Kids stick to their parent while the parent is fleeing
      let tu;
      let tv;
      if (a.parent && !a.parent.removed && (a.parent.state === 'flee' || a.parent.state === 'exit')) {
        tu = a.parent.u - a.parent.vu * 0.12;
        tv = a.parent.v - a.parent.vv * 0.12;
        if (a.parent.state === 'exit' && dist(a, a.parent) < 2.5) {
          a.state = 'exit';
          a.exit = a.parent.exit;
          a.st = 0;
          return;
        }
      } else {
        a.reExit -= dt;
        if (a.reExit <= 0 && !a.forcedExit) {
          a.exit = this.chooseExit(a);
          a.reExit = 0.9;
        }
        tu = a.exit.u;
        tv = a.exit.v;
      }

      let ru = 0;
      let rv = 0;
      const zs = this._zombies;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        const d = dist(a, z);
        if (d < 6.5 && d > 0.01) {
          const k = ((6.5 - d) / 6.5) * a.runSpeed * 0.95;
          ru += ((a.u - z.u) / d) * k;
          rv += ((a.v - z.v) / d) * k;
        }
      }

      // Bloody footprints after running through a pool
      a.footT -= dt;
      if (a.footT <= 0) {
        a.footT = 0.16;
        const dec = this.fx.decals;
        if (dec) {
          if (a.bloodySteps <= 0) {
            for (let i = 0; i < dec.list.length; i++) {
              const p = dec.list[i];
              if (p.kind !== 'pool' || p.r < 0.6) continue;
              if (Math.hypot(a.u - p.u, a.v - p.v) < p.r) {
                a.bloodySteps = 10;
                break;
              }
            }
          } else {
            a.bloodySteps--;
            const side = a.bloodySteps % 2 === 0 ? 0.18 : -0.18;
            dec.add(a.u + side * (a.vv / (a.speedNow || 1)), a.v - side * (a.vu / (a.speedNow || 1)), 0, { kind: 'foot' });
          }
        }
      }

      const d = this.goTo(a, tu, tv, a.runSpeed, dt, 9, [ru, rv]);
      if (!a.parent && d < 1.8) {
        a.state = 'exit';
        a.st = 0;
      }
    }

    releaseBalloon(a) {
      a.item = null;
      this.floaters.push({ u: a.u, v: a.v, z: 9, vz: 1.8, col: a.balloonColor || [222, 52, 58], phase: Math.random() * 6 });
    }

    detachStroller(a) {
      const s = a.stroller;
      if (!s) return;
      s.attached = null;
      s.vu = a.vu * 0.8 + (Math.random() - 0.5) * 0.6;
      s.vv = a.vv * 0.8 + (Math.random() - 0.5) * 0.6;
      a.stroller = null;
    }

    dropItem(a) {
      if (!a.item) return;
      this.addProp({ type: a.item, u: a.u + (Math.random() - 0.5) * 0.6, v: a.v + (Math.random() - 0.5) * 0.6, seed: Math.random() });
      a.item = null;
    }

    // ── Zombies ─────────────────────────────────────────────────────
    isPrey(t) {
      if (!t || t.removed || t.kind !== 'human' || t.noTarget || t.protected) return false;
      const s = t.state;
      return s === 'idle' || s === 'walk' || s === 'sit' || s === 'alert' || s === 'flee' || s === 'photo' || s === 'gawk';
    }

    findPrey(z, range) {
      let best = null;
      let bd = range;
      const acts = this.actors;
      for (let i = 0; i < acts.length; i++) {
        const t = acts[i];
        if (!this.isPrey(t)) continue;
        // The player is the most interesting target around
        const d = dist(z, t) * (t.controlled ? 0.7 : 1);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      return best;
    }

    updateZombie(z, dt) {
      if (z.script) {
        this.runScript(z, dt);
        return;
      }
      switch (z.state) {
        case 'idle':
          this.brake(z, dt);
          break;
        case 'down':
          break;
        case 'flung': {
          // Thrown through the air (hit by a vehicle / explosion)
          z.zOff = (z.zOff || 0) + z.fvz * dt;
          z.fvz -= 30 * dt;
          z.u += z.vu * dt;
          z.v += z.vv * dt;
          z.phase += dt * 20;
          if (z.zOff <= 0 && z.fvz < 0) {
            z.zOff = 0;
            z.state = 'down';
            z.vu = 0;
            z.vv = 0;
            if (this.fx.decals) this.fx.decals.add(z.u, z.v, 1.2 + Math.random() * 0.8, { grow: 0.8 });
            if (this.fx.particles) this.fx.particles.bloodBurst(z.u, z.v, 1, 10, 3.5);
            if (this.fx.audio) this.fx.audio.thud();
          }
          break;
        }
        case 'climb': {
          // Hauling itself up over a ledge / through a window
          const k = clamp(z.st / (z.climbDur || 1.6), 0, 1);
          z.zOff = (z.climbFrom || -5) * (1 - k);
          z.u += (z.climbDU || 0) * dt * 0.6;
          z.v += (z.climbDV || 0) * dt * 0.6;
          z.phase += dt * 6;
          if (k >= 1) {
            z.zOff = 0;
            z.state = 'shamble';
            z.st = 0;
          }
          break;
        }
        case 'stun': {
          const k = Math.max(0, 1 - dt * 5);
          z.vu *= k;
          z.vv *= k;
          this.integrate(z, dt);
          if (z.st > (z.stunDur || 0.5)) {
            z.state = 'shamble';
            z.st = 0;
            z.target = null;
          }
          break;
        }
        case 'shamble': {
          if (this.hunting) {
            const t = this.findPrey(z, 17);
            if (t) {
              z.prey = t;
              z.state = 'chase';
              z.st = 0;
              break;
            }
          }
          z.wait = (z.wait || 0) - dt;
          if (!z.target || z.wait <= 0 || Math.hypot(z.target.u - z.u, z.target.v - z.v) < 0.6) {
            const pts = this.world.wanderPoints;
            z.target = pts[Math.floor(Math.random() * pts.length)];
            z.wait = 4 + Math.random() * 4;
          }
          this.goTo(z, z.target.u, z.target.v, z.shambleSpeed, dt, 3);
          break;
        }
        case 'chase': {
          z.retarget = (z.retarget || 0) - dt;
          if (z.retarget <= 0) {
            z.retarget = 0.6;
            const t = this.findPrey(z, 20);
            if (t) z.prey = t;
          }
          const t = z.prey;
          if (!this.isPrey(t) || dist(z, t) > 22) {
            z.state = 'shamble';
            z.prey = null;
            break;
          }
          // Lunge when the prey is almost within reach. The player gets a fair chance:
          // a walking hero is a bit faster than the dead, sprinting leaves them behind.
          const near = dist(z, t);
          let sp;
          let reach = 0.95;
          if (t.controlled) {
            sp = Math.min(z.chaseSpeed, this.playerChaseCap || 3.5) * (near < 2.0 ? 1.15 : 1);
            reach = 0.78;
          } else {
            sp = near < 2.8 ? z.chaseSpeed * 1.35 : z.chaseSpeed;
          }
          const d = this.goTo(z, t.u, t.v, sp, dt, near < 2.8 ? 8 : 5);
          if (d < reach) this.bite(z, t);
          break;
        }
        case 'bite': {
          const t = z.victim;
          z.vu = 0;
          z.vv = 0;
          z.spurtT = (z.spurtT || 0) - dt;
          if (z.spurtT <= 0 && this.fx.particles) {
            z.spurtT = 0.16;
            this.fx.particles.bloodBurst(t.u, t.v, 6.5, 3, 2.4);
          }
          if (z.st > 1.35) {
            t.state = 'down';
            t.st = 0;
            t.deadT = 0;
            t.fallDir = -t.facing;
            t.grabbedBy = null;
            t.bloodied = 1;
            if (this.fx.decals) this.fx.decals.add(t.u + t.fallDir * 0.4, t.v, 1.5 + Math.random() * 0.9, { grow: 0.55 });
            if (this.fx.particles) this.fx.particles.bloodBurst(t.u, t.v, 3, 10, 3.2);
            if (this.fx.audio) this.fx.audio.thud();
            this.victims++;
            z.state = 'feed';
            z.st = 0;
            z.feedDur = 2.0 + Math.random() * 2.4;
            z.bloodied = 1;
            this.emit('death', t);
          }
          break;
        }
        case 'feed': {
          z.vu = 0;
          z.vv = 0;
          const t = z.victim;
          z.spurtT = (z.spurtT || 0) - dt;
          if (z.spurtT <= 0 && this.fx.particles && t) {
            z.spurtT = 0.5 + Math.random() * 0.4;
            this.fx.particles.bloodBurst(t.u, t.v, 2, 2, 1.4);
          }
          if (z.st > z.feedDur || !t || t.state === 'rise' || t.removed) {
            z.state = 'shamble';
            z.victim = null;
            z.target = null;
          }
          break;
        }
        default:
          break;
      }
    }

    bite(z, t) {
      if (t.controlled && (t.hp > 1 || t.invuln > 0)) {
        this.hurtPlayer(t, z);
        return;
      }
      if (t.controlled) {
        t.hp = 0;
        t.turnAt = -1;
        this.emit('playerDown', t);
      }
      t.state = 'grabbed';
      t.st = 0;
      t.grabbedBy = z;
      t.vu = 0;
      t.vv = 0;
      t.seated = false;
      t.script = null;
      t.emote = 'double';
      t.emoteT = 1.3;
      this.faceToward(z, t);
      t.facing = -z.facing;
      // Snap zombie into a clinch position beside the victim
      const ang = Math.atan2(z.v - t.v, z.u - t.u);
      z.u = t.u + Math.cos(ang) * 0.6;
      z.v = t.v + Math.sin(ang) * 0.6;
      z.state = 'bite';
      z.st = 0;
      z.victim = t;
      z.vu = 0;
      z.vv = 0;
      z.revealed = true;
      if (t.item === 'balloon') this.releaseBalloon(t);
      if (t.stroller) this.detachStroller(t);
      this.dropItem(t);
      this.scream(t.u, t.v, t);
      if (this.fx.audio) this.fx.audio.bite();
      if (this.fx.particles) this.fx.particles.bloodBurst(t.u, t.v, 7, 8, 3);
      this.emit('bite', { z, t });
    }

    // ── Dogs ────────────────────────────────────────────────────────
    updateDog(d, dt) {
      const o = d.owner;
      if (d.state === 'follow') {
        if (!o || o.removed || !this.isCalm(o)) {
          d.state = 'flee';
          d.st = 0;
          d.exit = this.chooseExit(d);
          d.emote = 'exclaim';
          d.emoteT = 1;
          if (this.fx.audio) this.fx.audio.bark();
          return;
        }
        const tu = o.u + (o.facing > 0 ? 1.4 : -0.4);
        const tv = o.v + (o.facing > 0 ? 0.2 : 1.2);
        const dd = this.goTo(d, tu, tv, Math.max(o.speedNow + 0.8, 1.2), dt, 5);
        if (dd < 0.35) this.brake(d, dt);
      } else if (d.state === 'flee') {
        d.barkT = (d.barkT || 0) - dt;
        if (d.barkT <= 0) {
          d.barkT = 0.7 + Math.random() * 0.6;
          if (this.fx.audio) this.fx.audio.bark();
        }
        const dd = this.goTo(d, d.exit.u, d.exit.v, 7.5, dt, 9);
        if (dd < 1.6) {
          d.state = 'exit';
        }
      } else if (d.state === 'exit') {
        d.vu = d.exit.du * 7;
        d.vv = d.exit.dv * 7;
        this.integrate(d, dt);
        d.alpha -= dt * 1.6;
        if (d.alpha <= 0) d.removed = true;
      }
    }

    // ── Birds / props / floaters ────────────────────────────────────
    updateBirds(dt) {
      const acts = this.actors;
      for (let i = this.birds.length - 1; i >= 0; i--) {
        const b = this.birds[i];
        b.phase += dt;
        if (b.state === 'peck') {
          b.hopT -= dt;
          if (b.hopT <= 0) {
            b.hopT = 0.6 + Math.random() * 1.8;
            b.u += (Math.random() - 0.5) * 0.7;
            b.v += (Math.random() - 0.5) * 0.7;
            b.facing = Math.random() < 0.5 ? -1 : 1;
          }
          let threat = null;
          for (let k = 0; k < acts.length; k++) {
            const a = acts[k];
            const d = Math.hypot(a.u - b.u, a.v - b.v);
            if ((a.speedNow > 3 && d < 4.5) || (a.kind === 'zombie' && a.revealed && d < 7) || d < 1.2) {
              threat = a;
              break;
            }
          }
          if (!threat) {
            for (let k = 0; k < this.screams.length; k++) {
              const s = this.screams[k];
              if (Math.hypot(s.u - b.u, s.v - b.v) < 20) threat = s;
            }
          }
          if (threat) {
            b.state = 'fly';
            const du = b.u - threat.u;
            const dv = b.v - threat.v;
            const d = Math.hypot(du, dv) || 1;
            b.vu = (du / d) * (4 + Math.random() * 3);
            b.vv = (dv / d) * (4 + Math.random() * 3);
            b.vz = 5 + Math.random() * 3;
            if (this.fx.audio && Math.random() < 0.4) this.fx.audio.flap();
          }
        } else {
          b.vz += dt * 4;
          b.u += b.vu * dt;
          b.v += b.vv * dt;
          b.z += b.vz * dt;
          b.facing = b.vu - b.vv > 0 ? 1 : -1;
          if (b.z > 90) this.birds.splice(i, 1);
        }
      }
    }

    updateProps(dt) {
      for (let i = 0; i < this.props.length; i++) {
        const p = this.props[i];
        if (p.attached) {
          const a = p.attached;
          const sp = a.speedNow || 0;
          let fu = a.facing > 0 ? 0.7 : -0.7;
          let fv = a.facing > 0 ? -0.7 : 0.7;
          if (sp > 0.2) {
            fu = a.vu / sp;
            fv = a.vv / sp;
          }
          p.u = a.u + fu * 1.15;
          p.v = a.v + fv * 1.15;
          p.facing = a.facing;
          continue;
        }
        if (Math.abs(p.vu) + Math.abs(p.vv) > 0.01) {
          p.u += p.vu * dt;
          p.v += p.vv * dt;
          const k = Math.max(0, 1 - dt * 1.4);
          p.vu *= k;
          p.vv *= k;
          p.u = clamp(p.u, 1, this.world.U - 1);
          p.v = clamp(p.v, 1, this.world.V - 1);
        }
      }
    }

    updateFloaters(dt) {
      for (let i = this.floaters.length - 1; i >= 0; i--) {
        const f = this.floaters[i];
        f.phase += dt;
        f.z += f.vz * dt;
        f.u += Math.sin(f.phase * 0.9) * dt * 0.5 + dt * 0.35;
        f.v -= dt * 0.25;
        if (f.z > 170) this.floaters.splice(i, 1);
      }
    }

    // ── Rendering ───────────────────────────────────────────────────
    collectItems(buf, atmo) {
      const items = [];
      const proj = this.world.proj;
      const acts = this.actors;
      for (let i = 0; i < acts.length; i++) {
        const a = acts[i];
        const flat = a.state === 'down' || (a.state === 'rise' && a.st < 0.8);
        if (a.hidden) continue;
        items.push({
          depth: a.u + a.v - (flat ? 0.8 : 0),
          draw: () => {
            if (a.kind === 'dog') drawDog(buf, a, atmo, proj);
            else drawPerson(buf, a, atmo, proj, this.time);
          },
        });
        if (a.kind === 'dog' && a.state === 'follow' && a.owner) {
          const o = a.owner;
          items.push({
            depth: Math.max(a.u + a.v, o.u + o.v) + 0.01,
            draw: () => {
              const p0 = proj.project(o.u, o.v, 0);
              const p1 = proj.project(a.u, a.v, 0);
              buf.line(p0[0] + o.facing * 2, p0[1] - 6, p1[0] + (a.facing > 0 ? 2 : -2), p1[1] - 4, atmo.applyLight([70, 60, 52]), 0.8);
            },
          });
        }
      }
      for (let i = 0; i < this.birds.length; i++) {
        const b = this.birds[i];
        if (b.state !== 'peck') continue;
        items.push({ depth: b.u + b.v, draw: () => drawBird(buf, b, atmo, proj) });
      }
      for (let i = 0; i < this.props.length; i++) {
        const p = this.props[i];
        items.push({ depth: p.u + p.v - (p.type === 'stroller' ? 0 : 0.5), draw: () => drawProp(buf, p, atmo, proj) });
      }
      return items;
    }

    drawOverlay(buf, atmo) {
      const proj = this.world.proj;
      for (let i = 0; i < this.birds.length; i++) {
        const b = this.birds[i];
        if (b.state === 'fly') drawBird(buf, b, atmo, proj);
      }
      for (let i = 0; i < this.floaters.length; i++) {
        const f = this.floaters[i];
        const p = proj.project(f.u, f.v, f.z);
        const x = Math.round(p[0] + Math.sin(f.phase * 2) * 1.2);
        const y = Math.round(p[1]);
        drawBalloon(buf, x, y, f.col, atmo, Math.sin(f.phase * 3));
      }
    }
  }

  // ── Sprite drawing ────────────────────────────────────────────────
  const WHITE = () => [255, 255, 255];

  function drawBalloon(buf, x, y, col, atmo, wig) {
    const c = atmo.applyLight(col);
    const hi = lerpRGB(c, [255, 255, 255], 0.55);
    const dk = mulRGB(c, 0.72);
    buf.hline(x - 1, x + 1, y - 4, c);
    buf.hline(x - 2, x + 2, y - 3, c);
    buf.hline(x - 2, x + 2, y - 2, c);
    buf.hline(x - 1, x + 1, y - 1, dk);
    buf.setPx(x, y, dk);
    buf.setPx(x - 1, y - 3, hi);
    const sc = atmo.applyLight([90, 90, 96]);
    buf.setPx(x, y + 1, sc);
    buf.setPx(x + (wig > 0 ? 1 : 0), y + 2, sc);
    buf.setPx(x, y + 3, sc);
    buf.setPx(x + (wig > 0 ? 0 : 1), y + 4, sc);
  }

  function drawPerson(buf, a, atmo, proj, time) {
    let z = a.zOff || 0;
    if (a.seated) z += a.seatZ != null ? a.seatZ : 1.4;
    let ou = 0;
    let ov = 0;
    if (a.state === 'swing') {
      const sw = Math.sin(time * 2.6 + a.id);
      ov = sw * 1.3;
      z = 1.8 + Math.abs(sw) * 1.4;
    }
    // Blink while invulnerable after taking a hit
    if (a.invuln > 0 && Math.floor(a.invuln * 14) % 2 === 0) return;
    const sp = proj.project(a.u + ou, a.v + ov, z);
    let x = Math.round(sp[0]);
    let y = Math.round(sp[1]);
    const A = a.alpha;
    const L = a.hitFlash > 0 ? WHITE : atmo.applyLight;
    const kid = a.size === 'kid';
    const look = a.look;

    const px = (xx, yy, c) => {
      if (A < 1 && A <= bayer4(xx, yy)) return;
      buf.setPx(xx, yy, c);
    };
    const rect = (x0, y0, w, h, c) => {
      for (let yy = y0; yy < y0 + h; yy++) for (let xx = x0; xx < x0 + w; xx++) px(xx, yy, c);
    };
    const vl = (xx, y0, y1, c) => {
      for (let yy = y0; yy <= y1; yy++) px(xx, yy, c);
    };
    const hl = (x0, x1, yy, c) => {
      for (let xx = x0; xx <= x1; xx++) px(xx, yy, c);
    };
    const ln = (x0, y0, x1, y1, c) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
    };

    const zf = a.zombify;
    const skin = L(zf > 0 ? lerpRGB(look.skin, ZSKIN, zf) : look.skin);
    const skinDk = L(zf > 0 ? lerpRGB(mulRGB(look.skin, 0.82), ZSKIN_DK, zf) : mulRGB(look.skin, 0.82));
    const shirtBase = zf > 0 ? lerpRGB(look.shirt, mulRGB(look.shirt, 0.72), zf) : look.shirt;
    const shirt = L(shirtBase);
    const shirtDk = mulRGB(shirt, 0.74);
    const shirtHi = lerpRGB(shirt, [255, 240, 224], 0.2);
    const pants = L(look.pants);
    const pantsDk = mulRGB(pants, 0.78);
    const shoes = L(look.shoes || SHOE);
    const hair = L(look.hair);
    const ink = atmo.ink;
    const blood = L([150, 22, 32]);

    if (a.hidden) return;

    // ── Lying body (also tumbling through the air when flung) ──
    if (a.state === 'down' || a.state === 'flung' || (a.state === 'rise' && a.st < 0.8)) {
      const dir = a.fallDir || 1;
      const tw = a.state === 'rise' ? (Math.random() < 0.5 ? 1 : 0) : 0;
      x += tw;
      for (let ox = -4; ox <= 5; ox++) {
        const xx = x + ox * dir;
        let c = ox < -1 ? pants : ox < 3 ? shirt : skin;
        if (ox >= 0 && ox < 3 && hash2(xx, y) > 0.55) c = blood;
        px(xx, y, c);
        if (ox >= -3 && ox <= 4) px(xx, y - 1, ox >= 3 ? (ox === 4 ? hair : skin) : mulRGB(c, 0.84));
      }
      px(x + 1 * dir, y - 2, shirtDk);
      px(x + 2 * dir, y + 1, skin);
      px(x - 4 * dir, y + 1, shoes);
      return;
    }

    // Dimensions
    const legH = kid ? 3 : 4;
    const torsoH = kid ? 3 : 5;
    const torsoW = kid ? 3 : 5;
    const headS = kid ? 3 : 4;
    const running = a.state === 'flee' || a.state === 'exit' || (a.kind === 'zombie' && a.state === 'chase') || (a.jog && a.state === 'walk') || (a.controlled && a.speedNow > 1.5);
    const moving = a.speedNow > 0.25 && !a.seated;
    const isZ = (a.kind === 'zombie' && a.revealed) || a.state === 'rise';
    const sickly = a.kind === 'zombie' && !a.revealed;
    const feeding = a.kind === 'zombie' && a.state === 'feed';
    const crouch = feeding ? 3 : a.state === 'rise' ? Math.round(clamp(2 - (a.st - 0.8) * 2, 0, 2)) : 0;

    let bob = 0;
    if (moving) bob = Math.round(Math.abs(Math.sin(a.phase)) * (running ? -1.6 : -1));
    if (a.state === 'grabbed') x += Math.random() < 0.5 ? -1 : 1;
    y += bob + crouch;

    // Ground shadow
    if (!a.seated && a.state !== 'swing') {
      const gy = Math.round(sp[1]) + 1;
      buf.hline(x - 3, x + 3, gy, ink, 0.3 * A);
      buf.hline(x - 2, x + 2, gy + 1, ink, 0.18 * A);
    }

    const f = a.facing;
    const half = (torsoW - 1) >> 1;

    // Legs
    if (a.seated) {
      // Sitting: thighs forward, shins down
      hl(x - 1, x + f * 2, y - 1, pants);
      hl(x, x + f * 2, y, pantsDk);
      px(x + f * 2, y + 1, pants);
      px(x + f * 2, y + 2, shoes);
      px(x + f * 3, y + 2, shoes);
    } else if (!feeding) {
      const strideAmp = running ? 2 : 1.4;
      const s = moving ? Math.round(Math.sin(a.phase) * strideAmp) : 0;
      const lx = x - 1 + (s > 0 ? 1 : s < 0 ? -1 : 0);
      const rx = x + 1 - (s > 0 ? 1 : s < 0 ? -1 : 0);
      vl(lx, y - legH, y - 1, pants);
      vl(rx, y - legH, y - 1, pantsDk);
      px(lx + (f > 0 ? 1 : 0), y, shoes);
      px(lx - (f > 0 ? 0 : 1), y, shoes);
      px(rx + (f > 0 ? 1 : 0), y, shoes);
      px(rx - (f > 0 ? 0 : 1), y, shoes);
    } else {
      hl(x - 1, x + 1, y - 1, pants);
      hl(x - 2, x + 1, y, pantsDk);
    }

    // Torso
    const tTop = y - legH - torsoH + (a.seated ? 1 : 0);
    const lean = isZ || sickly ? f : running ? f : 0;
    rect(x - half + (feeding ? f : 0), tTop, torsoW, torsoH, shirt);
    vl(x + (f > 0 ? -half : half), tTop, tTop + torsoH - 1, shirtDk);
    hl(x - half + 1, x + half - 1, tTop, shirtHi);
    if (a.role === 'hero') {
      // zipper + backpack
      vl(x, tTop + 1, tTop + torsoH - 1, shirtDk);
      const bpx = x - f * (half + 1);
      rect(Math.min(bpx, bpx - f), tTop + 1, 2, 4, L([88, 98, 62]));
      px(bpx - f, tTop + 1, L([66, 74, 48]));
    }
    if (look.stripe) hl(x - half, x + half, tTop + 2, L(look.stripe));
    if ((a.bloodied || isZ) && !kid) {
      // Blood stains
      for (let k = 0; k < 4; k++) {
        const hx = x - half + Math.floor(hash2(a.id, k) * torsoW);
        const hy = tTop + Math.floor(hash2(k, a.id * 3) * torsoH);
        px(hx, hy, blood);
      }
    }

    // Head
    const hx = x + lean + (feeding ? f * 2 : 0);
    const hy = tTop - headS + (feeding ? 3 : 0);
    rect(hx - (kid ? 1 : 2), hy, headS, headS, skin);
    vl(hx + (f > 0 ? -(kid ? 1 : 2) : kid ? 1 : 1), hy + 1, hy + headS - 1, skinDk);

    // Hair styles
    const hl0 = hx - (kid ? 1 : 2);
    const hr0 = hx + (kid ? 1 : 1);
    const back = f > 0 ? hl0 : hr0;
    const style = look.hairStyle;
    if (isZ && zf > 0.6) {
      hl(hl0, hr0, hy, hair);
      px(hl0 + 1, hy - 1, hair);
    } else if (style === 'bald') {
      px(hx, hy, lerpRGB(skin, [255, 255, 255], 0.25));
      px(back, hy + 1, hair);
    } else if (style === 'cap') {
      const cap = L(look.cap);
      hl(hl0, hr0, hy, cap);
      hl(hl0 + 1, hr0, hy - 1, cap);
      px(f > 0 ? hr0 + 1 : hl0 - 1, hy, mulRGB(cap, 0.8));
    } else {
      hl(hl0, hr0, hy, hair);
      hl(hl0 + 1, hr0 - (kid ? 0 : 1), hy - 1, hair);
      vl(back, hy, hy + 1, hair);
      if (style === 'long') {
        vl(back, hy, hy + headS + 1, hair);
        px(back - f, hy + 2, hair);
      } else if (style === 'bun') {
        px(back - f, hy - 1, hair);
        px(back - f, hy - 2, hair);
      }
    }
    // Eye
    if (isZ && zf > 0.5) px(hx + (f > 0 ? 1 : -1), hy + (kid ? 1 : 2), [210, 40, 40]);
    else px(hx + (f > 0 ? 1 : -1), hy + (kid ? 1 : 2), ink);
    if (a.state === 'grabbed' || (a.state === 'flee' && a.st < 1.5)) {
      // open screaming mouth
      px(hx + (f > 0 ? 1 : -1), hy + headS - 1, [90, 30, 34]);
    }

    // Arms
    const shY = tTop + 1;
    const shF = x + f * half;
    const shB = x - f * half;
    if (a.armed && (a.state === 'walk' || a.state === 'idle' || a.state === 'exit')) {
      const ax = a.aimSX != null ? a.aimSX : f;
      const ay = a.aimSY || 0;
      const sx0 = x + (ax >= 0 ? half : -half);
      const sy0 = shY + 1;
      // back arm
      vl(shB, shY, shY + 2, shirtDk);
      if (a.meleeT > 0) {
        // Strike: arm sweeps across the aim direction + white whoosh arc
        const p = 1 - a.meleeT / 0.25;
        const base = Math.atan2(ay, ax);
        const ang = base + (p - 0.5) * 2.4;
        const hx2 = Math.round(sx0 + Math.cos(ang) * 4.5);
        const hy2 = Math.round(sy0 + Math.sin(ang) * 3);
        ln(sx0, sy0, hx2, hy2, shirt);
        px(hx2, hy2, skin);
        const fade = a.meleeT / 0.25;
        for (let k = 0; k < 7; k++) {
          const aa = base + (k / 6 - 0.5) * 2.0;
          buf.blendPx(Math.round(sx0 + Math.cos(aa) * 8), Math.round(sy0 + Math.sin(aa) * 5.5), [255, 255, 255], 0.85 * fade);
        }
        a.muzzleX = sx0 + ax * 7;
        a.muzzleY = sy0 + ay * 5;
      } else {
        const kick = a.recoil || 0;
        const gun = atmo.applyLight([58, 62, 74]);
        const gunHi = atmo.applyLight([128, 136, 152]);
        const hx2 = Math.round(sx0 + ax * (3.6 - kick * 1.2));
        const hy2 = Math.round(sy0 + ay * (2.6 - kick * 0.8));
        const glen = a.rifle ? 6.5 : 3.6;
        const tipX = Math.round(hx2 + ax * glen);
        const tipY = Math.round(hy2 + ay * glen * 0.72);
        if (a.rifle) {
          // stock tucked behind the hand
          ln(hx2, hy2, Math.round(hx2 - ax * 2.5), Math.round(hy2 - ay * 1.8 + 1), gun);
        }
        ln(sx0, sy0, hx2, hy2, shirt);
        ln(hx2, hy2, tipX, tipY, gun);
        px(hx2, hy2 + 1, gun);
        px(Math.round(hx2 + ax * 1.5), Math.round(hy2 + ay * 1.2) - 1, gunHi);
        px(hx2, hy2, skin);
        a.muzzleX = tipX + ax;
        a.muzzleY = tipY + ay;
      }
    } else if (isZ && a.kind === 'zombie' && (a.state === 'shamble' || a.state === 'chase' || a.state === 'idle' || a.state === 'stun' || a.state === 'climb')) {
      const bobA = Math.round(Math.sin(a.phase * 1.4));
      ln(shF, shY + 1, shF + f * 4, shY + 1 + bobA, shirt);
      px(shF + f * 5, shY + 1 + bobA, skin);
      ln(shB + f, shY, shB + f * 5, shY - bobA, shirtDk);
      px(shB + f * 6, shY - bobA, skinDk);
    } else if (a.state === 'bite' || feeding) {
      ln(shF, shY + 1, shF + f * 3, shY + 2, shirt);
      px(shF + f * 3, shY + 3, skin);
      ln(shB + f, shY + 1, shB + f * 4, shY + 3, shirtDk);
    } else if (a.state === 'grabbed') {
      const fl = Math.random() < 0.5 ? -1 : 1;
      ln(shF, shY, shF + f, shY - 3 + fl, shirt);
      px(shF + f, shY - 4 + fl, skin);
      ln(shB, shY, shB - f, shY - 3 - fl, shirtDk);
      px(shB - f, shY - 4 - fl, skin);
    } else if (a.state === 'flee' || a.state === 'exit' || a.state === 'alert') {
      const sw = Math.round(Math.sin(a.phase * 1.3) * 2);
      if (a.panicArms !== false && a.state !== 'alert') {
        ln(shF, shY, shF + f, shY - 2 + sw, shirt);
        px(shF + f, shY - 3 + sw, skin);
        ln(shB, shY, shB - f, shY - 2 - sw, shirtDk);
        px(shB - f, shY - 3 - sw, skin);
      } else {
        vl(shF, shY, shY + 2, shirt);
        px(shF, shY + 3, skin);
      }
    } else if (a.seated) {
      px(shF, shY + 2, shirt);
      px(shF + f, shY + 3, skin);
    } else if (a.state === 'swing') {
      // Ropes up to the swing beam + seat under the kid
      const top = proj.project(a.u, a.v, a.swingTopZ || 7);
      const rope = L([120, 122, 128]);
      buf.line(shF, shY + 1, top[0] + 1, top[1], rope);
      buf.line(shB, shY + 1, top[0] - 1, top[1], rope);
      hl(x - 2, x + 2, y, L([170, 92, 62]));
      px(shF, shY + 1, skin);
    } else {
      const sw = moving ? Math.round(Math.sin(a.phase)) : 0;
      vl(shF + (sw > 0 ? 1 : 0) * f, shY, shY + (kid ? 1 : 2), shirt);
      px(shF + (sw > 0 ? 1 : 0) * f, shY + (kid ? 2 : 3), skin);
    }

    // Held items
    const handX = shF + f;
    const handY = shY + (kid ? 2 : 3);
    if (a.item === 'balloon') {
      const wig = Math.sin(time * 2 + a.id);
      const bx = handX + f * 2 + Math.round(wig);
      const by = handY - 13;
      ln(handX, handY, bx, by + 1, L([90, 90, 96]));
      drawBalloon(buf, bx, by - 1, a.balloonColor || [222, 52, 58], atmo, wig);
    } else if (a.item === 'icecream') {
      px(handX, handY - 1, L([214, 168, 104]));
      px(handX, handY - 2, L([248, 186, 204]));
    } else if (a.item === 'phone' && (a.state === 'sit' || a.state === 'idle')) {
      px(hx + f * 2, hy + 3, L([40, 44, 56]));
      px(hx + f * 2, hy + 2, [190, 220, 255]);
    } else if (a.item === 'book' && a.seated) {
      px(handX, handY - 1, L([176, 70, 62]));
      px(handX + f, handY - 1, L([236, 232, 220]));
      px(handX, handY - 2, L([176, 70, 62]));
    } else if (a.item === 'bag') {
      rect(handX - (f > 0 ? 0 : 1), handY, 2, 3, L(a.bagColor || [226, 214, 190]));
    } else if (a.item === 'cane') {
      ln(handX + f, handY, handX + f * 2, y, L([120, 86, 58]));
    } else if (a.item === 'camera') {
      px(hx + f * 2, hy + 2, L([40, 40, 46]));
      px(hx + f * 3, hy + 2, L([40, 40, 46]));
      if (a.flash > 0) {
        buf.smoothGlow(hx + f * 4, hy + 2, 7, 5, [255, 255, 240], 0.8, true);
        px(hx + f * 4, hy + 2, [255, 255, 255]);
      }
    }

    // Emote bubble
    if (a.emote && a.emoteT > 0) {
      drawEmote(buf, hx, hy - 2, a.emote, clamp(a.emoteT * 1.6, 0, 1) * A);
    }
  }

  function drawDog(buf, d, atmo, proj) {
    const sp = proj.project(d.u, d.v, 0);
    const x = Math.round(sp[0]);
    const y = Math.round(sp[1]);
    const A = d.alpha;
    const px = (xx, yy, c) => {
      if (A < 1 && A <= bayer4(xx, yy)) return;
      buf.setPx(xx, yy, c);
    };
    const L = atmo.applyLight;
    const fur = L(d.fur || [186, 132, 82]);
    const furDk = mulRGB(fur, 0.72);
    const f = d.facing;
    buf.hline(x - 3, x + 3, y + 1, atmo.ink, 0.26 * A);
    const run = d.speedNow > 2.5;
    const leg = Math.round(Math.sin(d.phase * 2) * (run ? 1 : 0.6));
    // legs
    px(x - 2 + leg, y, furDk);
    px(x - 1 - leg, y, furDk);
    px(x + 1 + leg, y, furDk);
    px(x + 2 - leg, y, furDk);
    // body
    for (let xx = x - 2; xx <= x + 2; xx++) {
      px(xx, y - 1, fur);
      px(xx, y - 2, xx === x - 2 * f ? furDk : fur);
    }
    // head
    px(x + 3 * f, y - 3, fur);
    px(x + 3 * f, y - 2, fur);
    px(x + 4 * f, y - 2, fur);
    px(x + 2 * f, y - 4, furDk);
    px(x + 4 * f, y - 3, atmo.ink);
    // tail
    const wag = Math.round(Math.sin(d.phase * 6 + buf.width));
    px(x - 3 * f, y - 3 + (wag > 0 ? 0 : 1), furDk);
    if (d.emote && d.emoteT > 0) drawEmote(buf, x + 2 * f, y - 6, d.emote, clamp(d.emoteT * 1.6, 0, 1) * A);
  }

  function drawBird(buf, b, atmo, proj) {
    const sp = proj.project(b.u, b.v, b.z);
    const x = Math.round(sp[0]);
    const y = Math.round(sp[1]);
    const col = atmo.applyLight(b.col);
    const dk = mulRGB(col, 0.7);
    if (b.state === 'peck') {
      const peck = Math.sin(b.phase * 5 + b.u) > 0.6 ? 1 : 0;
      buf.hline(x - 1, x + 1, y - 1, col);
      buf.setPx(x - b.facing, y - 1, dk);
      buf.setPx(x + b.facing * 1, y - 2 + peck, dk);
      buf.setPx(x + b.facing * 2, y - 1 + peck, atmo.applyLight([210, 150, 80]));
      buf.blendPx(x, y, atmo.ink, 0.3);
    } else {
      const flap = Math.sin(b.phase * 22) > 0;
      buf.setPx(x, y, col);
      buf.setPx(x + b.facing, y, dk);
      if (flap) {
        buf.setPx(x - 1, y - 1, col);
        buf.setPx(x + 1, y - 1, col);
        buf.setPx(x - 2, y - 2, dk);
        buf.setPx(x + 2, y - 2, dk);
      } else {
        buf.setPx(x - 1, y + 1, col);
        buf.setPx(x + 1, y + 1, col);
      }
    }
  }

  function drawProp(buf, p, atmo, proj) {
    const sp = proj.project(p.u, p.v, 0);
    const x = Math.round(sp[0]);
    const y = Math.round(sp[1]);
    const L = atmo.applyLight;
    if (p.type === 'stroller') {
      const f = p.facing || 1;
      const body = L([70, 108, 150]);
      const bodyDk = mulRGB(body, 0.72);
      const wheel = L([40, 42, 50]);
      buf.hline(x - 3, x + 3, y + 1, atmo.ink, 0.28);
      buf.setPx(x - 2, y, wheel);
      buf.setPx(x + 2, y, wheel);
      buf.rect(x - 3, y - 4, 6, 3, body);
      buf.hline(x - 3, x + 2, y - 2, bodyDk);
      // hood
      const hx = x + (f > 0 ? 1 : -3);
      buf.rect(hx, y - 6, 3, 2, bodyDk);
      // handle
      buf.line(x - f * 3, y - 4, x - f * 5, y - 7, L([60, 60, 66]));
    } else if (p.type === 'icecream') {
      buf.setPx(x, y, L([246, 184, 204]));
      buf.setPx(x + 1, y, L([246, 184, 204]));
      buf.setPx(x - 1, y, L([214, 168, 104]));
    } else if (p.type === 'bag') {
      buf.rect(x - 1, y - 2, 3, 2, L([226, 214, 190]));
      buf.hline(x - 1, x + 1, y, L([180, 168, 146]));
      buf.setPx(x + 2, y, L([238, 120, 70]));
      buf.setPx(x + 3, y, L([150, 196, 90]));
    } else if (p.type === 'phone') {
      buf.hline(x, x + 1, y, L([36, 40, 52]));
      buf.setPx(x, y, [170, 210, 250]);
    } else if (p.type === 'hat') {
      buf.hline(x - 1, x + 2, y, L([204, 60, 56]));
      buf.hline(x, x + 1, y - 1, L([204, 60, 56]));
    } else if (p.type === 'cane') {
      buf.line(x - 2, y, x + 3, y - 1, L([120, 86, 58]));
    } else if (p.type === 'book') {
      buf.rect(x - 1, y - 1, 3, 2, L([170, 72, 64]));
      buf.setPx(x, y - 1, L([240, 236, 224]));
    } else if (p.type === 'basket') {
      buf.hline(x - 3, x + 3, y + 1, atmo.ink, 0.25);
      buf.rect(x - 2, y - 2, 5, 3, L([170, 124, 74]));
      buf.hline(x - 2, x + 2, y - 2, L([204, 160, 104]));
      buf.line(x - 2, y - 3, x, y - 5, L([132, 94, 56]));
      buf.line(x, y - 5, x + 2, y - 3, L([132, 94, 56]));
      buf.setPx(x + 1, y - 3, L([214, 60, 60]));
    } else if (p.type === 'pistol') {
      buf.hline(x - 1, x + 2, y - 1, L([52, 56, 64]));
      buf.setPx(x - 1, y, L([52, 56, 64]));
      buf.setPx(x + 1, y - 2, L([128, 136, 150]));
      buf.hline(x - 2, x + 3, y + 1, atmo.ink, 0.3);
    } else if (p.type === 'rifle') {
      buf.line(x - 4, y, x + 4, y - 2, L([46, 50, 44]));
      buf.line(x - 4, y + 1, x - 2, y + 1, L([96, 76, 52]));
      buf.setPx(x + 1, y, L([70, 76, 66]));
      buf.setPx(x, y + 1, L([70, 76, 66]));
    } else if (p.type === 'bucket') {
      buf.rect(x - 1, y - 2, 2, 2, L([220, 70, 60]));
      buf.setPx(x + 1, y, L([90, 150, 210]));
    }
  }

  Diorama.Actors = { Crowd, makeActor, randomLook, dist };
})(window);
