/*
 * Story director: runs chapters in order, drives the camera (pan / zoom / shake),
 * title cards, fades and the end card. Chapters register themselves in
 * Diorama.StoryChapters (see src/story/chapters/*.js and README "How to add a chapter").
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});
  const { clamp, lerp } = Diorama.Palette;
  const { CANVAS_W, CANVAS_H } = Diorama.Iso;
  const CHAPTERS = (Diorama.StoryChapters = Diorama.StoryChapters || []);

  function formatClock(hours) {
    const h = Math.floor(hours) % 24;
    const m = Math.floor((hours - Math.floor(hours)) * 60 + 0.0001);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  class Story {
    constructor(opts) {
      this.soundscape = opts.audio;
      this.sfx = new Diorama.StoryAudio(opts.audio);
      this.onTheme = opts.onTheme || null;
      this.onFinish = opts.onFinish || null;
      this.onRequestSandbox = opts.onRequestSandbox || null;
      this.index = 0;
      this.inst = null;
      this.t = 0;
      this.paused = true;
      this.finished = false;
      this.timers = [];
      this.cam = { x: CANVAS_W / 2, y: CANVAS_H / 2, zoom: 1 };
      this.shakeAmt = 0;
      this.started = false;
      this.playable = false;
      // Player input (filled by main.js): held keys + pointer position (0..1 of the canvas)
      this.input = { keys: {}, fx: 0.5, fy: 0.5, inside: false, fire: 0, melee: 0, reload: 0 };

      this.el = {
        fade: document.getElementById('story-fade'),
        card: document.getElementById('story-card'),
        cardKicker: document.querySelector('#story-card .card-kicker'),
        cardTitle: document.querySelector('#story-card .card-title'),
        cardSub: document.querySelector('#story-card .card-sub'),
        end: document.getElementById('story-end'),
        endKicker: document.querySelector('#story-end .card-kicker'),
        endTitle: document.querySelector('#story-end .card-title'),
        endSub: document.querySelector('#story-end .card-sub'),
        pause: document.getElementById('story-pause'),
        hud: document.getElementById('hud'),
        hudHearts: document.getElementById('hud-hearts'),
        hudAmmo: document.getElementById('hud-ammo'),
        hudGoal: document.getElementById('hud-goal'),
        hudKills: document.getElementById('hud-kills'),
        hudTimer: document.getElementById('hud-timer'),
        hudStamina: document.getElementById('hud-stamina-fill'),
        caption: document.getElementById('story-caption'),
        title: document.getElementById('story-title'),
        hint: document.getElementById('hud-hint'),
        chapterLabel: document.getElementById('story-chapter'),
        chapterSegs: document.getElementById('story-chapters'),
        progress: document.getElementById('story-progress-fill'),
        clock: document.getElementById('story-clock'),
        playBtn: document.getElementById('btn-story-play'),
      };
      this.buildChapterSegments();
    }

    get chapter() {
      return CHAPTERS[this.index];
    }

    buildChapterSegments() {
      const host = this.el.chapterSegs;
      if (!host) return;
      host.innerHTML = '';
      this.segFills = [];
      const planned = Math.max(CHAPTERS.length, 5);
      for (let i = 0; i < planned; i++) {
        const ch = CHAPTERS[i];
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'scene-segment' + (ch ? '' : ' locked');
        seg.title = ch ? `Глава ${ch.number}. ${ch.title}` : `Глава ${i + 1} — скоро`;
        seg.disabled = !ch;
        const track = document.createElement('span');
        track.className = 'scene-segment-track';
        const fill = document.createElement('span');
        fill.className = 'scene-segment-fill';
        track.appendChild(fill);
        seg.appendChild(track);
        if (ch) seg.addEventListener('click', () => this.start(i, true));
        host.appendChild(seg);
        this.segFills.push(fill);
      }
    }

    // ── Chapter lifecycle ───────────────────────────────────────────
    start(index, autoplay, opts) {
      opts = opts || {};
      this.index = clamp(index, 0, CHAPTERS.length - 1);
      this.t = 0;
      this.finished = false;
      this.finalEnd = false;
      this.timers = [];
      this.shakeAmt = 0;
      if (this.el.title) this.el.title.classList.remove('visible');
      this.hideEnd();
      this.hideCard(true);
      this.hideCaption();
      this.playable = false;
      this.input.fire = 0;
      this.input.melee = 0;
      this.input.reload = 0;
      this.hud(null);
      this.showHint(false);
      this.showPause(false);
      this.inst = this.chapter.create(this.api());
      if (opts.retry && this.chapter.retryAt) this.fastForward(this.chapter.retryAt);
      const c = this.inst.camera(this.t);
      this.cam.x = c.x;
      this.cam.y = c.y;
      this.cam.zoom = c.zoom;
      if (opts.fadeIn) {
        this.fade(1, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => this.fade(0, 1.4)));
      } else {
        this.fade(0, 0);
      }
      if (autoplay !== undefined) this.paused = !autoplay;
      this.syncUI();
    }

    // Silently simulate up to time T (used to skip a chapter's intro on retry)
    fastForward(T) {
      this.sfx.muted = true;
      const dt = 1 / 30;
      while (this.t < T) {
        this.t += dt;
        for (let i = this.timers.length - 1; i >= 0; i--) {
          if (this.t >= this.timers[i].at) {
            const fn = this.timers[i].fn;
            this.timers.splice(i, 1);
            fn();
          }
        }
        this.inst.update(this.t, dt);
      }
      this.sfx.muted = false;
      this.hideCaption();
    }

    // Retry: same chapter, intro skipped. After the final chapter: start over.
    restart() {
      if (this.finalEnd) this.start(0, true, { fadeIn: true });
      else this.start(this.index, true, { retry: true, fadeIn: true });
    }

    next() {
      if (this.index + 1 < CHAPTERS.length) {
        this.start(this.index + 1, true, { fadeIn: true });
      } else if (this.onFinish) {
        this.onFinish();
      } else {
        this.start(0, false);
      }
    }

    showCaption(text, dur) {
      const el = this.el.caption;
      if (!el) return;
      el.textContent = text;
      el.classList.add('visible');
      this.captionId = (this.captionId || 0) + 1;
      const id = this.captionId;
      if (dur) this.after(dur, () => { if (this.captionId === id) this.hideCaption(); });
    }

    hideCaption() {
      if (this.el.caption) this.el.caption.classList.remove('visible');
    }

    // One big word in the middle of the screen (e.g. SURVIVE) that fades away
    showTitle(word, dur) {
      const el = this.el.title;
      if (!el) return;
      el.textContent = word;
      el.classList.remove('visible');
      void el.offsetWidth;
      el.classList.add('visible');
      this.titleId = (this.titleId || 0) + 1;
      const id = this.titleId;
      this.after(dur || 2.2, () => { if (this.titleId === id) el.classList.remove('visible'); });
    }

    skip() {
      if (this.index + 1 < CHAPTERS.length) this.start(this.index + 1, true);
      else if (!this.finished) {
        this.finished = true;
        this.fade(1, 0.5);
        this.after(0.5, () => this.showEnd());
      }
    }

    togglePause() {
      if (this.finished) return;
      this.paused = !this.paused;
      this.input.keys = {};
      this.showPause(this.paused && this.started);
      this.syncUI();
    }

    showPause(on) {
      const el = this.el.pause;
      if (!el) return;
      el.hidden = !on;
      el.classList.toggle('visible', !!on);
    }

    showHint(on, html) {
      if (!this.el.hint) return;
      if (html && this.el.hint.dataset.k !== html) {
        this.el.hint.innerHTML = html;
        this.el.hint.dataset.k = html;
      }
      this.el.hint.classList.toggle('visible', !!on);
    }

    // HUD: null hides it; otherwise
    // { hp, maxHp, oneTouch, armed, ammo, reserve, reloading, stamina, kills, goal, timer, timerLabel }
    hud(h) {
      const el = this.el;
      if (!el.hud) return;
      if (!h) {
        el.hud.hidden = true;
        return;
      }
      el.hud.hidden = false;
      let hearts = '';
      if (!h.oneTouch) for (let i = 0; i < h.maxHp; i++) hearts += `<span class="heart${i < h.hp ? '' : ' empty'}"></span>`;
      if (el.hudHearts.dataset.k !== hearts) {
        el.hudHearts.innerHTML = hearts;
        el.hudHearts.dataset.k = hearts;
      }
      // Ammo: a row of rounds in the magazine + a small reserve count, no boxes
      el.hudAmmo.hidden = !h.armed;
      if (h.armed) {
        let pips = '';
        for (let i = 0; i < (h.mag || h.ammo); i++) pips += `<span class="pip${i < h.ammo ? '' : ' empty'}"></span>`;
        pips += `<span class="reserve">${h.reserve > 0 ? '+' + h.reserve : ''}</span>`;
        if (el.hudAmmo.dataset.k !== pips) {
          el.hudAmmo.innerHTML = pips;
          el.hudAmmo.dataset.k = pips;
        }
        el.hudAmmo.classList.toggle('reloading', !!h.reloading);
      }
      // No kill counter, no objective text, no timer — the world tells you what to do
      el.hudKills.hidden = true;
      el.hudGoal.hidden = true;
      if (el.hudTimer) el.hudTimer.hidden = true;
      if (el.hudStamina) {
        el.hudStamina.style.width = Math.round((h.stamina != null ? h.stamina : 1) * 100) + '%';
        el.hudStamina.parentElement.classList.toggle('low', h.stamina < 0.3);
      }
    }

    // Mouse position in virtual-buffer pixels (camera applied, without shake)
    mouseBuffer() {
      const z = Math.max(1, this.cam.zoom);
      const vw = CANVAS_W / z;
      const vh = CANVAS_H / z;
      const sx = clamp(this.cam.x - vw / 2, 0, CANVAS_W - vw);
      const sy = clamp(this.cam.y - vh / 2, 0, CANVAS_H - vh);
      return [sx + this.input.fx * vw, sy + this.input.fy * vh];
    }

    // Chapter ends with a custom card (win / death)
    endWith(o) {
      this.finished = true;
      this.playable = false;
      this.hud(null);
      this.showHint(false);
      this.showEnd(o);
    }

    // API handed to chapters
    api() {
      return {
        sfx: this.sfx,
        soundscape: this.soundscape,
        W: CANVAS_W,
        H: CANVAS_H,
        card: (o, dur) => this.showCard(o, dur),
        hideCard: () => this.hideCard(),
        fade: (to, dur) => this.fade(to, dur),
        shake: (amt) => {
          this.shakeAmt = Math.max(this.shakeAmt, amt);
        },
        after: (sec, fn) => this.after(sec, fn),
        input: this.input,
        mouse: () => this.mouseBuffer(),
        setPlayable: (on) => {
          this.playable = !!on;
          if (!on) this.input.keys = {};
        },
        hud: (h) => this.hud(h),
        hint: (on, html) => this.showHint(on, html),
        end: (o) => this.endWith(o),
        next: () => this.next(),
        retry: () => this.restart(),
        caption: (text, dur) => this.showCaption(text, dur),
        title: (word, dur) => this.showTitle(word, dur),
      };
    }

    after(sec, fn) {
      this.timers.push({ at: this.t + sec, fn });
    }

    // ── Overlay (fades, cards, end screen) ─────────────────────────
    fade(to, dur) {
      const el = this.el.fade;
      if (!el) return;
      el.style.transitionDuration = Math.max(0, dur || 0) + 's';
      el.style.opacity = String(to);
    }

    showCard(o, dur) {
      const el = this.el;
      if (!el.card) return;
      el.cardKicker.textContent = o.kicker || '';
      el.cardTitle.textContent = o.title || '';
      el.cardSub.textContent = o.sub || '';
      el.card.classList.add('visible');
      if (dur) this.after(dur, () => this.hideCard());
    }

    hideCard(instant) {
      const el = this.el.card;
      if (!el) return;
      if (instant) {
        el.style.transition = 'none';
        el.classList.remove('visible');
        void el.offsetWidth;
        el.style.transition = '';
      } else {
        el.classList.remove('visible');
      }
    }

    showEnd(o) {
      const ch = this.chapter;
      const el = this.el;
      if (!el.end) return;
      const next = CHAPTERS[this.index + 1];
      o = o || {};
      el.endKicker.textContent = o.kicker || `Конец главы ${ch.number}`;
      el.endTitle.textContent = o.title || (next ? `Дальше: ${next.title}` : 'Продолжение следует…');
      el.endSub.textContent = o.sub || (next ? next.place : (ch.nextTeaser || 'Следующая глава в работе'));
      const replay = document.getElementById('btn-end-replay');
      if (replay) replay.textContent = o.retry || 'Смотреть снова';
      el.end.classList.toggle('death', !!o.death);
      el.end.hidden = false;
      requestAnimationFrame(() => el.end.classList.add('visible'));
    }

    hideEnd() {
      const el = this.el.end;
      if (!el) return;
      el.classList.remove('visible');
      el.hidden = true;
    }

    // ── Simulation ─────────────────────────────────────────────────
    step(dt) {
      if (!this.inst) return;
      if (!this.paused && !this.finished) {
        this.t += dt;
        for (let i = this.timers.length - 1; i >= 0; i--) {
          if (this.t >= this.timers[i].at) {
            const fn = this.timers[i].fn;
            this.timers.splice(i, 1);
            fn();
          }
        }
        this.inst.update(this.t, dt);
        if (this.t >= this.chapter.duration) {
          this.finished = true;
          if (this.index + 1 < CHAPTERS.length) {
            this.start(this.index + 1, true);
          } else {
            this.showEnd();
          }
        }
      } else if (!this.paused && this.finished) {
        // keep the world ticking behind the end card
        this.inst.update(this.t, dt);
      }

      // Camera follows the chapter's directed target
      const c = this.inst.camera(this.t);
      const k = Math.min(1, dt * (c.snap ? 20 : c.speed || 2.2));
      this.cam.x = lerp(this.cam.x, c.x, k);
      this.cam.y = lerp(this.cam.y, c.y, k);
      this.cam.zoom = lerp(this.cam.zoom, c.zoom, k);
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);

      // Audio beds
      const mix = this.inst.audioMix ? this.inst.audioMix(this.t) : { calm: 0, dread: 0, murmur: 0 };
      const pseudo = this.inst.audioState ? this.inst.audioState() : null;
      if (pseudo) this.soundscape.update(pseudo, dt);
      this.sfx.update(this.paused ? 0 : dt, this.paused ? 0 : mix.calm, mix.dread, mix.murmur);

      this.syncUI();
    }

    render(buf) {
      if (!this.inst) return null;
      const atmo = this.inst.render(buf, this.t);
      if (this.onTheme && atmo) this.onTheme(atmo);
      return atmo;
    }

    // Visible source rectangle of the virtual buffer (camera pan / zoom / shake)
    viewRect() {
      const z = Math.max(1, this.cam.zoom);
      const vw = CANVAS_W / z;
      const vh = CANVAS_H / z;
      const sh = this.shakeAmt;
      const jx = sh > 0 ? (Math.random() - 0.5) * sh * 6 : 0;
      const jy = sh > 0 ? (Math.random() - 0.5) * sh * 4 : 0;
      const sx = clamp(this.cam.x - vw / 2 + jx, 0, CANVAS_W - vw);
      const sy = clamp(this.cam.y - vh / 2 + jy, 0, CANVAS_H - vh);
      return { sx, sy, sw: vw, sh: vh };
    }

    syncUI() {
      const ch = this.chapter;
      if (!ch) return;
      const el = this.el;
      const label = `Глава ${ch.number} · ${ch.title}` + (ch.day ? ` · ${ch.day.toLowerCase()}` : '');
      if (el.chapterLabel && el.chapterLabel.textContent !== label) el.chapterLabel.textContent = label;
      const frac = clamp(this.t / ch.duration, 0, 1);
      if (el.progress) el.progress.style.width = (frac * 100).toFixed(2) + '%';
      if (this.segFills) {
        for (let i = 0; i < this.segFills.length; i++) {
          const pct = i < this.index ? 100 : i === this.index ? Math.max(4, frac * 100) : 0;
          this.segFills[i].style.width = pct.toFixed(1) + '%';
        }
      }
      if (el.clock && this.inst && this.inst.hours) {
        const txt = formatClock(this.inst.hours(this.t));
        if (el.clock.textContent !== txt) el.clock.textContent = txt;
      }
      if (el.playBtn) {
        el.playBtn.classList.toggle('paused', this.paused);
        el.playBtn.setAttribute('aria-label', this.paused ? 'Продолжить' : 'Пауза');
      }
    }
  }

  Diorama.Story = Story;
  Diorama.formatClock = formatClock;
})(window);
