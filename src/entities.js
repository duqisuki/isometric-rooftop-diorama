(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { clamp, lerp, mulRGB, lerpRGB, bayer4 } = Diorama.Palette;
  const { BUILDING, project } = Diorama.Iso;

  // Tiny crisp pixel emote icons (5x5)
  const EMOTE_SPRITES = {
    heart: [
      '.X.X.',
      'XXXXX',
      'XXXXX',
      '.XXX.',
      '..X..',
    ],
    note: [
      '..XXX',
      '..X.X',
      '..X..',
      'XXX..',
      'XX...',
    ],
    exclaim: [
      '..X..',
      '..X..',
      '..X..',
      '.....',
      '..X..',
    ],
    reload: [
      '.XXX.',
      'X...X',
      'X..XX',
      'X....',
      '.XXX.',
    ],
  };

  // 4 visually distinct zombie archetypes (tattered outfits + unmistakable zombie-green skin)
  const ZOMBIE_STYLES = [
    {
      skin: [138, 178, 118],
      skinDk: [94, 128, 80],
      shirt: [74, 86, 112],
      pants: [46, 52, 66],
      hair: [52, 58, 48],
      tie: null,
    },
    {
      skin: [152, 180, 134],
      skinDk: [104, 132, 90],
      shirt: [134, 102, 78],
      pants: [58, 66, 78],
      hair: [68, 56, 46],
      tie: null,
    },
    {
      skin: [128, 168, 110],
      skinDk: [86, 120, 74],
      shirt: [134, 68, 78],
      pants: [48, 46, 56],
      hair: [44, 48, 42],
      tie: null,
    },
    {
      skin: [144, 182, 126],
      skinDk: [98, 132, 84],
      shirt: [176, 182, 172],
      pants: [54, 58, 68],
      hair: [56, 52, 48],
      tie: [158, 54, 58],
    },
  ];

  // Safe walkable roof bounds for kiting & shambling
  function clampRoofPos(u, v) {
    let cu = clamp(u, 4.5, 41.5);
    let cv = clamp(v, 4.5, 20.4);
    // Keep clear of stairwell penthouse (4.5..14.8, 3..10.8)
    if (cu < 15.2 && cv < 11.2) {
      if (15.2 - cu < 11.2 - cv) cu = 15.2;
      else cv = 11.2;
    }
    // Keep clear of utility shack (36..42.5, 3..8.8)
    if (cu > 35.6 && cv < 9.2) {
      if (cu - 35.6 < 9.2 - cv) cu = 35.6;
      else cv = 9.2;
    }
    // Keep clear of planter box (4.4..10.6, 14.8..20.6)
    if (cu < 11.0 && cv > 14.4) {
      if (11.0 - cu < cv - 14.4) cu = 11.0;
      else cv = 14.4;
    }
    return [cu, cv];
  }

  let nextZombieId = 1;

  function makeZombie(spawnKind, customPos) {
    const style = ZOMBIE_STYLES[Math.floor(Math.random() * ZOMBIE_STYLES.length)];
    let u, v, z = 0, climbing = false;

    if (customPos) {
      u = customPos[0];
      v = customPos[1];
    } else if (spawnKind === 'door') {
      u = 9.0 + (Math.random() - 0.5) * 1.4;
      v = 11.4;
    } else if (spawnKind === 'parapet_right') {
      u = 42.4;
      v = 10.5 + Math.random() * 8.5;
      z = -4.5;
      climbing = true;
    } else if (spawnKind === 'parapet_front') {
      u = 14.0 + Math.random() * 24.0;
      v = 20.6;
      z = -4.5;
      climbing = true;
    } else {
      // Back-right parapet climb
      u = 18.0 + Math.random() * 16.0;
      v = 4.2;
      z = -4.5;
      climbing = true;
    }

    return {
      id: nextZombieId++,
      u,
      v,
      z,
      vx: 0,
      vy: 0,
      hp: 3,
      maxHp: 3,
      speed: 2.3 + Math.random() * 1.1,
      facing: -1,
      aimDx: -1,
      aimDy: 0,
      walkPhase: Math.random() * 6.28,
      climbing,
      climbT: 0,
      hitFlash: 0,
      stagger: 0,
      state: 'alive', // 'alive' | 'falling' | 'down'
      fallT: 0,
      downTimer: 0,
      fallDir: 1,
      style,
    };
  }

  function createEntities() {
    const survivor = {
      id: 'mina',
      name: 'Survivor',
      u: 19.5,
      v: 15.2,
      targetU: 19.5,
      targetV: 15.2,
      manualTarget: false,
      facing: 1,
      aimDx: 1,
      aimDy: 0,
      speed: 6.8,
      walkPhase: 0,
      hop: 0,
      emote: null,
      emoteTimer: 0,
      shirt: [214, 88, 70],
      pants: [48, 56, 78],
      hair: [42, 32, 32],
      skin: [244, 208, 180],
      scarf: false,
      // Pistol combat state
      ammo: 8,
      maxAmmo: 8,
      fireCooldown: 0.4,
      reloading: 0,
      recoil: 0,
      muzzleFlash: 0,
      muzzleX: 0,
      muzzleY: 0,
      targetZombieId: null,
      kills: 0,
    };

    const entities = {
      survivor,
      zombies: [],
      bullets: [],
      casings: [],
      decals: [],
      spawnTimer: 1.4,
      cat: {
        u: 24.0,
        v: 1.3,
        z: BUILDING.Z_PARAPET,
        facing: 1,
        sleeping: false,
        hop: 0,
        emote: null,
        emoteTimer: 0,
        parapetDir: 1,
      },
      pigeons: [
        { u: 20, v: 15.5, z: 0, vz: 0, flying: false, flyT: 0, seed: 1.1, facing: 1, peck: 0 },
        { u: 25, v: 17.5, z: 0, vz: 0, flying: false, flyT: 0, seed: 2.7, facing: -1, peck: 0 },
        { u: 17.5, v: 18.2, z: 0, vz: 0, flying: false, flyT: 0, seed: 4.3, facing: 1, peck: 0 },
      ],
      swallows: [
        { phase: 0.0, speed: 0.45, radX: 98, radY: 18, baseY: 54 },
        { phase: 1.7, speed: 0.52, radX: 112, radY: 16, baseY: 64 },
        { phase: 3.4, speed: 0.41, radX: 92, radY: 20, baseY: 44 },
        { phase: 5.0, speed: 0.48, radX: 104, radY: 14, baseY: 60 },
      ],
      fireflies: Array.from({ length: 16 }, (_, i) => ({
        u: 8 + ((i * 11.3) % 30),
        v: 6 + ((i * 7.7) % 14),
        z: 3 + ((i * 3.1) % 8),
        phase: i * 1.43,
        speed: 0.7 + (i % 4) * 0.22,
      })),
      particles: [],
    };

    seedInitialZombies(entities);
    return entities;
  }

  function seedInitialZombies(entities) {
    entities.zombies.length = 0;
    entities.bullets.length = 0;
    entities.casings.length = 0;
    entities.decals.length = 0;
    // Place an immediately readable, dramatic rooftop standoff right on frame 1!
    entities.zombies.push(makeZombie('custom', [31.5, 13.8]));
    entities.zombies.push(makeZombie('custom', [35.2, 11.2]));
    entities.zombies.push(makeZombie('custom', [27.5, 8.2]));
    entities.zombies.push(makeZombie('door'));
    entities.zombies.push(makeZombie('parapet_right'));
  }

  function spawnZombieWave(entities, count = 2, preferredKind = null) {
    const kinds = ['door', 'parapet_right', 'parapet_front', 'parapet_back'];
    for (let i = 0; i < count; i++) {
      if (entities.zombies.filter((z) => z.state === 'alive').length >= 9) break;
      const kind = preferredKind || kinds[Math.floor(Math.random() * kinds.length)];
      entities.zombies.push(makeZombie(kind));
    }
  }

  /**
   * Configures survivor & wildlife posture for each of the 5 scenarios.
   */
  function applyScenarioRoles(entities, scenarioId) {
    const s = entities.survivor;
    const cat = entities.cat;

    s.u = 18.8;
    s.v = 15.2;
    s.targetU = 18.8;
    s.targetV = 15.2;
    s.manualTarget = false;
    s.scarf = scenarioId === 'snowfall';
    s.ammo = s.maxAmmo;
    s.reloading = 0;
    s.fireCooldown = 0.25;

    seedInitialZombies(entities);

    // Brave rooftop cat watches the standoff safely from high ground!
    if (scenarioId === 'morning') {
      cat.u = 10.5; cat.v = 6.5; cat.z = BUILDING.Z_ROOF + 15.2; cat.sleeping = true;
    } else if (scenarioId === 'golden') {
      cat.u = 24.0; cat.v = 1.3; cat.z = BUILDING.Z_PARAPET; cat.sleeping = false;
    } else if (scenarioId === 'cinema') {
      cat.u = 11.5; cat.v = 8.2; cat.z = BUILDING.Z_ROOF + 15.2; cat.sleeping = false;
    } else if (scenarioId === 'snowfall') {
      cat.u = 22.0; cat.v = 1.3; cat.z = BUILDING.Z_PARAPET; cat.sleeping = false;
    } else {
      // Sudden Squall: perched alertly on the back parapet!
      cat.u = 20.5; cat.v = 1.3; cat.z = BUILDING.Z_PARAPET; cat.sleeping = false;
    }
  }

  function spawnParticle(entities, opts) {
    if (entities.particles.length > 220) entities.particles.shift();
    entities.particles.push({
      x: opts.x,
      y: opts.y,
      vx: opts.vx || 0,
      vy: opts.vy || 0,
      gravity: opts.gravity || 0,
      age: 0,
      maxAge: opts.maxAge || 1.0,
      size: opts.size || 1,
      color: opts.color || [235, 240, 248],
      dither: !!opts.dither,
      alpha: opts.alpha !== undefined ? opts.alpha : 0.9,
    });
  }

  function startlePigeons(entities) {
    for (let i = 0; i < entities.pigeons.length; i++) {
      const p = entities.pigeons[i];
      if (!p.flying) {
        p.flying = true;
        p.flyT = 0;
        p.vz = 15 + Math.random() * 6;
      }
    }
  }

  /**
   * Fires a crisp pistol shot from the survivor toward target zombie `zmb`.
   */
  function firePistolAt(entities, zmb, state, audio, isCrit = false) {
    const s = entities.survivor;
    if (!zmb || zmb.state !== 'alive') return false;

    const sPos = project(s.u, s.v, BUILDING.Z_ROOF + 4.8);
    const zPos = project(zmb.u, zmb.v, BUILDING.Z_ROOF + 4.2 + Math.max(0, zmb.z));
    const dx = zPos[0] - sPos[0];
    const dy = zPos[1] - sPos[1];
    const len = Math.max(1, Math.hypot(dx, dy));
    s.aimDx = dx / len;
    s.aimDy = dy / len;
    s.facing = s.aimDx >= 0 ? 1 : -1;

    // Barrel muzzle screen coordinates
    const mx = sPos[0] + s.aimDx * 8;
    const my = sPos[1] + s.aimDy * 5;
    s.muzzleX = mx;
    s.muzzleY = my;
    s.muzzleFlash = 0.11;
    s.recoil = 1.0;
    s.ammo = Math.max(0, s.ammo - 1);
    s.fireCooldown = 0.48 + Math.random() * 0.16;

    // Bullet tracer projectile
    entities.bullets.push({
      x0: mx,
      y0: my,
      x: mx,
      y: my,
      tx: zPos[0],
      ty: zPos[1],
      t: 0,
      dur: clamp(len / 520, 0.045, 0.11),
      targetId: zmb.id,
      damage: isCrit ? 2 : 1,
      dirU: zmb.u - s.u,
      dirV: zmb.v - s.v,
    });

    // Eject golden brass shell casing!
    entities.casings.push({
      x: mx - s.aimDx * 3,
      y: my - 1,
      vx: -s.aimDx * 14 + (Math.random() - 0.5) * 16,
      vy: -28 - Math.random() * 14,
      floorY: sPos[1] + 7,
      bounced: false,
      age: 0,
      maxAge: 2.2,
    });

    // Tiny puff of bluish-gray gunsmoke from barrel
    for (let k = 0; k < 3; k++) {
      spawnParticle(entities, {
        x: mx + (Math.random() - 0.5) * 2,
        y: my + (Math.random() - 0.5) * 2,
        vx: s.aimDx * 8 + (Math.random() - 0.5) * 6,
        vy: -10 - Math.random() * 8,
        maxAge: 0.55 + Math.random() * 0.25,
        size: 1.5,
        color: [214, 220, 232],
        dither: true,
        alpha: 0.62,
      });
    }

    // Startle nearby pigeons in Morning Laundry when shooting!
    if (state.env.pigeonsActive > 0.35 && Math.random() < 0.4) {
      startlePigeons(entities);
    }

    if (audio) audio.playGunshot();

    // Auto-reload when magazine runs dry
    if (s.ammo <= 0) {
      s.reloading = 1.05;
      s.emote = 'reload';
      s.emoteTimer = 1.0;
      if (audio) audio.playReload();
    }
    return true;
  }

  function applyBulletHit(entities, bullet, state, audio) {
    const z = entities.zombies.find((item) => item.id === bullet.targetId);
    if (!z || z.state !== 'alive') return;

    z.hp -= bullet.damage;
    z.hitFlash = 0.14;
    z.stagger = 0.22;

    const dLen = Math.max(0.1, Math.hypot(bullet.dirU, bullet.dirV));
    const ku = bullet.dirU / dLen;
    const kv = bullet.dirV / dLen;
    z.vx += ku * 10.5;
    z.vy += kv * 10.5;

    const zp = project(z.u, z.v, BUILDING.Z_ROOF + 4.0);
    // Impact sparks + dark splatter dots
    for (let k = 0; k < 6; k++) {
      spawnParticle(entities, {
        x: zp[0] + (Math.random() - 0.5) * 3,
        y: zp[1] + (Math.random() - 0.5) * 3,
        vx: (ku - kv) * 22 + (Math.random() - 0.5) * 24,
        vy: -14 - Math.random() * 16,
        gravity: 68,
        maxAge: 0.34 + Math.random() * 0.2,
        color: k < 2 ? [255, 224, 124] : [102, 134, 82],
      });
    }

    if (audio) audio.playZombieHit();

    if (z.hp <= 0) {
      z.state = 'falling';
      z.fallT = 0;
      z.fallDir = (ku - kv) >= 0 ? 1 : -1;
      entities.survivor.kills++;
      // Small subtle dark scuff on roof tile
      if (entities.decals.length > 10) entities.decals.shift();
      entities.decals.push({ u: z.u, v: z.v, age: 0, maxAge: 8.0 });
    }
  }

  /**
   * Advances survivor combat, zombie horde, bullets, shell casings, cat, wildlife & particles.
   */
  function updateEntities(entities, state, dt, audio) {
    const sid = state.scenario.id;
    const env = state.env;
    const t = state.time;
    const s = entities.survivor;

    // ── Survivor Cooldowns & Springs ────────────────────────────────
    if (s.hop > 0) s.hop = Math.max(0, s.hop - dt * 3.8);
    if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 7.5);
    if (s.muzzleFlash > 0) s.muzzleFlash = Math.max(0, s.muzzleFlash - dt);
    if (s.fireCooldown > 0) s.fireCooldown = Math.max(0, s.fireCooldown - dt);
    if (s.emoteTimer > 0) {
      s.emoteTimer -= dt;
      if (s.emoteTimer <= 0) s.emote = null;
    }
    if (s.reloading > 0) {
      s.reloading -= dt;
      if (s.reloading <= 0) {
        s.reloading = 0;
        s.ammo = s.maxAmmo;
      }
    }

    // ── Find Nearest Alive Zombie ───────────────────────────────────
    let nearest = null;
    let nearestDist = Infinity;
    let aliveCount = 0;

    for (let i = 0; i < entities.zombies.length; i++) {
      const z = entities.zombies[i];
      if (z.state !== 'alive') continue;
      aliveCount++;
      const d = Math.hypot(z.u - s.u, z.v - s.v);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = z;
      }
    }

    // ── Continuous Zombie Spawning (keeps the rooftop standoff lively!) ──
    entities.spawnTimer -= dt;
    if (entities.spawnTimer <= 0) {
      if (aliveCount < 5) {
        const kinds = ['door', 'parapet_right', 'parapet_front', 'parapet_back'];
        const pick = kinds[Math.floor(Math.random() * kinds.length)];
        entities.zombies.push(makeZombie(pick));
        if (pick === 'door' && !state.doorOpen) {
          state.doorOpen = true; // Zombies burst the stairwell door open!
        }
      }
      entities.spawnTimer = 2.0 + Math.random() * 1.8;
    }

    // ── Survivor Aiming, Firing & Tactical Kiting ───────────────────
    if (nearest) {
      const sPos = project(s.u, s.v, BUILDING.Z_ROOF + 4.8);
      const zPos = project(nearest.u, nearest.v, BUILDING.Z_ROOF + 4.2 + Math.max(0, nearest.z));
      const dx = zPos[0] - sPos[0];
      const dy = zPos[1] - sPos[1];
      const len = Math.max(1, Math.hypot(dx, dy));
      s.aimDx = lerp(s.aimDx, dx / len, Math.min(1, dt * 14));
      s.aimDy = lerp(s.aimDy, dy / len, Math.min(1, dt * 14));
      s.facing = s.aimDx >= 0 ? 1 : -1;

      // Auto-shoot at oncoming zombies!
      if (s.reloading <= 0 && s.fireCooldown <= 0 && nearestDist < 28) {
        firePistolAt(entities, nearest, state, audio, false);
      }

      // Tactical kiting: if a zombie gets too close, backpedal to an open rooftop corner!
      if (!s.manualTarget && nearestDist < 8.5) {
        // Compute repulsion vector away from all nearby alive zombies
        let awayU = 0;
        let awayV = 0;
        for (let i = 0; i < entities.zombies.length; i++) {
          const z = entities.zombies[i];
          if (z.state !== 'alive') continue;
          const du = s.u - z.u;
          const dv = s.v - z.v;
          const d = Math.hypot(du, dv);
          if (d < 12 && d > 0.01) {
            awayU += (du / d) * (12 - d);
            awayV += (dv / d) * (12 - d);
          }
        }
        // Slight pull toward rooftop center so survivor loops smoothly instead of cornering herself
        awayU += (23 - s.u) * 0.42;
        awayV += (14.5 - s.v) * 0.42;
        const al = Math.max(0.1, Math.hypot(awayU, awayV));
        const [tu, tv] = clampRoofPos(s.u + (awayU / al) * 7.5, s.v + (awayV / al) * 6.0);
        s.targetU = tu;
        s.targetV = tv;
        if (nearestDist < 4.8 && !s.emote) {
          s.emote = 'exclaim';
          s.emoteTimer = 0.85;
        }
      }
    }

    // Move survivor smoothly toward targetU, targetV
    const sdu = s.targetU - s.u;
    const sdv = s.targetV - s.v;
    const sdist = Math.hypot(sdu, sdv);
    if (sdist > 0.35) {
      const step = Math.min(sdist, s.speed * dt);
      const [nu, nv] = clampRoofPos(s.u + (sdu / sdist) * step, s.v + (sdv / sdist) * step);
      s.u = nu;
      s.v = nv;
      s.walkPhase += dt * 13.5;
      if (env.rainIntensity > 0.4 && Math.random() < dt * 5.0) {
        state.ripples.push({ u: s.u, v: s.v, age: 0, maxAge: 0.45, maxR: 2.2 });
      }
    } else {
      s.manualTarget = false;
    }

    // Frosty breath puffs in First Snowfall
    if (env.snowLevel > 0.5 && Math.random() < dt * 1.4) {
      const sp = project(s.u, s.v, BUILDING.Z_ROOF + 6.5);
      spawnParticle(entities, {
        x: sp[0] + s.facing * 2,
        y: sp[1],
        vx: s.facing * 6 + env.windSpeed * 4,
        vy: -4 - Math.random() * 2,
        maxAge: 0.75,
        color: [240, 246, 255],
        dither: true,
        alpha: 0.72,
      });
    }

    // ── Update Zombies ──────────────────────────────────────────────
    for (let i = entities.zombies.length - 1; i >= 0; i--) {
      const z = entities.zombies[i];
      if (z.hitFlash > 0) z.hitFlash = Math.max(0, z.hitFlash - dt);

      // Apply knockback decay
      if (Math.hypot(z.vx, z.vy) > 0.1) {
        const [ku, kv] = clampRoofPos(z.u + z.vx * dt, z.v + z.vy * dt);
        z.u = ku;
        z.v = kv;
        const damp = Math.exp(-8.5 * dt);
        z.vx *= damp;
        z.vy *= damp;
      }

      if (z.state === 'falling') {
        z.fallT += dt * 4.5;
        if (z.fallT >= 1) {
          z.state = 'down';
          z.downTimer = 2.6;
        }
        continue;
      }

      if (z.state === 'down') {
        z.downTimer -= dt;
        if (z.downTimer <= 0) {
          entities.zombies.splice(i, 1);
        }
        continue;
      }

      // Climbing over parapet edge onto the rooftop
      if (z.climbing) {
        z.climbT += dt * 1.25;
        z.z = lerp(-4.5, 0, clamp(z.climbT, 0, 1));
        if (z.climbT >= 1) {
          z.z = 0;
          z.climbing = false;
        }
        continue;
      }

      if (z.stagger > 0) {
        z.stagger = Math.max(0, z.stagger - dt);
        continue;
      }

      // Shamble relentlessly toward survivor (with soft separation from other zombies)
      let du = s.u - z.u;
      let dv = s.v - z.v;
      const dist = Math.hypot(du, dv);
      if (dist > 1.8) {
        du /= dist;
        dv /= dist;

        // Soft zombie-to-zombie separation so the horde fans out nicely
        for (let j = 0; j < entities.zombies.length; j++) {
          if (i === j) continue;
          const oz = entities.zombies[j];
          if (oz.state !== 'alive') continue;
          const su = z.u - oz.u;
          const sv = z.v - oz.v;
          const sd = Math.hypot(su, sv);
          if (sd > 0.01 && sd < 3.2) {
            const push = (3.2 - sd) * 0.42;
            du += (su / sd) * push;
            dv += (sv / sd) * push;
          }
        }

        const nLen = Math.max(0.01, Math.hypot(du, dv));
        const [nu, nv] = clampRoofPos(
          z.u + (du / nLen) * z.speed * dt,
          z.v + (dv / nLen) * z.speed * dt
        );
        z.u = nu;
        z.v = nv;
        z.walkPhase += dt * (z.speed * 2.6);
      }

      // Face toward survivor in screen space
      const zSp = project(z.u, z.v, BUILDING.Z_ROOF);
      const sSp = project(s.u, s.v, BUILDING.Z_ROOF);
      const sdx = sSp[0] - zSp[0];
      const sdy = sSp[1] - zSp[1];
      const sl = Math.max(1, Math.hypot(sdx, sdy));
      z.aimDx = sdx / sl;
      z.aimDy = sdy / sl;
      z.facing = sdx >= 0 ? 1 : -1;
    }

    // ── Update Bullet Tracers ───────────────────────────────────────
    for (let i = entities.bullets.length - 1; i >= 0; i--) {
      const b = entities.bullets[i];
      b.t += dt / b.dur;
      b.x = lerp(b.x0, b.tx, clamp(b.t, 0, 1));
      b.y = lerp(b.y0, b.ty, clamp(b.t, 0, 1));
      if (b.t >= 1) {
        applyBulletHit(entities, b, state, audio);
        entities.bullets.splice(i, 1);
      }
    }

    // ── Update Bouncing Brass Shell Casings ─────────────────────────
    for (let i = entities.casings.length - 1; i >= 0; i--) {
      const c = entities.casings[i];
      c.age += dt;
      if (c.age >= c.maxAge) {
        entities.casings.splice(i, 1);
        continue;
      }
      if (!c.bounced || c.y < c.floorY) {
        c.vy += 125 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        if (c.y >= c.floorY) {
          c.y = c.floorY;
          if (!c.bounced) {
            c.bounced = true;
            c.vy = -12;
            c.vx *= 0.45;
            if (audio) audio.playShellClink();
          } else {
            c.vy = 0;
            c.vx = 0;
          }
        }
      }
    }

    // ── Update Scuff Decals ─────────────────────────────────────────
    for (let i = entities.decals.length - 1; i >= 0; i--) {
      entities.decals[i].age += dt;
      if (entities.decals[i].age >= entities.decals[i].maxAge) {
        entities.decals.splice(i, 1);
      }
    }

    // ── Rooftop Cat ─────────────────────────────────────────────────
    const cat = entities.cat;
    if (cat.hop > 0) cat.hop = Math.max(0, cat.hop - dt * 4.2);
    if (cat.emoteTimer > 0) {
      cat.emoteTimer -= dt;
      if (cat.emoteTimer <= 0) cat.emote = null;
    }
    if (sid === 'golden' || sid === 'squall' || sid === 'snowfall') {
      cat.u += cat.parapetDir * 2.2 * dt;
      cat.facing = cat.parapetDir;
      if (cat.u > 33.5) cat.parapetDir = -1;
      if (cat.u < 16.5) cat.parapetDir = 1;
    }

    // ── Pigeons (Morning Laundry) ───────────────────────────────────
    if (env.pigeonsActive > 0.25) {
      for (let i = 0; i < entities.pigeons.length; i++) {
        const p = entities.pigeons[i];
        if (p.flying) {
          p.flyT += dt;
          p.z += p.vz * dt;
          p.vz -= 12 * dt;
          p.u += Math.cos(p.flyT * 2.4 + p.seed) * 9 * dt;
          p.v += Math.sin(p.flyT * 2.0 + p.seed) * 6 * dt;
          p.facing = Math.cos(p.flyT * 2.4 + p.seed) >= 0 ? 1 : -1;
          if (p.z <= 0 && p.flyT > 0.6) {
            p.z = 0;
            p.vz = 0;
            p.flying = false;
            p.u = clamp(p.u, 14, 34);
            p.v = clamp(p.v, 11, 20);
          }
        } else {
          p.peck = Math.max(0, Math.sin(t * 5.2 + p.seed * 3.1));
          if (Math.random() < dt * 0.45) {
            p.u = clamp(p.u + (Math.random() - 0.5) * 2.5, 14, 34);
            p.v = clamp(p.v + (Math.random() - 0.5) * 2.0, 11, 20);
            p.facing = Math.random() > 0.5 ? 1 : -1;
          }
        }
      }
    }

    // ── Grill Smoke Plumes (Golden Rooftop) ─────────────────────────
    if (env.grillActive > 0.35) {
      const rate = 6.5 + state.grillStoke * 16;
      if (Math.random() < dt * rate) {
        const gp = project(29.0, 18.5, BUILDING.Z_ROOF + 5.5);
        spawnParticle(entities, {
          x: gp[0] + (Math.random() - 0.5) * 4,
          y: gp[1],
          vx: 5 + env.windSpeed * 10 + (Math.random() - 0.5) * 4,
          vy: -15 - Math.random() * 8,
          maxAge: 1.6 + Math.random() * 0.9,
          size: 3,
          color: [224, 218, 214],
          dither: true,
          alpha: 0.58,
        });
      }
    }

    // ── Particles Integration ───────────────────────────────────────
    for (let i = entities.particles.length - 1; i >= 0; i--) {
      const pt = entities.particles[i];
      pt.age += dt;
      if (pt.age >= pt.maxAge) {
        entities.particles.splice(i, 1);
        continue;
      }
      pt.vy += pt.gravity * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
  }

  function drawEmote(buf, cx, cy, kind, alpha) {
    const spr = EMOTE_SPRITES[kind];
    if (!spr) return;
    const bx = Math.round(cx) - 4;
    const by = Math.round(cy) - 8;
    buf.rect(bx, by, 9, 7, [252, 252, 255], alpha * 0.92);
    buf.setPx(bx + 4, by + 7, [252, 252, 255]);
    const col = kind === 'heart'
      ? [226, 78, 92]
      : kind === 'exclaim'
        ? [236, 98, 52]
        : kind === 'reload'
          ? [102, 118, 142]
          : [68, 126, 204];
    for (let r = 0; r < spr.length; r++) {
      for (let c = 0; c < spr[r].length; c++) {
        if (spr[r][c] === 'X') buf.blendPx(bx + 2 + c, by + 1 + r, col, alpha);
      }
    }
  }

  /**
   * Draws crisp 7x13 pixel Survivor holding an aimed steel pistol + muzzle flash!
   */
  function drawSurvivor(buf, s, state, atmo, hitList) {
    const sp = project(s.u, s.v, BUILDING.Z_ROOF);
    const hopY = Math.round(Math.sin(s.hop * Math.PI) * -6.0);
    const moving = Math.hypot(s.targetU - s.u, s.targetV - s.v) > 0.4;
    const bob = moving ? Math.round(Math.abs(Math.sin(s.walkPhase)) * -1.4) : 0;
    const x = Math.round(sp[0]);
    const y = Math.round(sp[1]) + hopY + bob;

    const shirt = atmo.applyLight(s.shirt);
    const shirtHi = lerpRGB(shirt, [255, 226, 206], 0.22);
    const shirtDk = mulRGB(shirt, 0.72);
    const pants = atmo.applyLight(s.pants);
    const pantsDk = mulRGB(pants, 0.74);
    const boot = atmo.applyLight([36, 38, 46]);
    const hair = atmo.applyLight(s.hair);
    const skin = atmo.applyLight(s.skin);
    const gunMetal = atmo.applyLight([62, 68, 80]);
    const gunSlide = atmo.applyLight([124, 134, 150]);

    // Ground contact shadow
    buf.hline(x - 3, x + 3, Math.round(sp[1]) + 1, atmo.ink, 0.34);
    buf.hline(x - 2, x + 2, Math.round(sp[1]) + 2, atmo.ink, 0.22);

    // Animated legs & boots
    const stride = moving ? Math.round(Math.sin(s.walkPhase) * 1.6) : 0;
    const lx = x - 1 + (stride > 0 ? 1 : stride < 0 ? -1 : 0);
    const rx = x + 1 - (stride > 0 ? 1 : stride < 0 ? -1 : 0);
    buf.vline(lx, y - 4, y - 1, pants);
    buf.vline(rx, y - 4, y - 1, pantsDk);
    buf.hline(lx - (s.facing < 0 ? 1 : 0), lx + (s.facing > 0 ? 1 : 0), y, boot);
    buf.hline(rx - (s.facing < 0 ? 1 : 0), rx + (s.facing > 0 ? 1 : 0), y, boot);

    // Jacket torso (5x5 with lapel shading)
    buf.rect(x - 2, y - 9, 5, 5, shirt);
    buf.vline(x + (s.facing > 0 ? -2 : 2), y - 9, y - 5, shirtDk);
    buf.hline(x - 1, x + 1, y - 9, shirtHi);
    buf.vline(x, y - 8, y - 5, shirtDk); // jacket zip line

    // Cozy scarf in First Snowfall
    if (s.scarf) {
      buf.hline(x - 2, x + 2, y - 9, [226, 182, 88]);
      buf.rect(x - s.facing * 2, y - 8, 2, 2, [202, 146, 62]);
    }

    // Head (4x4 with hair, eyes & crisp silhouette)
    buf.rect(x - 2, y - 13, 4, 4, skin);
    buf.hline(x - 2, x + 1, y - 13, s.scarf ? [184, 72, 74] : hair);
    buf.hline(x - 1, x + 1, y - 14, s.scarf ? [208, 92, 88] : hair);
    buf.vline(x + (s.facing > 0 ? -2 : 1), y - 13, y - 11, hair);
    // Crisp eye pixel looking along aim direction
    buf.setPx(x + (s.facing > 0 ? 1 : -1), y - 11, atmo.ink);

    // Aimed Arm + Steel Pistol!
    const shX = x + s.facing;
    const shY = y - 7;
    if (s.reloading > 0) {
      // Tilted pistol down during brief reload
      buf.line(shX, shY, shX + s.facing * 2, shY + 2, shirtDk);
      buf.line(shX + s.facing * 2, shY + 2, shX + s.facing * 3, shY + 3, gunMetal);
    } else {
      const kick = s.recoil * 1.8;
      const ax = s.aimDx;
      const ay = s.aimDy;
      const handX = Math.round(shX + ax * (3.6 - kick * 0.5));
      const handY = Math.round(shY + ay * (2.6 - kick * 0.4));
      const tipX = Math.round(handX + ax * 3.8);
      const tipY = Math.round(handY + ay * 2.6);

      // Extended shooting arm
      buf.line(shX, shY, handX, handY, shirt);
      buf.setPx(handX, handY, skin);
      // Pistol grip & metallic barrel slide
      buf.setPx(handX, handY + 1, gunMetal);
      buf.line(handX, handY, tipX, tipY, gunMetal);
      buf.line(handX, handY - 1, tipX, tipY - 1, gunSlide, 0.85);
    }

    // Crisp incandescent muzzle flash + dynamic Bayer-dithered flash illumination!
    if (s.muzzleFlash > 0) {
      const fx = Math.round(s.muzzleX);
      const fy = Math.round(s.muzzleY);
      const intensity = clamp(s.muzzleFlash / 0.11, 0, 1);
      // Warm flash glow illuminating nearby rooftop tiles, puddles, and survivor!
      buf.ditherGlow(fx, fy, 18, 14, [255, 198, 92], 0.55 * intensity, true);
      // Crisp 5-point pixel starburst flash
      buf.rect(fx - 1, fy - 1, 3, 3, [255, 252, 232]);
      buf.setPx(fx - 2, fy, [255, 206, 78]);
      buf.setPx(fx + 2, fy, [255, 206, 78]);
      buf.setPx(fx, fy - 2, [255, 206, 78]);
      buf.setPx(fx, fy + 2, [255, 152, 54]);
      buf.setPx(Math.round(fx + s.aimDx * 3), Math.round(fy + s.aimDy * 2), [255, 240, 168]);
    }

    if (s.emote && s.emoteTimer > 0) {
      drawEmote(buf, x, y - 16, s.emote, clamp(s.emoteTimer * 1.4, 0, 1));
    }

    if (hitList) {
      hitList.push({
        type: 'resident',
        id: s.id,
        label: 'Survivor (fending off zombies)',
        x0: x - 6,
        y0: y - 15,
        x1: x + 6,
        y1: y + 2,
        cx: x,
        cy: y - 7,
      });
    }
  }

  /**
   * Draws a crisp 7x13 shambling pixel zombie (standing, climbing parapet, or defeated on tiles!).
   */
  function drawZombie(buf, z, state, atmo, hitList) {
    const sp = project(z.u, z.v, BUILDING.Z_ROOF + z.z);
    const x = Math.round(sp[0]);
    const y = Math.round(sp[1]);

    // Defeated zombie lying flat on rooftop tiles (dither-fades cleanly before vanishing)
    if (z.state === 'down' || z.state === 'falling') {
      const fade = z.state === 'down' ? clamp(z.downTimer / 0.8, 0, 1) : 1.0;
      const dir = z.fallDir;
      const skin = atmo.applyLight(z.style.skin);
      const shirt = atmo.applyLight(z.style.shirt);
      const pants = atmo.applyLight(z.style.pants);

      // Horizontal 10x4 defeated pixel silhouette
      const drawPx = (px, py, col) => {
        if (fade >= 0.99 || fade > bayer4(px, py)) buf.setPx(px, py, col);
      };
      for (let ox = -4; ox <= 5; ox++) {
        const px = x + ox * dir;
        const c = ox < -1 ? pants : ox < 3 ? shirt : skin;
        drawPx(px, y, c);
        if (ox >= -2 && ox <= 4) drawPx(px, y - 1, ox >= 3 ? skin : mulRGB(c, 0.82));
      }
      return;
    }

    const lurch = z.climbing ? 0 : Math.round(Math.abs(Math.sin(z.walkPhase)) * -1.4);
    const sway = z.climbing ? 0 : Math.round(Math.sin(z.walkPhase * 0.5) * 0.8);
    const zx = x + sway;
    const zy = y + lurch;

    const flash = z.hitFlash > 0;
    const tint = (rgb) => (flash ? [255, 255, 255] : atmo.applyLight(rgb));

    const skin = tint(z.style.skin);
    const skinDk = tint(z.style.skinDk);
    const shirt = tint(z.style.shirt);
    const shirtDk = flash ? [240, 240, 240] : mulRGB(shirt, 0.72);
    const pants = tint(z.style.pants);
    const hair = tint(z.style.hair);

    // Ground contact shadow (only once on roof)
    if (!z.climbing) {
      buf.hline(x - 3, x + 3, y + 1, atmo.ink, 0.34);
    }

    // Shambling uneven legs
    const stride = z.climbing ? 0 : Math.round(Math.sin(z.walkPhase) * 1.5);
    const lx = zx - 1 + stride;
    const rx = zx + 1 - stride;
    buf.vline(lx, zy - 4, zy, pants);
    buf.vline(rx, zy - 4, zy, mulRGB(pants, 0.82));

    // Hunched tattered torso (5x5, slightly jagged bottom hem!)
    buf.rect(zx - 2, zy - 9, 5, 5, shirt);
    buf.vline(zx + (z.facing > 0 ? -2 : 2), zy - 9, zy - 5, shirtDk);
    // Tattered hem notch
    buf.setPx(zx, zy - 5, pants);
    if (z.style.tie && !flash) {
      buf.vline(zx + (z.facing > 0 ? 1 : -1), zy - 8, zy - 6, atmo.applyLight(z.style.tie));
    }

    // Hunched forward head (leaned 1px toward survivor!)
    const hx = zx + (z.facing > 0 ? 1 : -1);
    buf.rect(hx - 2, zy - 13, 4, 4, skin);
    buf.vline(hx - (z.facing > 0 ? 2 : -1), zy - 12, zy - 10, skinDk);
    // Sparse messy hair
    buf.hline(hx - 2, hx + 1, zy - 13, hair);
    // Dark hollow zombie eye socket!
    buf.setPx(hx + (z.facing > 0 ? 1 : -2), zy - 11, flash ? [220, 220, 220] : atmo.ink);

    // Outstretched grasping zombie arms reaching toward the survivor!
    const armReachX = z.climbing ? z.facing * 2 : Math.round(z.aimDx * 4.5);
    const armReachY = z.climbing ? -3 : Math.round(z.aimDy * 2.5);
    const armBob = Math.round(Math.sin(z.walkPhase * 1.4));

    // Back arm
    buf.line(zx, zy - 8, zx + armReachX, zy - 8 + armReachY + armBob, shirtDk);
    buf.setPx(zx + armReachX, zy - 8 + armReachY + armBob, skinDk);
    // Front reaching arm
    buf.line(zx + z.facing, zy - 7, zx + z.facing + armReachX, zy - 7 + armReachY - armBob, shirt);
    buf.setPx(zx + z.facing + armReachX, zy - 7 + armReachY - armBob, skin);
    buf.setPx(zx + z.facing + armReachX + z.facing, zy - 7 + armReachY - armBob, skin);

    // Subtle crisp HP pips only when damaged (so you see they took hits!)
    if (z.hp < z.maxHp) {
      for (let h = 0; h < z.maxHp; h++) {
        const col = h < z.hp ? [154, 212, 118] : [64, 52, 56];
        buf.setPx(zx - 1 + h * 2, zy - 15, col);
      }
    }

    if (hitList) {
      hitList.push({
        type: 'zombie',
        id: z.id,
        label: 'Shoot zombie!',
        x0: zx - 6,
        y0: zy - 15,
        x1: zx + 6,
        y1: zy + 2,
        cx: zx,
        cy: zy - 7,
      });
    }
  }

  /**
   * Collects depth-sorted survivor, zombies, cat, and pigeons to sort cleanly with rooftop props.
   */
  function collectEntityItems(buf, entities, state, atmo, hitList) {
    const items = [];
    const Z = BUILDING.Z_ROOF;

    // ── Floor scuff decals (drawn under characters) ─────────────────
    if (entities.decals.length > 0) {
      items.push({
        depth: -10,
        draw() {
          for (let i = 0; i < entities.decals.length; i++) {
            const dc = entities.decals[i];
            const sp = project(dc.u, dc.v, Z);
            const a = clamp(1 - dc.age / dc.maxAge, 0, 1) * 0.42;
            const col = [64, 82, 54];
            buf.blendPx(sp[0], sp[1], col, a);
            buf.blendPx(sp[0] + 1, sp[1], col, a * 0.8);
            buf.blendPx(sp[0] - 1, sp[1] + 1, col, a * 0.6);
          }
        },
      });
    }

    // ── Hero Survivor with Pistol ───────────────────────────────────
    const s = entities.survivor;
    items.push({
      depth: s.u + s.v + 0.25,
      draw() {
        drawSurvivor(buf, s, state, atmo, hitList);
      },
    });

    // ── Pixel Zombies ───────────────────────────────────────────────
    for (let i = 0; i < entities.zombies.length; i++) {
      const z = entities.zombies[i];
      items.push({
        depth: z.u + z.v + (z.state === 'down' ? -0.4 : 0.2),
        draw() {
          drawZombie(buf, z, state, atmo, hitList);
        },
      });
    }

    // ── Rooftop Cat (higher-res 8x6 tabby watching from safe perch!) ─
    const cat = entities.cat;
    items.push({
      depth: cat.u + cat.v + (cat.z > Z ? 2.8 : 0.1),
      draw() {
        const sp = project(cat.u, cat.v, cat.z);
        const hopY = Math.round(Math.sin(cat.hop * Math.PI) * -5.0);
        const x = Math.round(sp[0]);
        const y = Math.round(sp[1]) + hopY;
        const fur = atmo.applyLight([226, 152, 78]);
        const stripe = atmo.applyLight([176, 106, 48]);
        const ear = atmo.applyLight([244, 196, 152]);

        buf.hline(x - 3, x + 3, Math.round(sp[1]) + 1, atmo.ink, 0.28);

        if (cat.sleeping) {
          buf.rect(x - 3, y - 2, 6, 3, fur);
          buf.hline(x - 2, x + 2, y - 3, fur);
          buf.setPx(x - 1, y - 2, stripe);
          buf.setPx(x + 1, y - 2, stripe);
          const flick = Math.sin(state.time * 2.2) > 0.65 ? -1 : 0;
          buf.hline(x + 3, x + 4, y - 1 + flick, stripe);
        } else {
          // Body
          buf.rect(x - 2, y - 3, 5, 2, fur);
          buf.setPx(x, y - 3, stripe);
          buf.setPx(x - 2, y - 1, stripe);
          buf.setPx(x + 2, y - 1, stripe);
          // Head & pointed ears
          const hx = x + cat.facing * 3;
          buf.rect(hx - (cat.facing < 0 ? 1 : 0), y - 5, 3, 3, fur);
          buf.setPx(hx, y - 6, ear);
          buf.setPx(hx + (cat.facing > 0 ? 2 : -1), y - 6, ear);
          buf.setPx(hx + (cat.facing > 0 ? 2 : -1), y - 4, atmo.ink); // eye
          // Animated swishing tail
          const swish = Math.round(Math.sin(state.time * 4.5));
          buf.setPx(x - cat.facing * 3, y - 3, fur);
          buf.setPx(x - cat.facing * 3 + swish, y - 4, stripe);
          buf.setPx(x - cat.facing * 3 + swish, y - 5, fur);
        }

        if (cat.emote && cat.emoteTimer > 0) {
          drawEmote(buf, x, y - 8, cat.emote, clamp(cat.emoteTimer * 1.4, 0, 1));
        }

        if (hitList) {
          hitList.push({
            type: 'cat',
            label: 'Pet rooftop cat',
            x0: x - 6,
            y0: y - 7,
            x1: x + 6,
            y1: y + 2,
            cx: x,
            cy: y - 2,
          });
        }
      },
    });

    // ── Pigeons (Morning Laundry) ───────────────────────────────────
    if (state.env.pigeonsActive > 0.2) {
      for (let i = 0; i < entities.pigeons.length; i++) {
        const p = entities.pigeons[i];
        items.push({
          depth: p.u + p.v + p.z * 0.2,
          draw() {
            const sp = project(p.u, p.v, Z + p.z);
            const x = Math.round(sp[0]);
            const y = Math.round(sp[1]);
            const body = atmo.applyLight([192, 200, 212]);
            const wing = atmo.applyLight([124, 134, 148]);
            const neck = atmo.applyLight([118, 152, 142]);

            const sh = project(p.u, p.v, Z);
            buf.hline(Math.round(sh[0]) - 2, Math.round(sh[0]) + 2, Math.round(sh[1]) + 1, atmo.ink, 0.24);

            if (p.flying) {
              const flap = Math.sin(state.time * 24 + p.seed) > 0 ? -3 : 2;
              buf.hline(x - 2, x + 2, y, body);
              buf.line(x - 1, y, x - 3, y + flap, wing);
              buf.line(x + 1, y, x + 3, y + flap, wing);
            } else {
              const headDrop = p.peck > 0.78 ? 1 : 0;
              buf.rect(x - 2, y - 2, 4, 2, body);
              buf.hline(x - 1, x + 1, y - 1, wing);
              buf.rect(x + p.facing, y - 4 + headDrop, 2, 2, neck);
              buf.setPx(x + p.facing * 3, y - 3 + headDrop, [224, 162, 86]);
            }

            if (hitList) {
              hitList.push({
                type: 'pigeon',
                label: 'Startle pigeons',
                x0: x - 5,
                y0: y - 5,
                x1: x + 5,
                y1: y + 2,
                cx: x,
                cy: y - 2,
              });
            }
          },
        });
      }
    }

    return items;
  }

  /**
   * Draws foreground combat FX (bullet tracers, brass shell casings), aerial wildlife & particles.
   */
  function drawForegroundEntities(buf, entities, state, atmo) {
    const env = state.env;
    const t = state.time;

    // 1. High-speed glowing pixel bullet tracers
    for (let i = 0; i < entities.bullets.length; i++) {
      const b = entities.bullets[i];
      const tailT = Math.max(0, b.t - 0.55);
      const tx = lerp(b.x0, b.tx, tailT);
      const ty = lerp(b.y0, b.ty, tailT);
      buf.line(tx, ty, b.x, b.y, [255, 204, 88], 0.85);
      buf.setPx(Math.round(b.x), Math.round(b.y), [255, 255, 236]);
      buf.blendPx(Math.round(b.x) + 1, Math.round(b.y), [255, 232, 148], 0.65);
    }

    // 2. Bouncing golden brass shell casings
    for (let i = 0; i < entities.casings.length; i++) {
      const c = entities.casings[i];
      const a = clamp(1 - c.age / c.maxAge, 0, 1);
      buf.blendPx(c.x, c.y, [246, 206, 86], a);
      buf.blendPx(c.x + 1, c.y, [196, 152, 54], a * 0.8);
    }

    // 3. Swallows gliding in Golden Hour
    if (env.swallowsActive > 0.2) {
      const col = atmo.applyLight([62, 54, 72]);
      for (let i = 0; i < entities.swallows.length; i++) {
        const sw = entities.swallows[i];
        const a = t * sw.speed + sw.phase;
        const x = Math.round(175 + Math.cos(a) * sw.radX);
        const y = Math.round(sw.baseY + Math.sin(a * 2) * sw.radY * 0.5);
        const flap = Math.sin(t * 11 + sw.phase) > 0 ? -1 : 1;
        buf.hline(x - 1, x + 1, y, col);
        buf.setPx(x - 2, y + flap, col);
        buf.setPx(x + 2, y + flap, col);
        buf.setPx(x - 3, y + flap * 2, col);
        buf.setPx(x + 3, y + flap * 2, col);
      }
    }

    // 4. Fireflies / Lantern Moths (Night & Rooftop Cinema)
    const ffStrength = clamp(Math.max(env.firefliesActive, atmo.night * 0.8), 0, 1);
    if (ffStrength > 0.15) {
      for (let i = 0; i < entities.fireflies.length; i++) {
        const ff = entities.fireflies[i];
        const u = ff.u + Math.sin(t * ff.speed + ff.phase) * 2.5;
        const v = ff.v + Math.cos(t * ff.speed * 0.8 + ff.phase) * 2.0;
        const z = BUILDING.Z_ROOF + ff.z + Math.sin(t * 1.8 + ff.phase) * 1.5;
        const sp = project(u, v, z);
        const pulse = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.6 + ff.phase * 2), 2);
        const alpha = pulse * ffStrength;
        if (alpha > 0.15) {
          buf.ditherGlow(sp[0], sp[1], 4, 4, [255, 236, 134], alpha * 0.52, true);
          buf.blendPx(sp[0], sp[1], [255, 248, 190], alpha);
        }
      }
    }

    // 5. Ambient & Combat Particles (gunsmoke, sparks, grill smoke, leaves, splashes)
    for (let i = 0; i < entities.particles.length; i++) {
      const pt = entities.particles[i];
      const life = 1 - pt.age / pt.maxAge;
      const a = pt.alpha * life;
      if (pt.dither) {
        const rad = pt.size + (1 - life) * 2.0;
        buf.ditherGlow(pt.x, pt.y, rad, rad, pt.color, a * 0.9, false);
      } else {
        buf.blendPx(pt.x, pt.y, pt.color, a);
        if (pt.size > 1) {
          buf.blendPx(pt.x + 1, pt.y, pt.color, a * 0.75);
        }
      }
    }
  }

  Diorama.Entities = {
    createEntities,
    applyScenarioRoles,
    spawnZombieWave,
    firePistolAt,
    spawnParticle,
    startlePigeons,
    updateEntities,
    collectEntityItems,
    drawForegroundEntities,
  };
})(window);
