// Every sound is synthesized with Web Audio, with small random variations so
// repeats never sound identical. Audio starts on the first tap.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.music = null;
    this.quiet = false; // true while the title-screen demo plays
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.55;
      this.sfx.connect(this.master);
      this.mus = this.ctx.createGain();
      this.mus.gain.value = 0.0;
      this.mus.connect(this.master);
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.musicOn) this.startMusic();
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setSfx(on) { this.sfxOn = on; }
  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic(); else this.stopMusic();
  }

  get ok() { return this.ctx && this.sfxOn && !this.quiet && this.ctx.state === 'running'; }
  vary(x, amt = 0.04) { return x * (1 + (Math.random() * 2 - 1) * amt); }

  tone({ type = 'sine', f = 440, f2 = null, t = 0, dur = 0.15, vol = 0.3, attack = 0.005, dest = null, q = null, cutoff = null }) {
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    let node = o;
    if (cutoff) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass'; fl.frequency.value = cutoff; if (q) fl.Q.value = q;
      o.connect(fl); node = fl;
    }
    node.connect(g).connect(dest || this.sfx);
    o.start(now); o.stop(now + dur + 0.05);
  }

  noise({ t = 0, dur = 0.1, vol = 0.2, f = 1200, type = 'bandpass', q = 1, dest = null }) {
    const c = this.ctx, now = c.currentTime + t;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter();
    fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(fl).connect(g).connect(dest || this.sfx);
    s.start(now, Math.random() * 0.3); s.stop(now + dur + 0.02);
  }

  // --- effects ---------------------------------------------------------------
  tap() { if (!this.ok) return; this.tone({ type: 'triangle', f: this.vary(660), f2: this.vary(880), dur: 0.06, vol: 0.12 }); }

  go() {
    if (!this.ok) return;
    this.tone({ type: 'sawtooth', f: this.vary(90, 0.08), f2: this.vary(180, 0.08), dur: 0.35, vol: 0.12, cutoff: 700 });
    this.tone({ type: 'square', f: this.vary(880), dur: 0.06, vol: 0.06, t: 0.02, cutoff: 3000 });
  }

  honk() {
    if (!this.ok) return;
    const base = this.vary(330, 0.1);
    for (const m of [1, 1.26]) {
      this.tone({ type: 'sawtooth', f: base * m, dur: 0.22, vol: 0.11, cutoff: 1400, q: 3 });
      this.tone({ type: 'square', f: base * m * 1.005, dur: 0.22, vol: 0.05, cutoff: 1200 });
    }
  }

  bump() {
    if (!this.ok) return;
    this.tone({ type: 'sine', f: this.vary(140), f2: 60, dur: 0.18, vol: 0.35 });
    this.noise({ dur: 0.08, vol: 0.18, f: 600 });
  }

  pop(i = 0) {
    if (!this.ok) return;
    const n = PENTA[i % PENTA.length];
    const f = 520 * Math.pow(2, n / 12) * this.vary(1, 0.015);
    this.tone({ type: 'sine', f: f * 0.7, f2: f * 1.4, dur: 0.09, vol: 0.25 });
    this.tone({ type: 'triangle', f: f * 2, dur: 0.05, vol: 0.06, t: 0.01 });
  }

  depart() {
    if (!this.ok) return;
    const b = this.vary(700, 0.05);
    this.tone({ type: 'square', f: b, dur: 0.08, vol: 0.08, cutoff: 2500 });
    this.tone({ type: 'square', f: b * 1.33, dur: 0.12, vol: 0.08, t: 0.1, cutoff: 2500 });
    this.tone({ type: 'sawtooth', f: 110, f2: 220, dur: 0.5, vol: 0.06, t: 0.15, cutoff: 600 });
  }

  nope() {
    if (!this.ok) return;
    this.tone({ type: 'triangle', f: 300, f2: 200, dur: 0.16, vol: 0.18 });
  }

  wake() {
    if (!this.ok) return;
    this.tone({ type: 'sine', f: this.vary(300), f2: this.vary(900), dur: 0.22, vol: 0.18 });
  }

  gate() {
    if (!this.ok) return;
    this.tone({ type: 'triangle', f: 988, dur: 0.15, vol: 0.15 });
    this.tone({ type: 'triangle', f: 1319, dur: 0.25, vol: 0.15, t: 0.12 });
  }

  spawn() {
    if (!this.ok) return;
    this.noise({ dur: 0.25, vol: 0.12, f: 900, q: 0.7 });
    this.tone({ type: 'sine', f: 200, f2: 400, dur: 0.2, vol: 0.12 });
  }

  coin() {
    if (!this.ok) return;
    this.tone({ type: 'square', f: 1318, dur: 0.06, vol: 0.06, cutoff: 5000 });
    this.tone({ type: 'square', f: 1760, dur: 0.14, vol: 0.06, t: 0.06, cutoff: 5000 });
  }

  streak(n) {
    if (!this.ok) return;
    const f = 440 * Math.pow(2, Math.min(n, 12) / 12);
    this.tone({ type: 'triangle', f, f2: f * 2, dur: 0.18, vol: 0.14 });
  }

  booster() {
    if (!this.ok) return;
    [0, 4, 7, 12].forEach((n, i) => this.tone({ type: 'triangle', f: 523 * Math.pow(2, n / 12), dur: 0.12, vol: 0.14, t: i * 0.05 }));
    this.noise({ dur: 0.4, vol: 0.06, f: 4000, type: 'highpass' });
  }

  win() {
    if (!this.ok) return;
    const seq = [[0, 0], [4, 0.12], [7, 0.24], [12, 0.36], [7, 0.5], [12, 0.62]];
    seq.forEach(([n, t]) => {
      const f = 523.25 * Math.pow(2, n / 12);
      this.tone({ type: 'square', f, dur: 0.18, vol: 0.08, t, cutoff: 3500 });
      this.tone({ type: 'triangle', f: f / 2, dur: 0.2, vol: 0.12, t });
    });
    [0, 4, 7, 12].forEach((n) => this.tone({ type: 'triangle', f: 523.25 * Math.pow(2, n / 12), dur: 0.9, vol: 0.08, t: 0.78, attack: 0.02 }));
    for (let i = 0; i < 6; i++) this.noise({ t: 0.8 + i * 0.07, dur: 0.06, vol: 0.05, f: 6000, type: 'highpass' });
  }

  lose() {
    if (!this.ok) return;
    [[7, 0], [6, 0.18], [5, 0.36], [0, 0.56]].forEach(([n, t], i) =>
      this.tone({ type: 'triangle', f: 392 * Math.pow(2, (n - 7) / 12), dur: i === 3 ? 0.6 : 0.2, vol: 0.16, t }));
  }

  // --- background music: a gentle, original looping tune --------------------------
  startMusic() {
    if (!this.ctx || this.music) return;
    const c = this.ctx;
    this.mus.gain.cancelScheduledValues(c.currentTime);
    this.mus.gain.setTargetAtTime(0.16, c.currentTime, 0.8);
    const bpm = 104, beat = 60 / bpm;
    // I - vi - IV - V in F major, with a little walking bass.
    const chords = [[53, 57, 60], [50, 53, 57], [46, 50, 53], [48, 52, 55]];
    const scale = [65, 67, 69, 72, 74, 77, 79, 81];
    let step = 0, next = c.currentTime + 0.1, melody = 3, bar = 0;
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const tick = () => {
      while (next < c.currentTime + 0.25) {
        const chord = chords[Math.floor(step / 8) % 4];
        const i = step % 8;
        if (i === 0) {
          chord.forEach((m) => this.tone({ type: 'triangle', f: midi(m), dur: beat * 3.6, vol: 0.05, t: next - c.currentTime, attack: 0.04, dest: this.mus }));
          bar++;
        }
        if (i % 2 === 0) this.tone({ type: 'sine', f: midi(chord[0] - 12 + (i === 4 ? 7 : 0)), dur: beat * 0.9, vol: 0.16, t: next - c.currentTime, dest: this.mus });
        if (i % 2 === 1) this.noise({ t: next - c.currentTime, dur: 0.03, vol: 0.05, f: 7000, type: 'highpass', dest: this.mus });
        // melody: a soft pluck walking the scale, resting now and then
        const rest = (bar % 4 === 3 && i > 3) || Math.random() < 0.28;
        if (!rest) {
          melody = Math.max(0, Math.min(scale.length - 1, melody + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
          this.tone({ type: 'sine', f: midi(scale[melody]), dur: beat * 0.45, vol: 0.09, t: next - c.currentTime, dest: this.mus });
          this.tone({ type: 'triangle', f: midi(scale[melody] + 12), dur: beat * 0.2, vol: 0.02, t: next - c.currentTime, dest: this.mus });
        }
        next += beat / 2;
        step++;
      }
    };
    this.music = setInterval(tick, 90);
    tick();
  }

  stopMusic() {
    if (!this.music) return;
    clearInterval(this.music);
    this.music = null;
    if (this.ctx) this.mus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }
}

export function buzz(pattern, enabled) {
  if (!enabled) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not supported */ }
}
