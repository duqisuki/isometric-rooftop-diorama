(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const {
    bayer4,
    bayer8,
    hash2,
    clamp,
    lerpRGB,
  } = Diorama.Palette;
  const { CANVAS_W, CANVAS_H, BUILDING, project } = Diorama.Iso;

  // Sculptural multi-lobe cloud bank profile (tightly framed for crisp 350x264 close-up)
  const CLOUD_PUFFS = [
    { x: 48, y: 89, rx: 27, ry: 17, minCov: 0.55 },
    { x: 90, y: 79, rx: 32, ry: 20, minCov: 0.25 },
    { x: 134, y: 77, rx: 29, ry: 18, minCov: 0.45 },
    { x: 178, y: 59, rx: 34, ry: 22, minCov: 0.05 },
    { x: 226, y: 69, rx: 31, ry: 20, minCov: 0.30 },
    { x: 272, y: 81, rx: 29, ry: 19, minCov: 0.50 },
    { x: 310, y: 89, rx: 25, ry: 17, minCov: 0.72 },
    // Distinct secondary dome tufts for rich silhouette & underside valleys
    { x: 114, y: 64, rx: 22, ry: 14, minCov: 0.65 },
    { x: 206, y: 55, rx: 25, ry: 15, minCov: 0.60 },
    { x: 256, y: 67, rx: 22, ry: 14, minCov: 0.75 },
    { x: 294, y: 76, rx: 21, ry: 13, minCov: 0.80 },
  ];

  function createWeather() {
    // 108 diagonal raindrop streaks across tightly framed canvas
    const raindrops = Array.from({ length: 108 }, (_, i) => ({
      x: 16 + ((i * 47.3) % 316),
      y: 80 + ((i * 33.7) % 176),
      len: 7 + (i % 4) * 2.2,
      speed: 170 + (i % 5) * 26,
      layer: i % 4 === 0 ? 0 : 1,
      roofDrop: i % 3 === 0,
    }));

    // 108 snowflakes with depth & sinusoidal flutter
    const snowflakes = Array.from({ length: 108 }, (_, i) => ({
      x: 12 + ((i * 51.7) % 326),
      y: 36 + ((i * 29.3) % 220),
      speed: 20 + (i % 5) * 6.5,
      phase: i * 1.37,
      size: i % 4 === 0 ? 2 : 1,
      layer: i % 3 === 0 ? 0 : 1,
    }));

    // 64 fixed crisp pixel stars in the upper sky dome
    const stars = Array.from({ length: 64 }, (_, i) => {
      const x = Math.floor(10 + hash2(i, 13) * 330);
      const y = Math.floor(8 + hash2(i, 71) * 116);
      return {
        x,
        y,
        phase: hash2(i, 29) * Math.PI * 2,
        speed: 1.2 + hash2(i, 41) * 2.5,
        bright: hash2(i, 97) > 0.72 ? 1.0 : 0.62,
      };
    });

    return {
      raindrops,
      snowflakes,
      stars,
      cloudOffset: 0,
      lightningTimer: 3.4,
      lightningFlash: 0,
      lightningBolt: null,
      shootingStars: [],
      splashes: [],
    };
  }

  function triggerLightning(weather, audio) {
    weather.lightningFlash = 1.0;
    // Generate jagged pixel fork starting inside storm cloud bank
    const startX = 88 + Math.random() * 174;
    const startY = 82 + Math.random() * 12;
    const pts = [[startX, startY]];
    let cx = startX;
    let cy = startY;
    const segs = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < segs; i++) {
      cx += (Math.random() - 0.45) * 20;
      cy += 12 + Math.random() * 10;
      pts.push([cx, cy]);
    }
    const branchIdx = 2;
    const branch = [pts[branchIdx]];
    let bx = pts[branchIdx][0];
    let by = pts[branchIdx][1];
    for (let i = 0; i < 3; i++) {
      bx += (Math.random() > 0.5 ? 1 : -1) * (9 + Math.random() * 9);
      by += 10 + Math.random() * 9;
      branch.push([bx, by]);
    }

    weather.lightningBolt = {
      pts,
      branch,
      life: 0.28,
      maxLife: 0.28,
    };
    if (audio) audio.playThunder();
  }

  function spawnShootingStar(weather, sx, sy) {
    weather.shootingStars.push({
      x: sx !== undefined ? sx : 50 + Math.random() * 200,
      y: sy !== undefined ? sy : 12 + Math.random() * 42,
      vx: 115 + Math.random() * 50,
      vy: 42 + Math.random() * 26,
      age: 0,
      maxAge: 0.65 + Math.random() * 0.25,
    });
  }

  function updateWeather(weather, state, dt, audio) {
    const env = state.env;
    weather.cloudOffset += (2.2 + env.windSpeed * 4.2) * dt;

    // Lightning flash decay & autonomous storm strikes
    if (weather.lightningFlash > 0) {
      weather.lightningFlash = Math.max(0, weather.lightningFlash - dt * 3.6);
    }
    if (weather.lightningBolt) {
      weather.lightningBolt.life -= dt;
      if (weather.lightningBolt.life <= 0) weather.lightningBolt = null;
    }
    if (env.lightningChance > 0.05 && env.rainIntensity > 0.4) {
      weather.lightningTimer -= dt;
      if (weather.lightningTimer <= 0) {
        triggerLightning(weather, audio);
        weather.lightningTimer = 4.2 + Math.random() * 5.2;
      }
    }

    // Raindrop integration + roof splash generation
    const rainInt = env.rainIntensity;
    if (rainInt > 0.02) {
      const windX = 24 + env.windSpeed * 32;
      for (let i = 0; i < weather.raindrops.length; i++) {
        const d = weather.raindrops[i];
        d.x += windX * dt;
        d.y += d.speed * dt;

        if (d.roofDrop && d.y > 130 && d.y < 216 && Math.random() < dt * 7 * rainInt) {
          const ru = 4 + Math.random() * 38;
          const rv = 4 + Math.random() * 16;
          const sp = project(ru, rv, BUILDING.Z_ROOF);
          weather.splashes.push({ x: sp[0], y: sp[1], age: 0, maxAge: 0.22 });
          if (state.ripples.length < 24 && Math.random() < 0.35) {
            state.ripples.push({ u: ru, v: rv, age: 0, maxAge: 0.62, maxR: 2.6 });
          }
        }

        if (d.y > CANVAS_H - 6 || d.x > CANVAS_W - 10) {
          d.x = 12 + Math.random() * (CANVAS_W - 36);
          d.y = 78 + Math.random() * 20;
        }
      }
    }

    // Splashes update
    for (let i = weather.splashes.length - 1; i >= 0; i--) {
      const s = weather.splashes[i];
      s.age += dt;
      if (s.age >= s.maxAge) weather.splashes.splice(i, 1);
    }

    // Snowflakes integration
    if (env.snowIntensity > 0.02) {
      for (let i = 0; i < weather.snowflakes.length; i++) {
        const f = weather.snowflakes[i];
        f.y += f.speed * dt;
        f.x += (Math.sin(state.time * 1.8 + f.phase) * 13 + env.windSpeed * 12) * dt;
        if (f.y > CANVAS_H - 6) {
          f.y = 36 + Math.random() * 30;
          f.x = 12 + Math.random() * (CANVAS_W - 24);
        }
        if (f.x > CANVAS_W - 10) f.x = 10;
        if (f.x < 8) f.x = CANVAS_W - 12;
      }
    }

    // Shooting stars at night
    if (state.atmo && state.atmo.night > 0.55 && Math.random() < dt * 0.16) {
      spawnShootingStar(weather);
    }
    for (let i = weather.shootingStars.length - 1; i >= 0; i--) {
      const ss = weather.shootingStars[i];
      ss.age += dt;
      ss.x += ss.vx * dt;
      ss.y += ss.vy * dt;
      if (ss.age >= ss.maxAge) weather.shootingStars.splice(i, 1);
    }
  }

  /**
   * Draws background sky accents: stars, crescent moon, shooting stars,
   * golden-hour sunset glow, and far-layer precip behind the building.
   */
  function drawSkyAndFarWeather(buf, weather, state, atmo) {
    const t = state.time;

    // 1. Night starfield & crisp dithered crescent moon
    if (atmo.night > 0.22) {
      const starVis = clamp((atmo.night - 0.22) / 0.55, 0, 1);
      for (let i = 0; i < weather.stars.length; i++) {
        const st = weather.stars[i];
        const tw = 0.45 + 0.55 * Math.sin(t * st.speed + st.phase);
        const a = starVis * st.bright * tw;
        const col = i % 5 === 0 ? [255, 236, 198] : [228, 238, 255];
        buf.blendPx(st.x, st.y, col, a);
        if (st.bright > 0.9 && tw > 0.82) {
          buf.blendPx(st.x - 1, st.y, col, a * 0.4);
          buf.blendPx(st.x + 1, st.y, col, a * 0.4);
          buf.blendPx(st.x, st.y - 1, col, a * 0.4);
          buf.blendPx(st.x, st.y + 1, col, a * 0.4);
        }
      }

      // Crisp pixel crescent moon in upper-right sky
      const mx = 298;
      const my = 34;
      buf.ditherGlow(mx, my, 24, 24, [186, 206, 252], starVis * 0.3, true);
      const mr = 10;
      for (let dy = -mr; dy <= mr; dy++) {
        for (let dx = -mr; dx <= mr; dx++) {
          const d1 = dx * dx + dy * dy;
          const d2 = (dx - 4.8) * (dx - 4.8) + (dy + 2.0) * (dy + 2.0);
          if (d1 <= mr * mr && d2 > (mr - 1.1) * (mr - 1.1)) {
            const c = dx < -3 ? [255, 248, 214] : [232, 224, 186];
            buf.blendPx(mx + dx, my + dy, c, starVis);
          }
        }
      }

      // Shooting stars
      for (let i = 0; i < weather.shootingStars.length; i++) {
        const ss = weather.shootingStars[i];
        const life = 1 - ss.age / ss.maxAge;
        const tx = ss.x - ss.vx * 0.14;
        const ty = ss.y - ss.vy * 0.14;
        buf.line(ss.x, ss.y, tx, ty, [242, 248, 255], life * 0.85);
        buf.setPx(Math.round(ss.x), Math.round(ss.y), [255, 255, 255]);
      }
    }

    // 2. Golden Hour subtle warm sunset mist behind upper horizon
    if (atmo.warmth > 0.35 && atmo.night < 0.7) {
      const wStr = clamp((atmo.warmth - 0.35) / 0.6, 0, 1) * (1 - atmo.night * 0.8);
      const gx = 176;
      const gy = 78;
      for (let y = 32; y <= 126; y++) {
        const dy = (y - gy) / 46;
        for (let x = 16; x <= 334; x++) {
          const dx = (x - gx) / 158;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 1) continue;
          const k = (1 - d2) * (1 - d2) * 0.24 * wStr;
          if (k > 0.01) buf.blendPx(x, y, [252, 206, 158], k);
        }
      }
    }

    // 3. Far rain layer behind the building
    if (state.env.rainIntensity > 0.05) {
      const col = atmo.isDarkTheme ? [112, 132, 166] : [156, 166, 182];
      const tilt = 2.4 + state.env.windSpeed * 1.2;
      for (let i = 0; i < weather.raindrops.length; i++) {
        const d = weather.raindrops[i];
        if (d.layer !== 0) continue;
        if (i / weather.raindrops.length > state.env.rainIntensity) continue;
        buf.line(d.x, d.y, d.x + tilt, d.y + d.len, col, 0.42);
      }
    }

    // 4. Far snow layer
    if (state.env.snowIntensity > 0.05) {
      const col = atmo.isDarkTheme ? [196, 212, 238] : [178, 194, 216];
      for (let i = 0; i < weather.snowflakes.length; i++) {
        const f = weather.snowflakes[i];
        if (f.layer !== 0) continue;
        if (i / weather.snowflakes.length > state.env.snowIntensity) continue;
        buf.blendPx(f.x, f.y, col, 0.55);
      }
    }
  }

  /**
   * Renders the sculptural Bayer-ordered dithered cloud bank hovering above the rooftop.
   */
  function drawDitheredClouds(buf, weather, state, atmo, hitList) {
    const cov = clamp(state.env.cloudCoverage, 0, 1);
    if (cov < 0.06) return;

    const dark = state.env.cloudDarkness;
    const warm = clamp(state.env.cloudWarmth + atmo.warmth * 0.5, 0, 1);
    const flash = weather.lightningFlash;

    let colDark = lerpRGB([178, 198, 222], [62, 72, 92], dark);
    let colMid = lerpRGB([208, 222, 238], [92, 104, 124], dark);
    let colLight = lerpRGB([236, 244, 252], [128, 140, 162], dark);

    if (warm > 0.1 && atmo.night < 0.7) {
      colDark = lerpRGB(colDark, [172, 112, 114], warm * 0.72);
      colMid = lerpRGB(colMid, [228, 156, 122], warm * 0.78);
      colLight = lerpRGB(colLight, [254, 218, 172], warm * 0.85);
    }

    if (state.env.snowLevel > 0.3 && atmo.night < 0.6) {
      colDark = lerpRGB(colDark, [136, 154, 180], state.env.snowLevel * 0.7);
      colMid = lerpRGB(colMid, [174, 190, 212], state.env.snowLevel * 0.7);
      colLight = lerpRGB(colLight, [212, 224, 238], state.env.snowLevel * 0.7);
    }

    if (atmo.night > 0.25) {
      const nf = clamp((atmo.night - 0.25) / 0.75, 0, 1);
      colDark = lerpRGB(colDark, [30, 38, 60], nf * 0.85);
      colMid = lerpRGB(colMid, [46, 56, 84], nf * 0.85);
      colLight = lerpRGB(colLight, [68, 82, 116], nf * 0.82);
    }

    if (flash > 0.02) {
      colLight = lerpRGB(colLight, [238, 246, 255], flash * 0.85);
      colMid = lerpRGB(colMid, [196, 214, 240], flash * 0.7);
      colDark = lerpRGB(colDark, [132, 150, 182], flash * 0.45);
    }

    const active = [];
    let minX = CANVAS_W, maxX = 0, minY = CANVAS_H, maxY = 0;
    for (let i = 0; i < CLOUD_PUFFS.length; i++) {
      const p = CLOUD_PUFFS[i];
      const vis = clamp((cov - p.minCov + 0.24) / 0.28, 0, 1);
      if (vis <= 0.02) continue;
      const swayX = Math.sin(weather.cloudOffset * 0.09 + i * 1.15) * 9.5;
      const swayY = Math.cos(weather.cloudOffset * 0.07 + i * 0.9) * 2.6;
      const rx = p.rx * (0.72 + 0.32 * vis);
      const ry = p.ry * (0.72 + 0.32 * vis);
      const px = p.x + swayX;
      const py = p.y + swayY;
      active.push({ x: px, y: py, rx, ry, vis });
      if (px - rx - 6 < minX) minX = px - rx - 6;
      if (px + rx + 6 > maxX) maxX = px + rx + 6;
      if (py - ry - 6 < minY) minY = py - ry - 6;
      if (py + ry + 6 > maxY) maxY = py + ry + 6;
    }

    const x0 = Math.max(4, Math.floor(minX));
    const x1 = Math.min(CANVAS_W - 5, Math.ceil(maxX));
    const y0 = Math.max(12, Math.floor(minY));
    const y1 = Math.min(162, Math.ceil(maxY));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let density = 0;
        let bestDome = 0;
        let bestTop = 0.5;
        let overlapCount = 0;

        for (let i = 0; i < active.length; i++) {
          const p = active[i];
          const dx = (x - p.x) / p.rx;
          const dy = (y - p.y) / p.ry;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 1.38) continue;
          const contrib = Math.max(0, 1 - d2 / 1.38) * p.vis;
          const smooth = contrib * contrib * (3 - 2 * contrib);
          density = Math.max(density, smooth * 1.32) + smooth * 0.22;
          if (smooth > bestDome) {
            bestDome = smooth;
            bestTop = clamp(0.56 - dy * 0.58 - dx * 0.12 - d2 * 0.14, 0, 1);
          }
          if (smooth > 0.16) overlapCount++;
        }

        if (density < 0.06) continue;

        const edgeDensity = clamp((density - 0.06) / 0.58, 0, 1);
        const b = bayer8(x, y);
        if (edgeDensity <= b) continue;

        const shade = clamp(bestTop - (overlapCount > 1 && bestDome < 0.45 ? 0.14 : 0), 0, 1);
        const b4 = bayer4(x, y);
        let col;
        if (shade > 0.54) {
          const k = clamp((shade - 0.54) / 0.34, 0, 1);
          col = k > b4 ? colLight : colMid;
        } else {
          const k = clamp((shade - 0.18) / 0.36, 0, 1);
          col = k > b4 ? colMid : colDark;
        }

        if (edgeDensity < 0.44 && !atmo.isDarkTheme && dark > 0.5) {
          col = lerpRGB(col, colLight, 0.28);
        }

        buf.setPx(x, y, col);
      }
    }

    if (hitList) {
      hitList.push({
        type: 'sky',
        label: state.env.rainIntensity > 0.3
          ? 'Trigger lightning strike'
          : atmo.night > 0.4
            ? 'Make a shooting star'
            : state.env.snowIntensity > 0.3
              ? 'Shake a snow flurry'
              : 'Send a breeze across the sky',
        x0,
        y0: Math.min(28, y0),
        x1,
        y1: Math.min(144, y1),
        cx: (x0 + x1) * 0.5,
        cy: (y0 + y1) * 0.5,
      });
    }
  }

  function drawForegroundWeather(buf, weather, state, atmo, hitList) {
    const env = state.env;

    // 1. Jagged pixel lightning bolt
    if (weather.lightningBolt) {
      const bolt = weather.lightningBolt;
      const life = bolt.life / bolt.maxLife;
      const coreCol = [255, 255, 255];
      const haloCol = [164, 212, 255];

      const drawSegs = (pts, thick) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          if (thick) {
            buf.line(a[0] - 1, a[1], b[0] - 1, b[1], haloCol, life * 0.7);
            buf.line(a[0] + 1, a[1], b[0] + 1, b[1], haloCol, life * 0.7);
          }
          buf.line(a[0], a[1], b[0], b[1], coreCol, life);
        }
      };
      drawSegs(bolt.pts, true);
      drawSegs(bolt.branch, false);
    }

    // 2. Foreground diagonal pixel rain streaks & crisp impact splashes
    if (env.rainIntensity > 0.04) {
      const streakCol = atmo.isDarkTheme ? [154, 178, 216] : [132, 144, 162];
      const tipCol = atmo.isDarkTheme ? [216, 232, 255] : [182, 194, 212];
      const tilt = 2.4 + env.windSpeed * 1.25;

      for (let i = 0; i < weather.raindrops.length; i++) {
        const d = weather.raindrops[i];
        if (d.layer !== 1) continue;
        if (i / weather.raindrops.length > env.rainIntensity) continue;
        const x1 = d.x + tilt;
        const y1 = d.y + d.len;
        buf.line(d.x, d.y, x1, y1, streakCol, 0.72);
        buf.blendPx(Math.round(x1), Math.round(y1), tipCol, 0.85);
      }

      const splashCol = atmo.isDarkTheme ? [216, 234, 255] : [242, 248, 255];
      for (let i = 0; i < weather.splashes.length; i++) {
        const s = weather.splashes[i];
        const a = 1 - s.age / s.maxAge;
        const spread = 1 + Math.round((s.age / s.maxAge) * 3);
        buf.blendPx(s.x - spread, s.y - 1, splashCol, a * 0.85);
        buf.blendPx(s.x + spread, s.y - 1, splashCol, a * 0.85);
        buf.blendPx(s.x, s.y, splashCol, a * 0.65);
      }
    }

    // 3. Foreground swirling snowflakes (crisp white core + cool rim)
    if (env.snowIntensity > 0.04) {
      const flakeBright = [255, 255, 255];
      const flakeRim = atmo.isDarkTheme ? [178, 202, 236] : [162, 182, 208];
      for (let i = 0; i < weather.snowflakes.length; i++) {
        const f = weather.snowflakes[i];
        if (f.layer !== 1) continue;
        if (i / weather.snowflakes.length > env.snowIntensity) continue;
        const fx = Math.round(f.x);
        const fy = Math.round(f.y);
        buf.blendPx(fx + 1, fy + 1, flakeRim, 0.55);
        buf.setPx(fx, fy, flakeBright);
        if (f.size > 1) {
          buf.setPx(fx + 1, fy, flakeBright);
          buf.blendPx(fx, fy + 1, flakeRim, 0.68);
          buf.blendPx(fx - 1, fy, flakeRim, 0.45);
        }
      }
    }

    if (hitList && env.cloudCoverage < 0.35) {
      hitList.push({
        type: 'sky',
        label: atmo.night > 0.4 ? 'Make a shooting star' : 'Send a breeze across the sky',
        x0: 36,
        y0: 18,
        x1: CANVAS_W - 36,
        y1: 118,
        cx: CANVAS_W * 0.5,
        cy: 64,
      });
    }
  }

  Diorama.Weather = {
    createWeather,
    triggerLightning,
    spawnShootingStar,
    updateWeather,
    drawSkyAndFarWeather,
    drawDitheredClouds,
    drawForegroundWeather,
  };
})(window);
