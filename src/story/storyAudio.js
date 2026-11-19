/*
 * StoryAudio — procedural Web Audio sound effects + score for story chapters.
 * Piggybacks on the shared Soundscape context/master gain (so the mute button
 * controls everything). Every method is a safe no-op while audio is disabled.
 */
(function (global) {
  'use strict';

  const Diorama = (global.Diorama = global.Diorama || {});

  class StoryAudio {
    constructor(soundscape) {
      this.sc = soundscape;
      this.ready = false;
      this.calm = 0;
      this.dread = 0;
      this.noteT = 0;
      this.noteIdx = 0;
      this.lastScream = 0;
    }

    get ok() {
      return !this.muted && this.sc && this.sc.enabled && this.sc.ctx;
    }

    horn() {
      if (!this.ensure()) return;
      [0, 0.32].forEach((off) => {
        this.tone(311, 'square', 0.05, 0.28, off);
        this.tone(392, 'square', 0.04, 0.28, off);
      });
    }

    engine(level) {
      if (!this.ensure()) return;
      const ctx = this.sc.ctx;
      if (!this.engineOsc) {
        this.engineOsc = ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 48;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 220;
        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineOsc.connect(lp);
        lp.connect(this.engineGain);
        this.engineGain.connect(this.bus);
        this.engineOsc.start();
      }
      const now = ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(level * 0.09, now, 0.15);
      this.engineOsc.frequency.setTargetAtTime(42 + level * 40, now, 0.2);
    }

    crash() {
      this.noise(0.9, 'lowpass', 900, 0.4);
      this.tone(60, 'sine', 0.3, 0.8);
      this.noise(0.4, 'highpass', 2600, 0.12);
    }

    shot(heavy) {
      this.noise(heavy ? 0.28 : 0.18, 'lowpass', heavy ? 1800 : 2600, heavy ? 0.4 : 0.3);
      this.tone(heavy ? 90 : 140, 'sine', 0.2, 0.12);
    }

    whoosh() {
      this.noise(0.5, 'bandpass', 600, 0.12, 0.7);
    }

    stopEngine() {
      if (this.engineGain && this.sc.ctx) this.engineGain.gain.setTargetAtTime(0, this.sc.ctx.currentTime, 0.2);
    }

    ensure() {
      if (!this.ok) return false;
      if (this.ready) return true;
      const ctx = this.sc.ctx;
      this.bus = ctx.createGain();
      this.bus.gain.value = 1;
      this.bus.connect(this.sc.master);

      // Dread drone: two detuned saws through a low-pass with slow tremolo
      this.droneGain = ctx.createGain();
      this.droneGain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      lp.Q.value = 3;
      this.droneLP = lp;
      [55, 55.7, 82.4].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        o.start();
      });
      const trem = ctx.createOscillator();
      trem.frequency.value = 0.35;
      const tremG = ctx.createGain();
      tremG.gain.value = 120;
      trem.connect(tremG);
      tremG.connect(lp.frequency);
      trem.start();
      lp.connect(this.droneGain);
      this.droneGain.connect(this.bus);

      // Distant crowd murmur (band-passed noise)
      const len = ctx.sampleRate * 2;
      const nb = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = nb;
      const ns = ctx.createBufferSource();
      ns.buffer = nb;
      ns.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 0.9;
      this.murmurGain = ctx.createGain();
      this.murmurGain.gain.value = 0;
      ns.connect(bp);
      bp.connect(this.murmurGain);
      this.murmurGain.connect(this.bus);
      ns.start();

      this.ready = true;
      return true;
    }

    // Continuous layers: calm (0..1) = gentle music box, dread (0..1) = drone
    update(dt, calm, dread, murmur) {
      if (!this.ensure()) return;
      const ctx = this.sc.ctx;
      const now = ctx.currentTime;
      this.droneGain.gain.setTargetAtTime(dread * 0.11, now, 0.6);
      this.murmurGain.gain.setTargetAtTime((murmur || 0) * 0.05, now, 0.4);

      this.noteT -= dt;
      if (calm > 0.05 && this.noteT <= 0) {
        // Gentle looping music-box melody (C major pentatonic)
        const melody = [659.25, 783.99, 880.0, 783.99, 659.25, 587.33, 523.25, 587.33,
          659.25, 783.99, 1046.5, 880.0, 783.99, 659.25, 587.33, 659.25];
        const f = melody[this.noteIdx % melody.length];
        this.noteIdx++;
        this.tone(f, 'triangle', 0.035 * calm, 0.9);
        if (this.noteIdx % 4 === 1) this.tone(f / 2, 'sine', 0.03 * calm, 1.4);
        this.noteT = 0.42;
      }
    }

    tone(freq, type, gain, dur, when) {
      if (!this.ensure()) return;
      const ctx = this.sc.ctx;
      const t = ctx.currentTime + (when || 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.bus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    noise(dur, filterType, freq, gain, q) {
      if (!this.ensure()) return;
      const ctx = this.sc.ctx;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      if (q) f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.bus);
      src.start(now, Math.random());
      src.stop(now + dur + 0.05);
    }

    scream(pitch) {
      if (!this.ensure()) return;
      const ctx = this.sc.ctx;
      const now = ctx.currentTime;
      if (now - this.lastScream < 0.25) return;
      this.lastScream = now;
      const base = 620 * (pitch || 1) * (0.9 + Math.random() * 0.25);
      const dur = 0.8 + Math.random() * 0.5;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.8, now);
      o.frequency.linearRampToValueAtTime(base * 1.25, now + 0.12);
      o.frequency.linearRampToValueAtTime(base * 1.1, now + dur * 0.6);
      o.frequency.exponentialRampToValueAtTime(base * 0.62, now + dur);
      const vib = ctx.createOscillator();
      vib.frequency.value = 7 + Math.random() * 3;
      const vibG = ctx.createGain();
      vibG.gain.value = base * 0.04;
      vib.connect(vibG);
      vibG.connect(o.frequency);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 1300;
      f1.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.11, now + 0.05);
      g.gain.setValueAtTime(0.1, now + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(f1);
      f1.connect(g);
      g.connect(this.bus);
      o.start(now);
      vib.start(now);
      o.stop(now + dur + 0.05);
      vib.stop(now + dur + 0.05);
    }

    bite() {
      this.noise(0.22, 'lowpass', 700, 0.22);
      this.tone(90, 'sine', 0.18, 0.25);
    }

    thud() {
      this.tone(70, 'sine', 0.16, 0.3);
      this.noise(0.15, 'lowpass', 400, 0.12);
    }

    groan() {
      if (!this.ensure()) return;
      const ctx = this.sc.ctx;
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 85 + Math.random() * 30;
      o.frequency.setValueAtTime(f0, now);
      o.frequency.linearRampToValueAtTime(f0 * 1.3, now + 0.5);
      o.frequency.linearRampToValueAtTime(f0 * 0.8, now + 1.3);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 480;
      lp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.09, now + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.bus);
      o.start(now);
      o.stop(now + 1.5);
    }

    bark() {
      if (!this.ensure()) return;
      const ctx = this.sc.ctx;
      const now = ctx.currentTime;
      [0, 0.16].forEach((off) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(520, now + off);
        o.frequency.exponentialRampToValueAtTime(260, now + off + 0.08);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now + off);
        g.gain.linearRampToValueAtTime(0.05, now + off + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.1);
        o.connect(lp);
        lp.connect(g);
        g.connect(this.bus);
        o.start(now + off);
        o.stop(now + off + 0.12);
      });
    }

    flap() {
      this.noise(0.3, 'highpass', 1800, 0.05);
    }

    shutter() {
      this.tone(2400, 'square', 0.02, 0.04);
      this.tone(1500, 'square', 0.02, 0.05, 0.06);
    }

    // Dramatic hit when the horror begins
    stinger() {
      if (!this.ensure()) return;
      this.tone(55, 'sine', 0.3, 2.6);
      this.tone(58.3, 'sawtooth', 0.06, 2.2);
      this.tone(233.08, 'triangle', 0.05, 1.8);
      this.tone(246.94, 'triangle', 0.05, 1.8);
      this.noise(1.6, 'lowpass', 300, 0.25);
    }

    heartbeat() {
      this.tone(60, 'sine', 0.2, 0.18);
      this.tone(52, 'sine', 0.16, 0.2, 0.22);
    }
  }

  Diorama.StoryAudio = StoryAudio;
})(window);
