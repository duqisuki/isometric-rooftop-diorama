(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { hash2, shiftRGB, lerpRGB, mulRGB, bayer4, clamp } = Diorama.Palette;

  const CANVAS_W = 350;
  const CANVAS_H = 264;
  const ISO_SCALE = 1.5;
  const ORIGIN_X = 142;
  const ORIGIN_Y = 148;

  // Main building bounds in logical world iso units (projected at 1.5x exact 2:1 scale)
  const BUILDING = {
    U: 46,
    V: 24,
    Z_ROOF: 22,
    Z_PARAPET: 26,
    WALL_T: 2.5,
  };

  function project(u, v, z = 0) {
    return [
      ORIGIN_X + (u - v) * (2 * ISO_SCALE),
      ORIGIN_Y + (u + v) * ISO_SCALE - z * ISO_SCALE,
    ];
  }

  function unproject(sx, sy, z = BUILDING.Z_ROOF) {
    const dx = (sx - ORIGIN_X) / (2 * ISO_SCALE);
    const dy = (sy - ORIGIN_Y + z * ISO_SCALE) / ISO_SCALE;
    return [
      (dx + dy) * 0.5,
      (dy - dx) * 0.5,
    ];
  }

  /**
   * Draws an exact isometric pixel box [u0..u1, v0..v1, z0..z1] with
   * textured concrete/wood planes, subtle edge bevels, and crisp ink lines.
   */
  function drawIsoBox(buf, u0, v0, z0, u1, v1, z1, opts) {
    const {
      top,
      left,
      right,
      ink,
      bevel,
      noise = 6,
      outlineOuter = true,
      outlineTop = false,
      outlineBottom = true,
      drawTop = true,
      drawLeft = true,
      drawRight = true,
      weatherDrips = false,
      snowTop = 0,
      snowColors = null,
    } = opts;

    const p001 = project(u0, v0, z1); // back top
    const p101 = project(u1, v0, z1); // right top
    const p111 = project(u1, v1, z1); // front top
    const p011 = project(u0, v1, z1); // left top

    const p100 = project(u1, v0, z0); // right bot
    const p110 = project(u1, v1, z0); // front bot
    const p010 = project(u0, v1, z0); // left bot

    const makeTextured = (baseCol, seedOffset, isWall) => {
      if (!noise && !weatherDrips) return baseCol;
      return (x, y) => {
        const n = (hash2(x + seedOffset, y + seedOffset * 3) - 0.5) * noise * 2;
        let dr = n;
        let dg = n;
        let db = n;
        if (isWall && weatherDrips) {
          const streak = hash2(x, 19);
          if (streak > 0.87) {
            const drip = (hash2(x, y >> 2) - 0.3) * 8;
            dr -= Math.max(0, drip);
            dg -= Math.max(0, drip);
            db -= Math.max(0, drip);
          }
        }
        return shiftRGB(baseCol, dr, dg, db);
      };
    };

    // Left-front face (v = v1)
    if (drawLeft && left) {
      buf.fillPoly([p011, p111, p110, p010], makeTextured(left, 11, true));
    }

    // Right-front face (u = u1)
    if (drawRight && right) {
      buf.fillPoly([p111, p101, p100, p110], makeTextured(right, 37, true));
    }

    // Top face (z = z1)
    if (drawTop && top) {
      if (snowTop > 0.05 && snowColors) {
        buf.fillPoly([p001, p101, p111, p011], (x, y) => {
          const n = hash2(x * 3, y * 5);
          const cov = clamp(snowTop * 1.15 - n * 0.28, 0, 1);
          if (cov > bayer4(x, y)) {
            return n > 0.55 ? snowColors.bright : snowColors.mid;
          }
          const g = (hash2(x + 7, y + 13) - 0.5) * noise * 2;
          return shiftRGB(top, g, g, g);
        });
      } else {
        buf.fillPoly([p001, p101, p111, p011], makeTextured(top, 73, false));
      }
    }

    // Subtle sunlit ridge bevels on front-top edges
    if (bevel && drawTop) {
      buf.line(p011[0], p011[1], p111[0], p111[1], bevel, 0.55);
      buf.line(p111[0], p111[1], p101[0], p101[1], bevel, 0.35);
    }

    // Subtle crease along front vertical edge between left & right walls
    if (drawLeft && drawRight && ink) {
      buf.line(p111[0], p111[1] + 1, p110[0], p110[1], ink, 0.22);
    }

    // Crisp outer silhouette ink outline
    if (outlineOuter && ink) {
      if (drawTop) {
        buf.line(p001[0], p001[1], p101[0], p101[1], ink, 0.78);
        buf.line(p001[0], p001[1], p011[0], p011[1], ink, 0.78);
      }
      if (outlineTop && drawTop) {
        buf.line(p011[0], p011[1], p111[0], p111[1], ink, 0.45);
        buf.line(p111[0], p111[1], p101[0], p101[1], ink, 0.45);
      }
      if (drawLeft) {
        buf.line(p011[0], p011[1], p010[0], p010[1], ink, 0.85);
        if (outlineBottom) buf.line(p010[0], p010[1], p110[0], p110[1], ink, 0.88);
      }
      if (drawRight) {
        buf.line(p101[0], p101[1], p100[0], p100[1], ink, 0.85);
        if (outlineBottom) buf.line(p110[0], p110[1], p100[0], p100[1], ink, 0.88);
      }
    }

    return { p001, p101, p111, p011, p100, p110, p010 };
  }

  /**
   * Draws a recessed isometric window on either the front-left (+v) facade
   * or front-right (+u) facade, complete with frame, sill, weathering, glass sheen,
   * optional lit warm interior + curtain/blinds + soft glow.
   */
  function drawIsoWindow(buf, spec, atmo, isLit, litFlicker, hitList) {
    const { face, u0, u1, v0, v1, z0, z1, id, roomStyle } = spec;

    let tl, tr, br, bl;
    if (face === 'left') {
      // On v = BUILDING.V, spanning u0..u1
      tl = project(u0, v1, z1);
      tr = project(u1, v1, z1);
      br = project(u1, v1, z0);
      bl = project(u0, v1, z0);
    } else {
      // On u = BUILDING.U, spanning v1..v0 (left-to-right on screen goes from v1 to v0!)
      tl = project(u1, v1, z1);
      tr = project(u1, v0, z1);
      br = project(u1, v0, z0);
      bl = project(u1, v1, z0);
    }

    // Subtle dark moisture stain beneath sill
    const stainB0 = [bl[0], bl[1] + 2];
    const stainB1 = [br[0], br[1] + 2];
    const stainB2 = [br[0], br[1] + 5];
    const stainB3 = [bl[0], bl[1] + 5];
    buf.fillPoly([stainB0, stainB1, stainB2, stainB3], atmo.ink, 0.08);

    // Recessed dark frame shadow along top & inner jamb
    buf.fillPoly([tl, tr, br, bl], (x, y) => {
      // Compute local normalized coordinates inside window quad
      const wSpan = Math.max(1, tr[0] - tl[0]);
      const fx = clamp((x - tl[0]) / wSpan, 0, 1);
      const topY = tl[1] + (tr[1] - tl[1]) * fx;
      const hSpan = Math.max(1, bl[1] - tl[1]);
      const fy = clamp((y - topY) / hSpan, 0, 1);

      // Outer recessed frame border on top & left/right jamb
      if (fy < 0.13) return atmo.windowFrame;
      if (face === 'left' && fx < 0.14) return atmo.windowFrame;
      if (face === 'right' && fx > 0.86) return atmo.windowFrame;

      // Center vertical mullion + upper horizontal transom sash
      if (Math.abs(fx - 0.5) < 0.075 || Math.abs(fy - 0.42) < 0.06) {
        return isLit ? lerpRGB(atmo.windowFrame, atmo.windowLit, 0.28) : atmo.windowFrame;
      }

      if (isLit) {
        // Cozy warm room glow, brighter lower down, subtle curtain/TV tint
        let col = fy > 0.48 ? atmo.windowLitCore : atmo.windowLit;
        if (roomStyle === 'tv') {
          // Subtle blue-cyan flickering television glow in one apartment
          col = lerpRGB([132, 192, 245], [186, 224, 255], 0.4 + 0.6 * litFlicker);
        } else if (roomStyle === 'curtain' && (fx < 0.27 || fx > 0.75)) {
          col = lerpRGB(atmo.windowLit, [196, 132, 82], 0.45);
        } else {
          col = mulRGB(col, 0.94 + 0.08 * litFlicker);
        }
        return col;
      }

      // Unlit deep slate-teal glass with crisp diagonal skylight reflection
      const diag = fx * 0.7 + fy * 0.55;
      if (diag > 0.48 && diag < 0.61) return atmo.windowGlassShine;
      if (fy < 0.42) return atmo.windowGlassDeep;
      return atmo.windowGlass;
    });

    // Crisp outer outline on top & sides
    buf.line(tl[0], tl[1], tr[0], tr[1], atmo.ink, 0.58);
    buf.line(tl[0], tl[1], bl[0], bl[1], atmo.ink, 0.45);
    buf.line(tr[0], tr[1], br[0], br[1], atmo.ink, 0.45);

    // Protruding 2px stone sill at bottom of window
    const sillCol = isLit ? lerpRGB(atmo.windowSill, atmo.windowLit, 0.35) : atmo.windowSill;
    buf.line(bl[0] - 1, bl[1] + 1, br[0] + 1, br[1] + 1, sillCol, 0.95);
    buf.line(bl[0] - 1, bl[1] + 2, br[0] + 1, br[1] + 2, atmo.windowFrame, 0.55);
    buf.line(bl[0], bl[1] + 3, br[0], br[1] + 3, atmo.ink, 0.28);

    // Warm dithered spill light on surrounding wall when lit at dusk/night
    if (isLit && (atmo.night > 0.15 || atmo.storm > 0.3)) {
      const cx = (tl[0] + br[0]) * 0.5;
      const cy = (tl[1] + br[1]) * 0.5 + 1;
      const glowCol = roomStyle === 'tv' ? [120, 185, 255] : [255, 198, 102];
      const strength = 0.28 + atmo.night * 0.46;
      buf.ditherGlow(cx, cy, 12, 13, glowCol, strength, true);
    }

    // Register clickable hitbox
    if (hitList) {
      const minX = Math.min(tl[0], tr[0], br[0], bl[0]) - 1;
      const maxX = Math.max(tl[0], tr[0], br[0], bl[0]) + 1;
      const minY = Math.min(tl[1], tr[1], br[1], bl[1]) - 1;
      const maxY = Math.max(tl[1], tr[1], br[1], bl[1]) + 2;
      hitList.push({
        type: 'window',
        id,
        label: isLit ? 'Turn off apartment light' : 'Turn on apartment light',
        x0: minX,
        y0: minY,
        x1: maxX,
        y1: maxY,
        cx: (minX + maxX) * 0.5,
        cy: (minY + maxY) * 0.5,
      });
    }
  }

  /**
   * Projects a soft isometric shadow polygon onto the roof floor z = Z_ROOF.
   */
  function drawRoofCastShadow(buf, u0, v0, u1, v1, height, atmo) {
    if (atmo.shadowAlpha < 0.03) return;
    const du = atmo.sunDir[0] * height;
    const dv = atmo.sunDir[1] * height;
    const z = BUILDING.Z_ROOF;

    // Clamp shadow coordinates inside the rooftop interior floor
    const cu = (val) => clamp(val, BUILDING.WALL_T, BUILDING.U - BUILDING.WALL_T);
    const cv = (val) => clamp(val, BUILDING.WALL_T, BUILDING.V - BUILDING.WALL_T);

    const pts = [
      project(cu(u0), cv(v0), z),
      project(cu(u1), cv(v0), z),
      project(cu(u1 + du), cv(v0 + dv), z),
      project(cu(u1 + du), cv(v1 + dv), z),
      project(cu(u0 + du), cv(v1 + dv), z),
      project(cu(u0), cv(v1), z),
    ];

    const shadeCol = atmo.night > 0.5 ? [14, 18, 32] : [36, 40, 56];
    buf.fillPoly(pts, (x, y) => {
      // Slightly dithered shadow fringe
      return shadeCol;
    }, atmo.shadowAlpha * 0.65);
  }

  Diorama.Iso = {
    CANVAS_W,
    CANVAS_H,
    ISO_SCALE,
    ORIGIN_X,
    ORIGIN_Y,
    BUILDING,
    project,
    unproject,
    drawIsoBox,
    drawIsoWindow,
    drawRoofCastShadow,
  };
})(window);
