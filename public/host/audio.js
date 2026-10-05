// Áudio 100% procedural (WebAudio) — sem arquivos, sem internet.
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [60, 64, 67, 71], [55, 59, 62, 69]]; // Am7 Fmaj7 Cmaj7 G6
const BASS = [45, 41, 48, 43];

export class Sound {
  constructor() { this.ctx = null; this.vol = 1; this.muted = false; this.sfxScale = 1; this.intensity = 0; this.step = 0; this.nextT = 0; }
  get ready() { return !!this.ctx && this.ctx.state === 'running'; }
  start() {
    if (!this.ctx) {
      const c = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      this.master = c.createGain(); this.master.gain.value = 0.85;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp); comp.connect(c.destination);
      this.music = c.createGain(); this.music.gain.value = 0.5; this.music.connect(this.master);
      this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
      const len = c.sampleRate * 2, nb = c.createBuffer(1, len, c.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = nb;
      this.initLoops();
      this.nextT = c.currentTime + 0.1;
      setInterval(() => this.schedule(), 30);
    }
    this.ctx.resume();
    return this.ready;
  }
  mute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.85; }

  // --- loops contínuos: zumbido do raio e vento do voo ---
  initLoops() {
    const c = this.ctx;
    this.beamG = c.createGain(); this.beamG.gain.value = 0; this.beamG.connect(this.sfx);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(this.beamG);
    this.beamO = [c.createOscillator(), c.createOscillator(), c.createOscillator()];
    [['sawtooth', 70], ['sine', 140], ['triangle', 281]].forEach(([t, f], i) => { const o = this.beamO[i]; o.type = t; o.frequency.value = f; const g = c.createGain(); g.gain.value = [0.3, 0.35, 0.15][i]; o.connect(g); g.connect(lp); o.start(); });
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 7; lg.gain.value = 0.25; lfo.connect(lg); lg.connect(this.beamG.gain); lfo.start();
    this.beamLp = lp;
    this.flyG = c.createGain(); this.flyG.gain.value = 0; this.flyG.connect(this.sfx);
    const ns = c.createBufferSource(); ns.buffer = this.noise; ns.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.8; ns.connect(bp); bp.connect(this.flyG); ns.start(); this.flyF = bp;
    // ambiente: vento suave + grilos do entardecer (loop contínuo, sem agendamento)
    const amb = (this.amb = c.createGain()); amb.gain.value = 0.7; amb.connect(this.master);
    const wn = c.createBufferSource(); wn.buffer = this.noise; wn.loop = true; wn.playbackRate.value = 0.6;
    const wbp = c.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 380; wbp.Q.value = 0.5;
    const wg = c.createGain(); wg.gain.value = 0.05; const wl = c.createOscillator(), wlg = c.createGain(); wl.frequency.value = 0.12; wlg.gain.value = 0.035; wl.connect(wlg); wlg.connect(wg.gain); wl.start();
    wn.connect(wbp); wbp.connect(wg); wg.connect(amb); wn.start();
    [[4300, 13, 0.27], [4720, 11, 0.19]].forEach(([f, rate, slow]) => {
      const o = c.createOscillator(); o.frequency.value = f; const pulse = c.createGain(); pulse.gain.value = 0.007;
      const l1 = c.createOscillator(), d1 = c.createGain(); l1.type = 'square'; l1.frequency.value = rate; d1.gain.value = 0.007; l1.connect(d1); d1.connect(pulse.gain);
      const env = c.createGain(); env.gain.value = 0.5; const l2 = c.createOscillator(), d2 = c.createGain(); l2.frequency.value = slow; d2.gain.value = 0.5; l2.connect(d2); d2.connect(env.gain);
      o.connect(pulse); pulse.connect(env); env.connect(amb); o.start(); l1.start(); l2.start();
    });
    const hum = c.createOscillator(); hum.type = 'sine'; hum.frequency.value = 95; const hg = c.createGain(); hg.gain.value = 0.5; hum.connect(hg); hg.connect(this.flyG); hum.start(); this.hum = hum;
  }
  setBeam(k) { if (!this.ctx) return; const t = this.ctx.currentTime; this.beamG.gain.setTargetAtTime(k * 0.22 * this.sfxScale, t, 0.05); this.beamLp.frequency.setTargetAtTime(500 + k * 1500, t, 0.1); this.beamO[0].frequency.setTargetAtTime(60 + k * 25, t, 0.2); }
  setFly(s, turbo) { if (!this.ctx) return; const t = this.ctx.currentTime, k = Math.min(1, s / 24); this.flyG.gain.setTargetAtTime((0.025 + k * 0.1 + (turbo ? 0.12 : 0)) * this.sfxScale, t, 0.1); this.flyF.frequency.setTargetAtTime(350 + k * 900 + (turbo ? 1200 : 0), t, 0.1); this.hum.frequency.setTargetAtTime(90 + k * 40, t, 0.15); }

  // --- helpers ---
  tone(freq, t, dur, type = 'sine', vol = 0.2, dest = this.sfx, o = {}) {
    const c = this.ctx, os = c.createOscillator(), g = c.createGain();
    os.type = type; os.frequency.setValueAtTime(freq, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (o.a ?? 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n = os; if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; os.connect(f); n = f; }
    n.connect(g); g.connect(dest); os.start(t); os.stop(t + dur + 0.05);
  }
  hit(t, dur, vol, freq, q = 1, type = 'bandpass', dest = this.sfx) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  v(x) { return x * this.sfxScale; }

  // --- efeitos ---
  blip(up = true) { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(up ? 520 : 400, t, 0.1, 'square', this.v(0.07), this.sfx, { to: up ? 880 : 300, lp: 3000 }); }
  grab() { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(300, t, 0.35, 'sine', this.v(0.14), this.sfx, { to: 900 }); this.tone(600, t + 0.05, 0.3, 'triangle', this.v(0.06), this.sfx, { to: 1800 }); }
  startle() { if (!this.ready) return; const t = this.ctx.currentTime, f = 1100 + Math.random() * 500; this.tone(f, t, 0.09, 'square', this.v(0.04), this.sfx, { to: f * 1.5, lp: 2600 }); this.tone(f * 1.2, t + 0.1, 0.08, 'square', this.v(0.035), this.sfx, { to: f * 1.9, lp: 2600 }); }
  capture(combo = 1, gold = false) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    this.tone(180, t, 0.25, 'sine', this.v(0.3), this.sfx, { to: 40 }); // pop grave
    this.hit(t, 0.2, this.v(0.3), 3000, 0.7, 'highpass');
    const base = 72 + Math.min(combo - 1, 6) * 2 + (gold ? 5 : 0);
    [0, 4, 7, 12].forEach((s, i) => this.tone(midi(base + s), t + 0.04 + i * 0.065, 0.35, 'triangle', this.v(0.14), this.sfx, { lp: 5000 }));
    if (combo >= 2) this.tone(midi(base + 19), t + 0.32, 0.5, 'sine', this.v(0.12));
    if (gold) [0, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(midi(84 + s), t + 0.1 + i * 0.07, 0.5, 'sine', this.v(0.1)));
  }
  combo(n) { if (!this.ready) return; const t = this.ctx.currentTime; [0, 4, 7].forEach((s, i) => this.tone(midi(76 + n + s), t + i * 0.06, 0.28, 'square', this.v(0.05), this.sfx, { lp: 3500 })); }
  turbo() { if (!this.ready) return; const t = this.ctx.currentTime; this.hit(t, 0.7, this.v(0.28), 600, 0.6); this.tone(150, t, 0.6, 'sawtooth', this.v(0.08), this.sfx, { to: 600, lp: 1800 }); }
  count(n) { if (!this.ready) return; const t = this.ctx.currentTime; if (n > 0) this.tone(660, t, 0.18, 'square', this.v(0.12), this.sfx, { lp: 2500 }); else { [0, 4, 7, 12].forEach((s, i) => this.tone(midi(72 + s), t + i * 0.05, 0.5, 'sawtooth', this.v(0.1), this.sfx, { lp: 3500 })); } }
  tick() { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(1200, t, 0.06, 'square', this.v(0.05), this.sfx, { lp: 2500 }); }
  end() { if (!this.ready) return; const t = this.ctx.currentTime; [72, 67, 64, 60, 64, 67, 72, 76].forEach((n, i) => this.tone(midi(n), t + i * 0.11, 0.4, 'triangle', this.v(0.14), this.sfx, { lp: 4000 })); this.tone(midi(48), t, 1.2, 'sine', this.v(0.2)); }
  spawn() { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(900, t, 0.2, 'sine', this.v(0.05), this.sfx, { to: 1500 }); }

  // --- música: pad + baixo + arpejo; intensidade (0..1) liga ritmo ---
  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') { if (this.ctx) this.nextT = Math.max(this.nextT, this.ctx.currentTime); return; }
    const spb = 60 / 104 / 2; // colcheia
    while (this.nextT < this.ctx.currentTime + 0.18) { this.stepAt(this.step++, this.nextT); this.nextT += spb; }
  }
  stepAt(s, t) {
    const bar = Math.floor(s / 8) % 4, i = s % 8, ch = CHORDS[bar], I = this.intensity, M = this.music;
    if (i === 0) {
      ch.forEach((n, k) => { const f = midi(n) * (k % 2 ? 1.004 : 0.996); this.tone(f, t, 2.6, 'sawtooth', 0.025, M, { a: 0.5, lp: 1100 }); });
      this.tone(midi(BASS[bar]), t, 0.9, 'sine', 0.2, M);
    }
    if (i === 4 || i === 6) this.tone(midi(BASS[bar]), t, 0.3, 'sine', 0.13, M);
    const arp = [0, 1, 2, 3, 2, 1, 2, 3][i];
    this.tone(midi(ch[arp] + 12), t, 0.22, 'triangle', 0.05 + I * 0.03, M, { lp: 3500 });
    if (I > 0.05) {
      if (i % 4 === 0) this.tone(120, t, 0.18, 'sine', 0.28 * I, M, { to: 40 });
      if (i % 2 === 1) this.hit(t, 0.05, 0.05 * I, 7000, 1, 'highpass', M);
      if (i === 4) this.hit(t, 0.12, 0.09 * I, 1800, 1, 'bandpass', M);
    }
  }
  setIntensity(x) { this.intensity = x; }
}
