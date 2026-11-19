/*
 * Story Kit — shared building blocks for story chapters:
 *  - iso projector with a per-chapter origin
 *  - LitLayer: a static, pre-baked ground layer that is re-lit every frame (cheap)
 *  - Decals: blood pools / splatter / footprints on the ground
 *  - Particles: world-space blood, water, feathers, leaves
 *  - drawTree / drawEmote helpers in the same pixel style as the rooftop
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { clamp, lerp, lerpRGB, mulRGB, shiftRGB, hash2, bayer4 } = Diorama.Palette;
  const S = Diorama.Iso.ISO_SCALE;

  function makeProjector(ox, oy) {
    function project(u, v, z) {
      z = z || 0;
      return [ox + (u - v) * 2 * S, oy + (u + v) * S - z * S];
    }
    function unproject(sx, sy, z) {
      z = z || 0;
      const dx = (sx - ox) / (2 * S);
      const dy = (sy - oy + z * S) / S;
      return [(dx + dy) * 0.5, (dy - dx) * 0.5];
    }
    return { project, unproject, ox, oy, S };
  }

  // ── LitLayer: static pixels baked once, multiplied by ambient light each frame ──
  class LitLayer {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.buf = new Diorama.PixelBuffer(w, h);
      this.mask = new Uint8Array(w * h);
      this.x0 = 0;
      this.y0 = 0;
      this.x1 = w - 1;
      this.y1 = h - 1;
    }

    // Paint a polygon; fn(x, y) returns rgb or null.
    fillPoly(pts, fn) {
      const mask = this.mask;
      const w = this.w;
      this.buf.fillPoly(pts, (x, y) => {
        const c = typeof fn === 'function' ? fn(x, y) : fn;
        if (c) mask[y * w + x] = 1;
        return c;
      });
    }

    setPx(x, y, rgb) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
      this.buf.setPx(ix, iy, rgb);
      this.mask[iy * this.w + ix] = 1;
    }

    // Only blends over pixels that already exist in the layer (e.g. shadows on grass)
    blendPx(x, y, rgb, a) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
      if (!this.mask[iy * this.w + ix]) return;
      this.buf.blendPx(ix, iy, rgb, a);
    }

    finalize() {
      let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
      for (let y = 0; y < this.h; y++) {
        const row = y * this.w;
        for (let x = 0; x < this.w; x++) {
          if (this.mask[row + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    }

    // Composite onto dst, multiplying RGB by amb = [r, g, b] (≈1.0 = unlit)
    composite(dst, amb) {
      const ar = (amb[0] * 256) | 0;
      const ag = (amb[1] * 256) | 0;
      const ab = (amb[2] * 256) | 0;
      const src = this.buf.u8;
      const out = dst.u8;
      const mask = this.mask;
      const w = this.w;
      for (let y = this.y0; y <= this.y1; y++) {
        const row = y * w;
        for (let x = this.x0; x <= this.x1; x++) {
          const i = row + x;
          if (!mask[i]) continue;
          const o = i << 2;
          const r = (src[o] * ar) >> 8;
          const g = (src[o + 1] * ag) >> 8;
          const b = (src[o + 2] * ab) >> 8;
          out[o] = r > 255 ? 255 : r;
          out[o + 1] = g > 255 ? 255 : g;
          out[o + 2] = b > 255 ? 255 : b;
          out[o + 3] = 255;
        }
      }
    }
  }

  // ── Decals: blood on the ground (pools, splats, drag smears, footprints) ──
  const BLOOD_DARK = [96, 12, 20];
  const BLOOD_MID = [148, 22, 32];
  const BLOOD_HI = [196, 48, 54];

  class Decals {
    constructor(proj) {
      this.proj = proj;
      this.list = [];
    }

    add(u, v, r, opts) {
      opts = opts || {};
      if (this.list.length > 420) this.list.splice(0, 40);
      const d = {
        u, v,
        r: opts.grow ? 0.05 : r,
        maxR: r,
        grow: opts.grow || 0, // units per second
        seed: Math.random() * 1000,
        kind: opts.kind || 'pool',
        dark: opts.dark || 0,
        z: opts.z || 0,
      };
      this.list.push(d);
      return d;
    }

    update(dt) {
      for (let i = 0; i < this.list.length; i++) {
        const d = this.list[i];
        if (d.grow > 0 && d.r < d.maxR) {
          d.r = Math.min(d.maxR, d.r + d.grow * dt * (1.15 - d.r / d.maxR));
        }
        if (d.dark < 1) d.dark = Math.min(1, d.dark + dt * 0.025);
      }
    }

    draw(buf, atmo) {
      const proj = this.proj;
      const dark = atmo.applyLight(BLOOD_DARK);
      const mid = atmo.applyLight(BLOOD_MID);
      const hi = atmo.applyLight(BLOOD_HI);
      for (let i = 0; i < this.list.length; i++) {
        const d = this.list[i];
        if (d.kind === 'foot') {
          const p = proj.project(d.u, d.v, d.z);
          buf.blendPx(Math.round(p[0]), Math.round(p[1]), mid, 0.75 * (1 - d.dark * 0.5));
          continue;
        }
        const r = d.r;
        if (r < 0.12) {
          const p = proj.project(d.u, d.v, d.z);
          buf.setPx(Math.round(p[0]), Math.round(p[1]), mid);
          continue;
        }
        const c = proj.project(d.u, d.v, d.z);
        const rx = Math.ceil(r * 2 * S * 1.45) + 1;
        const ry = Math.ceil(r * S * 1.45) + 1;
        const cx = Math.round(c[0]);
        const cy = Math.round(c[1]);
        const coreCol = lerpRGB(mid, dark, d.dark * 0.85);
        for (let y = cy - ry; y <= cy + ry; y++) {
          for (let x = cx - rx; x <= cx + rx; x++) {
            const uv = proj.unproject(x + 0.5, y + 0.5, d.z);
            const du = uv[0] - d.u;
            const dv = uv[1] - d.v;
            const ang = Math.atan2(dv, du);
            const wob = 1 + 0.22 * Math.sin(ang * 3 + d.seed) + 0.12 * Math.sin(ang * 7 + d.seed * 1.7);
            const dist = Math.hypot(du, dv) / (r * wob);
            if (dist > 1) continue;
            let col = coreCol;
            if (dist > 0.78) col = dark;
            else if (dist < 0.32 && hash2(x + (d.seed | 0), y) > 0.82) col = hi;
            if (d.kind === 'splat' && dist > 0.6 && hash2(x * 3, y * 7 + (d.seed | 0)) > 0.55) continue;
            buf.setPx(x, y, col);
          }
        }
      }
    }
  }

  // ── Particles in world space (u, v, z) ──
  class Particles {
    constructor(proj, decals) {
      this.proj = proj;
      this.decals = decals;
      this.list = [];
    }

    spawn(p) {
      if (this.list.length > 600) return;
      this.list.push(Object.assign({
        vu: 0, vv: 0, vz: 0, z: 0, age: 0, maxAge: 1.2, gravity: 38, kind: 'blood', size: 1,
        col: BLOOD_MID,
      }, p));
    }

    bloodBurst(u, v, z, n, power) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.6 + Math.random()) * (power || 3);
        this.spawn({
          u, v, z,
          vu: Math.cos(a) * s,
          vv: Math.sin(a) * s,
          vz: 6 + Math.random() * 10,
          maxAge: 1.6,
          col: Math.random() < 0.3 ? BLOOD_HI : BLOOD_MID,
          size: Math.random() < 0.25 ? 2 : 1,
        });
      }
    }

    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.age += dt;
        p.u += p.vu * dt;
        p.v += p.vv * dt;
        p.z += p.vz * dt;
        p.vz -= p.gravity * dt;
        if (p.kind === 'feather' || p.kind === 'leaf') {
          p.vz = Math.max(p.vz, -3);
          p.u += Math.sin(p.age * 5 + p.u) * dt * 0.8;
        }
        if (p.z <= (p.floor || 0) && p.vz < 0) {
          if (p.kind === 'blood' && this.decals) {
            this.decals.add(p.u, p.v, 0.12 + Math.random() * 0.22, { kind: 'splat', z: p.floor || 0 });
          }
          if (p.kind === 'water' || p.kind === 'blood') {
            this.list.splice(i, 1);
            continue;
          }
          p.z = p.floor || 0;
          p.vz = 0;
          p.vu *= 0.5;
          p.vv *= 0.5;
        }
        if (p.age >= p.maxAge) this.list.splice(i, 1);
      }
    }

    draw(buf, atmo) {
      for (let i = 0; i < this.list.length; i++) {
        const p = this.list[i];
        const sp = this.proj.project(p.u, p.v, p.z);
        const col = p.lit === false ? p.col : atmo.applyLight(p.col);
        const x = Math.round(sp[0]);
        const y = Math.round(sp[1]);
        const fade = 1 - clamp((p.age - p.maxAge * 0.7) / (p.maxAge * 0.3), 0, 1);
        if (fade < 1 && fade < bayer4(x, y)) continue;
        buf.setPx(x, y, col);
        if (p.size > 1) buf.setPx(x + 1, y, col);
      }
    }
  }

  // ── Trees (generalised from the rooftop tree; same lobe shading) ──
  function makeTreeShape(seed, size, kind) {
    const lobes = [];
    const rnd = (k) => hash2((seed * 97) | 0, k * 13 + 5);
    if (kind === 'tall') {
      // Poplar / cypress: stacked narrow lobes
      for (let i = 0; i < 6; i++) {
        lobes.push({ ox: (rnd(i) - 0.5) * 3 * size, oy: (2 - i * 4.4) * size, r: (6.2 - i * 0.55) * size });
      }
    } else {
      const n = 6 + Math.floor(rnd(1) * 3);
      lobes.push({ ox: 0, oy: 2.2 * size, r: 7.2 * size });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(i + 2) * 0.7;
        const rr = (4.6 + rnd(i + 9) * 1.8) * size;
        lobes.push({ ox: Math.cos(a) * rr * 0.95, oy: Math.sin(a) * rr * 0.62 - 1.5 * size, r: (5.4 + rnd(i + 4) * 1.6) * size });
      }
    }
    let ext = 0;
    for (const l of lobes) ext = Math.max(ext, Math.abs(l.ox) + l.r, Math.abs(l.oy) + l.r);
    return { lobes, ext: Math.ceil(ext) + 1, size, kind, seed };
  }

  /**
   * Draw a tree whose trunk base is at screen (bx, by).
   * pal: { leafBright, leafMid, leafDark, bark, ink, blossom? }
   */
  function drawTree(buf, bx, by, shape, sway, pal, opts) {
    opts = opts || {};
    const tx = Math.round(bx);
    const ty = Math.round(by);
    const size = shape.size;
    const trunkH = Math.round((shape.kind === 'tall' ? 7 : 9) * size);
    const barkDk = shiftRGB(pal.bark, -22, -18, -14);

    buf.vline(tx - 1, ty - trunkH + 2, ty, pal.bark);
    buf.vline(tx, ty - trunkH, ty, pal.bark);
    buf.vline(tx + 1, ty - trunkH + 1, ty, barkDk);
    buf.setPx(tx - 2, ty, pal.bark);
    buf.setPx(tx + 2, ty, barkDk);

    const cx = tx + sway * 0.65;
    const cy = ty - trunkH - 6 * size;
    const ext = shape.ext;
    const lobes = shape.lobes;
    const minX = Math.floor(cx - ext);
    const maxX = Math.ceil(cx + ext);
    const minY = Math.floor(cy - ext);
    const maxY = Math.ceil(cy + ext * 0.85);
    const seedI = shape.seed | 0;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        let best = 99;
        for (let l = 0; l < lobes.length; l++) {
          const lb = lobes[l];
          const d = Math.hypot(px - (cx + lb.ox), (py - (cy + lb.oy)) * 1.1) / lb.r;
          if (d < best) best = d;
        }
        if (best < 1.0) {
          const n = hash2(px * 3 + 7 + seedI, py * 5 + 11);
          if (best > 0.87 && n < 0.45) continue;
          const relX = (px - cx) / ext;
          const relY = (py - cy) / ext;
          let col = pal.leafMid;
          if (relY < -0.12 && relX < 0.35 && n > 0.25) col = pal.leafBright;
          else if (relY > 0.3 || relX > 0.45) col = pal.leafDark;
          if (pal.blossom && n > 0.84 && relY < 0.25) col = n > 0.94 ? pal.blossomHi || pal.blossom : pal.blossom;
          if (opts.burnt) col = lerpRGB(col, [70, 62, 54], opts.burnt);
          buf.setPx(px, py, col);
        } else if (best < 1.14) {
          if (py > cy + 2) buf.blendPx(px, py, pal.ink, 0.38);
        }
      }
    }
    return { minX, maxX, minY, maxY: ty + 2, cx, cy };
  }

  // ── Emote bubbles ──
  const EMOTES = {
    exclaim: ['..X..', '..X..', '..X..', '.....', '..X..'],
    double: ['.X.X.', '.X.X.', '.X.X.', '.....', '.X.X.'],
    question: ['.XXX.', '....X', '..XX.', '.....', '..X..'],
    heart: ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
    note: ['..XXX', '..X.X', '..X..', 'XXX..', 'XX...'],
    dots: ['.....', '.....', '.....', '.....', 'X.X.X'],
    skull: ['.XXX.', 'X.X.X', 'XXXXX', '.X.X.', '.....'],
  };
  const EMOTE_COLORS = {
    exclaim: [236, 98, 52],
    double: [214, 52, 52],
    question: [68, 126, 204],
    heart: [226, 78, 92],
    note: [68, 126, 204],
    dots: [90, 98, 112],
    skull: [60, 64, 74],
  };

  function drawEmote(buf, cx, cy, kind, alpha) {
    const spr = EMOTES[kind];
    if (!spr) return;
    const bx = Math.round(cx) - 4;
    const by = Math.round(cy) - 8;
    buf.rect(bx, by, 9, 7, [252, 252, 255], alpha * 0.94);
    buf.setPx(bx + 4, by + 7, [252, 252, 255]);
    const col = EMOTE_COLORS[kind] || [60, 60, 60];
    for (let r = 0; r < spr.length; r++) {
      for (let c = 0; c < spr[r].length; c++) {
        if (spr[r][c] === 'X') buf.blendPx(bx + 2 + c, by + 1 + r, col, alpha);
      }
    }
  }

  // Dithered soft ellipse (for baked shadows)
  function ditherEllipse(layer, cx, cy, rx, ry, col, alpha) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const k = d > 0.7 ? 0.5 : 1;
        if (k < 1 && bayer4(x, y) > 0.5) continue;
        layer.blendPx(x, y, col, alpha);
      }
    }
  }

  function easeInOut(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  Diorama.StoryKit = {
    makeProjector,
    LitLayer,
    Decals,
    Particles,
    makeTreeShape,
    drawTree,
    drawEmote,
    ditherEllipse,
    easeInOut,
    BLOOD_MID,
    BLOOD_DARK,
    BLOOD_HI,
  };
})(window);
