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
        if (p.kind === 'flame' || p.kind === 'smoke' || p.kind === 'ember') {
          // Rising: no ground contact
          if (p.age >= p.maxAge) this.list.splice(i, 1);
          continue;
        }
        if (p.kind === 'ash') {
          p.vz = Math.max(p.vz, -1.4);
          p.u += Math.sin(p.age * 2 + p.v) * dt * 0.6;
          if (p.z <= 0 || p.age >= p.maxAge) this.list.splice(i, 1);
          continue;
        }
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
        const x = Math.round(sp[0]);
        const y = Math.round(sp[1]);
        if (p.kind === 'flame') {
          const k = p.age / p.maxAge;
          const c = k < 0.25 ? [255, 244, 186] : k < 0.55 ? [255, 176, 64] : [214, 76, 40];
          buf.setPx(x, y, c);
          if (p.size > 1 && k < 0.6) {
            buf.setPx(x + 1, y, c);
            buf.setPx(x, y - 1, c);
          }
          continue;
        }
        if (p.kind === 'ember') {
          buf.setPx(x, y, (p.age * 10) % 2 < 1 ? [255, 200, 90] : [255, 120, 50]);
          continue;
        }
        if (p.kind === 'smoke') {
          const k = p.age / p.maxAge;
          const a = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * (p.alpha || 0.4);
          const col = atmo.applyLight(p.col);
          const r = 1 + Math.floor(k * (p.size || 3));
          for (let yy = -r; yy <= r; yy++) {
            for (let xx = -r; xx <= r; xx++) {
              if (xx * xx + yy * yy > r * r + 1) continue;
              if (a < bayer4(x + xx, y + yy)) continue;
              buf.blendPx(x + xx, y + yy, col, 0.75);
            }
          }
          continue;
        }
        const col = p.lit === false ? p.col : atmo.applyLight(p.col);
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

  // ── Fire: emitters that spawn flames + smoke and light their surroundings ──
  class FireFX {
    constructor(proj, particles) {
      this.proj = proj;
      this.particles = particles;
      this.list = [];
    }

    add(u, v, z, size, opts) {
      const e = Object.assign({ u, v, z: z || 0, size: size || 1, acc: 0, smokeAcc: Math.random(), smoke: true, spread: 0.6 }, opts || {});
      this.list.push(e);
      return e;
    }

    remove(e) {
      const i = this.list.indexOf(e);
      if (i >= 0) this.list.splice(i, 1);
    }

    update(dt, wind) {
      const P = this.particles;
      const w = wind || 0.6;
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i];
        e.acc += dt * 30 * e.size;
        while (e.acc > 1) {
          e.acc -= 1;
          P.spawn({
            kind: 'flame',
            u: e.u + (Math.random() - 0.5) * e.spread * e.size,
            v: e.v + (Math.random() - 0.5) * e.spread * e.size,
            z: e.z + Math.random() * 0.6,
            vu: (Math.random() - 0.5) * 0.4 + w * 0.2,
            vv: (Math.random() - 0.5) * 0.4 - w * 0.1,
            vz: 3 + Math.random() * 3.5 * e.size,
            gravity: -1.5,
            maxAge: 0.35 + Math.random() * 0.45,
            size: Math.random() < 0.4 ? 2 : 1,
          });
        }
        if (Math.random() < dt * 2.5 * e.size) {
          P.spawn({ kind: 'ember', u: e.u, v: e.v, z: e.z + 2, vu: (Math.random() - 0.3) * 1.5 + w, vv: (Math.random() - 0.5) * 1.5, vz: 4 + Math.random() * 4, gravity: 0.5, maxAge: 1.2 + Math.random() });
        }
        if (e.smoke) {
          e.smokeAcc += dt * 3 * e.size;
          while (e.smokeAcc > 1) {
            e.smokeAcc -= 1;
            P.spawn({
              kind: 'smoke', u: e.u, v: e.v, z: e.z + 3 + e.size * 1.5,
              vu: w * 0.7 + (Math.random() - 0.5) * 0.4, vv: -w * 0.3 + (Math.random() - 0.5) * 0.4,
              vz: 2.2 + Math.random() * 1.6, gravity: -0.3,
              maxAge: 3 + Math.random() * 2.5, col: [64, 60, 62], size: 3 + e.size * 2, alpha: 0.5,
            });
          }
        }
      }
    }

    drawGlow(buf, atmo, t) {
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i];
        const p = this.proj.project(e.u, e.v, e.z + 1);
        const fl = 0.82 + 0.18 * Math.sin(t * 17 + e.u * 3) * Math.sin(t * 7.3 + e.v);
        const s = e.size * fl;
        buf.ditherGlow(p[0], p[1], 12 * s + 4, 7 * s + 3, [255, 150, 60], 0.45 + (atmo.night || 0) * 0.45, true);
      }
    }
  }

  // ── Navigation grid (1×1 cells) + A* for walls/interiors ──
  class NavGrid {
    constructor(world, margin) {
      this.margin = margin == null ? 0.42 : margin;
      this.W = Math.ceil(world.U);
      this.H = Math.ceil(world.V);
      this.block = new Uint8Array(this.W * this.H);
      this.rebuild(world);
    }

    rebuild(world) {
      const m = this.margin;
      const b = world.bounds || { u0: 0.8, v0: 0.8, u1: world.U - 0.8, v1: world.V - 0.8 };
      for (let y = 0; y < this.H; y++) {
        for (let x = 0; x < this.W; x++) {
          const u = x + 0.5;
          const v = y + 0.5;
          let blk = u < b.u0 || u > b.u1 || v < b.v0 || v > b.v1;
          if (!blk && world.boxes) {
            for (let i = 0; i < world.boxes.length; i++) {
              const bx = world.boxes[i];
              if (u > bx.u0 - m && u < bx.u1 + m && v > bx.v0 - m && v < bx.v1 + m) { blk = true; break; }
            }
          }
          if (!blk && world.obstacles) {
            for (let i = 0; i < world.obstacles.length; i++) {
              const o = world.obstacles[i];
              if (Math.hypot(u - o.u, v - o.v) < o.r + m) { blk = true; break; }
            }
          }
          this.block[y * this.W + x] = blk ? 1 : 0;
        }
      }
    }

    blocked(u, v) {
      const x = Math.floor(u);
      const y = Math.floor(v);
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return true;
      return this.block[y * this.W + x] === 1;
    }

    lineClear(u0, v0, u1, v1) {
      const d = Math.hypot(u1 - u0, v1 - v0);
      const n = Math.ceil(d / 0.35);
      for (let i = 1; i < n; i++) {
        const k = i / n;
        if (this.blocked(u0 + (u1 - u0) * k, v0 + (v1 - v0) * k)) return false;
      }
      return true;
    }

    nearestFree(x, y) {
      if (x >= 0 && y >= 0 && x < this.W && y < this.H && !this.block[y * this.W + x]) return [x, y];
      for (let r = 1; r < 6; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= this.W || yy >= this.H) continue;
            if (!this.block[yy * this.W + xx]) return [xx, yy];
          }
        }
      }
      return null;
    }

    findPath(u0, v0, u1, v1) {
      const W = this.W;
      const s = this.nearestFree(Math.floor(u0), Math.floor(v0));
      const g = this.nearestFree(Math.floor(u1), Math.floor(v1));
      if (!s || !g) return null;
      const start = s[1] * W + s[0];
      const goal = g[1] * W + g[0];
      const N = W * this.H;
      const gScore = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const heap = [];
      const push = (i, f) => {
        heap.push([f, i]);
        let c = heap.length - 1;
        while (c > 0) {
          const p = (c - 1) >> 1;
          if (heap[p][0] <= heap[c][0]) break;
          const tmp = heap[p]; heap[p] = heap[c]; heap[c] = tmp;
          c = p;
        }
      };
      const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let c = 0;
          for (;;) {
            const l = c * 2 + 1;
            const r = l + 1;
            let m = c;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === c) break;
            const tmp = heap[m]; heap[m] = heap[c]; heap[c] = tmp;
            c = m;
          }
        }
        return top;
      };
      const hx = g[0];
      const hy = g[1];
      const h = (i) => {
        const dx = Math.abs((i % W) - hx);
        const dy = Math.abs(((i / W) | 0) - hy);
        return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
      };
      gScore[start] = 0;
      push(start, h(start));
      let found = false;
      let iter = 0;
      while (heap.length && iter++ < 4000) {
        const cur = pop()[1];
        if (cur === goal) { found = true; break; }
        if (closed[cur]) continue;
        closed[cur] = 1;
        const cx = cur % W;
        const cy = (cur / W) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= this.H) continue;
            const ni = ny * W + nx;
            if (this.block[ni] || closed[ni]) continue;
            if (dx && dy && (this.block[cy * W + nx] || this.block[ny * W + cx])) continue; // no corner cutting
            const ng = gScore[cur] + (dx && dy ? 1.414 : 1);
            if (ng < gScore[ni]) {
              gScore[ni] = ng;
              came[ni] = cur;
              push(ni, ng + h(ni));
            }
          }
        }
      }
      if (!found) return null;
      const path = [];
      let c = goal;
      while (c !== -1 && c !== start) {
        path.push({ u: (c % W) + 0.5, v: ((c / W) | 0) + 0.5 });
        c = came[c];
      }
      path.reverse();
      path.push({ u: u1, v: v1 });
      return path;
    }
  }

  // ── Generic iso box with a given projector ──
  function box(buf, proj, u0, v0, z0, u1, v1, z1, top, left, right, ink) {
    const p = proj.project;
    if (left) buf.fillPoly([p(u0, v1, z1), p(u1, v1, z1), p(u1, v1, z0), p(u0, v1, z0)], left);
    if (right) buf.fillPoly([p(u1, v1, z1), p(u1, v0, z1), p(u1, v0, z0), p(u1, v1, z0)], right);
    if (top) buf.fillPoly([p(u0, v0, z1), p(u1, v0, z1), p(u1, v1, z1), p(u0, v1, z1)], top);
    if (ink) {
      const a = p(u0, v1, z0);
      const b = p(u1, v1, z0);
      const c = p(u1, v0, z0);
      const d = p(u0, v0, z1);
      const e = p(u1, v0, z1);
      const f = p(u0, v1, z1);
      buf.line(a[0], a[1], b[0], b[1], ink, 0.5);
      buf.line(b[0], b[1], c[0], c[1], ink, 0.5);
      buf.line(d[0], d[1], e[0], e[1], ink, 0.35);
      buf.line(d[0], d[1], f[0], f[1], ink, 0.35);
    }
  }

  // Box from a palette colour: top lighter, left base, right shaded
  function shadedBox(buf, proj, u0, v0, z0, u1, v1, z1, col, L, ink) {
    const c = L(col);
    box(buf, proj, u0, v0, z0, u1, v1, z1, shiftRGB(c, 18, 18, 18), c, mulRGB(c, 0.78), ink);
  }

  /**
   * Building block with window grid on the two visible faces.
   * opts: { wall, roof, glass, lit (0..1 share of lit windows), ruined (0..1), burnt, floors, seed, sign }
   */
  function drawBlock(buf, proj, u0, v0, u1, v1, h, L, opts) {
    const p = proj.project;
    const o = opts || {};
    const wall = L(o.wall || [196, 186, 172]);
    const wallR = mulRGB(wall, 0.8);
    const roof = L(o.roof || [150, 146, 142]);
    const glass = L(o.glass || [70, 96, 112]);
    const frame = mulRGB(wall, 0.72);
    const litC = [255, 214, 130];
    const seed = o.seed || 1;
    const ruin = o.ruined || 0;
    const floorH = 3.2;
    const topAt = (s) => {
      // ruined silhouette: jagged top edge
      if (!ruin) return h;
      const n = hash2(Math.floor(s * 1.3) + seed * 17, 7) * ruin;
      return h * (1 - n * 0.55);
    };
    const faceFn = (face, base) => (x, y) => {
      // reconstruct position on the face
      let s;
      let yTop;
      let yBot;
      if (face === 'L') {
        s = (x + 0.5 - proj.ox) / 3 + v1; // u coordinate
        const pb = p(s, v1, 0);
        yBot = pb[1];
      } else {
        s = u1 - (x + 0.5 - proj.ox) / 3; // v coordinate
        const pb = p(u1, s, 0);
        yBot = pb[1];
      }
      const z = (yBot - (y + 0.5)) / 1.5;
      if (z > topAt(s)) return null;
      const fl = Math.floor(z / floorH);
      const zf = z - fl * floorH;
      const col = Math.floor(s / 2.2);
      const sf = s - col * 2.2;
      const n = hash2(x * 3 + seed, y * 5);
      let c = base;
      if (o.burnt && hash2(x + seed, y >> 2) < o.burnt * 0.7) c = mulRGB(c, 0.45);
      if (n > 0.93) c = shiftRGB(c, -10, -10, -10);
      if (fl === 0 && o.shop) {
        // storefront: big glass + sign band
        if (zf > 2.4) return o.sign ? L(o.sign) : frame;
        if (zf > 0.3 && sf > 0.2 && sf < 2.0) return o.burnt ? [30, 26, 26] : glass;
        return c;
      }
      if (zf > 1.0 && zf < 2.5 && sf > 0.55 && sf < 1.65) {
        if (o.burnt && hash2(col + seed, fl) < o.burnt) {
          return hash2(col * 3 + seed, fl * 7) < 0.3 && o.fireWin ? [255, 150, 60] : [26, 22, 24];
        }
        const lit = hash2(col + seed * 3, fl * 11) < (o.lit || 0);
        if (lit) return litC;
        return zf > 2.25 || sf < 0.65 ? frame : glass;
      }
      return c;
    };
    buf.fillPoly([p(u0, v1, h), p(u1, v1, h), p(u1, v1, 0), p(u0, v1, 0)], faceFn('L', wall));
    buf.fillPoly([p(u1, v1, h), p(u1, v0, h), p(u1, v0, 0), p(u1, v1, 0)], faceFn('R', wallR));
    if (!ruin) {
      buf.fillPoly([p(u0, v0, h), p(u1, v0, h), p(u1, v1, h), p(u0, v1, h)], roof);
      const a = p(u0, v1, h);
      const b = p(u1, v1, h);
      const c = p(u1, v0, h);
      buf.line(a[0], a[1], b[0], b[1], shiftRGB(roof, 24, 24, 24));
      buf.line(b[0], b[1], c[0], c[1], shiftRGB(roof, 14, 14, 14));
    }
    const ink = [54, 60, 72];
    const a = p(u0, v1, 0);
    const b = p(u1, v1, 0);
    const c = p(u1, v0, 0);
    buf.line(a[0], a[1], b[0], b[1], ink, 0.5);
    buf.line(b[0], b[1], c[0], c[1], ink, 0.5);
  }

  /**
   * Car along 'u' or 'v'. opts: { color, police, lightsT, wreck, burnt }
   */
  function drawCar(buf, proj, u, v, along, L, opts) {
    const o = opts || {};
    const len = 2.2;
    const wid = 1.0;
    const u0 = along === 'u' ? u - len : u - wid;
    const u1 = along === 'u' ? u + len : u + wid;
    const v0 = along === 'u' ? v - wid : v - len;
    const v1 = along === 'u' ? v + wid : v + len;
    let body = o.police ? [236, 238, 242] : o.color || [176, 60, 56];
    if (o.burnt) body = lerpRGB(body, [56, 50, 48], 0.85);
    const bc = L(body);
    const glass = o.burnt ? L([30, 28, 30]) : L([70, 98, 118]);
    const ink = L([40, 42, 50]);
    const pr = proj.project;
    // shadow
    const s0 = pr(u0, v1, 0);
    const s1 = pr(u1, v1, 0);
    buf.line(s0[0], s0[1] + 1, s1[0], s1[1] + 1, [20, 22, 28], 0.3);
    // wheels
    const wheel = L([34, 34, 40]);
    const wp = along === 'u'
      ? [[u0 + 0.6, v1], [u1 - 0.6, v1], [u1, v0 + 0.4]]
      : [[u1, v0 + 0.6], [u1, v1 - 0.6], [u0 + 0.4, v1]];
    wp.forEach((w) => {
      const q = pr(w[0], w[1], 0.4);
      buf.rect(Math.round(q[0]) - 1, Math.round(q[1]) - 1, 2, 2, wheel);
    });
    box(buf, proj, u0, v0, 0.5, u1, v1, 1.6, shiftRGB(bc, 14, 14, 14), bc, mulRGB(bc, 0.78), ink);
    // cabin
    const ci = 0.25;
    const cu0 = along === 'u' ? u0 + 0.9 : u0 + ci;
    const cu1 = along === 'u' ? u1 - 0.7 : u1 - ci;
    const cv0 = along === 'u' ? v0 + ci : v0 + 0.9;
    const cv1 = along === 'u' ? v1 - ci : v1 - 0.7;
    box(buf, proj, cu0, cv0, 1.6, cu1, cv1, 2.6, o.police ? L([30, 40, 70]) : shiftRGB(bc, 10, 10, 10), glass, mulRGB(glass, 0.8), ink);
    if (o.police) {
      // blue stripe + light bar
      const a = pr(u0, v1, 1.1);
      const b = pr(u1, v1, 1.1);
      buf.line(a[0], a[1], b[0], b[1], L([40, 70, 170]));
      const lb = pr((cu0 + cu1) / 2, (cv0 + cv1) / 2, 2.8);
      const on = Math.floor((o.lightsT || 0) * 6) % 2 === 0;
      buf.rect(Math.round(lb[0]) - 3, Math.round(lb[1]) - 1, 3, 2, on ? [255, 60, 60] : [120, 30, 30]);
      buf.rect(Math.round(lb[0]), Math.round(lb[1]) - 1, 3, 2, on ? [70, 110, 160] : [80, 160, 255]);
      if (o.lightsT != null) {
        buf.ditherGlow(lb[0] + (on ? -2 : 2), lb[1], 18, 10, on ? [255, 60, 60] : [70, 140, 255], 0.5, true);
      }
    }
    if (o.wreck) {
      // smashed windshield + dent
      const q = pr(along === 'u' ? cu1 : cu1, along === 'u' ? cv1 : cv1, 2.1);
      buf.setPx(Math.round(q[0]) - 1, Math.round(q[1]), [220, 230, 236]);
      buf.setPx(Math.round(q[0]), Math.round(q[1]) - 1, [220, 230, 236]);
    }
    return { u0, v0, u1, v1 };
  }

  /**
   * Army truck driving along +u (front at higher u). Centre (u, v).
   * opts: { color, canvas, doorOpen (0..1), lightsOn, wreck, burnt, tilt }
   * Returns the footprint { u0, v0, u1, v1, door: {u, v} }.
   */
  function drawTruck(buf, proj, u, v, L, opts) {
    const o = opts || {};
    const pr = proj.project;
    let body = o.color || [92, 104, 70];
    let tarp = o.canvas || [124, 128, 92];
    if (o.burnt) {
      body = lerpRGB(body, [50, 46, 44], 0.8);
      tarp = lerpRGB(tarp, [46, 42, 40], 0.85);
    }
    const bc = L(body);
    const tc = L(tarp);
    const ink = L([34, 36, 40]);
    const wid = 1.15;
    const v0 = v - wid;
    const v1 = v + wid;
    const cargo = [u - 2.6, u + 0.5];
    const cab = [u + 0.6, u + 2.4];
    // shadow
    for (let k = 1; k <= 3; k++) {
      const a = pr(cargo[0], v1, 0);
      const b = pr(cab[1], v1, 0);
      buf.line(a[0], a[1] + k, b[0], b[1] + k, [16, 18, 22], 0.22 / k);
    }
    // wheels
    const wheel = L([30, 30, 34]);
    const hub = L([120, 120, 110]);
    [[cargo[0] + 0.7, v1], [cargo[0] + 1.9, v1], [cab[1] - 0.6, v1], [cab[1], v0 + 0.5]].forEach((w) => {
      const q = pr(w[0], w[1], 0.55);
      buf.rect(Math.round(q[0]) - 2, Math.round(q[1]) - 2, 4, 4, wheel);
      buf.setPx(Math.round(q[0]), Math.round(q[1]), hub);
    });
    // chassis
    box(buf, proj, cargo[0], v0, 0.6, cab[1], v1, 1.2, mulRGB(bc, 0.7), mulRGB(bc, 0.6), mulRGB(bc, 0.5), ink);
    // cargo bed with canvas cover
    box(buf, proj, cargo[0], v0, 1.2, cargo[1], v1, 2.0, shiftRGB(bc, 10, 10, 10), bc, mulRGB(bc, 0.78), ink);
    box(buf, proj, cargo[0], v0 + 0.05, 2.0, cargo[1], v1 - 0.05, 4.4, shiftRGB(tc, 16, 16, 12), tc, mulRGB(tc, 0.78), ink);
    // canvas ribs
    for (let k = 1; k <= 3; k++) {
      const uu = cargo[0] + ((cargo[1] - cargo[0]) * k) / 4;
      const a = pr(uu, v1 - 0.05, 2.0);
      const b = pr(uu, v1 - 0.05, 4.4);
      buf.line(a[0], a[1], b[0], b[1], mulRGB(tc, 0.82));
    }
    // cab
    box(buf, proj, cab[0], v0, 1.2, cab[1], v1, 3.3, shiftRGB(bc, 14, 14, 14), bc, mulRGB(bc, 0.8), ink);
    // windshield on the front face (u = cab[1])
    const glass = o.burnt ? L([24, 22, 24]) : L([84, 112, 130]);
    buf.fillPoly([pr(cab[1], v1 - 0.25, 3.1), pr(cab[1], v0 + 0.25, 3.1), pr(cab[1], v0 + 0.25, 2.25), pr(cab[1], v1 - 0.25, 2.25)], glass);
    // side window + door on the visible side (v = v1)
    const dw0 = cab[0] + 0.25;
    const dw1 = cab[1] - 0.35;
    buf.fillPoly([pr(dw0, v1, 3.0), pr(dw1, v1, 3.0), pr(dw1, v1, 2.3), pr(dw0, v1, 2.3)], glass);
    // grille + headlights
    const g0 = pr(cab[1], v1 - 0.2, 1.9);
    const g1 = pr(cab[1], v0 + 0.2, 1.9);
    buf.line(g0[0], g0[1], g1[0], g1[1], ink);
    const hl1 = pr(cab[1], v1 - 0.3, 1.6);
    const hl2 = pr(cab[1], v0 + 0.3, 1.6);
    const hlc = o.lightsOn ? [255, 248, 210] : L([200, 196, 170]);
    buf.rect(Math.round(hl1[0]) - 1, Math.round(hl1[1]) - 1, 2, 2, hlc);
    buf.rect(Math.round(hl2[0]) - 1, Math.round(hl2[1]) - 1, 2, 2, hlc);
    if (o.lightsOn) {
      buf.ditherGlow(hl1[0] + 6, hl1[1] + 3, 14, 7, [255, 240, 190], 0.45, true);
      buf.ditherGlow(hl2[0] + 6, hl2[1] + 3, 14, 7, [255, 240, 190], 0.45, true);
    }
    // star decal on the door
    const st = pr((cab[0] + cab[1]) / 2, v1, 1.75);
    buf.setPx(Math.round(st[0]), Math.round(st[1]), L([230, 226, 200]));
    // open door swings out toward +v
    const door = { u: (cab[0] + cab[1]) / 2, v: v1 + 0.9 };
    if (o.doorOpen > 0.01) {
      const ang = o.doorOpen * 1.2;
      const hu = cab[0] + 0.2;
      const du = Math.cos(ang) * 1.3;
      const dv = Math.sin(ang) * 1.3;
      buf.fillPoly([pr(hu, v1, 3.0), pr(hu + du, v1 + dv, 3.0), pr(hu + du, v1 + dv, 1.3), pr(hu, v1, 1.3)], mulRGB(bc, 0.9));
      buf.line(pr(hu, v1, 3.0)[0], pr(hu, v1, 3.0)[1], pr(hu + du, v1 + dv, 3.0)[0], pr(hu + du, v1 + dv, 3.0)[1], ink, 0.6);
    }
    if (o.wreck) {
      const q = pr(cab[1], v, 2.7);
      buf.setPx(Math.round(q[0]), Math.round(q[1]), [236, 240, 244]);
      buf.setPx(Math.round(q[0]) - 1, Math.round(q[1]) + 1, [236, 240, 244]);
      buf.setPx(Math.round(q[0]) + 1, Math.round(q[1]) - 1, [236, 240, 244]);
    }
    return { u0: cargo[0], v0, u1: cab[1], v1, door };
  }

  // Thin wall segment with optional windows (for interiors); opts { h, col, windows:[{a0,a1}], boarded }
  function drawWall(buf, proj, u0, v0, u1, v1, L, opts) {
    const o = opts || {};
    const h = o.h || 4;
    const c = L(o.col || [214, 206, 192]);
    box(buf, proj, u0, v0, 0, u1, v1, h, L(o.capCol || [238, 232, 222]), c, mulRGB(c, 0.8), L([60, 60, 70]));
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
    FireFX,
    NavGrid,
    box,
    shadedBox,
    drawBlock,
    drawCar,
    drawTruck,
    drawWall,
    BLOOD_MID,
    BLOOD_DARK,
    BLOOD_HI,
  };
})(window);
