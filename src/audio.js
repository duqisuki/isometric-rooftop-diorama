(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});

  class Soundscape {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.master = null;
      this.rainGain = null;
      this.windGain = null;
      this.windFilter = null;
      this.cricketGain = null;
      this.ambientTimer = 0;
    }

    init() {
      if (this.ctx) return;
      const AudioCtx = global.AudioContext || global.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.0001;
      this.master.connect(ctx.destination);

      // Shared pink-ish noise buffer (3 seconds loop)
      const len = ctx.sampleRate * 3;
      const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
      }

      // 1. Rain patter bed (bandpass + high shelf)
      const rainSrc = ctx.createBufferSource();
      rainSrc.buffer = noiseBuf;
      rainSrc.loop = true;
      const rainBP = ctx.createBiquadFilter();
      rainBP.type = 'bandpass';
      rainBP.frequency.value = 1450;
      rainBP.Q.value = 0.55;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0.0;
      rainSrc.connect(rainBP);
      rainBP.connect(this.rainGain);
      this.rainGain.connect(this.master);
      rainSrc.start();

      // 2. Soft rooftop wind bed
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = noiseBuf;
      windSrc.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 420;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.0;
      windSrc.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.master);
      windSrc.start();

      // 3. Soft nocturnal cricket/cicada pulse
      const crkOsc = ctx.createOscillator();
      crkOsc.type = 'sine';
      crkOsc.frequency.value = 4150;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 11.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.008;
      this.cricketGain = ctx.createGain();
      this.cricketGain.gain.value = 0.0;
      lfo.connect(lfoGain);
      lfoGain.connect(this.cricketGain.gain);
      crkOsc.connect(this.cricketGain);
      this.cricketGain.connect(this.master);
      crkOsc.start();
      lfo.start();

      // Short white-noise burst buffer for crisp pistol shots
      const shotLen = Math.floor(ctx.sampleRate * 0.22);
      this.shotBuf = ctx.createBuffer(1, shotLen, ctx.sampleRate);
      const sd = this.shotBuf.getChannelData(0);
      for (let i = 0; i < shotLen; i++) {
        const env = Math.pow(1 - i / shotLen, 2.8);
        sd[i] = (Math.random() * 2 - 1) * env;
      }
    }

    setEnabled(flag) {
      this.enabled = !!flag;
      if (this.enabled) {
        this.init();
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
      }
      if (this.ctx && this.master) {
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(this.enabled ? 0.42 : 0.0001, now, 0.14);
      }
    }

    update(state, dt) {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const env = state.env;
      const night = state.atmo ? state.atmo.night : 0;

      // Crossfade continuous beds smoothly
      this.rainGain.gain.setTargetAtTime(env.rainIntensity * 0.72, now, 0.2);
      const windLevel = 0.12 + env.windSpeed * 0.2 + env.snowIntensity * 0.14;
      this.windGain.gain.setTargetAtTime(windLevel, now, 0.25);
      this.windFilter.frequency.setTargetAtTime(300 + env.windSpeed * 320, now, 0.25);
      const cricketLvl = Math.max(0, (night - 0.35) * 0.015 * (1 - env.rainIntensity) * (1 - env.snowIntensity));
      this.cricketGain.gain.setTargetAtTime(cricketLvl, now, 0.3);

      // Periodic delicate musical/nature accents
      this.ambientTimer -= dt;
      if (this.ambientTimer <= 0) {
        if (env.pigeonsActive > 0.5 && env.rainIntensity < 0.2) {
          this.playBirdChirp();
          this.ambientTimer = 2.6 + Math.random() * 3.8;
        } else if (env.cinemaMode > 0.5 || env.goldenBoost > 0.5) {
          this.playChimeNote(env.cinemaMode > 0.5);
          this.ambientTimer = 2.8 + Math.random() * 3.5;
        } else {
          this.ambientTimer = 2.5;
        }
      }
    }

    playThunder() {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const dur = 2.4;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        const env = Math.pow(1 - i / ch.length, 1.8);
        ch[i] = (Math.random() * 2 - 1) * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(160, now);
      lp.frequency.exponentialRampToValueAtTime(52, now + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.55, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      src.start(now);
    }

    playBirdChirp() {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const base = 1850 + Math.random() * 750;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 1.32, now + 0.06);
      osc.frequency.exponentialRampToValueAtTime(base * 0.92, now + 0.14);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.05, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.18);
    }

    playChimeNote(softNight) {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      // Pentatonic cozy scale (C5, D5, E5, G5, A5, C6)
      const notes = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
      const freq = notes[Math.floor(Math.random() * notes.length)] * (softNight ? 0.5 : 1);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.045, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + 1.2);
    }

    playGunshot() {
      if (!this.enabled || !this.ctx || !this.shotBuf) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;

      // Crisp filtered pistol crack
      const src = ctx.createBufferSource();
      src.buffer = this.shotBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1600 + (Math.random() - 0.5) * 280, now);
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.32, now);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 0.19);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      src.start(now);

      // Tight low-mid punch thump
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.08);
      og.gain.setValueAtTime(0.22, now);
      og.gain.exponentialRampToValueAtTime(0.0005, now + 0.09);
      osc.connect(og);
      og.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.1);
    }

    playShellClink() {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(4200 + Math.random() * 900, now);
      g.gain.setValueAtTime(0.022, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.05);
    }

    playZombieHit() {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(64, now + 0.07);
      g.gain.setValueAtTime(0.085, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.09);
    }

    playReload() {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const click = (offset, f1, f2) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f1, now + offset);
        osc.frequency.exponentialRampToValueAtTime(f2, now + offset + 0.03);
        g.gain.setValueAtTime(0.035, now + offset);
        g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.04);
        osc.connect(g);
        g.connect(this.master);
        osc.start(now + offset);
        osc.stop(now + offset + 0.045);
      };
      click(0.08, 620, 420);
      click(0.75, 880, 1240);
    }

    playInteract(kind) {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();

      if (kind === 'window' || kind === 'cinema') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(kind === 'window' ? 740 : 580, now);
        osc.frequency.exponentialRampToValueAtTime(kind === 'window' ? 980 : 880, now + 0.055);
        g.gain.setValueAtTime(0.07, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        osc.connect(g); g.connect(this.master);
        osc.start(now); osc.stop(now + 0.09);
      } else if (kind === 'cat') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(920, now + 0.08);
        osc.frequency.exponentialRampToValueAtTime(760, now + 0.16);
        g.gain.setValueAtTime(0.06, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.connect(g); g.connect(this.master);
        osc.start(now); osc.stop(now + 0.2);
      } else if (kind === 'roof' || kind === 'tarp') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
        g.gain.setValueAtTime(0.065, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
        osc.connect(g); g.connect(this.master);
        osc.start(now); osc.stop(now + 0.11);
      } else {
        // Gentle marimba pop for residents, tree, door, snowman
        const freq = kind === 'resident' ? 660 : kind === 'door' ? 340 : 520;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.18, now + 0.09);
        g.gain.setValueAtTime(0.065, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        osc.connect(g); g.connect(this.master);
        osc.start(now); osc.stop(now + 0.15);
      }
    }
  }

  Diorama.Soundscape = Soundscape;
})(window);
