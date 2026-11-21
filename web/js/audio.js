// Klang: alles synthetisch per Web Audio – Pupse, Geräusche und eine kleine Dudelmusik
export class Sound {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.voices = [];
    this.musicOn = false;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (_) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.22; this.mus.connect(this.master);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.applyVolume();
    if (this.wantMusic) this.startMusic(this.wantMusic);
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.volume;
    this.mus.gain.value = this.settings.music ? 0.2 : 0;
  }

  // ---------------------------------------------------------- Pups-Stimme (eine je Sitzplatz)
  voice(i, pitch) {
    if (!this.ctx) return null;
    let v = this.voices[i];
    if (v && v.pitch === pitch) return v;
    if (v) v.stop();
    const c = this.ctx;
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    const sub = c.createOscillator(); sub.type = 'square';
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 7;
    const nz = c.createBufferSource(); nz.buffer = this.noiseBuf; nz.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.9;
    const ng = c.createGain(); ng.gain.value = 0.5;
    const subG = c.createGain(); subG.gain.value = 0.35;
    const vca = c.createGain(); vca.gain.value = 0.5;
    const am = c.createOscillator(); am.type = 'square';
    const amG = c.createGain(); amG.gain.value = 0.5;
    const env = c.createGain(); env.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    osc.connect(lp); sub.connect(subG); subG.connect(lp); lp.connect(vca);
    nz.connect(bp); bp.connect(ng); ng.connect(vca);
    am.connect(amG); amG.connect(vca.gain);
    vca.connect(env);
    if (pan) { env.connect(pan); pan.connect(this.sfx); } else env.connect(this.sfx);
    const base = 78 * pitch;
    osc.frequency.value = base; sub.frequency.value = base / 2; am.frequency.value = 24; lp.frequency.value = 520;
    osc.start(); sub.start(); nz.start(); am.start();
    v = this.voices[i] = {
      pitch, on: false, t: 0,
      set: (on, gas, turbo, panX) => {
        const now = c.currentTime;
        if (pan) pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, panX || 0)), now, 0.05);
        if (on) {
          v.t += 1;
          // Flattern: Tonhöhe, Klappenrate und Filter zappeln zufällig
          const squeak = 1 + (1 - gas) * 0.9;
          const f = base * squeak * (0.85 + Math.random() * 0.35) * (turbo ? 0.8 : 1);
          osc.frequency.setTargetAtTime(f, now, 0.03);
          sub.frequency.setTargetAtTime(f / 2, now, 0.03);
          am.frequency.setTargetAtTime(16 + Math.random() * 18 + (1 - gas) * 10, now, 0.05);
          lp.frequency.setTargetAtTime(380 + Math.random() * 500 + (turbo ? 400 : 0), now, 0.04);
          ng.gain.setTargetAtTime(turbo ? 0.9 : 0.45, now, 0.05);
          if (!v.on) { env.gain.cancelScheduledValues(now); env.gain.setTargetAtTime(turbo ? 0.75 : 0.55, now, 0.015); }
        } else if (v.on) {
          env.gain.cancelScheduledValues(now);
          // kleines Quietschen zum Schluss
          osc.frequency.setTargetAtTime(base * 2.2, now, 0.05);
          env.gain.setTargetAtTime(0, now + 0.03, 0.05);
        }
        v.on = on;
      },
      stop: () => { try { env.gain.value = 0; osc.stop(); sub.stop(); nz.stop(); am.stop(); env.disconnect(); } catch (_) { /* egal */ } },
    };
    return v;
  }

  silence() { for (const v of this.voices) if (v && v.on) v.set(false, 1, false, 0); }

  // ---------------------------------------------------------- einfache Geräusche
  tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, freq, vol = 0.3, type = 'lowpass', delay = 0, q = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  bump(v) { this.tone('sine', 110, 45, 0.25, 0.25 + v * 0.4); this.noise(0.15, 500, 0.15 * v + 0.05); }
  hit() { this.tone('square', 900, 300, 0.12, 0.12); this.noise(0.6, 3000, 0.25, 'highpass'); this.tone('sine', 300, 180, 0.2, 0.2, 0.05); }
  pop() { this.noise(0.5, 1800, 0.9); this.tone('sine', 140, 30, 0.6, 0.6); this.noise(1.2, 600, 0.3, 'lowpass', 0.25); }
  fall() { this.tone('triangle', 900, 120, 1.6, 0.25); this.tone('sine', 600, 90, 1.6, 0.12, 0.1); this.noise(0.5, 300, 0.5, 'lowpass', 1.5); }
  splash() { this.noise(0.7, 1200, 0.35, 'bandpass', 0, 0.6); }
  bean() { this.tone('square', 300, 900, 0.15, 0.12); this.tone('triangle', 600, 1400, 0.18, 0.12, 0.08); this.tone('sawtooth', 60, 50, 0.35, 0.12, 0.2); }
  gold() { [784, 988, 1175, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.22, i * 0.08)); }
  pump() { for (let i = 0; i < 3; i++) this.noise(0.12, 1500, 0.3, 'bandpass', i * 0.13, 2); this.tone('sine', 400, 800, 0.4, 0.12, 0.35); }
  checkpoint() { this.tone('triangle', 880, 880, 0.15, 0.25); this.tone('triangle', 1320, 1320, 0.3, 0.25, 0.12); }
  count(n) { this.tone('square', n > 0 ? 520 : 1040, n > 0 ? 520 : 1040, n > 0 ? 0.15 : 0.45, 0.18); }
  click() { this.tone('triangle', 700, 900, 0.05, 0.12); }
  finish() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone('square', f, f, i === 5 ? 0.6 : 0.14, 0.14, i * 0.12)); }

  // ---------------------------------------------------------- Musik (kleiner Sequenzer)
  startMusic(style = 1) {
    this.wantMusic = style;
    if (!this.ctx || this.musicTimer) return;
    const c = this.ctx;
    const bpm = 116, step = 60 / bpm / 2;
    const roots = [[0, 4, 7], [-5, -1, 2], [-3, 0, 4], [-7, -3, 0]];   // I V vi IV
    const key = 60 + (style % 3) * 2;
    const mel = [7, 9, 7, 4, 5, 4, 2, 0, 4, 5, 7, 12, 11, 9, 7, -1];
    let n = 0, next = c.currentTime + 0.1;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const note = (type, m, t, dur, vol) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = mtof(m);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + dur + 0.02);
    };
    this.musicTimer = setInterval(() => {
      while (next < c.currentTime + 0.35) {
        const bar = Math.floor(n / 8) % 4, k = n % 8, ch = roots[bar];
        if (k % 2 === 0) note('triangle', key - 24 + ch[0] + (k === 4 ? 7 : 0), next, step * 1.8, 0.5);
        note('square', key + ch[k % 3] + (k > 3 ? 12 : 0), next, step * 0.6, 0.06);
        if (n % 2 === 0) note('triangle', key + 12 + mel[(n / 2) % 16], next, step * 1.6, 0.13);
        if (k % 2 === 1) { const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter(); s.buffer = this.noiseBuf; f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(0.12, next); g.gain.exponentialRampToValueAtTime(0.0001, next + 0.05); s.connect(f); f.connect(g); g.connect(this.mus); s.start(next, Math.random()); s.stop(next + 0.06); }
        next += step; n++;
      }
    }, 100);
  }

  stopMusic() { this.wantMusic = 0; if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = null; }
}
