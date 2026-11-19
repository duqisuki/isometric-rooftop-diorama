(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const {
    hash2,
    bayer4,
    clamp,
    lerp,
    lerpRGB,
    shiftRGB,
    mulRGB,
  } = Diorama.Palette;
  const {
    BUILDING,
    ISO_SCALE,
    ORIGIN_X,
    ORIGIN_Y,
    project,
    drawIsoBox,
    drawIsoWindow,
    drawRoofCastShadow,
  } = Diorama.Iso;

  // 8 interactive apartment windows along both visible facades
  const WINDOWS = [
    // Front-left long facade (5 windows, matching reference)
    { id: 0, face: 'left', u0: 5, u1: 9, v0: 24, v1: 24, z0: 7, z1: 15, roomStyle: 'warm' },
    { id: 1, face: 'left', u0: 13, u1: 17, v0: 24, v1: 24, z0: 7, z1: 15, roomStyle: 'curtain' },
    { id: 2, face: 'left', u0: 21, u1: 25, v0: 24, v1: 24, z0: 7, z1: 15, roomStyle: 'warm' },
    { id: 3, face: 'left', u0: 29, u1: 33, v0: 24, v1: 24, z0: 7, z1: 15, roomStyle: 'tv' },
    { id: 4, face: 'left', u0: 37, u1: 41, v0: 24, v1: 24, z0: 7, z1: 15, roomStyle: 'curtain' },
    // Front-right shorter facade (3 windows, matching reference)
    { id: 5, face: 'right', u0: 46, u1: 46, v0: 17, v1: 21, z0: 7, z1: 15, roomStyle: 'warm' },
    { id: 6, face: 'right', u0: 46, u1: 46, v0: 10, v1: 14, z0: 7, z1: 15, roomStyle: 'curtain' },
    { id: 7, face: 'right', u0: 46, u1: 46, v0: 3, v1: 7, z0: 7, z1: 15, roomStyle: 'warm' },
  ];

  // Organic puddle basins on the rooftop floor
  const PUDDLES = [
    { u: 16.5, v: 16.0, ru: 4.5, rv: 2.8 },
    { u: 25.0, v: 11.2, ru: 5.2, rv: 3.1 },
    { u: 22.0, v: 18.5, ru: 3.6, rv: 2.2 },
    { u: 33.5, v: 8.5, ru: 3.8, rv: 2.5 },
    { u: 13.5, v: 12.2, ru: 3.2, rv: 2.1 },
  ];

  // Garments on the clotheslines (scaled cleanly for 450x340 high-res)
  const GARMENTS = [
    { line: 0, t: 0.16, w: 6, h: 7, col: [232, 228, 218], shape: 'sheet' },
    { line: 0, t: 0.36, w: 5, h: 6, col: [204, 108, 92], shape: 'shirt' },
    { line: 0, t: 0.56, w: 5, h: 6, col: [112, 158, 192], shape: 'towel' },
    { line: 0, t: 0.77, w: 6, h: 7, col: [238, 224, 178], shape: 'sheet' },
    { line: 1, t: 0.28, w: 5, h: 6, col: [134, 166, 128], shape: 'shirt' },
    { line: 1, t: 0.62, w: 5, h: 6, col: [224, 152, 114], shape: 'towel' },
  ];

  function isWindowLit(id, state, atmo) {
    if (state.windowOverrides[id] !== undefined) {
      return state.windowOverrides[id];
    }
    const preset = state.scenario.windowPreset[id] || 0;
    // Automatically light windows as darkness falls, staggered per apartment
    const stagger = (id * 0.08 + 0.14) % 0.45;
    if (atmo.night > 0.22 + stagger * 0.85) {
      return preset === 1 || (id % 3 === 0 && atmo.night > 0.65);
    }
    if (atmo.warmth > 0.55 && preset === 1) {
      return id === 0 || id === 3 || id === 5 || id === 7;
    }
    if (atmo.storm > 0.55 && preset === 1) {
      return id === 1 || id === 6; // A couple cozy lights during daytime squall
    }
    if (atmo.snow > 0.5 && preset === 1) {
      return true;
    }
    return false;
  }

  /**
   * Draws soft floating ambient-occlusion shadow directly beneath the building base.
   */
  function drawBaseShadow(buf, atmo) {
    const pLeft = project(0, BUILDING.V, 0);
    const pFront = project(BUILDING.U, BUILDING.V, 0);
    const pRight = project(BUILDING.U, 0, 0);
    const col = atmo.isDarkTheme ? [6, 9, 16] : [182, 188, 200];

    for (let dy = 1; dy <= 4; dy++) {
      const alpha = (5 - dy) * (atmo.isDarkTheme ? 0.16 : 0.10);
      buf.line(pLeft[0] + 1, pLeft[1] + dy, pFront[0], pFront[1] + dy, col, alpha);
      buf.line(pFront[0], pFront[1] + dy, pRight[0] - 1, pRight[1] + dy, col, alpha);
    }
  }

  /**
   * Draws the main concrete apartment block walls + 8 recessed interactive windows.
   */
  function drawBuildingShell(buf, state, atmo, hitList) {
    drawBaseShadow(buf, atmo);

    // Main apartment exterior block up to Z_ROOF (parapets extend above)
    drawIsoBox(buf, 0, 0, 0, BUILDING.U, BUILDING.V, BUILDING.Z_ROOF, {
      top: atmo.wallTop,
      left: atmo.wallLeft,
      right: atmo.wallRight,
      ink: atmo.ink,
      noise: 7,
      drawTop: false, // Rooftop floor & parapets cover the top
      drawLeft: true,
      drawRight: true,
      outlineOuter: true,
      weatherDrips: true,
    });

    // Subtle horizontal architectural floor-slab seam along both facades
    const seamZ = 18;
    // Subtle cornice / architectural shadow line near parapet base
    const sL = project(0, BUILDING.V, seamZ);
    const sF = project(BUILDING.U, BUILDING.V, seamZ);
    const sR = project(BUILDING.U, 0, seamZ);
    buf.line(sL[0] + 1, sL[1], sF[0] - 1, sF[1], atmo.ink, 0.08);
    buf.line(sF[0] + 1, sF[1], sR[0] - 1, sR[1], atmo.ink, 0.10);

    // Subtle base plinth band along the bottom 2px of exterior walls
    const bL = project(0, BUILDING.V, 2);
    const bF = project(BUILDING.U, BUILDING.V, 2);
    const bR = project(BUILDING.U, 0, 2);
    buf.line(bL[0] + 1, bL[1], bF[0], bF[1], atmo.ink, 0.16);
    buf.line(bF[0], bF[1], bR[0] - 1, bR[1], atmo.ink, 0.18);

    // Render all 8 apartment windows
    for (let i = 0; i < WINDOWS.length; i++) {
      const w = WINDOWS[i];
      const lit = isWindowLit(w.id, state, atmo);
      const flicker = 0.5 + 0.5 * Math.sin(state.time * (w.roomStyle === 'tv' ? 7.3 : 1.7) + w.id * 2.1);
      drawIsoWindow(buf, w, atmo, lit, flicker, hitList);
    }
  }

  /**
   * Draws back parapet walls + tiled roof floor + dynamic puddles/ripples + snow drifts + cast shadows.
   */
  function drawRoofFloorAndBackParapet(buf, state, atmo, hitList) {
    const { U, V, Z_ROOF, Z_PARAPET, WALL_T } = BUILDING;
    const snowCols = { bright: atmo.snowBright, mid: atmo.snowMid };

    // 1. Back-right parapet wall (v: 0..WALL_T, u: 0..U)
    drawIsoBox(buf, 0, 0, Z_ROOF, U, WALL_T, Z_PARAPET, {
      top: atmo.copingLight,
      left: atmo.wallInnerLeft,
      right: atmo.wallRight,
      ink: atmo.ink,
      bevel: atmo.copingLight,
      noise: 5,
      outlineOuter: true,
      outlineBottom: false,
      snowTop: state.env.snowLevel,
      snowColors: snowCols,
    });

    // 2. Back-left parapet wall (u: 0..WALL_T, v: WALL_T..V)
    drawIsoBox(buf, 0, WALL_T, Z_ROOF, WALL_T, V, Z_PARAPET, {
      top: atmo.copingLight,
      left: atmo.wallLeft,
      right: atmo.wallInnerRight,
      ink: atmo.ink,
      bevel: atmo.copingLight,
      noise: 5,
      outlineOuter: true,
      outlineBottom: false,
      snowTop: state.env.snowLevel,
      snowColors: snowCols,
    });

    // 3. Rooftop interior tiled floor (u: WALL_T..U-WALL_T, v: WALL_T..V-WALL_T)
    const p00 = project(WALL_T, WALL_T, Z_ROOF);
    const p10 = project(U - WALL_T, WALL_T, Z_ROOF);
    const p11 = project(U - WALL_T, V - WALL_T, Z_ROOF);
    const p01 = project(WALL_T, V - WALL_T, Z_ROOF);

    const puddleLvl = state.env.puddleLevel;
    const snowLvl = state.env.snowLevel;
    const wetDarken = clamp(puddleLvl * 0.55 + state.env.rainIntensity * 0.25, 0, 0.72);
    const skyReflect = atmo.night > 0.5
      ? [58, 72, 108]
      : atmo.storm > 0.3
        ? [134, 148, 168]
        : lerpRGB([172, 196, 218], atmo.skyGlow, 0.4);

    buf.fillPoly([p00, p10, p11, p01], (x, y) => {
      // Exact roof iso coordinates for this pixel (scaled for ISO_SCALE)
      const dx = (x - ORIGIN_X) / (2 * ISO_SCALE);
      const dy = (y - ORIGIN_Y + Z_ROOF * ISO_SCALE) / ISO_SCALE;
      const u = (dx + dy) * 0.5;
      const v = (dy - dx) * 0.5;

      // Tile grid (3.5 iso-unit square tiles)
      const tileSize = 3.5;
      const tu = Math.floor(u / tileSize);
      const tv = Math.floor(v / tileSize);
      const fu = (u / tileSize) - tu;
      const fv = (v / tileSize) - tv;
      const isGrout = fu < 0.09 || fv < 0.09;

      const tileHash = hash2(tu + 19, tv + 43);
      let col = tileHash > 0.5 ? atmo.tileBase : atmo.tileAlt;
      if (isGrout) col = atmo.tileGrout;

      // Subtle micro-grain weathering
      const grain = (hash2(x, y) - 0.5) * 10;
      col = shiftRGB(col, grain, grain * 0.9, grain * 0.85);

      // Edge ambient occlusion along inner parapet base
      const edgeDist = Math.min(u - WALL_T, v - WALL_T, (U - WALL_T) - u, (V - WALL_T) - v);
      if (edgeDist < 1.3) {
        col = mulRGB(col, 0.86);
      }

      // General dampness darkening in rain
      if (wetDarken > 0.02) {
        col = lerpRGB(col, atmo.tileWet, wetDarken * (0.45 + 0.35 * tileHash));
      }

      // Standing puddles with glossy sky reflection
      if (puddleLvl > 0.08) {
        for (let i = 0; i < PUDDLES.length; i++) {
          const pd = PUDDLES[i];
          const du = (u - pd.u) / (pd.ru * puddleLvl);
          const dv = (v - pd.v) / (pd.rv * puddleLvl);
          const d2 = du * du + dv * dv;
          if (d2 < 1.15) {
            const wobble = (hash2(tu * 3, tv * 7) - 0.5) * 0.22;
            if (d2 + wobble < 0.82) {
              // Reflective water surface
              const sheen = ((x + y) & 3) === 0 ? 0.52 : 0.36;
              col = lerpRGB(atmo.tileWet, skyReflect, sheen);
              if (atmo.flash > 0.1) {
                col = lerpRGB(col, [235, 245, 255], atmo.flash * 0.5);
              }
              break;
            } else if (d2 + wobble < 1.04) {
              // Damp ring edge
              col = mulRGB(col, 0.78);
              break;
            }
          }
        }
      }

      // Winter snow blanket: lush soft drifted snow with cleared doorway mat & subtle footprints!
      if (snowLvl > 0.04) {
        const doorDist = Math.hypot(u - 9.2, v - 11.4);
        const snowManDist = Math.hypot(u - 19.8, v - 18.2);
        const cornerWeight = edgeDist < 3.2 ? 0.22 : 0.0;
        const cleared = doorDist < 2.2 ? (1 - doorDist / 2.2) * 0.55 : 0;
        const drift = clamp(snowLvl * 1.25 + cornerWeight - cleared - tileHash * 0.12, 0, 1);

        if (drift > 0.82 || drift > bayer4(x, y)) {
          // Sculpted soft snow shading with crisp blue-shadow drifts along parapet edges
          const wave = Math.sin(u * 0.42 + v * 0.28) * 0.5 + 0.5;
          let sCol = wave > 0.42 ? atmo.snowBright : atmo.snowMid;
          if (edgeDist < 2.4 || snowManDist < 2.4) {
            sCol = lerpRGB(atmo.snowMid, atmo.snowShade, 0.55);
          }
          // Subtle indented footprints walking from doorway (10,12) toward snowman (18,17.5)
          const footT = clamp(((u - 10) * 8 + (v - 12) * 5.5) / 94, 0, 1);
          const fpU = 10 + footT * 8;
          const fpV = 12 + footT * 5.5;
          const fpDist = Math.hypot(u - fpU, v - fpV);
          if (fpDist < 0.7 && ((Math.floor(footT * 10) & 1) === 0)) {
            sCol = atmo.snowShade;
          }
          col = sCol;
        }
      }

      return col;
    });

    // Crisp inner wall-floor corner seam
    buf.line(p00[0], p00[1], p10[0], p10[1], atmo.ink, 0.42);
    buf.line(p00[0], p00[1], p01[0], p01[1], atmo.ink, 0.42);

    // Subtle rooftop cast shadows from sun
    drawRoofCastShadow(buf, 4.5, 3, 14.5, 10.5, 14, atmo); // stairwell
    drawRoofCastShadow(buf, 36.5, 3, 42.5, 8.5, 10, atmo); // utility shed
    drawRoofCastShadow(buf, 5.2, 15.2, 9.8, 19.8, 9, atmo); // potted tree
    drawRoofCastShadow(buf, 27, 17, 31.5, 20.5, 3.5, atmo); // wooden table
    if (state.env.tarpsMode > 0.4) {
      drawRoofCastShadow(buf, 30.5, 13.5, 35.5, 17.5, 5, atmo);
      drawRoofCastShadow(buf, 35.0, 10.2, 39.5, 14.0, 5, atmo);
    }

    // Draw expanding splash ripples on puddles & clicked roof spots
    for (let i = 0; i < state.ripples.length; i++) {
      const rp = state.ripples[i];
      const sp = project(rp.u, rp.v, Z_ROOF);
      const t = rp.age / rp.maxAge;
      const rx = 1.5 + t * rp.maxR * 2 * ISO_SCALE;
      const ry = Math.max(1, rx * 0.5);
      const alpha = (1 - t) * 0.78;
      const rCol = rp.color || (atmo.isDarkTheme ? [175, 205, 245] : [235, 245, 255]);
      // Draw crisp isometric elliptical pixel ring
      const steps = Math.max(10, Math.ceil(rx * 5));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const px = Math.round(sp[0] + Math.cos(a) * rx);
        const py = Math.round(sp[1] + Math.sin(a) * ry);
        buf.blendPx(px, py, rCol, alpha);
      }
    }

    // Register roof floor hitbox (low priority; props push on top)
    if (hitList) {
      hitList.push({
        type: 'roof',
        label: 'Tap roof',
        x0: p01[0],
        y0: p00[1],
        x1: p10[0],
        y1: p11[1],
        poly: [p00, p10, p11, p01],
      });
    }
  }

  /**
   * Renders the animated miniature pixel film onto the stairwell penthouse wall in Rooftop Cinema.
   */
  function drawCinemaScreen(buf, state, atmo, hitList) {
    const cm = state.env.cinemaMode;
    if (cm < 0.08) return;

    // Projected onto front-right face of stairwell penthouse (u = 14.5, v = 3.8..9.6, z = 23.5..31.5)
    const u = 14.55;
    const tl = project(u, 9.5, 31.2);
    const tr = project(u, 3.8, 31.2);
    const br = project(u, 3.8, 23.8);
    const bl = project(u, 9.5, 23.8);

    const ch = state.cinemaChannel % 4;
    const t = state.time;
    const flicker = 0.92 + 0.08 * Math.sin(t * 23.0);

    // Subtle dark screen border
    buf.line(tl[0] - 1, tl[1] - 1, tr[0] + 1, tr[1] - 1, [26, 30, 42], cm * 0.7);

    buf.fillPoly([tl, tr, br, bl], (x, y) => {
      const fx = clamp((x - tl[0]) / Math.max(1, tr[0] - tl[0]), 0, 1);
      const topY = tl[1] + (tr[1] - tl[1]) * fx;
      const fy = clamp((y - topY) / Math.max(1, bl[1] - tl[1]), 0, 1);

      let col = [26, 38, 68];
      if (ch === 0) {
        // Channel 0: Cosmic rocket ascending through stars & planet
        col = lerpRGB([18, 26, 56], [42, 62, 108], fy);
        // Ringed planet
        const pd = Math.hypot((fx - 0.72) * 1.4, fy - 0.34);
        if (pd < 0.16) col = [232, 168, 112];
        // Twinkling stars
        if (hash2(Math.floor(fx * 12), Math.floor(fy * 9)) > 0.9) col = [245, 248, 255];
        // Tiny rising rocket
        const ry = 0.85 - ((t * 0.32) % 1.0) * 0.8;
        const rx = 0.34 + Math.sin(t * 3) * 0.03;
        if (Math.abs(fx - rx) < 0.08 && Math.abs(fy - ry) < 0.12) {
          col = fy < ry ? [245, 96, 84] : [245, 245, 250];
        } else if (Math.abs(fx - rx) < 0.06 && fy > ry + 0.1 && fy < ry + 0.28) {
          col = [255, 208, 86];
        }
      } else if (ch === 1) {
        // Channel 1: Moonlit ocean & bobbing sailboat
        if (fy < 0.55) {
          col = lerpRGB([28, 42, 82], [82, 104, 152], fy / 0.55);
          if (Math.hypot(fx - 0.75, fy - 0.25) < 0.14) col = [255, 244, 196];
        } else {
          const wave = Math.sin(fx * 14 + t * 4.5) * 0.06;
          col = fy + wave > 0.7 ? [36, 76, 128] : [64, 118, 168];
          if (Math.abs(fx - 0.75) < 0.09 && ((Math.floor(fy * 10 + t * 3)) & 1) === 0) {
            col = [235, 224, 168];
          }
        }
        // Bobbing sailboat
        const bx = 0.25 + ((t * 0.12) % 0.5);
        const by = 0.56 + Math.sin(t * 3.5) * 0.03;
        if (Math.abs(fx - bx) < 0.1 && fy > by && fy < by + 0.1) col = [140, 82, 58];
        if (fx > bx - 0.02 && fx < bx + 0.09 && fy < by && fy > by - 0.22) col = [248, 246, 236];
      } else if (ch === 2) {
        // Channel 2: Sunset bridge & glowing express train
        col = lerpRGB([236, 118, 92], [252, 204, 124], fy);
        if (Math.hypot(fx - 0.5, fy - 0.52) < 0.18) col = [255, 242, 186];
        if (fy > 0.68) col = [48, 42, 64];
        // Passing train cars
        const tx = ((t * 0.55) % 1.4) - 0.2;
        if (fy > 0.56 && fy < 0.69 && fx > tx && fx < tx + 0.42) {
          const win = Math.floor((fx - tx) * 24) % 3 === 1 && fy < 0.63;
          col = win ? [255, 240, 168] : [58, 72, 104];
        }
      } else {
        // Channel 3: Retro arcade cat & bouncing ball
        col = [42, 56, 78];
        const ballX = 0.5 + Math.sin(t * 3.2) * 0.32;
        const ballY = 0.72 - Math.abs(Math.sin(t * 5.2)) * 0.42;
        if (Math.hypot(fx - ballX, fy - ballY) < 0.1) col = [255, 128, 152];
        // Silhouette cat bouncing on left
        if (fx > 0.14 && fx < 0.34 && fy > 0.52 && fy < 0.85) col = [248, 214, 134];
      }

      return mulRGB(col, flicker);
    }, cm * 0.94);

    // Soft glow spilling gently from screen without washing out the pixel artwork
    const scx = (tl[0] + br[0]) * 0.5;
    const scy = (tl[1] + br[1]) * 0.5;
    buf.line(tl[0], tl[1], tr[0], tr[1], [16, 20, 32], cm * 0.85);
    buf.line(bl[0], bl[1], br[0], br[1], [16, 20, 32], cm * 0.85);
    buf.line(tl[0], tl[1], bl[0], bl[1], [16, 20, 32], cm * 0.85);
    buf.line(tr[0], tr[1], br[0], br[1], [16, 20, 32], cm * 0.85);
    buf.ditherGlow(scx, scy, 9, 8, [160, 205, 255], cm * (0.14 + atmo.night * 0.16), true);

    if (hitList) {
      hitList.push({
        type: 'cinema',
        label: 'Switch movie channel',
        x0: Math.min(tl[0], bl[0]) - 2,
        y0: Math.min(tl[1], tr[1]) - 2,
        x1: Math.max(tr[0], br[0]) + 2,
        y1: Math.max(bl[1], br[1]) + 2,
        cx: scx,
        cy: scy,
      });
    }
  }

  /**
   * Builds all depth-sorted rooftop structures and props.
   */
  function collectRoofItems(buf, state, atmo, hitList) {
    const items = [];
    const Z = BUILDING.Z_ROOF;
    const snowCols = { bright: atmo.snowBright, mid: atmo.snowMid };
    const env = state.env;

    // ── 1. Stairwell Penthouse (back-left corner) ───────────────────
    items.push({
      depth: 14.5 + 10.5,
      draw() {
        const u0 = 4.5, u1 = 14.5, v0 = 3.0, v1 = 10.5;
        const zTop = Z + 13;

        drawIsoBox(buf, u0, v0, Z, u1, v1, zTop, {
          top: atmo.wallTop,
          left: atmo.wallLeft,
          right: atmo.wallRight,
          ink: atmo.ink,
          noise: 6,
          outlineOuter: true,
          weatherDrips: true,
        });

        // Concrete overhanging cap roof
        drawIsoBox(buf, u0 - 0.7, v0 - 0.7, zTop, u1 + 0.7, v1 + 0.7, zTop + 2.2, {
          top: atmo.copingLight,
          left: atmo.copingDark,
          right: atmo.wallRight,
          ink: atmo.ink,
          bevel: atmo.copingLight,
          noise: 4,
          outlineOuter: true,
          snowTop: env.snowLevel,
          snowColors: snowCols,
        });

        // Small rooftop exhaust pipe on stairwell roof
        drawIsoBox(buf, 6.2, 4.5, zTop + 2.2, 7.6, 5.9, zTop + 5.2, {
          top: atmo.copingDark,
          left: atmo.wallRight,
          right: atmo.wallInnerRight,
          ink: atmo.ink,
          noise: 2,
        });

        // Doorway on front-left wall (v = v1, u = 7.2..10.6, z = Z..Z+9.5)
        const dtl = project(7.2, v1, Z + 9.5);
        const dtr = project(10.6, v1, Z + 9.5);
        const dbr = project(10.6, v1, Z);
        const dbl = project(7.2, v1, Z);
        const doorOpen = state.doorOpen;
        const doorGlow = doorOpen || atmo.night > 0.25 || env.snowLevel > 0.45;

        buf.fillPoly([dtl, dtr, dbr, dbl], (x, y) => {
          const fx = clamp((x - dtl[0]) / Math.max(1, dtr[0] - dtl[0]), 0, 1);
          const topY = dtl[1] + (dtr[1] - dtl[1]) * fx;
          const fy = clamp((y - topY) / Math.max(1, dbl[1] - dtl[1]), 0, 1);
          if (doorOpen) {
            // Warm sunlit / tungsten stairwell interior visible
            return fy < 0.2 ? [255, 240, 190] : lerpRGB([246, 198, 114], [188, 132, 74], fy);
          }
          // Closed dark steel door with warm top transom light
          if (fy < 0.18 && doorGlow) return [255, 224, 146];
          if (fx > 0.72 && fx < 0.85 && fy > 0.5 && fy < 0.6) return [196, 182, 132]; // handle
          return fy < 0.5 ? atmo.windowGlassDeep : atmo.ink;
        });
        buf.line(dtl[0], dtl[1], dtr[0], dtr[1], atmo.ink, 0.85);
        buf.line(dtl[0], dtl[1], dbl[0], dbl[1], atmo.ink, 0.85);
        buf.line(dtr[0], dtr[1], dbr[0], dbr[1], atmo.ink, 0.85);

        // Warm doorway light spill onto roof floor when open or night/snow
        if (doorOpen || (doorGlow && (atmo.night > 0.22 || env.snowLevel > 0.5))) {
          const spDoor = project(8.9, v1 + 1.8, Z + 1);
          buf.ditherGlow(
            spDoor[0],
            spDoor[1],
            doorOpen ? 18 : 10,
            doorOpen ? 12 : 7,
            [255, 206, 118],
            doorOpen ? 0.65 : 0.34,
            true
          );
        }

        // Small louvred vent on right wall when cinema isn't covering it
        if (env.cinemaMode < 0.4) {
          const vtl = project(u1, 8.2, Z + 9.5);
          const vtr = project(u1, 5.2, Z + 9.5);
          const vbr = project(u1, 5.2, Z + 6.5);
          const vbl = project(u1, 8.2, Z + 6.5);
          buf.fillPoly([vtl, vtr, vbr, vbl], (x, y) => ((y & 1) === 0 ? atmo.ink : atmo.wallRight), 0.75);
        }

        // Cinema projection screen on front-right stairwell wall
        drawCinemaScreen(buf, state, atmo, hitList);

        // Register clickable doorway hitbox
        if (hitList) {
          hitList.push({
            type: 'door',
            label: doorOpen ? 'Close stairwell door' : 'Open stairwell door',
            x0: dtl[0] - 2,
            y0: dtl[1] - 2,
            x1: dbr[0] + 2,
            y1: dbr[1] + 2,
            cx: (dtl[0] + dbr[0]) * 0.5,
            cy: (dtl[1] + dbr[1]) * 0.5,
          });
        }
      },
    });

    // ── 2. Utility / Elevator Shack + Spinning Vent Turbine ─────────
    items.push({
      depth: 42.5 + 8.5,
      draw() {
        const u0 = 36.5, u1 = 42.2, v0 = 3.2, v1 = 8.4;
        const zTop = Z + 9.2;

        drawIsoBox(buf, u0, v0, Z, u1, v1, zTop, {
          top: atmo.wallTop,
          left: atmo.wallLeft,
          right: atmo.wallRight,
          ink: atmo.ink,
          noise: 6,
          outlineOuter: true,
        });

        // Overhanging roof slab
        drawIsoBox(buf, u0 - 0.6, v0 - 0.6, zTop, u1 + 0.6, v1 + 0.6, zTop + 1.8, {
          top: atmo.copingLight,
          left: atmo.copingDark,
          right: atmo.wallRight,
          ink: atmo.ink,
          bevel: atmo.copingLight,
          noise: 4,
          outlineOuter: true,
          snowTop: env.snowLevel,
          snowColors: snowCols,
        });

        // Metal access hatch on front-left face
        const htl = project(38.0, v1, Z + 6.5);
        const htr = project(40.8, v1, Z + 6.5);
        const hbr = project(40.8, v1, Z + 1.0);
        const hbl = project(38.0, v1, Z + 1.0);
        buf.fillPoly([htl, htr, hbr, hbl], atmo.windowFrame, 0.88);
        buf.line(htl[0], htl[1], htr[0], htr[1], atmo.ink, 0.7);
        buf.line(htl[0], htl[1], hbl[0], hbl[1], atmo.ink, 0.7);
        buf.line(htr[0], htr[1], hbr[0], hbr[1], atmo.ink, 0.7);

        // Spinning silver whirlybird vent turbine on top (1.5x detail)
        const turbPos = project(39.4, 5.8, zTop + 3.2);
        const tx = Math.round(turbPos[0]);
        const ty = Math.round(turbPos[1]);
        const phase = Math.floor(state.turbineAngle) % 4;
        const metalHi = atmo.applyLight([228, 234, 242]);
        const metalMid = atmo.applyLight([164, 174, 188]);
        const metalDk = atmo.applyLight([96, 106, 120]);
        // Neck collar
        buf.rect(tx - 1, ty, 3, 3, metalDk);
        buf.vline(tx - 1, ty, ty + 2, metalMid);
        // Rounded louver dome
        buf.hline(tx - 3, tx + 3, ty - 1, metalMid);
        buf.hline(tx - 3, tx + 3, ty - 2, metalHi);
        buf.hline(tx - 3, tx + 3, ty - 3, metalHi);
        buf.hline(tx - 2, tx + 2, ty - 4, metalHi);
        buf.hline(tx - 1, tx + 1, ty - 5, atmo.copingLight);
        // Spinning louver slats
        buf.vline(tx - 3 + phase, ty - 3, ty - 1, metalDk);
        buf.vline(tx - 2 + ((phase + 2) % 4), ty - 3, ty - 1, metalDk);

        if (hitList) {
          hitList.push({
            type: 'turbine',
            label: 'Spin roof vent turbine',
            x0: tx - 8,
            y0: ty - 8,
            x1: tx + 8,
            y1: ty + 12,
            cx: tx,
            cy: ty,
          });
        }
      },
    });

    // ── 3. Rooftop Garden Planter & Lush Potted Tree ────────────────
    items.push({
      depth: 10.6 + 20.6,
      draw() {
        const u0 = 4.6, u1 = 10.2, v0 = 15.0, v1 = 20.4;
        // Raised brick/wood planter box
        drawIsoBox(buf, u0, v0, Z, u1, v1, Z + 3.4, {
          top: atmo.soil,
          left: atmo.planter,
          right: atmo.planterShade,
          ink: atmo.ink,
          noise: 6,
          outlineOuter: true,
        });

        // Rim lip around planter
        const rim0 = project(u0, v0, Z + 3.4);
        const rim1 = project(u1, v0, Z + 3.4);
        const rim2 = project(u1, v1, Z + 3.4);
        const rim3 = project(u0, v1, Z + 3.4);
        buf.line(rim0[0], rim0[1], rim1[0], rim1[1], atmo.planter, 0.9);
        buf.line(rim1[0], rim1[1], rim2[0], rim2[1], atmo.planter, 0.9);
        buf.line(rim2[0], rim2[1], rim3[0], rim3[1], atmo.planter, 0.9);
        buf.line(rim3[0], rim3[1], rim0[0], rim0[1], atmo.planter, 0.9);

        // Companion potted herb & watering can next to planter
        const pot = project(11.6, 19.2, Z + 1);
        buf.rect(pot[0] - 3, pot[1] - 2, 6, 4, atmo.planter);
        buf.hline(pot[0] - 3, pot[0] + 2, pot[1] - 2, atmo.planterShade);
        buf.setPx(pot[0] - 2, pot[1] - 3, atmo.leafBright);
        buf.setPx(pot[0] + 1, pot[1] - 3, atmo.leafMid);
        buf.rect(pot[0] - 1, pot[1] - 5, 2, 2, atmo.leafBright);

        // Metal watering can at (11.4, 16.5)
        const wc = project(11.4, 16.5, Z + 1);
        const canCol = atmo.applyLight([132, 164, 178]);
        const canDk = atmo.applyLight([92, 120, 134]);
        buf.rect(wc[0] - 2, wc[1] - 2, 4, 3, canCol);
        buf.vline(wc[0] + 1, wc[1] - 2, wc[1], canDk);
        buf.line(wc[0] - 2, wc[1] - 1, wc[0] - 4, wc[1] - 3, canCol); // spout
        buf.vline(wc[0] + 2, wc[1] - 2, wc[1], atmo.ink); // handle

        // Tree trunk + lush 1.5x organic swaying pixel foliage crown
        const base = project(7.4, 17.7, Z + 3.2);
        const shake = Math.sin(state.time * 26) * state.treeShake * 2.5;
        const sway = Math.sin(state.time * (1.8 + env.windSpeed * 2.1)) * (0.6 + env.windSpeed * 1.0) + shake;

        const tx = Math.round(base[0]);
        const ty = Math.round(base[1]);

        // Trunk with root flare & shaded bark
        buf.vline(tx - 1, ty - 6, ty, atmo.bark);
        buf.vline(tx, ty - 8, ty, atmo.bark);
        buf.vline(tx + 1, ty - 7, ty, shiftRGB(atmo.bark, -20, -16, -12));
        buf.setPx(tx - 2, ty, atmo.bark);
        buf.setPx(tx + 2, ty, shiftRGB(atmo.bark, -20, -16, -12));

        // Multi-lobe pixel foliage clusters (scaled 1.5x!)
        const cx = tx + sway * 0.65;
        const cy = ty - 14;
        const lobes = [
          { ox: -5.5, oy: 2.2, r: 6.4 },
          { ox: 5.5, oy: 2.6, r: 6.0 },
          { ox: 0.0, oy: 3.0, r: 7.0 },
          { ox: -3.2, oy: -2.6, r: 6.5 },
          { ox: 3.4, oy: -2.2, r: 6.1 },
          { ox: 0.0, oy: -5.2, r: 5.8 },
        ];

        const minX = Math.floor(cx - 14);
        const maxX = Math.ceil(cx + 14);
        const minY = Math.floor(cy - 12);
        const maxY = Math.ceil(cy + 11);

        for (let py = minY; py <= maxY; py++) {
          for (let px = minX; px <= maxX; px++) {
            let best = 99;
            for (let l = 0; l < lobes.length; l++) {
              const lb = lobes[l];
              const d = Math.hypot((px - (cx + lb.ox)), (py - (cy + lb.oy)) * 1.1) / lb.r;
              if (d < best) best = d;
            }
            if (best < 1.0) {
              const n = hash2(px * 3 + 7, py * 5 + 11);
              if (best > 0.87 && n < 0.45) continue; // Crisp organic pixel silhouette edges

              // Shading: top-left brightest, bottom-right shaded
              const relX = (px - cx) / 12;
              const relY = (py - cy) / 10.5;
              let col = atmo.leafMid;
              if (relY < -0.15 && relX < 0.35 && n > 0.25) col = atmo.leafBright;
              else if (relY > 0.28 || relX > 0.42) col = atmo.leafDark;

              // Subtle tiny blossoms in Morning Laundry
              if (state.scenario.id === 'morning' && n > 0.93 && relY < 0.1) {
                col = atmo.applyLight([246, 212, 218]);
              }
              // Wet specular raindrops on foliage in Squall
              if (env.rainIntensity > 0.4 && n > 0.91 && relY < 0) {
                col = lerpRGB(col, [188, 216, 238], 0.55);
              }
              // Snow frosting cap on upper foliage in Snowfall (leaving crisp green-to-snow rim!)
              if (env.snowLevel > 0.15 && relY < 0.02) {
                const frost = clamp((env.snowLevel * 1.05 - (relY + 0.58) * 0.72), 0, 1);
                if (frost > 0.75 || frost > bayer4(px, py)) {
                  col = best > 0.78 ? atmo.snowShade : (relY < -0.25 ? atmo.snowBright : atmo.snowMid);
                }
              }

              buf.setPx(px, py, col);
            } else if (best < 1.14) {
              // Subtle dark ink rim along underside/right edge (and delicate cool outline on top in winter)
              if (py > cy + 2) buf.blendPx(px, py, atmo.ink, 0.38);
              else if (env.snowLevel > 0.25) buf.blendPx(px, py, atmo.ink, 0.26);
            }
          }
        }

        if (hitList) {
          hitList.push({
            type: 'tree',
            label: 'Shake rooftop tree',
            x0: minX,
            y0: minY,
            x1: maxX,
            y1: ty + 3,
            cx: tx,
            cy: cy,
          });
        }
      },
    });

    // ── 4. Clothesline Poles & Animated Wind-Blown Laundry ──────────
    items.push({
      depth: 22.0 + 11.5,
      draw() {
        const poleCol = atmo.applyLight([92, 98, 110]);
        const wireCol = atmo.applyLight([74, 80, 92]);

        // Two slender poles anchoring the foreground clothesline
        const pA0 = project(15.5, 11.5, Z);
        const pA1 = project(15.5, 11.5, Z + 9.5);
        const pB0 = project(34.5, 9.8, Z);
        const pB1 = project(34.5, 9.8, Z + 9.5);
        buf.line(pA0[0], pA0[1], pA1[0], pA1[1], poleCol, 0.9);
        buf.line(pB0[0], pB0[1], pB1[0], pB1[1], poleCol, 0.9);
        // Little crossbars
        buf.hline(pA1[0] - 1, pA1[0] + 1, pA1[1], poleCol);
        buf.hline(pB1[0] - 1, pB1[0] + 1, pB1[1], poleCol);

        // Two clotheslines: line 0 between poles, line 1 from stairwell to utility shed
        const lines = [
          { a: pA1, b: pB1, sag: 4.2 },
          { a: project(14.5, 6.5, Z + 9.0), b: project(36.5, 5.5, Z + 8.5), sag: 3.8 },
        ];

        const lineVisibility = clamp(env.laundryCount + 0.35, 0, 1);
        for (let li = 0; li < lines.length; li++) {
          const ln = lines[li];
          const steps = 28;
          let prevX = ln.a[0];
          let prevY = ln.a[1];
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const x = lerp(ln.a[0], ln.b[0], t);
            const sag = Math.sin(t * Math.PI) * ln.sag;
            const gust = Math.sin(state.time * (5 + env.windSpeed * 4) + t * 5 + li) * (0.25 + state.clothesGust * 1.2);
            const y = lerp(ln.a[1], ln.b[1], t) + sag + gust * Math.sin(t * Math.PI);
            buf.line(prevX, prevY, x, y, wireCol, 0.55 * lineVisibility);
            prevX = x;
            prevY = y;
          }
        }

        // Draw hanging laundry items
        const activeCount = Math.round(env.laundryCount * GARMENTS.length);
        for (let gi = 0; gi < activeCount; gi++) {
          const g = GARMENTS[gi];
          const ln = lines[g.line];
          const x = lerp(ln.a[0], ln.b[0], g.t);
          const sag = Math.sin(g.t * Math.PI) * ln.sag;
          const y = lerp(ln.a[1], ln.b[1], g.t) + sag;

          const windAmp = 0.5 + env.windSpeed * 1.5 + state.clothesGust * 2.5;
          const flap = Math.sin(state.time * (4.2 + env.windSpeed * 5.2) + gi * 1.7) * windAmp;
          const colBase = atmo.applyLight(g.col);
          const colShade = mulRGB(colBase, 0.78);
          const wet = env.rainIntensity > 0.3 ? 0.84 : 1.0;

          for (let row = 0; row < g.h; row++) {
            const rowFrac = row / Math.max(1, g.h - 1);
            const dx = Math.round(flap * rowFrac * rowFrac);
            const py = Math.round(y + row + 1);
            for (let col = 0; col < g.w; col++) {
              // Shirt notches at bottom corners
              if (g.shape === 'shirt' && row === 0 && (col === 0 || col === g.w - 1)) continue;
              const px = Math.round(x - g.w * 0.5 + col + dx);
              const c = (col === g.w - 1 || row === g.h - 1) ? mulRGB(colShade, wet) : mulRGB(colBase, wet);
              buf.setPx(px, py, c);
            }
          }
          // Tiny clothespin pixel
          buf.setPx(Math.round(x), Math.round(y), atmo.woodTop);
        }

        if (hitList && activeCount > 0) {
          hitList.push({
            type: 'clothesline',
            label: 'Gust the clothesline',
            x0: Math.min(pA1[0], pB1[0]) - 2,
            y0: Math.min(pA1[1], pB1[1]) - 3,
            x1: Math.max(pA1[0], pB1[0]) + 2,
            y1: Math.max(pA1[1], pB1[1]) + 9,
            cx: (pA1[0] + pB1[0]) * 0.5,
            cy: (pA1[1] + pB1[1]) * 0.5 + 2,
          });
        }
      },
    });

    // ── 5. AC Condenser Unit (front-right corner) ───────────────────
    items.push({
      depth: 42.5 + 19.5,
      draw() {
        const u0 = 38.6, u1 = 42.4, v0 = 15.8, v1 = 19.4;
        const acTop = atmo.applyLight([222, 226, 232]);
        const acLeft = atmo.applyLight([194, 200, 208]);
        const acRight = atmo.applyLight([162, 170, 180]);
        drawIsoBox(buf, u0, v0, Z, u1, v1, Z + 4.4, {
          top: acTop,
          left: acLeft,
          right: acRight,
          ink: atmo.ink,
          noise: 3,
          snowTop: env.snowLevel,
          snowColors: snowCols,
        });
        // Spinning fan grille on front-left face (1.5x detail)
        const fc = project(40.5, v1, Z + 2.2);
        const fx = Math.round(fc[0]);
        const fy = Math.round(fc[1]);
        buf.rect(fx - 3, fy - 2, 6, 4, atmo.ink, 0.72);
        const spin = Math.floor(state.time * 8) & 1;
        buf.setPx(fx - 1 + spin, fy - 1, acTop);
        buf.setPx(fx + 1 - spin, fy + 1, acTop);
        buf.setPx(fx, fy, acLeft);
      },
    });

    // ── 6. Wooden Rooftop Table / Grill / Popcorn Crate ─────────────
    items.push({
      depth: 31.2 + 20.2,
      draw() {
        const u0 = 26.8, u1 = 31.2, v0 = 16.8, v1 = 20.2;
        drawIsoBox(buf, u0, v0, Z, u1, v1, Z + 3.2, {
          top: atmo.woodTop,
          left: atmo.woodLeft,
          right: atmo.woodRight,
          ink: atmo.ink,
          bevel: atmo.woodTop,
          noise: 5,
          snowTop: env.snowLevel * 0.9,
          snowColors: snowCols,
        });

        const topC = project(29.0, 18.5, Z + 3.5);
        const tx = Math.round(topC[0]);
        const ty = Math.round(topC[1]);

        if (env.grillActive > 0.35) {
          // Glowing portable charcoal grill on table
          const gCol = atmo.applyLight([54, 58, 68]);
          buf.rect(tx - 4, ty - 3, 8, 4, gCol);
          const glow = 0.65 + 0.35 * Math.sin(state.time * 9.5 + state.grillStoke * 6);
          const emberA = [255, Math.round(112 + glow * 70), 34];
          const emberB = [255, 206, 86];
          buf.hline(tx - 3, tx + 3, ty - 3, emberA);
          buf.setPx(tx - 2, ty - 3, emberB);
          buf.setPx(tx + 1, ty - 3, emberB);
          buf.ditherGlow(tx, ty - 3, 10, 7, [255, 142, 64], 0.42 + state.grillStoke * 0.35, true);

          if (hitList) {
            hitList.push({
              type: 'grill',
              label: 'Stoke charcoal grill',
              x0: tx - 8,
              y0: ty - 8,
              x1: tx + 8,
              y1: ty + 6,
              cx: tx,
              cy: ty,
            });
          }
        } else if (env.cinemaMode > 0.35) {
          // Popcorn bowl + warm lantern mug
          buf.rect(tx - 3, ty - 3, 6, 3, [238, 92, 84]);
          buf.hline(tx - 3, tx + 2, ty - 4, [255, 242, 188]);
          buf.hline(tx - 2, tx + 1, ty - 5, [255, 248, 214]);
          buf.rect(tx + 4, ty - 2, 2, 2, [242, 232, 214]);
        } else if (env.snowLevel > 0.4) {
          // Warm steaming coffee mug perched on snow-dusted crate
          buf.rect(tx + 1, ty - 3, 3, 3, [212, 86, 72]);
          buf.setPx(tx + 4, ty - 2, [212, 86, 72]);
        } else if (state.scenario.id === 'morning') {
          // Morning coffee & folded paper
          buf.rect(tx - 4, ty - 2, 4, 3, [242, 240, 232]);
          buf.rect(tx + 2, ty - 3, 3, 3, [196, 112, 82]);
        } else {
          // Wet glistening top during Squall
          buf.hline(tx - 3, tx + 3, ty - 1, [236, 240, 246], 0.45);
        }
      },
    });

    // ── 7. Blue & Ochre Tarps / Tents / Chairs / Cushions ───────────
    items.push({
      depth: 35.2 + 16.8,
      draw() {
        const ripple = Math.sin(state.time * (5 + env.windSpeed * 5) + state.tarpShake * 10) * (0.4 + env.windSpeed * 0.4 + state.tarpShake);

        if (env.tarpsMode > 0.45) {
          // Pitched Blue & Ochre triangular rain tarps/tents (exact homage to reference!)
          // Blue tarp at (30.5..35.2, 13.5..17.6)
          const b0 = project(30.5, 17.6, Z);
          const b1 = project(35.2, 17.6, Z);
          const b2 = project(35.2, 13.5, Z);
          const bPeakL = project(31.2, 15.6, Z + 5.8 + ripple * 0.25);
          const bPeakR = project(34.5, 15.4, Z + 5.6 - ripple * 0.25);
          buf.fillPoly([b0, b1, bPeakR, bPeakL], atmo.blueTarp);
          buf.fillPoly([b1, b2, bPeakR], atmo.blueTarpDark);
          buf.line(b0[0], b0[1], bPeakL[0], bPeakL[1], atmo.ink, 0.55);
          buf.line(bPeakL[0], bPeakL[1], bPeakR[0], bPeakR[1], atmo.copingLight, 0.45);
          buf.line(b1[0], b1[1], bPeakR[0], bPeakR[1], atmo.ink, 0.45);
          buf.line(b2[0], b2[1], bPeakR[0], bPeakR[1], atmo.ink, 0.55);

          // Ochre-yellow tarp at (34.8..39.5, 10.2..14.0)
          const y0 = project(34.8, 14.0, Z);
          const y1 = project(39.4, 14.0, Z);
          const y2 = project(39.4, 10.2, Z);
          const yPeakL = project(35.5, 12.1, Z + 5.6 - ripple * 0.2);
          const yPeakR = project(38.7, 11.9, Z + 5.4 + ripple * 0.2);
          buf.fillPoly([y0, y1, yPeakR, yPeakL], atmo.ochreTarp);
          buf.fillPoly([y1, y2, yPeakR], atmo.ochreTarpDark);
          buf.line(y0[0], y0[1], yPeakL[0], yPeakL[1], atmo.ink, 0.55);
          buf.line(yPeakL[0], yPeakL[1], yPeakR[0], yPeakR[1], atmo.copingLight, 0.42);
          buf.line(y1[0], y1[1], yPeakR[0], yPeakR[1], atmo.ink, 0.42);
          buf.line(y2[0], y2[1], yPeakR[0], yPeakR[1], atmo.ink, 0.55);

          // Snow dusting on pitched winter tarp
          if (env.snowLevel > 0.35) {
            buf.line(bPeakL[0], bPeakL[1], bPeakR[0], bPeakR[1], atmo.snowBright, 0.9);
            buf.line(yPeakL[0], yPeakL[1], yPeakR[0], yPeakR[1], atmo.snowBright, 0.9);
          }

          if (hitList) {
            hitList.push({
              type: 'tarp',
              label: 'Shake rain tarps',
              x0: b0[0] - 2,
              y0: Math.min(bPeakL[1], yPeakL[1]) - 2,
              x1: y2[0] + 2,
              y1: b1[1] + 2,
              cx: (b0[0] + y2[0]) * 0.5,
              cy: (bPeakL[1] + b1[1]) * 0.5,
            });
          }
        } else if (env.cinemaMode > 0.4) {
          // Cozy blue & ochre floor cushions facing the stairwell wall
          const c1 = project(26.0, 9.5, Z + 0.5);
          const c2 = project(29.0, 12.2, Z + 0.5);
          const c3 = project(24.8, 13.8, Z + 0.5);
          drawIsoBox(buf, 24.5, 8.2, Z, 27.5, 10.8, Z + 1.3, {
            top: atmo.blueTarp, left: atmo.blueTarpDark, right: atmo.blueTarpDark, ink: atmo.ink, noise: 2,
          });
          drawIsoBox(buf, 27.6, 10.8, Z, 30.6, 13.5, Z + 1.3, {
            top: atmo.ochreTarp, left: atmo.ochreTarpDark, right: atmo.ochreTarpDark, ink: atmo.ink, noise: 2,
          });
          drawIsoBox(buf, 23.4, 12.2, Z, 26.2, 14.8, Z + 1.3, {
            top: atmo.applyLight([176, 98, 106]), left: atmo.applyLight([132, 72, 78]), right: atmo.applyLight([118, 62, 68]), ink: atmo.ink, noise: 2,
          });
          // Ensure variables used cleanly
          void c1; void c2; void c3;
        } else {
          // Morning & Golden Hour: cheerful blue & ochre folding chairs + wicker basket
          drawIsoBox(buf, 31.2, 13.8, Z, 34.0, 16.4, Z + 1.8, {
            top: atmo.blueTarp, left: atmo.blueTarpDark, right: atmo.woodRight, ink: atmo.ink, noise: 2,
          });
          // Chair backrest
          const bL = project(34.0, 16.4, Z + 1.8);
          const bR = project(34.0, 13.8, Z + 1.8);
          const bTL = project(34.5, 16.4, Z + 4.4);
          const bTR = project(34.5, 13.8, Z + 4.4);
          buf.fillPoly([bL, bR, bTR, bTL], atmo.blueTarp);
          buf.line(bTL[0], bTL[1], bTR[0], bTR[1], atmo.ink, 0.5);

          drawIsoBox(buf, 35.0, 10.8, Z, 37.8, 13.4, Z + 1.8, {
            top: atmo.ochreTarp, left: atmo.ochreTarpDark, right: atmo.woodRight, ink: atmo.ink, noise: 2,
          });
          const yL = project(37.8, 13.4, Z + 1.8);
          const yR = project(37.8, 10.8, Z + 1.8);
          const yTL = project(38.3, 13.4, Z + 4.4);
          const yTR = project(38.3, 10.8, Z + 4.4);
          buf.fillPoly([yL, yR, yTR, yTL], atmo.ochreTarp);
          buf.line(yTL[0], yTL[1], yTR[0], yTR[1], atmo.ink, 0.5);

          // Wicker laundry basket in Morning
          if (state.scenario.id === 'morning') {
            drawIsoBox(buf, 22.8, 14.2, Z, 25.4, 16.4, Z + 2.3, {
              top: atmo.applyLight([236, 232, 222]),
              left: atmo.woodTop,
              right: atmo.woodLeft,
              ink: atmo.ink,
              noise: 4,
            });
          }
        }
      },
    });

    // ── 8. Mini Tripod Movie Projector (Rooftop Cinema) ─────────────
    if (env.cinemaMode > 0.15) {
      items.push({
        depth: 21.5 + 10.2,
        draw() {
          const cm = env.cinemaMode;
          const pBase = project(21.4, 10.2, Z);
          const pHead = project(21.4, 10.2, Z + 4.4);
          const px = Math.round(pHead[0]);
          const py = Math.round(pHead[1]);

          // Tripod legs
          buf.line(px, py + 1, pBase[0] - 3, pBase[1] + 1, atmo.ink, 0.9);
          buf.line(px, py + 1, pBase[0] + 3, pBase[1] + 1, atmo.ink, 0.9);
          buf.line(px, py + 1, pBase[0], pBase[1] - 1, atmo.ink, 0.75);

          // Volumetric Bayer-dithered light cone beaming to stairwell wall
          const scrTop = project(14.6, 3.8, 31.0);
          const scrBot = project(14.6, 9.5, 24.0);
          const beamPoly = [[px - 2, py], scrTop, scrBot];
          const flicker = 0.85 + 0.15 * Math.sin(state.time * 24);
          buf.fillPoly(beamPoly, (x, y) => {
            const dist = Math.hypot(x - px, y - py) / 42;
            const d = clamp((1 - dist * 0.55) * 0.42 * cm * flicker, 0, 1);
            if (d > bayer4(x, y)) return [218, 234, 255];
            return null;
          }, 0.22);

          // Projector body + glowing lens
          buf.rect(px - 3, py - 2, 7, 4, [58, 66, 82]);
          buf.hline(px - 2, px + 3, py - 2, [88, 98, 118]);
          buf.rect(px - 3, py - 1, 2, 2, [232, 246, 255]); // Bright blue-white lens
          buf.ditherGlow(px - 3, py, 6, 6, [200, 232, 255], cm * 0.6, true);

          if (hitList) {
            hitList.push({
              type: 'cinema',
              label: 'Switch movie channel',
              x0: px - 7,
              y0: py - 6,
              x1: px + 7,
              y1: pBase[1] + 3,
              cx: px,
              cy: py,
            });
          }
        },
      });
    }

    // ── 9. Crisp Pixel Snowman (First Snowfall) ─────────────────────
    if (env.snowmanActive > 0.25) {
      items.push({
        depth: 19.8 + 18.2,
        draw() {
          const sp = project(19.8, 18.2, Z);
          const sx = Math.round(sp[0]);
          const sy = Math.round(sp[1]);
          const hop = Math.round(Math.sin(state.snowmanBounce * Math.PI) * -4.0);

          // Shadow base
          buf.hline(sx - 4, sx + 4, sy + 1, atmo.snowShade, 0.72);
          // Bottom snowball (7x5)
          buf.rect(sx - 3, sy - 5 + hop, 7, 5, atmo.snowMid);
          buf.rect(sx - 2, sy - 5 + hop, 5, 4, atmo.snowBright);
          buf.setPx(sx, sy - 4 + hop, atmo.ink); // coal button
          buf.setPx(sx, sy - 2 + hop, atmo.ink); // coal button
          // Ochre scarf
          buf.hline(sx - 3, sx + 3, sy - 6 + hop, [216, 152, 68]);
          buf.rect(sx + 2, sy - 5 + hop, 2, 3, [186, 118, 48]);
          // Head (5x4)
          buf.rect(sx - 2, sy - 10 + hop, 5, 4, atmo.snowMid);
          buf.rect(sx - 2, sy - 10 + hop, 4, 3, atmo.snowBright);
          buf.setPx(sx - 1, sy - 9 + hop, atmo.ink); // eye
          buf.setPx(sx + 1, sy - 9 + hop, atmo.ink); // eye
          buf.hline(sx, sx + 1, sy - 8 + hop, [238, 128, 46]); // carrot nose
          // Stick arms
          buf.line(sx - 4, sy - 4 + hop, sx - 6, sy - 7 + hop, atmo.bark);
          buf.line(sx + 4, sy - 4 + hop, sx + 6, sy - 7 + hop, atmo.bark);
          // Cozy beanie + pom-pom
          buf.hline(sx - 2, sx + 2, sy - 11 + hop, [186, 74, 72]);
          buf.hline(sx - 1, sx + 1, sy - 12 + hop, [214, 92, 86]);
          buf.setPx(sx, sy - 13 + hop, atmo.snowBright);

          if (hitList) {
            hitList.push({
              type: 'snowman',
              label: 'Boop the snowman',
              x0: sx - 7,
              y0: sy - 14,
              x1: sx + 7,
              y1: sy + 3,
              cx: sx,
              cy: sy - 6,
            });
          }
        },
      });
    }

    return items;
  }

  /**
   * Draws front parapet walls (occluding rooftop items behind them).
   */
  function drawFrontParapet(buf, state, atmo) {
    const { U, V, Z_ROOF, Z_PARAPET, WALL_T } = BUILDING;
    const snowCols = { bright: atmo.snowBright, mid: atmo.snowMid };

    // Front-left parapet wall (v: V-WALL_T..V, u: 0..U) — seamlessly merges into exterior facade!
    drawIsoBox(buf, 0, V - WALL_T, Z_ROOF, U, V, Z_PARAPET, {
      top: atmo.copingLight,
      left: atmo.wallLeft,
      right: atmo.wallRight,
      ink: atmo.ink,
      bevel: atmo.copingLight,
      noise: 5,
      outlineOuter: true,
      outlineBottom: false,
      drawRight: false,
      snowTop: state.env.snowLevel,
      snowColors: snowCols,
    });

    // Front-right parapet wall (u: U-WALL_T..U, v: 0..V)
    drawIsoBox(buf, U - WALL_T, 0, Z_ROOF, U, V, Z_PARAPET, {
      top: atmo.copingLight,
      left: atmo.wallLeft,
      right: atmo.wallRight,
      ink: atmo.ink,
      bevel: atmo.copingLight,
      noise: 5,
      outlineOuter: true,
      outlineBottom: false,
      drawLeft: false,
      snowTop: state.env.snowLevel,
      snowColors: snowCols,
    });

    // Crisp outer silhouette touch-up along the corner miter & inner top ridge
    const pCorner = project(U, V, Z_PARAPET);
    const pCornerBot = project(U, V, Z_ROOF);
    const pLeftTop = project(0, V, Z_PARAPET);
    const pRightTop = project(U, 0, Z_PARAPET);
    const pInnerFront = project(U - WALL_T, V - WALL_T, Z_PARAPET);
    const pInnerLeft = project(WALL_T, V - WALL_T, Z_PARAPET);
    const pInnerRight = project(U - WALL_T, WALL_T, Z_PARAPET);

    buf.line(pLeftTop[0], pLeftTop[1], pCorner[0], pCorner[1], atmo.ink, 0.55);
    buf.line(pCorner[0], pCorner[1], pRightTop[0], pRightTop[1], atmo.ink, 0.55);
    buf.line(pCorner[0], pCorner[1] + 1, pCornerBot[0], pCornerBot[1], atmo.ink, 0.22);
    buf.line(pInnerLeft[0], pInnerLeft[1], pInnerFront[0], pInnerFront[1], atmo.ink, 0.3);
    buf.line(pInnerFront[0], pInnerFront[1], pInnerRight[0], pInnerRight[1], atmo.ink, 0.3);

    // Subtle stone coping joint notches along the front-left top rim
    for (let u = 6; u < U - 2; u += 8) {
      const j0 = project(u, V - WALL_T, Z_PARAPET);
      const j1 = project(u, V, Z_PARAPET);
      buf.line(j0[0], j0[1], j1[0], j1[1], atmo.ink, 0.16);
    }
  }

  /**
   * Draws overhead festoon Edison string lights & refined warm Bayer-dithered light halos.
   */
  function drawStringLights(buf, state, atmo) {
    const Z = BUILDING.Z_ROOF;
    const strength = clamp(
      Math.max(state.env.stringLights, atmo.lightsOn * 0.85),
      0,
      1
    );
    if (strength < 0.12) return;

    // Draped cleanly between stairwell front-right roof corner, utility shack, and terrace pole
    const strands = [
      { a: project(14.8, 10.6, Z + 13.0), b: project(36.4, 8.2, Z + 9.8), sag: 6.8, bulbs: 6 },
      { a: project(34.5, 9.8, Z + 9.4), b: project(36.5, 19.8, Z + 7.2), sag: 6.0, bulbs: 5 },
    ];

    const wireCol = atmo.isDarkTheme ? [52, 62, 88] : [92, 98, 112];

    for (let si = 0; si < strands.length; si++) {
      const st = strands[si];
      const steps = 26;
      let px = st.a[0];
      let py = st.a[1];
      const sway = Math.sin(state.time * 1.9 + si * 2) * (0.35 + state.env.windSpeed * 0.35);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const nx = lerp(st.a[0], st.b[0], t);
        const ny = lerp(st.a[1], st.b[1], t) + Math.sin(t * Math.PI) * (st.sag + sway);
        buf.line(px, py, nx, ny, wireCol, 0.42 * strength);
        px = nx;
        py = ny;
      }

      // Delicate glowing Edison bulbs (crisp & warm, never overwhelming the roof below!)
      for (let b = 1; b <= st.bulbs; b++) {
        const t = b / (st.bulbs + 1);
        const bx = Math.round(lerp(st.a[0], st.b[0], t));
        const by = Math.round(lerp(st.a[1], st.b[1], t) + Math.sin(t * Math.PI) * (st.sag + sway)) + 1;
        const twinkle = 0.88 + 0.12 * Math.sin(state.time * 3.1 + b * 2.3 + si * 4);
        const glowAmt = strength * twinkle;

        if (glowAmt > 0.28) {
          const glowR = 3.5 + atmo.night * 2.5;
          buf.ditherGlow(bx, by, glowR, glowR * 0.85, [255, 204, 104], glowAmt * (0.18 + atmo.night * 0.24), true);
          buf.setPx(bx, by, [255, 248, 212]);
          buf.blendPx(bx, by + 1, [255, 210, 114], 0.72);
        } else {
          buf.setPx(bx, by, atmo.copingLight);
        }
      }
    }
  }

  Diorama.Architecture = {
    WINDOWS,
    PUDDLES,
    drawBuildingShell,
    drawRoofFloorAndBackParapet,
    collectRoofItems,
    drawFrontParapet,
    drawStringLights,
  };
})(window);
