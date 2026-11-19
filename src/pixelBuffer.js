(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { pack, packRGB, bayer4, bayer8, clamp } = Diorama.Palette;

  class PixelBuffer {
    constructor(width, height) {
      this.width = width | 0;
      this.height = height | 0;
      this.imageData = new ImageData(this.width, this.height);
      this.u8 = this.imageData.data;
      this.u32 = new Uint32Array(this.imageData.data.buffer);
    }

    clear(rgb) {
      this.u32.fill(packRGB(rgb));
    }

    clearU32(u32) {
      this.u32.fill(u32);
    }

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    setPx(x, y, rgb) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
      this.u32[iy * this.width + ix] = packRGB(rgb);
    }

    setPxU32(x, y, u32) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
      this.u32[iy * this.width + ix] = u32;
    }

    getPxRGB(x, y) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return [0, 0, 0];
      const o = (iy * this.width + ix) << 2;
      return [this.u8[o], this.u8[o + 1], this.u8[o + 2]];
    }

    blendPx(x, y, rgb, alpha) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
      if (alpha <= 0) return;
      if (alpha >= 1) {
        this.u32[iy * this.width + ix] = packRGB(rgb);
        return;
      }
      const o = (iy * this.width + ix) << 2;
      const inv = 1 - alpha;
      this.u8[o] = (this.u8[o] * inv + rgb[0] * alpha) | 0;
      this.u8[o + 1] = (this.u8[o + 1] * inv + rgb[1] * alpha) | 0;
      this.u8[o + 2] = (this.u8[o + 2] * inv + rgb[2] * alpha) | 0;
      this.u8[o + 3] = 255;
    }

    darkenPx(x, y, factor) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
      const o = (iy * this.width + ix) << 2;
      this.u8[o] = (this.u8[o] * factor) | 0;
      this.u8[o + 1] = (this.u8[o + 1] * factor) | 0;
      this.u8[o + 2] = (this.u8[o + 2] * factor) | 0;
    }

    addPx(x, y, rgb, alpha) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
      if (alpha <= 0) return;
      const o = (iy * this.width + ix) << 2;
      const r = this.u8[o] + rgb[0] * alpha;
      const g = this.u8[o + 1] + rgb[1] * alpha;
      const b = this.u8[o + 2] + rgb[2] * alpha;
      this.u8[o] = r > 255 ? 255 : r | 0;
      this.u8[o + 1] = g > 255 ? 255 : g | 0;
      this.u8[o + 2] = b > 255 ? 255 : b | 0;
      this.u8[o + 3] = 255;
    }

    ditherPx(x, y, rgb, density, use8x8 = false) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
      const thr = use8x8 ? bayer8(ix, iy) : bayer4(ix, iy);
      if (density > thr) {
        this.u32[iy * this.width + ix] = packRGB(rgb);
      }
    }

    ditherBlendPx(x, y, rgb, density, alpha = 1, use8x8 = false) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
      const thr = use8x8 ? bayer8(ix, iy) : bayer4(ix, iy);
      if (density > thr) {
        this.blendPx(ix, iy, rgb, alpha);
      }
    }

    hline(x0, x1, y, rgb, alpha = 1) {
      const iy = y | 0;
      if (iy < 0 || iy >= this.height) return;
      let a = Math.min(x0, x1) | 0;
      let b = Math.max(x0, x1) | 0;
      if (b < 0 || a >= this.width) return;
      if (a < 0) a = 0;
      if (b >= this.width) b = this.width - 1;
      if (alpha >= 1) {
        const u = packRGB(rgb);
        const row = iy * this.width;
        for (let x = a; x <= b; x++) this.u32[row + x] = u;
      } else {
        for (let x = a; x <= b; x++) this.blendPx(x, iy, rgb, alpha);
      }
    }

    vline(x, y0, y1, rgb, alpha = 1) {
      const ix = x | 0;
      if (ix < 0 || ix >= this.width) return;
      let a = Math.min(y0, y1) | 0;
      let b = Math.max(y0, y1) | 0;
      if (b < 0 || a >= this.height) return;
      if (a < 0) a = 0;
      if (b >= this.height) b = this.height - 1;
      if (alpha >= 1) {
        const u = packRGB(rgb);
        for (let y = a; y <= b; y++) this.u32[y * this.width + ix] = u;
      } else {
        for (let y = a; y <= b; y++) this.blendPx(ix, y, rgb, alpha);
      }
    }

    rect(x, y, w, h, rgb, alpha = 1) {
      const x0 = x | 0;
      const y0 = y | 0;
      const x1 = (x + w - 1) | 0;
      const y1 = (y + h - 1) | 0;
      for (let yy = y0; yy <= y1; yy++) {
        this.hline(x0, x1, yy, rgb, alpha);
      }
    }

    line(x0, y0, x1, y1, rgb, alpha = 1) {
      let ix0 = Math.round(x0);
      let iy0 = Math.round(y0);
      const ix1 = Math.round(x1);
      const iy1 = Math.round(y1);
      const dx = Math.abs(ix1 - ix0);
      const dy = Math.abs(iy1 - iy0);
      const sx = ix0 < ix1 ? 1 : -1;
      const sy = iy0 < iy1 ? 1 : -1;
      let err = dx - dy;

      while (true) {
        if (alpha >= 1) this.setPx(ix0, iy0, rgb);
        else this.blendPx(ix0, iy0, rgb, alpha);
        if (ix0 === ix1 && iy0 === iy1) break;
        const e2 = err * 2;
        if (e2 > -dy) {
          err -= dy;
          ix0 += sx;
        }
        if (e2 < dx) {
          err += dx;
          iy0 += sy;
        }
      }
    }

    /**
     * Scanline fills a convex/concave polygon.
     * `colorOrFn` may be an [r, g, b] array or a function (x, y) => [r,g,b] | null | void.
     */
    fillPoly(pts, colorOrFn, alpha = 1) {
      const n = pts.length;
      if (n < 3) return;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        if (pts[i][1] < minY) minY = pts[i][1];
        if (pts[i][1] > maxY) maxY = pts[i][1];
      }
      const yStart = Math.max(0, Math.ceil(minY - 0.5));
      const yEnd = Math.min(this.height - 1, Math.floor(maxY - 0.5));
      const isFn = typeof colorOrFn === 'function';
      const solidU32 = !isFn && alpha >= 1 ? packRGB(colorOrFn) : 0;
      const nodes = [];

      for (let y = yStart; y <= yEnd; y++) {
        const sy = y + 0.5;
        nodes.length = 0;
        let j = n - 1;
        for (let i = 0; i < n; i++) {
          const yi = pts[i][1];
          const yj = pts[j][1];
          if ((yi < sy && yj >= sy) || (yj < sy && yi >= sy)) {
            nodes.push(pts[i][0] + ((sy - yi) / (yj - yi)) * (pts[j][0] - pts[i][0]));
          }
          j = i;
        }
        if (nodes.length < 2) continue;
        nodes.sort((a, b) => a - b);
        for (let k = 0; k < nodes.length - 1; k += 2) {
          let x0 = Math.max(0, Math.ceil(nodes[k] - 0.5));
          let x1 = Math.min(this.width - 1, Math.floor(nodes[k + 1] - 0.5));
          if (x1 < x0) continue;
          const row = y * this.width;
          if (!isFn) {
            if (alpha >= 1) {
              for (let x = x0; x <= x1; x++) this.u32[row + x] = solidU32;
            } else {
              for (let x = x0; x <= x1; x++) this.blendPx(x, y, colorOrFn, alpha);
            }
          } else {
            for (let x = x0; x <= x1; x++) {
              const c = colorOrFn(x, y);
              if (!c) continue;
              if (alpha >= 1) this.u32[row + x] = packRGB(c);
              else this.blendPx(x, y, c, alpha);
            }
          }
        }
      }
    }

    /**
     * Draws a soft Bayer-dithered radial light glow or smoke puff.
     */
    ditherGlow(cx, cy, rx, ry, rgb, strength = 0.65, additive = true) {
      const x0 = Math.max(0, Math.floor(cx - rx));
      const x1 = Math.min(this.width - 1, Math.ceil(cx + rx));
      const y0 = Math.max(0, Math.floor(cy - ry));
      const y1 = Math.min(this.height - 1, Math.ceil(cy + ry));
      for (let y = y0; y <= y1; y++) {
        const dy = (y - cy) / ry;
        const dy2 = dy * dy;
        for (let x = x0; x <= x1; x++) {
          const dx = (x - cx) / rx;
          const d2 = dx * dx + dy2;
          if (d2 >= 1) continue;
          const falloff = (1 - Math.sqrt(d2));
          const density = falloff * falloff * strength;
          if (density > bayer4(x, y)) {
            if (additive) this.addPx(x, y, rgb, 0.22 + falloff * 0.32);
            else this.blendPx(x, y, rgb, 0.28 + falloff * 0.42);
          }
        }
      }
    }

    /**
     * Draws a pixel-art sprite from string rows using a char->RGB map.
     * Anchor (ax, ay) is the top-left of the sprite.
     */
    drawSprite(ax, ay, rows, map, flipX = false, tintFn = null) {
      const x0 = Math.round(ax);
      const y0 = Math.round(ay);
      for (let r = 0; r < rows.length; r++) {
        const line = rows[r];
        const len = line.length;
        for (let c = 0; c < len; c++) {
          const ch = line[flipX ? len - 1 - c : c];
          if (ch === '.' || ch === ' ') continue;
          let rgb = map[ch];
          if (!rgb) continue;
          if (tintFn) rgb = tintFn(rgb);
          this.setPx(x0 + c, y0 + r, rgb);
        }
      }
    }

    present(ctx) {
      ctx.putImageData(this.imageData, 0, 0);
    }
  }

  Diorama.PixelBuffer = PixelBuffer;
})(window);
