'use strict';
// Backroom Poker audio: varied clay-chip / card / table sounds, and a generative lounge
// soundtrack that never loops exactly (chords, key, melody and rhythm are re-rolled as it plays).
(function () {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  let sfxOn = store.get('bp_sound') !== '0';
  let musicOn = store.get('bp_music') !== '0';
  const A = { ctx: null, master: null, sfxBus: null, musicBus: null, reverb: null, mReverb: null, delay: null, noise: null };
  const MUSIC_LEVEL = 0.9;

  // ------------------------------------------------------------ graph
  function build(ctx) {
    A.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    A.master = master;

    A.sfxBus = ctx.createGain();
    A.sfxBus.gain.value = 1.9;
    A.sfxBus.connect(master);

    const mlp = ctx.createBiquadFilter();
    mlp.type = 'lowpass'; mlp.frequency.value = 3800;
    A.musicBus = ctx.createGain();
    A.musicBus.gain.value = 0;
    A.musicBus.connect(mlp); mlp.connect(master);

    // short noise buffer reused by every percussive sound
    const nl = ctx.sampleRate;
    A.noise = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = A.noise.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;

    // small room reverb for sfx, a longer one for music
    const mk = (secs, pow) => {
      const len = Math.floor(ctx.sampleRate * secs);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, pow);
      }
      return ir;
    };
    A.reverb = ctx.createConvolver(); A.reverb.buffer = mk(1.2, 2.8);
    const rg = ctx.createGain(); rg.gain.value = 0.3;
    A.reverb.connect(rg); rg.connect(master);

    A.mReverb = ctx.createConvolver(); A.mReverb.buffer = mk(2.4, 2.2);
    const mrg = ctx.createGain(); mrg.gain.value = 0.55;
    A.mReverb.connect(mrg); mrg.connect(A.musicBus);

    // tempo-synced echo for the melody
    A.delay = ctx.createDelay(2);
    A.delay.delayTime.value = 0.4;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2300;
    A.delay.connect(dlp); dlp.connect(fb); fb.connect(A.delay);
    const dw = ctx.createGain(); dw.gain.value = 0.55;
    dlp.connect(dw); dw.connect(A.musicBus);
  }

  function ctx() {
    if (A.ctx) return A.ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      build(new AC());
    } catch (e) { return null; }
    return A.ctx;
  }

  function ready() {
    const c = ctx();
    if (!c) return null;
    if (c.state === 'suspended') {
      try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
    }
    return c.state === 'running' || c instanceof (window.OfflineAudioContext || function () {}) ? c : null;
  }

  // ------------------------------------------------------------ helpers
  function noiseSrc(t, dur) {
    const s = A.ctx.createBufferSource();
    s.buffer = A.noise;
    s.start(t, Math.random() * 0.6, dur + 0.02);
    return s;
  }
  function env(t, peak, att, dec) {
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec);
    return g;
  }
  function toSfx(node, pan, send) {
    let n = node;
    if (A.ctx.createStereoPanner) {
      const p = A.ctx.createStereoPanner(); p.pan.value = pan || 0;
      n.connect(p); n = p;
    }
    n.connect(A.sfxBus);
    if (send) { const g = A.ctx.createGain(); g.gain.value = send; n.connect(g); g.connect(A.reverb); }
  }
  function toMusic(node, send, echo) {
    node.connect(A.musicBus);
    if (send) { const g = A.ctx.createGain(); g.gain.value = send; node.connect(g); g.connect(A.mReverb); }
    if (echo) { const g = A.ctx.createGain(); g.gain.value = echo; node.connect(g); g.connect(A.delay); }
  }
  function osc(type, f, t, dur) {
    const o = A.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function band(type, f, q) {
    const b = A.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q || 1;
    return b;
  }

  // ------------------------------------------------------------ sfx voices
  // One clay chip hitting another: dry click + short clay ring + low thock. Every hit is randomised.
  function clay(t, vel, pan) {
    const n = noiseSrc(t, 0.03);
    const bp = band('bandpass', rnd(2200, 5000), rnd(1, 2.2));
    const g = env(t, 0.5 * vel, 0.001, rnd(0.015, 0.03));
    n.connect(bp); bp.connect(g); toSfx(g, pan, 0.15);

    const f = rnd(850, 1600);
    const o = osc('sine', f, t, 0.1);
    const og = env(t, 0.15 * vel, 0.001, rnd(0.03, 0.075));
    o.connect(og); toSfx(og, pan, 0.2);
    if (Math.random() < 0.6) {
      const o2 = osc('sine', f * rnd(1.45, 1.7), t, 0.08);
      const g2 = env(t, 0.07 * vel, 0.001, rnd(0.02, 0.04));
      o2.connect(g2); toSfx(g2, pan, 0.2);
    }
    const k = osc('sine', rnd(200, 320), t, 0.1);
    k.frequency.exponentialRampToValueAtTime(rnd(90, 120), t + 0.055);
    const kg = env(t, 0.3 * vel, 0.001, 0.07);
    k.connect(kg); toSfx(kg, pan, 0);
  }

  function slide(t, dur, vel) { // chips pushed across felt
    const n = noiseSrc(t, dur);
    const f0 = rnd(900, 1500);
    const lp = band('bandpass', f0, 0.7);
    lp.frequency.setValueAtTime(f0, t);
    lp.frequency.exponentialRampToValueAtTime(rnd(1800, 2600), t + dur);
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12 * vel, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(lp); lp.connect(g); toSfx(g, rnd(-0.3, 0.3), 0.1);
  }

  function flick(t, vel) { // a card snapping onto the felt
    const n = noiseSrc(t, 0.05);
    const bp = band('bandpass', rnd(3600, 6400), rnd(0.7, 1.2));
    const g = env(t, 0.32 * vel, 0.001, rnd(0.025, 0.05));
    n.connect(bp); bp.connect(g); toSfx(g, rnd(-0.5, 0.5), 0.12);
    const o = osc('sine', rnd(380, 520), t, 0.05);
    o.frequency.exponentialRampToValueAtTime(190, t + 0.04);
    const og = env(t, 0.1 * vel, 0.001, 0.04);
    o.connect(og); toSfx(og, 0, 0);
  }

  function bell(t, f, vel, dur, bus) { // soft electric-piano / glass tone
    const o = osc('sine', f, t, dur);
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    const o2 = osc('sine', f * 2.01, t, dur);
    const g2 = env(t, vel * 0.22, 0.003, Math.min(0.5, dur));
    o2.connect(g2);
    if (bus === 'sfx') { toSfx(g, 0, 0.35); toSfx(g2, 0, 0.35); } else { toMusic(g, 0.45, 0.25); toMusic(g2, 0.45, 0.25); }
  }

  const sfx = {
    chips(n, big) {
      const c = ready(); if (!c || !sfxOn) return;
      let t = c.currentTime + 0.01;
      const pattern = pick(['drop', 'stack', 'scatter']);
      if (pattern === 'stack') { slide(t, 0.11, 1); t += 0.07; }
      for (let i = 0; i < n; i++) {
        const vel = i === 0 ? rnd(0.85, 1) : rnd(0.4, 0.85);
        clay(t, big ? Math.min(1.2, vel * 1.15) : vel, rnd(-0.4, 0.4));
        if (Math.random() < 0.28) clay(t + rnd(0.008, 0.02), vel * 0.55, rnd(-0.4, 0.4));
        t += pattern === 'drop' ? (i === 0 ? rnd(0.07, 0.11) : rnd(0.035, 0.07)) : rnd(0.035, 0.095);
      }
    },
    sweep(mine) { // winner pulls in the pot
      const c = ready(); if (!c || !sfxOn) return;
      let t = c.currentTime + 0.05;
      slide(t, 0.25, 1.2);
      t += 0.12;
      const n = mine ? 14 : 9;
      let gap = 0.085;
      for (let i = 0; i < n; i++) { clay(t, rnd(0.5, 0.95), rnd(-0.5, 0.5)); t += gap; gap = Math.max(0.03, gap * 0.9); }
    },
    deal() { // riffle shuffle, then the first card
      const c = ready(); if (!c || !sfxOn) return;
      let t = c.currentTime + 0.01;
      const n = Math.floor(rnd(14, 20));
      for (let i = 0; i < n; i++) {
        const nz = noiseSrc(t, 0.02);
        const bp = band('bandpass', rnd(3000, 7000), 1.1);
        const g = env(t, rnd(0.08, 0.2), 0.001, 0.018);
        nz.connect(bp); bp.connect(g); toSfx(g, rnd(-0.2, 0.2), 0.1);
        t += rnd(0.018, 0.032);
      }
      flick(t + 0.08, 0.8); flick(t + 0.26, 0.7);
    },
    flop(n) {
      const c = ready(); if (!c || !sfxOn) return;
      let t = c.currentTime + 0.01;
      for (let i = 0; i < n; i++) { flick(t, rnd(0.7, 1)); t += rnd(0.12, 0.16); }
    },
    check() { // knuckles on the felt
      const c = ready(); if (!c || !sfxOn) return;
      const t = c.currentTime + 0.01;
      const knock = (tt, v) => {
        const o = osc('sine', rnd(140, 190), tt, 0.1);
        o.frequency.exponentialRampToValueAtTime(75, tt + 0.07);
        const g = env(tt, 0.5 * v, 0.002, 0.09);
        o.connect(g); toSfx(g, 0, 0.05);
        const nz = noiseSrc(tt, 0.03);
        const lp = band('lowpass', 1400, 0.7);
        const ng = env(tt, 0.18 * v, 0.001, 0.025);
        nz.connect(lp); lp.connect(ng); toSfx(ng, 0, 0);
      };
      knock(t, 1); knock(t + rnd(0.085, 0.12), 0.7);
    },
    fold() { // cards slid face-down towards the dealer
      const c = ready(); if (!c || !sfxOn) return;
      const t = c.currentTime + 0.01;
      const dur = rnd(0.16, 0.24);
      const nz = noiseSrc(t, dur);
      const bp = band('bandpass', 3000, 0.8);
      bp.frequency.setValueAtTime(3200, t);
      bp.frequency.exponentialRampToValueAtTime(900, t + dur);
      const g = A.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      nz.connect(bp); bp.connect(g); toSfx(g, rnd(-0.4, 0.4), 0.1);
    },
    ding() { // it's your turn
      const c = ready(); if (!c || !sfxOn) return;
      const t = c.currentTime + 0.01;
      const [a, b] = pick([[784, 1175], [880, 1319], [698, 1047], [988, 1480]]);
      bell(t, a, 0.1, 0.9, 'sfx');
      bell(t + 0.11, b, 0.07, 1.0, 'sfx');
    },
    tick(urgent) { // countdown for the last seconds of your turn
      const c = ready(); if (!c || !sfxOn) return;
      const t = c.currentTime + 0.01;
      const o = osc('triangle', urgent ? 1900 : 1450, t, 0.05);
      const g = env(t, urgent ? 0.32 : 0.22, 0.001, 0.04);
      o.connect(g); toSfx(g, 0, 0.1);
    },
    win(mine) {
      const c = ready(); if (!c || !sfxOn) return;
      this.sweep(mine);
      if (!mine) return;
      const t = c.currentTime + 0.5;
      const root = pick([523.25, 587.33, 659.25, 698.46]);
      const shape = pick([[1, 1.25, 1.5, 2], [1, 1.5, 2, 2.5], [1, 1.2, 1.5, 1.8, 2.4]]);
      shape.forEach((r, i) => bell(t + i * 0.11, root * r, 0.09, 1.2, 'sfx'));
    }
  };

  // ------------------------------------------------------------ music
  const CH = { m9: [0, 3, 7, 10, 14], 13: [0, 4, 10, 14, 21], M9: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10], 7: [0, 4, 7, 10], 9: [0, 4, 7, 10, 14] };
  // each progression is 4 bars of [root offset from the key, chord type]
  const PROGS = [
    [[2, 'm9'], [7, '13'], [0, 'M9'], [9, '7']],
    [[0, 'M9'], [9, 'm7'], [2, 'm9'], [7, '13']],
    [[9, 'm9'], [2, 'm7'], [7, '13'], [0, 'M9']],
    [[0, 'M9'], [5, 'M9'], [4, 'm7'], [9, '7']],
    [[0, 'M9'], [3, '9'], [2, 'm9'], [7, '13']],
    [[5, 'M9'], [4, 'm7'], [2, 'm9'], [7, '13']]
  ];
  const M = { timer: null, nextT: 0, bar: 0, key: 0, progIdx: 0, bpm: 76, mel: 0, running: false };

  function voicing(rootPc, q) {
    return CH[q].slice(1).map((i) => {
      let m = rootPc + i + 48;
      while (m > 78) m -= 12;
      while (m < 57) m += 12;
      return m;
    });
  }

  function scheduleBar(t0) {
    const beat = 60 / M.bpm;
    const e8 = beat / 2;
    const swing = e8 * 0.17;
    const at = (i) => t0 + i * e8 + (i % 2 ? swing : 0);

    if (M.bar % 8 === 0) { let n; do { n = Math.floor(Math.random() * PROGS.length); } while (n === M.progIdx); M.progIdx = n; }
    if (M.bar > 0 && M.bar % 16 === 0) M.key = (M.key + pick([5, 7, 2, 10, 3])) % 12;
    const prog = PROGS[M.progIdx];
    const [rootOff, q] = prog[M.bar % 4];
    const nextOff = prog[(M.bar + 1) % 4][0];
    const rootPc = (M.key + rootOff) % 12;
    const notes = voicing(rootPc, q);
    A.delay.delayTime.value = beat * 0.75;

    // chord stabs: always on the one, sometimes anticipating the next beat
    const stab = (t, vel, dur) => {
      notes.forEach((m, i) => bell(t + i * rnd(0.008, 0.018), mtof(m), vel * rnd(0.8, 1), dur, 'music'));
    };
    stab(at(0), 0.05, beat * 3);
    if (Math.random() < 0.6) stab(at(3), 0.034, beat * 1.2);
    if (Math.random() < 0.35) stab(at(6), 0.03, beat);

    // bass walks a little
    const bassNote = (t, m, v) => {
      const o = osc('sine', mtof(m), t, beat * 1.4);
      const o2 = osc('triangle', mtof(m), t, beat * 1.4);
      const lp = band('lowpass', 420, 0.7);
      const g = env(t, v, 0.012, beat * 1.2);
      const g2 = A.ctx.createGain(); g2.gain.value = 0.35;
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); toMusic(g, 0.05, 0);
    };
    const bassRoot = 36 + rootPc;
    bassNote(at(0), bassRoot, 0.24);
    bassNote(at(4), Math.random() < 0.5 ? bassRoot + 7 : bassRoot, 0.18);
    if (Math.random() < 0.4) {
      const target = 36 + ((M.key + nextOff) % 12);
      bassNote(at(7), target + pick([-1, 1]), 0.14);
    }

    // soft kick and brushes
    const kick = (t, v) => {
      const o = osc('sine', 115, t, 0.2);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
      const g = env(t, v, 0.003, 0.15);
      o.connect(g); toMusic(g, 0, 0);
    };
    kick(at(0), 0.22);
    if (Math.random() < 0.45) kick(at(5), 0.14);
    for (let i = 0; i < 8; i++) {
      const t = at(i);
      const accent = i === 2 || i === 6;
      if (accent) { // brush on 2 and 4
        const nz = noiseSrc(t, 0.14);
        const bp = band('bandpass', 2600, 0.6);
        const g = env(t, 0.05, 0.02, 0.12);
        nz.connect(bp); bp.connect(g); toMusic(g, 0.15, 0);
      }
      if (Math.random() < (i % 2 ? 0.8 : 0.55)) { // shaker
        const nz = noiseSrc(t, 0.03);
        const hp = band('highpass', 7000, 0.7);
        const g = env(t, (i % 2 ? 0.022 : 0.03) * rnd(0.6, 1.2), 0.002, 0.03);
        nz.connect(hp); hp.connect(g); toMusic(g, 0.1, 0);
      }
    }

    // sparse melody in 4-bar phrases: busy, busy, thin, rest
    const prob = [0.38, 0.32, 0.18, 0.06][M.bar % 4];
    const pool = CH[q].concat([14, 21, 2, 9]).map((i) => i + rootPc);
    for (let i = 0; i < 8; i++) {
      if (Math.random() > prob) continue;
      let m = pool[Math.floor(Math.random() * pool.length)] + 72;
      while (m > 90) m -= 12;
      while (m < 69) m += 12;
      if (M.mel && Math.abs(m - M.mel) > 7 && Math.random() < 0.7) m += Math.sign(M.mel - m) * 12 * (Math.abs(m - M.mel) > 12 ? 1 : 0);
      M.mel = m;
      bell(at(i), mtof(m), rnd(0.03, 0.05), rnd(0.8, 1.6), 'music');
    }
    M.bar++;
  }

  function startMusic() {
    const c = ready();
    if (!c || !musicOn || M.running) return;
    M.running = true;
    M.bpm = Math.round(rnd(70, 84));
    M.key = Math.floor(Math.random() * 12);
    M.progIdx = Math.floor(Math.random() * PROGS.length);
    M.bar = 0; M.mel = 0;
    M.nextT = c.currentTime + 0.2;
    const g = A.musicBus.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(MUSIC_LEVEL, c.currentTime + 3);
    const tick = () => {
      if (!A.ctx || A.ctx.state !== 'running') return;
      const beat = 60 / M.bpm;
      while (M.nextT < A.ctx.currentTime + 0.7) { scheduleBar(M.nextT); M.nextT += beat * 4; }
    };
    tick();
    M.timer = setInterval(tick, 150);
  }

  function stopMusic() {
    if (!M.running) return;
    M.running = false;
    clearInterval(M.timer); M.timer = null;
    if (A.ctx && A.musicBus) {
      const g = A.musicBus.gain;
      g.cancelScheduledValues(A.ctx.currentTime);
      g.setValueAtTime(g.value, A.ctx.currentTime);
      g.linearRampToValueAtTime(0, A.ctx.currentTime + 0.8);
    }
  }

  // ------------------------------------------------------------ public api
  let wantMusic = false;
  const Snd = {
    get sfxOn() { return sfxOn; },
    get musicOn() { return musicOn; },
    // call from any user gesture: creates/resumes the audio context and starts the music if wanted
    unlock() {
      const c = ready();
      if (c && wantMusic && musicOn && !M.running) startMusic();
    },
    setInGame(v) {
      wantMusic = v;
      if (v) this.unlock(); else stopMusic();
    },
    toggleSfx() {
      sfxOn = !sfxOn; store.set('bp_sound', sfxOn ? '1' : '0');
      if (sfxOn) sfx.chips(2);
      return sfxOn;
    },
    toggleMusic() {
      musicOn = !musicOn; store.set('bp_music', musicOn ? '1' : '0');
      if (musicOn) { ready(); if (wantMusic) startMusic(); } else stopMusic();
      return musicOn;
    },
    suspend() { if (A.ctx && A.ctx.suspend && A.ctx.state === 'running') A.ctx.suspend(); },
    resume() { if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume(); },
    chips: (n, big) => sfx.chips(n, big),
    deal: () => sfx.deal(),
    flop: (n) => sfx.flop(n),
    check: () => sfx.check(),
    fold: () => sfx.fold(),
    ding: () => sfx.ding(),
    tick: (u) => sfx.tick(u),
    win: (mine) => sfx.win(mine),
    // offline-render hook for tests
    _test: { build, scheduleBar, A, M, sfx }
  };
  window.Snd = Snd;
})();
