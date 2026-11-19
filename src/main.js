(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { computeAtmosphere, clamp } = Diorama.Palette;
  const { PixelBuffer } = Diorama;
  const { CANVAS_W, CANVAS_H, BUILDING, project, unproject } = Diorama.Iso;
  const { LIST, DEFAULT_INDEX, TOUR_DURATION, cloneEnv, stepEnvTowards } = Diorama.Scenarios;
  const Arch = Diorama.Architecture;
  const Ent = Diorama.Entities;
  const Weath = Diorama.Weather;
  const { Soundscape } = Diorama;
  const { createUI } = Diorama.UI;

  const CINEMA_TITLES = [
    'Cosmic Rocket',
    'Moonlit Ocean',
    'Sunset Express',
    'Arcade Cat',
  ];

  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / (yj - yi + 0.00001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function boot() {
    const canvas = document.getElementById('diorama-canvas');
    const viewport = document.getElementById('diorama-viewport');
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;

    const buf = new PixelBuffer(CANVAS_W, CANVAS_H);
    const audio = new Soundscape();
    const entities = Ent.createEntities();
    const weather = Weath.createWeather();

    const initialScenario = LIST[DEFAULT_INDEX];
    const state = {
      mode: 'story', // 'story' | 'sandbox'
      scenarioIndex: DEFAULT_INDEX,
      scenario: initialScenario,
      env: cloneEnv(initialScenario.env),
      hours: initialScenario.defaultHour,
      time: 0,
      paused: false,
      tourMode: true,
      tourElapsed: 0,
      audioEnabled: false,
      atmo: null,
      // Interactive transient states
      windowOverrides: {},
      doorOpen: false,
      treeShake: 0,
      clothesGust: 0,
      tarpShake: 0,
      grillStoke: 0,
      snowmanBounce: 0,
      turbineAngle: 0,
      turbineBoost: 0,
      cinemaChannel: 0,
      ripples: [],
      hitList: [],
    };

    Ent.applyScenarioRoles(entities, initialScenario.id);

    // ── Responsive Full-Size Pixel Scaling + Optional Mouse Wheel Zoom ──
    let userZoom = 1.0;

    function resizeCanvas() {
      const vw = Math.max(260, viewport.clientWidth - 8);
      const vh = Math.max(200, viewport.clientHeight - 4);
      const fitScale = Math.min(vw / CANVAS_W, vh / CANVAS_H);
      const scale = Math.min(6, Math.max(1, fitScale * userZoom));
      const cssW = Math.round(CANVAS_W * scale);
      const cssH = Math.round(CANVAS_H * scale);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      // Backing store at real device resolution, so the browser never re-scales it
      const dpr = global.devicePixelRatio || 1;
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
    }

    // ── Crisp presentation ──────────────────────────────────────────
    // Nearest-neighbour scaling by a non-integer factor makes some pixels wider
    // than others ("wobbly" pixels). Instead: blow the frame up by an exact integer
    // factor first, then fit it to the screen with a light bilinear pass, so every
    // virtual pixel ends up as the same size square with only a soft 1px edge.
    const offCanvas = document.createElement('canvas');
    offCanvas.width = CANVAS_W;
    offCanvas.height = CANVAS_H;
    const offCtx = offCanvas.getContext('2d');
    const upCanvas = document.createElement('canvas');
    const upCtx = upCanvas.getContext('2d');

    function presentView(sx, sy, sw, sh) {
      offCtx.putImageData(buf.imageData, 0, 0);
      const need = canvas.width / sw;
      const k = Math.max(1, Math.min(8, Math.ceil(need - 0.001)));
      if (upCanvas.width !== CANVAS_W * k) {
        upCanvas.width = CANVAS_W * k;
        upCanvas.height = CANVAS_H * k;
      }
      upCtx.imageSmoothingEnabled = false;
      upCtx.drawImage(offCanvas, 0, 0, CANVAS_W * k, CANVAS_H * k);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(upCanvas, sx * k, sy * k, sw * k, sh * k, 0, 0, canvas.width, canvas.height);
    }

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      userZoom = clamp(userZoom * factor, 0.75, 2.4);
      resizeCanvas();
    }, { passive: false });

    global.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    requestAnimationFrame(resizeCanvas);

    // ── Controller API shared with UI ───────────────────────────────
    const controller = {
      selectScenario(idx, userTriggered) {
        if (state.mode !== 'sandbox' && userTriggered) return;
        const nextIdx = ((idx % LIST.length) + LIST.length) % LIST.length;
        state.scenarioIndex = nextIdx;
        state.scenario = LIST[nextIdx];
        state.hours = state.scenario.defaultHour;
        state.tourElapsed = 0;
        state.windowOverrides = {};
        state.doorOpen = state.scenario.id === 'snowfall';
        Ent.applyScenarioRoles(entities, state.scenario.id);
        if (userTriggered) {
          audio.playInteract('window');
        }
      },
      togglePlay() {
        if (state.mode === 'story') {
          if (!started) return;
          // During gameplay Space is the melee key; pause is Esc
          if (story.playable && !story.paused) return;
          story.togglePause();
          return;
        }
        state.paused = !state.paused;
      },
      toggleTourMode() {
        state.tourMode = !state.tourMode;
        state.tourElapsed = 0;
        ui.showToast(state.tourMode ? 'Auto-tour: 5×10s' : 'Single scenario loop');
      },
      toggleAudio() {
        setAudio(!state.audioEnabled);
        ui.showToast(state.audioEnabled ? (state.mode === 'story' ? 'Звук включён' : 'Ambient audio on') : (state.mode === 'story' ? 'Звук выключен' : 'Audio muted'));
      },
      setTimeOfDay(hours) {
        if (state.mode !== 'sandbox') return;
        state.hours = ((hours % 24) + 24) % 24;
      },
      nudgeTime(deltaHours) {
        if (state.mode !== 'sandbox') return;
        state.hours = ((state.hours + deltaHours) % 24 + 24) % 24;
      },
      spawnWave() {
        if (state.mode !== 'sandbox') return;
        Ent.spawnZombieWave(entities, 3);
        ui.showToast('Zombie wave incoming!');
        audio.playInteract('door');
      },
    };

    const ui = createUI(controller);

    // ── Story mode ──────────────────────────────────────────────────
    let started = false;
    const story = new Diorama.Story({
      audio,
      onTheme(atmo) {
        document.documentElement.style.setProperty('--bg', atmo.bgHex);
        document.body.dataset.theme = atmo.isDarkTheme ? 'dark' : 'light';
      },
    });
    story.start(0, false);

    const audioBtns = Array.from(document.querySelectorAll('.btn-audio'));
    function setAudio(on) {
      state.audioEnabled = !!on;
      audio.setEnabled(state.audioEnabled);
      audioBtns.forEach((b) => b.setAttribute('aria-pressed', state.audioEnabled ? 'true' : 'false'));
    }

    function setMode(mode) {
      state.mode = mode;
      document.body.classList.toggle('mode-story', mode === 'story');
      document.body.classList.toggle('mode-sandbox', mode === 'sandbox');
      if (mode === 'sandbox') {
        story.paused = true;
        story.fade(0, 0);
        story.hideCard(true);
        story.hideEnd();
        controller.selectScenario(state.scenarioIndex, false);
        state.env = cloneEnv(state.scenario.env);
      }
      if (mode === 'story') {
        if (!story.finished && started) story.paused = false;
      }
      hideStartScreen();
    }

    const startScreen = document.getElementById('start-screen');
    function hideStartScreen() {
      if (startScreen) startScreen.classList.add('hidden');
    }

    function beginStory(withSound) {
      started = true;
      story.started = true;
      hideStartScreen();
      if (withSound) setAudio(true);
      setMode('story');
      story.start(0, true);
    }

    const byId = (id) => document.getElementById(id);
    byId('btn-start').addEventListener('click', () => beginStory(true));
    byId('btn-start-muted').addEventListener('click', () => beginStory(false));
    byId('btn-start-sandbox').addEventListener('click', () => setMode('sandbox'));
    byId('btn-to-story').addEventListener('click', () => {
      setMode('story');
      if (!started) beginStory(state.audioEnabled);
    });
    byId('btn-end-replay').addEventListener('click', () => story.restart());
    byId('btn-end-sandbox').addEventListener('click', () => setMode('sandbox'));

    byId('btn-pause-resume').addEventListener('click', () => story.togglePause());
    byId('btn-pause-restart').addEventListener('click', () => story.restart());
    byId('btn-pause-sandbox').addEventListener('click', () => {
      story.showPause(false);
      setMode('sandbox');
    });

    // ── Player input (story gameplay) ─────────────────────────────
    // e.code is layout-independent, so WASD also works on a Russian keyboard
    const MOVE_KEYS = {
      KeyW: 'w', ArrowUp: 'w',
      KeyA: 'a', ArrowLeft: 'a',
      KeyS: 's', ArrowDown: 's',
      KeyD: 'd', ArrowRight: 'd',
    };
    const input = story.input;

    document.addEventListener('keydown', (e) => {
      if (state.mode !== 'story' || !started) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        story.togglePause();
        e.preventDefault();
        return;
      }
      if (!story.playable || story.paused) return;
      const mk = MOVE_KEYS[e.code];
      if (mk) {
        input.keys[mk] = true;
        e.preventDefault();
      } else if (e.code === 'Space' || e.code === 'KeyF' || e.code === 'KeyE') {
        if (!e.repeat) input.melee++;
        e.preventDefault();
      } else if (e.code === 'KeyR') {
        input.reload++;
      }
    });
    document.addEventListener('keyup', (e) => {
      const mk = MOVE_KEYS[e.code];
      if (mk) input.keys[mk] = false;
    });
    global.addEventListener('blur', () => {
      input.keys = {};
      story.input.keys = input.keys;
    });

    function trackPointer(e) {
      const r = canvas.getBoundingClientRect();
      input.fx = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      input.fy = clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1);
    }
    global.addEventListener('pointermove', (e) => {
      if (state.mode === 'story') trackPointer(e);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (state.mode !== 'story' || !story.playable || story.paused) return;
      trackPointer(e);
      if (e.button === 0) input.fire++;
      else if (e.button === 2) input.melee++;
      e.preventDefault();
    });
    canvas.addEventListener('contextmenu', (e) => {
      if (state.mode === 'story') e.preventDefault();
    });

    // ── Pointer Mapping & Hit Testing ───────────────────────────────
    function clientToVirtual(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return [
        ((clientX - rect.left) / Math.max(1, rect.width)) * CANVAS_W,
        ((clientY - rect.top) / Math.max(1, rect.height)) * CANVAS_H,
      ];
    }

    function pickHit(vx, vy) {
      // Iterate in reverse render order so foreground objects win over background floor/sky
      for (let i = state.hitList.length - 1; i >= 0; i--) {
        const h = state.hitList[i];
        if (vx < h.x0 || vx > h.x1 || vy < h.y0 || vy > h.y1) continue;
        if (h.poly && !pointInPoly(vx, vy, h.poly)) continue;
        return h;
      }
      return null;
    }

    canvas.addEventListener('pointermove', (e) => {
      if (state.mode !== 'sandbox') return;
      const [vx, vy] = clientToVirtual(e.clientX, e.clientY);
      const hit = pickHit(vx, vy);
      canvas.classList.toggle('interactive-hover', !!hit);
    });

    canvas.addEventListener('pointerleave', () => {
      canvas.classList.remove('interactive-hover');
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (state.mode !== 'sandbox') return;
      const [vx, vy] = clientToVirtual(e.clientX, e.clientY);
      const hit = pickHit(vx, vy);
      if (!hit) return;

      handleInteraction(hit, vx, vy);
    });

    function handleInteraction(hit, vx, vy) {
      const atmo = state.atmo;
      if (hit.type !== 'zombie') audio.playInteract(hit.type);

      if (hit.type === 'zombie') {
        const zmb = entities.zombies.find((z) => z.id === hit.id);
        if (zmb && zmb.state === 'alive') {
          entities.survivor.reloading = 0;
          if (entities.survivor.ammo <= 0) entities.survivor.ammo = entities.survivor.maxAmmo;
          Ent.firePistolAt(entities, zmb, state, audio, true);
          ui.showToast('Direct hit!');
        }
      } else if (hit.type === 'window') {
        const cur = state.windowOverrides[hit.id] !== undefined
          ? state.windowOverrides[hit.id]
          : (atmo.night > 0.25 || (state.scenario.windowPreset[hit.id] === 1 && (atmo.storm > 0.5 || atmo.snow > 0.5)));
        const next = !cur;
        state.windowOverrides[hit.id] = next;
        ui.showToast(next ? 'Apartment light on' : 'Apartment light off');
      } else if (hit.type === 'door') {
        state.doorOpen = !state.doorOpen;
        if (state.doorOpen) {
          Ent.spawnZombieWave(entities, 1, 'door');
          ui.showToast('Stairwell breached — zombie emerging!');
        } else {
          ui.showToast('Stairwell door barricaded');
        }
      } else if (hit.type === 'tree') {
        state.treeShake = 1.0;
        const burstCol = state.env.snowLevel > 0.4
          ? [244, 249, 255]
          : state.env.rainIntensity > 0.4
            ? [154, 198, 232]
            : state.scenario.id === 'morning'
              ? [246, 206, 214]
              : [122, 168, 92];
        for (let k = 0; k < 12; k++) {
          Ent.spawnParticle(entities, {
            x: hit.cx + (Math.random() - 0.5) * 14,
            y: hit.cy + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.4) * 20,
            vy: -8 + Math.random() * 12,
            gravity: 28,
            maxAge: 0.75 + Math.random() * 0.45,
            color: burstCol,
          });
        }
        if (state.env.pigeonsActive > 0.4) Ent.startlePigeons(entities);
        ui.showToast(state.env.snowLevel > 0.4 ? 'Snow dusted off branches' : 'Shook the rooftop tree');
      } else if (hit.type === 'clothesline') {
        state.clothesGust = 1.0;
        if (state.env.rainIntensity > 0.3) {
          for (let k = 0; k < 10; k++) {
            Ent.spawnParticle(entities, {
              x: hit.x0 + Math.random() * (hit.x1 - hit.x0),
              y: hit.cy + 2,
              vx: 6 + Math.random() * 10,
              vy: 4 + Math.random() * 8,
              gravity: 48,
              maxAge: 0.45,
              color: [176, 208, 236],
            });
          }
        }
        ui.showToast('Gust along the clothesline');
      } else if (hit.type === 'turbine') {
        state.turbineBoost = 24;
        ui.showToast('Roof vent spinning faster');
      } else if (hit.type === 'grill') {
        state.grillStoke = 1.0;
        for (let k = 0; k < 10; k++) {
          Ent.spawnParticle(entities, {
            x: hit.cx + (Math.random() - 0.5) * 6,
            y: hit.cy - 2,
            vx: (Math.random() - 0.3) * 16,
            vy: -16 - Math.random() * 14,
            gravity: 8,
            maxAge: 0.7 + Math.random() * 0.4,
            color: k % 2 === 0 ? [255, 196, 84] : [255, 118, 52],
          });
        }
        ui.showToast('Stoked the charcoal grill');
      } else if (hit.type === 'tarp') {
        state.tarpShake = 1.0;
        const dropCol = state.env.snowLevel > 0.35 ? [244, 249, 255] : [172, 206, 236];
        for (let k = 0; k < 12; k++) {
          Ent.spawnParticle(entities, {
            x: hit.cx + (Math.random() - 0.5) * 18,
            y: hit.cy,
            vx: (Math.random() - 0.5) * 24,
            vy: -14 - Math.random() * 12,
            gravity: 52,
            maxAge: 0.55,
            color: dropCol,
          });
        }
        ui.showToast(state.env.snowLevel > 0.35 ? 'Brushed snow off tarps' : 'Shook rain off tarps');
      } else if (hit.type === 'cinema') {
        state.cinemaChannel = (state.cinemaChannel + 1) % CINEMA_TITLES.length;
        ui.showToast('Now showing: ' + CINEMA_TITLES[state.cinemaChannel]);
      } else if (hit.type === 'snowman') {
        state.snowmanBounce = 1.0;
        for (let k = 0; k < 10; k++) {
          Ent.spawnParticle(entities, {
            x: hit.cx + (Math.random() - 0.5) * 8,
            y: hit.cy,
            vx: (Math.random() - 0.5) * 22,
            vy: -14 - Math.random() * 10,
            gravity: 34,
            maxAge: 0.65,
            color: [244, 249, 255],
          });
        }
        ui.showToast('Snowman wiggled!');
      } else if (hit.type === 'resident') {
        const s = entities.survivor;
        s.hop = 1.0;
        s.ammo = s.maxAmmo;
        s.reloading = 0;
        s.emote = 'exclaim';
        s.emoteTimer = 1.2;
        ui.showToast(`Reloaded! (${s.kills} zombies fended off)`);
      } else if (hit.type === 'cat') {
        entities.cat.hop = 1.0;
        entities.cat.sleeping = false;
        entities.cat.emote = 'heart';
        entities.cat.emoteTimer = 2.0;
        ui.showToast('Rooftop cat purrs');
      } else if (hit.type === 'pigeon') {
        Ent.startlePigeons(entities);
        ui.showToast('Pigeons take flight!');
      } else if (hit.type === 'sky') {
        if (state.env.rainIntensity > 0.3 || state.env.storminess > 0.45) {
          Weath.triggerLightning(weather, audio);
          ui.showToast('Lightning strike!');
        } else if (atmo.night > 0.35) {
          Weath.spawnShootingStar(weather, vx, vy);
          ui.showToast('Shooting star!');
        } else if (state.env.snowIntensity > 0.3) {
          for (let k = 0; k < 18; k++) {
            Ent.spawnParticle(entities, {
              x: vx + (Math.random() - 0.5) * 32,
              y: vy + (Math.random() - 0.5) * 16,
              vx: (Math.random() - 0.3) * 16,
              vy: 14 + Math.random() * 14,
              maxAge: 1.4,
              color: [255, 255, 255],
            });
          }
          ui.showToast('Fresh snow flurry');
        } else {
          state.clothesGust = 1.0;
          state.turbineBoost = 16;
          ui.showToast('Breeze across the roof');
        }
      } else if (hit.type === 'roof') {
        const [u, v] = unproject(vx, vy, BUILDING.Z_ROOF);
        const cu = clamp(u, 4, BUILDING.U - 4);
        const cv = clamp(v, 4, BUILDING.V - 4);
        const sp = project(cu, cv, BUILDING.Z_ROOF);

        if (state.env.rainIntensity > 0.25 || state.env.puddleLevel > 0.25) {
          state.ripples.push({ u: cu, v: cv, age: 0, maxAge: 0.72, maxR: 4.5 });
          for (let k = 0; k < 7; k++) {
            Ent.spawnParticle(entities, {
              x: sp[0],
              y: sp[1],
              vx: (Math.random() - 0.5) * 20,
              vy: -10 - Math.random() * 10,
              gravity: 48,
              maxAge: 0.4,
              color: [224, 240, 255],
            });
          }
        } else if (state.env.snowLevel > 0.35) {
          for (let k = 0; k < 9; k++) {
            Ent.spawnParticle(entities, {
              x: sp[0],
              y: sp[1],
              vx: (Math.random() - 0.5) * 18,
              vy: -10 - Math.random() * 8,
              gravity: 34,
              maxAge: 0.5,
              color: [244, 249, 255],
            });
          }
        } else {
          state.ripples.push({
            u: cu,
            v: cv,
            age: 0,
            maxAge: 0.5,
            maxR: 3.2,
            color: atmo.isDarkTheme ? [255, 232, 164] : [255, 255, 255],
          });
        }

        // Direct survivor to reposition tactically to the clicked rooftop tile
        const s = entities.survivor;
        s.targetU = clamp(cu, 11, 35);
        s.targetV = clamp(cv, 10, 20);
        s.manualTarget = true;
      }
    }

    // ── Simulation Step & Full Pixel Frame Render ───────────────────
    function step(dt) {
      // Smoothly blend environment parameters toward active scenario
      stepEnvTowards(state.env, state.scenario.env, Math.min(1, dt * 3.4));

      if (!state.paused) {
        state.time += dt;
        state.hours = (state.hours + state.scenario.timeSpeed * dt) % 24;

        // 5x10s Auto-Tour progression
        if (state.tourMode) {
          state.tourElapsed += dt;
          if (state.tourElapsed >= TOUR_DURATION) {
            controller.selectScenario(state.scenarioIndex + 1, false);
          }
        }
      }

      // Decay interactive spring states
      state.treeShake = Math.max(0, state.treeShake - dt * 2.2);
      state.clothesGust = Math.max(0, state.clothesGust - dt * 1.4);
      state.tarpShake = Math.max(0, state.tarpShake - dt * 2.2);
      state.grillStoke = Math.max(0, state.grillStoke - dt * 1.2);
      state.snowmanBounce = Math.max(0, state.snowmanBounce - dt * 2.4);
      state.turbineBoost = Math.max(0, state.turbineBoost - dt * 12);
      state.turbineAngle += dt * (2.5 + state.env.windSpeed * 7.5 + state.turbineBoost);

      // Update expanding ripples
      for (let i = state.ripples.length - 1; i >= 0; i--) {
        state.ripples[i].age += dt;
        if (state.ripples[i].age >= state.ripples[i].maxAge) {
          state.ripples.splice(i, 1);
        }
      }

      // Compute continuous atmosphere & lighting
      state.atmo = computeAtmosphere(state.hours, state.env, weather.lightningFlash);

      if (!state.paused) {
        Weath.updateWeather(weather, state, dt, audio);
        Ent.updateEntities(entities, state, dt, audio);
      }
      audio.update(state, dt);
    }

    function render() {
      const atmo = state.atmo;
      state.hitList.length = 0;

      // Layer 0: Studio backdrop + stars/moon/sunset halo + far precipitation
      buf.clearU32(atmo.bgU32);
      Weath.drawSkyAndFarWeather(buf, weather, state, atmo);

      // Layer 1: Building exterior facades & 8 recessed windows
      Arch.drawBuildingShell(buf, state, atmo, state.hitList);

      // Layer 2: Back parapet walls + tiled rooftop floor + puddles + snow + shadows
      Arch.drawRoofFloorAndBackParapet(buf, state, atmo, state.hitList);

      // Layer 3: Depth-sorted rooftop architecture, props & living characters
      const propItems = Arch.collectRoofItems(buf, state, atmo, state.hitList);
      const entItems = Ent.collectEntityItems(buf, entities, state, atmo, state.hitList);
      const allSorted = propItems.concat(entItems);
      allSorted.sort((a, b) => a.depth - b.depth);
      for (let i = 0; i < allSorted.length; i++) {
        allSorted[i].draw();
      }

      // Layer 4: Front parapet walls (naturally occluding props/characters near front rim)
      Arch.drawFrontParapet(buf, state, atmo);

      // Layer 5: Overhead string lights & warm dithered glow halos
      Arch.drawStringLights(buf, state, atmo);

      // Layer 6: Foreground aerial wildlife (swallows, fireflies) & particles
      Ent.drawForegroundEntities(buf, entities, state, atmo);

      // Layer 7: Iconic Bayer-ordered dithered cloud bank & foreground rain/snow/lightning
      Weath.drawDitheredClouds(buf, weather, state, atmo, state.hitList);
      Weath.drawForegroundWeather(buf, weather, state, atmo, state.hitList);

      // Blit the virtual pixel buffer to the canvas with even, crisp pixels
      presentView(0, 0, CANVAS_W, CANVAS_H);
      ui.sync(state, atmo);
    }

    function renderStory() {
      story.render(buf);
      const r = story.viewRect();
      presentView(r.sx, r.sy, r.sw, r.sh);
    }

    // Main loop
    let lastTs = performance.now();
    function frame(ts) {
      const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;
      if (state.mode === 'story') {
        story.step(dt);
        renderStory();
        const aiming = story.playable && !story.paused;
        if (aiming !== canvas.classList.contains('aiming')) canvas.classList.toggle('aiming', aiming);
      } else {
        step(dt);
        render();
      }
      requestAnimationFrame(frame);
    }

    // Expose clean API for testing / inspection
    global.__DIORAMA__ = {
      state,
      story,
      setMode,
      beginStory,
      renderNow() {
        if (state.mode === 'story') {
          renderStory();
        } else {
          render();
        }
      },
      controller,
      triggerLightning: () => Weath.triggerLightning(weather, audio),
      snapToScenario(idx) {
        controller.selectScenario(idx, false);
        state.env = cloneEnv(state.scenario.env);
        state.tourElapsed = 3.5;
        step(0.016);
        render();
      },
    };

    step(0.016);
    render();
    story.step(0.016);
    renderStory();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
