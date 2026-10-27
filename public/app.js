'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  // ---------------------------------------------------------------- session
  let token = store.get('bp_token');
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    const a = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(a);
    token = Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    store.set('bp_token', token);
  }

  // ---------------------------------------------------------------- chips (3D clay)
  const DEN = [
    { v: 1000, body: '#F2C230', acc: '#D63A2F' },
    { v: 500, body: '#D1308C', acc: '#A9E0DA' },
    { v: 100, body: '#15110C', acc: '#F2C14E' },
    { v: 50, body: '#1F6FD0', acc: '#A6D8E8' },
    { v: 25, body: '#1F2A2A', acc: '#9FD8D0' },
    { v: 5, body: '#D63A2F', acc: '#F2C14E' },
    { v: 1, body: '#F4F1EA', acc: '#3A3A3A' }
  ];

  function stacksFor(amount, o) {
    let rem = Math.floor(amount);
    const out = [];
    for (const d of DEN) {
      if (o.first && d.v > amount / o.first) continue;
      const n = Math.min(Math.floor(rem / d.v), o.maxPer);
      if (n > 0) { rem -= n * d.v; out.push({ d, n }); }
      if (out.length >= o.maxStacks) break;
    }
    if (!out.length && amount > 0) out.push({ d: DEN[DEN.length - 1], n: 1 });
    return out.reverse();
  }

  function chipSvg(d, w, t, bottom, label) {
    const rx = w / 2, ry = rx * 0.4, W = w + 2, H = 2 * ry + t + 2;
    const cx = W / 2, cy = ry + 1;
    const per = (a, b) => 2 * Math.PI * Math.sqrt((a * a + b * b) / 2);
    const rrx = rx * 0.86, rry = ry * 0.86;
    const dash = (per(rrx, rry) / 12).toFixed(2);
    const pt = (a, dy) => {
      const r = a * Math.PI / 180;
      return (cx + rx * Math.cos(r)).toFixed(2) + ' ' + (cy + ry * Math.sin(r) + dy).toFixed(2);
    };
    let sp = '';
    const shift = (bottom * 7) % 24;
    for (let k = 0; k < 6; k++) {
      const c = (30 + 60 * k + shift) % 360;
      if (c - 14 > 2 && c + 14 < 178) sp += 'M' + pt(c - 14, 0) + ' L' + pt(c + 14, 0) + ' L' + pt(c + 14, t) + ' L' + pt(c - 14, t) + ' Z ';
    }
    const side = 'M' + (cx - rx) + ' ' + cy + ' L' + (cx - rx) + ' ' + (cy + t) + ' A' + rx + ' ' + ry + ' 0 0 0 ' + (cx + rx) + ' ' + (cy + t) + ' L' + (cx + rx) + ' ' + cy + ' Z';
    let s = '<svg width="' + W + '" height="' + H.toFixed(1) + '" style="bottom:' + (bottom * t).toFixed(1) + 'px" aria-hidden="true">';
    s += '<path d="' + side + '" fill="' + d.body + '"/>';
    if (sp) s += '<path d="' + sp + '" fill="' + d.acc + '"/>';
    s += '<path d="' + side + '" fill="url(#rimShade)"/>';
    s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + d.body + '" stroke="rgba(0,0,0,.4)" stroke-width=".6"/>';
    s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rrx.toFixed(2) + '" ry="' + rry.toFixed(2) + '" fill="none" stroke="' + d.acc + '" stroke-width="' + Math.max(1.5, w * 0.07).toFixed(1) + '" stroke-dasharray="' + dash + ' ' + dash + '"/>';
    s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (rx * 0.55).toFixed(2) + '" ry="' + (ry * 0.55).toFixed(2) + '" fill="#EDEBE4"/>';
    if (label) s += '<text transform="translate(' + cx + ' ' + (cy + w * 0.1).toFixed(2) + ') scale(1 .45)" text-anchor="middle" font-family="Fraunces,serif" font-weight="600" font-size="' + (w * 0.3).toFixed(1) + '" fill="#16201B">' + label + '</text>';
    return s + '</svg>';
  }

  function stackHtml(amount, o) {
    if (!(amount > 0)) return '';
    const rx = o.w / 2, ry = rx * 0.4;
    return stacksFor(amount, o).map(({ d, n }) => {
      let chips = '';
      for (let i = 0; i < n; i++) chips += chipSvg(d, o.w, o.h, i, i === n - 1 && o.w >= 34 ? d.v : '');
      return '<div class="cs" style="width:' + (o.w + 2) + 'px;height:' + (n * o.h + 2 * ry + 2).toFixed(1) + 'px"><div class="sh" style="height:' + (2 * ry + 2).toFixed(1) + 'px"></div>' + chips + '</div>';
    }).join('');
  }

  // ---------------------------------------------------------------- sound
  const sfx = {
    on: store.get('bp_sound') !== '0',
    ctx: null,
    get() {
      if (!this.on) return null;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!this.ctx) this.ctx = new AC();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) { return null; }
    },
    noise(ctx, t, len, freq, q, gain) {
      const n = Math.floor(ctx.sampleRate * len);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < n; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / n, 3);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(bp); bp.connect(g); g.connect(ctx.destination);
      src.start(t);
    },
    tone(ctx, t, f0, f1, dur, gain, type) {
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    // clay chips: a dry high click plus a low "thock", several in quick succession
    chips(count) {
      const ctx = this.get(); if (!ctx) return;
      let t = ctx.currentTime + 0.01;
      for (let i = 0; i < count; i++) {
        this.noise(ctx, t, 0.06, 2200 + Math.random() * 1300, 1.3, 0.8);
        this.tone(ctx, t, 260 + Math.random() * 70, 110, 0.08, 0.5);
        t += 0.045 + Math.random() * 0.06;
      }
    },
    deal() {
      const ctx = this.get(); if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      this.noise(ctx, t, 0.05, 5200, 0.9, 0.35);
      this.noise(ctx, t + 0.12, 0.05, 4600, 0.9, 0.3);
    },
    flop(n) {
      const ctx = this.get(); if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      for (let i = 0; i < n; i++) this.noise(ctx, t + i * 0.13, 0.05, 4800 + i * 300, 0.9, 0.35);
    },
    check() {
      const ctx = this.get(); if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      this.tone(ctx, t, 190, 120, 0.07, 0.55);
      this.noise(ctx, t, 0.03, 1400, 1, 0.3);
    },
    fold() {
      const ctx = this.get(); if (!ctx) return;
      this.noise(ctx, ctx.currentTime + 0.01, 0.12, 3200, 0.7, 0.22);
    },
    ding() {
      const ctx = this.get(); if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      this.tone(ctx, t, 880, 880, 0.35, 0.16, 'triangle');
      this.tone(ctx, t + 0.09, 1320, 1320, 0.4, 0.11, 'triangle');
    },
    win(mine) {
      const ctx = this.get(); if (!ctx) return;
      const t = ctx.currentTime + 0.05;
      this.chips(mine ? 9 : 5);
      if (mine) { [523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, t + 0.25 + i * 0.1, f, f, 0.5, 0.12, 'triangle')); }
    },
    toggle() {
      this.on = !this.on;
      store.set('bp_sound', this.on ? '1' : '0');
      renderSoundBtn();
      if (this.on) this.chips(2);
    }
  };

  function renderSoundBtn() {
    $('#sndOn').style.display = sfx.on ? '' : 'none';
    $('#sndOff').style.display = sfx.on ? 'none' : '';
    $('#soundBtn').setAttribute('aria-label', sfx.on ? 'Sound on' : 'Sound off');
  }

  // ---------------------------------------------------------------- connection
  let ws = null;
  let pending = null;
  let inGame = false;
  let retry = 0;
  let pingIv = null;
  let state = null;

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    setConn('Connecting…');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => {
      retry = 0;
      setConn('');
      $('#banner').hidden = true;
      clearInterval(pingIv);
      pingIv = setInterval(() => send({ t: 'ping' }), 20000);
      if (pending) { const p = pending; pending = null; send(p); return; }
      const room = store.get('bp_room');
      if (room) send({ t: 'join', code: room, name: store.get('bp_name') || 'Player', token });
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      onMessage(m);
    };
    ws.onclose = () => {
      clearInterval(pingIv);
      if (inGame || store.get('bp_room')) {
        $('#banner').hidden = false;
        $('#banner').textContent = 'Connection lost — reconnecting…';
        retry++;
        setTimeout(connect, Math.min(1000 * retry, 5000));
      } else {
        setConn('Disconnected');
      }
    };
    ws.onerror = () => { /* close handler does the work */ };
  }

  function send(o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
  }

  function setConn(s) { const c = $('#conn'); if (c) c.textContent = s; }

  function lobbyError(msg) {
    const e = $('#lobbyErr');
    e.hidden = !msg; e.textContent = msg || '';
  }

  function onMessage(m) {
    switch (m.t) {
      case 'joined':
        store.set('bp_room', m.code);
        enterGame();
        break;
      case 'state':
        state = m;
        render();
        break;
      case 'ev':
        onEvent(m);
        break;
      case 'error':
        if (m.fatal) {
          if (m.notFound || !inGame) { store.del('bp_room'); leaveToLobby(); }
          lobbyError(m.m);
        } else {
          toast(m.m);
        }
        break;
      case 'left':
      case 'closed':
        store.del('bp_room');
        leaveToLobby();
        if (m.t === 'closed') lobbyError('That room was closed.');
        break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- lobby
  const lobby = {
    bots: 3, chips: 2000, bb: 20,
    init() {
      $('#name').value = store.get('bp_name') || '';
      const q = new URLSearchParams(location.search).get('room');
      if (q) $('#code').value = q.toUpperCase().slice(0, 4);
      const draw = () => {
        $('#botsOut').textContent = this.bots;
        $('#seatsOut').textContent = '1 + ' + this.bots + ' bot' + (this.bots === 1 ? '' : 's') + ' · 8 max';
      };
      $('#botsMinus').onclick = () => { this.bots = Math.max(0, this.bots - 1); draw(); };
      $('#botsPlus').onclick = () => { this.bots = Math.min(7, this.bots + 1); draw(); };
      document.querySelectorAll('#presets button').forEach((b) => {
        b.onclick = () => {
          document.querySelectorAll('#presets button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          this.chips = +b.dataset.chips; this.bb = +b.dataset.bb;
        };
      });
      $('#createBtn').onclick = () => {
        const name = this.name(); if (!name) return;
        lobbyError('');
        pending = { t: 'create', name, token, bots: this.bots, startChips: this.chips, bb: this.bb, actionTime: 30 };
        store.del('bp_room');
        connect(); if (ws && ws.readyState === 1) { const p = pending; pending = null; send(p); }
      };
      const join = () => {
        const name = this.name(); if (!name) return;
        const code = $('#code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 4) { lobbyError('Room codes are 4 characters, like KXQ7.'); $('#code').focus(); return; }
        lobbyError('');
        pending = { t: 'join', code, name, token };
        store.del('bp_room');
        connect(); if (ws && ws.readyState === 1) { const p = pending; pending = null; send(p); }
      };
      $('#joinBtn').onclick = join;
      $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
      draw();
    },
    name() {
      const n = $('#name').value.trim();
      if (!n) { lobbyError('Pick a name first so your friends know who you are.'); $('#name').focus(); return ''; }
      store.set('bp_name', n);
      return n;
    }
  };

  function enterGame() {
    inGame = true;
    $('#lobby').hidden = true;
    $('#game').hidden = false;
    renderSoundBtn();
  }

  function leaveToLobby() {
    inGame = false; state = null; pending = null;
    $('#game').hidden = true;
    $('#lobby').hidden = false;
    $('#banner').hidden = true;
    history.replaceState(null, '', location.pathname);
  }

  // ---------------------------------------------------------------- game rendering
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const COLORS = ['#6B4A9A', '#2F6F8F', '#8F5A2F', '#2F7F5F', '#8F2F55', '#5A6B2F', '#4A5FA8', '#9A5A4A'];
  const STAGES = ['preflop', 'flop', 'turn', 'river'];
  const dealt = new Map();
  let prev = { handNo: -1, turnId: -1 };

  function animFor(key, delay) {
    const now = performance.now();
    if (!dealt.has(key)) dealt.set(key, now);
    const el = now - dealt.get(key);
    if (el > 900 + delay) return '';
    return ' deal" style="animation-delay:' + Math.round(delay - el) + 'ms';
  }

  function cardHtml(c, extra, key, delay) {
    const r = c[0] === 'T' ? '10' : c[0];
    const red = c[1] === 'h' || c[1] === 'd';
    const a = key ? animFor(key, delay || 0) : '';
    const cls = 'pc' + (red ? ' red' : '') + (extra ? ' ' + extra : '') + a;
    return '<div class="' + cls + '"><b>' + r + '</b><i>' + SUIT[c[1]] + '</i></div>';
  }
  function backHtml(extra, key, delay) {
    const a = key ? animFor(key, delay || 0) : '';
    return '<div class="pc back' + (extra ? ' ' + extra : '') + a + '"></div>';
  }

  function seatPos(seat, you) {
    const rel = you >= 0 ? ((seat - you) + 8) % 8 : seat;
    if (window.innerWidth <= 760) {
      // hand-placed so plates stay on screen and clear of the board on a phone
      const N = [[50, 90], [19, 75], [14, 43], [22, 22], [50, 11], [78, 22], [86, 43], [81, 75]][rel];
      return { x: N[0], y: N[1], rel };
    }
    const ang = (90 + rel * 45) * Math.PI / 180;
    return { x: 50 + 43 * Math.cos(ang), y: 50 + 39 * Math.sin(ang), rel };
  }

  function render() {
    const s = state;
    if (!s) return;
    $('#roomCode').textContent = s.code;
    const humans = s.players.filter(Boolean).length;
    $('#seated').textContent = humans + ' / 8 seated';
    $('#blinds').textContent = 'Blinds ' + fmt(s.settings.sb) + ' / ' + fmt(s.settings.bb) + (s.handNo ? '  ·  Hand #' + s.handNo : '');

    // street tracker
    const idx = STAGES.indexOf(s.street);
    $('#stageTabs').innerHTML = STAGES.map((n, i) => {
      const cls = idx < 0 && s.street !== 'showdown' ? '' : (s.street === 'showdown' ? 'done' : (i < idx ? 'done' : (i === idx ? 'now' : '')));
      return '<span class="' + cls + '">' + n + '</span>';
    }).join('');

    renderTable(s);
    renderWait(s);
    renderActions(s);
    renderPanels(s);
    prev.handNo = s.handNo;
  }

  function renderTable(s) {
    const you = s.you;
    const running = ['preflop', 'flop', 'turn', 'river'].includes(s.street);
    const sumBets = s.players.reduce((a, p) => a + (p ? p.bet : 0), 0);
    const centerPot = Math.max(0, s.pot - sumBets);

    // pot
    $('#potBox').innerHTML = centerPot > 0
      ? '<div class="stk">' + stackHtml(centerPot, { w: 30, h: 5, maxPer: 8, maxStacks: 4 }) + '</div><div class="lab"><small>Pot</small><b>' + fmt(centerPot) + '</b></div>'
      : '<div class="lab"><small>Pot</small><b>0</b></div>';

    // board
    const winCards = new Set();
    let bh = '';
    for (let i = 0; i < 5; i++) {
      if (s.board[i]) bh += cardHtml(s.board[i], '', 'b' + s.handNo + '-' + i, i < 3 ? i * 120 : 0);
      else bh += '<div class="pc empty"></div>';
    }
    $('#board').innerHTML = bh;

    // result line
    const rl = $('#result');
    if (s.street === 'showdown' && s.result) { rl.textContent = s.result.text; rl.className = 'resultline on'; } else { rl.className = 'resultline'; rl.textContent = ''; }

    // seats + bets
    let seatsH = '';
    let betsH = '';
    const showdownWinners = new Set((s.result && s.street === 'showdown') ? s.result.winners.map((w) => w.seat) : []);
    for (let i = 0; i < 8; i++) {
      const p = s.players[i];
      const pos = seatPos(i, you);
      const base = 'left:' + pos.x.toFixed(2) + '%;top:' + pos.y.toFixed(2) + '%';
      if (!p) {
        if (s.host && pos.rel !== 0) {
          seatsH += '<div class="seat" style="' + base + '"><button class="add-seat" data-add="1">+ Add bot</button></div>';
        }
        continue;
      }
      const me = i === you;
      const myTurn = s.toAct === i && running;
      const out = p.folded || p.left || (!p.inHand && s.handNo > 0 && running) || p.busted || p.sitOut || !p.connected;
      const cls = 'seat' + (me ? ' me' : '') + (myTurn ? ' turn' : '') + (showdownWinners.has(i) ? ' win' : '') + (out ? ' out' : '');
      const initials = esc(p.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?');
      const dealerBadge = i === s.dealer && s.handNo > 0 ? '<div class="badge d">D</div>' : '';
      const blindBadge = s.handNo > 0 && p.inHand && running ? (i === s.sbSeat && i !== s.dealer ? '<div class="badge b">SB</div>' : (i === s.bbSeat ? '<div class="badge b">BB</div>' : '')) : '';
      // hole cards
      let holes = '';
      if (p.hole) {
        const faded = p.folded ? 'dim' : '';
        holes = '<div class="holes">' + p.hole.map((c, k) => cardHtml(c, (me ? '' : 'show ') + faded, 'h' + s.handNo + '-' + i + '-' + k, k * 150)).join('') + '</div>';
      } else if (p.inHand && !p.folded && (running || s.street === 'showdown')) {
        holes = '<div class="holes">' + backHtml('', 'o' + s.handNo + '-' + i + '-0', i * 40) + backHtml('', 'o' + s.handNo + '-' + i + '-1', 150 + i * 40) + '</div>';
      }
      // timer bar (humans only; the server sends the time left)
      let tbar = '';
      if (myTurn && s.timeLeftMs != null) {
        const total = s.settings.actionTime * 1000;
        tbar = '<div class="tbar" style="animation-duration:' + total + 'ms;animation-delay:' + (-(total - s.timeLeftMs)) + 'ms"></div>';
      }
      // status line under the plate
      let status = '';
      let sc = '';
      if (s.street === 'showdown' && p.win > 0) { status = '+' + fmt(p.win) + (p.hand ? ' · ' + p.hand : ''); sc = ' w'; }
      else if (s.street === 'showdown' && p.hand && p.hole) status = p.hand;
      else if (p.busted) status = 'Out of chips';
      else if (p.sitOut) status = 'Sitting out';
      else if (!p.connected) status = 'Disconnected';
      else if (p.allIn && running) status = 'All-in';
      else if (p.last && running) status = p.last;
      const remove = s.host && p.bot ? '<button class="x-btn" data-rm="' + i + '" aria-label="Remove bot ' + esc(p.name) + '">×</button>' : '';
      const stackSize = me ? { w: 22, h: 3.6, maxPer: 8, maxStacks: 4, first: 12 } : { w: 18, h: 3.2, maxPer: 8, maxStacks: 3, first: 12 };
      seatsH += '<div class="seat ' + cls.slice(5) + '" style="' + base + '">' + holes + dealerBadge + blindBadge + remove +
        '<div class="plate"><div class="av" style="background:' + COLORS[i % 8] + '">' + initials + '</div>' +
        '<div class="nm"><span class="n">' + esc(p.name) + (p.bot ? '<span class="tag">BOT</span>' : '') + '</span><span class="c">' + fmt(p.chips) + '</span></div>' + tbar + '</div>' +
        '<div class="status' + sc + '">' + esc(status) + '</div>' +
        '<div class="stk">' + stackHtml(p.chips, stackSize) + '</div></div>';

      if (p.bet > 0) {
        // bets sit between the seat and the middle of the table
        const bx = 50 + (pos.x - 50) * 0.58, by = 50 + (pos.y - 50) * 0.55 + (pos.rel === 0 ? -2 : 0);
        betsH += '<div class="bet" style="left:' + bx.toFixed(2) + '%;top:' + by.toFixed(2) + '%"><div class="stk">' + stackHtml(p.bet, { w: 22, h: 4, maxPer: 6, maxStacks: 3 }) + '</div>' + fmt(p.bet) + '</div>';
      }
    }
    $('#seats').innerHTML = seatsH;
    $('#bets').innerHTML = betsH;
  }

  function renderWait(s) {
    const w = $('#wait');
    const running = ['preflop', 'flop', 'turn', 'river'].includes(s.street);
    if (!s.started) {
      const link = location.origin + '/?room=' + s.code;
      const names = s.players.filter((p) => p && !p.bot).map((p) => esc(p.name)).join(', ');
      w.hidden = false;
      w.innerHTML = '<h3>Waiting room</h3><div class="code" aria-label="Room code ' + s.code.split('').join(' ') + '">' + s.code + '</div>' +
        '<p>Share this code or link. Friends join from the lobby.</p><p><b>' + names + '</b></p>' +
        '<div class="btns"><button class="ghost" data-invite="1">Copy invite link</button>' +
        (s.host ? '<button class="primary" style="padding:0 22px" data-start="1">Start game</button>' : '') + '</div>' +
        (s.host ? '<p style="font-size:12px;color:var(--mute)">Hover a bot to remove it, or use “+ Add bot” on an empty seat.</p>' : '<p>Waiting for the host to start…</p>');
      w.dataset.link = link;
    } else if (!running && s.street !== 'showdown' && s.msg) {
      w.hidden = false;
      w.innerHTML = '<h3>' + esc(s.msg) + '</h3>' + (s.host ? '<div class="btns"><button class="ghost" data-add="1">+ Add bot</button><button class="ghost" data-invite="1">Copy invite link</button></div>' : '<div class="btns"><button class="ghost" data-invite="1">Copy invite link</button></div>');
      w.dataset.link = location.origin + '/?room=' + s.code;
    } else {
      w.hidden = true;
    }
  }

  let actSig = '';
  let raiseTo = 0;
  let raiseOpen = false;

  function renderActions(s) {
    const box = $('#actions');
    const me = s.you >= 0 ? s.players[s.you] : null;
    const running = ['preflop', 'flop', 'turn', 'river'].includes(s.street);
    const sig = JSON.stringify([s.turnId, s.legal, s.toAct, s.you, running, me && me.busted, me && me.sitOut, s.myHand, s.pot, s.street === 'showdown', s.street, s.started, s.host]);
    if (sig === actSig) return;
    actSig = sig;

    const handLabel = s.myHand ? '<span class="hand">' + esc(s.myHand) + '</span>' : '';

    if (s.you < 0) { box.innerHTML = '<span class="hint">You are watching this table.</span>'; return; }
    if (me && me.busted) {
      box.innerHTML = '<span class="hint">You are out of chips.</span><button class="btn raise" data-rebuy="1">Rebuy ' + fmt(s.settings.startChips) + '</button>';
      return;
    }
    if (me && me.sitOut) {
      box.innerHTML = '<span class="hint">You missed two turns and are sitting out.</span><button class="btn call" data-back="1">I’m back</button>';
      return;
    }
    if (s.legal && s.toAct === s.you) {
      const l = s.legal;
      raiseTo = Math.min(Math.max(raiseTo || 0, l.minRaiseTo), l.maxRaiseTo);
      if (prev.turnId !== s.turnId) { raiseTo = l.minRaiseTo; raiseOpen = false; }
      prev.turnId = s.turnId;
      const potAfter = s.pot + l.toCall;
      const q = [['Min', l.minRaiseTo], ['½ Pot', s.currentBet + Math.round(potAfter / 2)], ['Pot', s.currentBet + potAfter], ['All-in', l.maxRaiseTo]]
        .map(([n, v]) => [n, Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, Math.round(v)))]);
      const verb = s.currentBet === 0 ? 'Bet' : 'Raise to';
      let h = handLabel + '<button class="btn" data-act="fold">Fold</button>';
      h += l.canCheck ? '<button class="btn call" data-act="check">Check</button>' : '<button class="btn call" data-act="call">Call ' + fmt(l.toCall) + (l.toCall >= me.chips ? ' (all-in)' : '') + '</button>';
      if (l.canRaise) {
        h += '<button class="btn rtoggle" data-rtoggle="1">' + (s.currentBet === 0 ? 'Bet' : 'Raise') + ' ▴</button><div class="rsheet"><span class="sep-v"></span><div class="raisebox">' + q.map(([n, v]) => '<button class="btn q" data-q="' + v + '">' + n + '</button>').join('') + '</div>';
        h += '<div class="raisebox"><div class="amt"><button data-step="-1" aria-label="Decrease">−</button><output id="raiseOut">' + fmt(raiseTo) + '</output><button data-step="1" aria-label="Increase">+</button></div>';
        h += '<input type="range" id="raiseRange" min="' + l.minRaiseTo + '" max="' + l.maxRaiseTo + '" step="1" value="' + raiseTo + '" aria-label="Raise amount"></div>';
        h += '<button class="btn raise" data-act="raise" id="raiseBtn">' + verb + ' ' + fmt(raiseTo) + '</button></div>';
      }
      box.innerHTML = h;
      box.classList.toggle('open', raiseOpen);
      box.dataset.verb = verb;
      box.dataset.min = l.minRaiseTo; box.dataset.max = l.maxRaiseTo;
      if (!sfxDinged[s.turnId]) { sfxDinged[s.turnId] = 1; }
      return;
    }
    // not my turn
    box.classList.remove('open');
    let msg = '';
    if (!s.started) msg = s.host ? 'Press “Start game” when everyone is in.' : 'Waiting for the host to start…';
    else if (running && s.toAct >= 0 && s.players[s.toAct]) msg = esc(s.players[s.toAct].name) + ' is thinking…';
    else if (running) msg = 'Dealing…';
    else if (s.street === 'showdown') msg = 'Next hand starting…';
    else msg = esc(s.msg || '');
    if (me && !me.inHand && running) msg = 'You’ll be dealt in next hand.';
    else if (me && me.folded && running) msg = 'You folded. ' + (s.toAct >= 0 && s.players[s.toAct] ? esc(s.players[s.toAct].name) + ' to act.' : '');
    box.innerHTML = handLabel + '<span class="hint">' + msg + '</span>';
  }
  const sfxDinged = {};

  function updateRaise(v) {
    const box = $('#actions');
    const lo = +box.dataset.min, hi = +box.dataset.max;
    raiseTo = Math.max(lo, Math.min(hi, Math.round(v)));
    const o = $('#raiseOut'); if (o) o.textContent = fmt(raiseTo);
    const r = $('#raiseRange'); if (r) r.value = raiseTo;
    const b = $('#raiseBtn'); if (b) b.textContent = box.dataset.verb + ' ' + fmt(raiseTo) + (raiseTo >= hi ? ' (all-in)' : '');
    box.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', +x.dataset.q === raiseTo));
  }

  const HAND_ROWS = ['Royal Flush', 'Straight Flush', 'Four of a Kind', 'Full House', 'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'One Pair', 'High Card'];
  function handIndex(label) {
    if (!label) return -1;
    if (label.startsWith('Royal')) return 0;
    if (label.startsWith('Straight Flush')) return 1;
    if (label.startsWith('Four')) return 2;
    if (label.startsWith('Full House')) return 3;
    if (label.startsWith('Flush')) return 4;
    if (label.startsWith('Straight')) return 5;
    if (label.startsWith('Three')) return 6;
    if (label.startsWith('Two Pair')) return 7;
    if (label.startsWith('Pair')) return 8;
    return 9;
  }

  function renderPanels(s) {
    $('#logLines').innerHTML = s.log.map((l) => '<div>' + esc(l) + '</div>').join('');
    const hi = handIndex(s.myHand);
    $('#handsList').innerHTML = HAND_ROWS.map((n, i) => '<div class="' + (i === hi ? 'on' : '') + '"><span>' + (i + 1) + '</span>' + n + '</div>').join('');
  }

  function buildLegend() {
    $('#legend').innerHTML = DEN.slice().reverse().map((d) => {
      const fs = d.v >= 1000 ? 6 : (d.v >= 100 ? 7.5 : 9);
      return '<svg width="28" height="28" viewBox="0 0 28 28" role="img" aria-label="' + d.v + ' chip"><circle cx="14" cy="14" r="13" fill="' + d.body + '"/><circle cx="14" cy="14" r="10.5" fill="none" stroke="' + d.acc + '" stroke-width="3.5" stroke-dasharray="6.6 5.5"/><circle cx="14" cy="14" r="7" fill="#EDEBE4"/><text x="14" y="' + (d.v >= 1000 ? 16 : 17) + '" text-anchor="middle" font-family="Fraunces,serif" font-size="' + fs + '" font-weight="600" fill="#16201B">' + d.v + '</text></svg>';
    }).join('');
  }

  // ---------------------------------------------------------------- events -> sounds
  function onEvent(m) {
    if (!state) return;
    switch (m.k) {
      case 'deal': sfx.deal(); break;
      case 'flop': sfx.flop(3); break;
      case 'turn': if (m.seat === undefined) sfx.flop(1); else if (m.seat === state.you) sfx.ding(); break;
      case 'river': sfx.flop(1); break;
      case 'chips': sfx.chips(m.amount >= state.settings.bb * 10 ? 6 : 3); break;
      case 'check': sfx.check(); break;
      case 'fold': sfx.fold(); break;
      case 'win': sfx.win(m.seats.indexOf(state.you) >= 0); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- toast / clipboard
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function invite() {
    const code = state ? state.code : store.get('bp_room');
    const link = location.origin + '/?room=' + code;
    const text = 'Join my poker table: code ' + code;
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      navigator.share({ title: 'Backroom Poker', text, url: link }).catch(() => {});
      return;
    }
    const done = () => toast('Invite link copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => toast(link));
    else toast(link);
  }

  // ---------------------------------------------------------------- input wiring
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.act) {
      const a = t.dataset.act;
      if (a === 'raise') send({ t: 'act', a, amt: raiseTo }); else send({ t: 'act', a });
      if (a === 'check') sfx.check();
    } else if (t.dataset.rtoggle) { raiseOpen = !raiseOpen; $('#actions').classList.toggle('open', raiseOpen); }
    else if (t.dataset.q) updateRaise(+t.dataset.q);
    else if (t.dataset.step) {
      const bb = state ? state.settings.bb : 20;
      updateRaise(raiseTo + (+t.dataset.step) * bb);
    } else if (t.dataset.start) { sfx.get(); send({ t: 'start' }); }
    else if (t.dataset.add) send({ t: 'addBot' });
    else if (t.dataset.rm) send({ t: 'removeSeat', seat: +t.dataset.rm });
    else if (t.dataset.rebuy) send({ t: 'rebuy' });
    else if (t.dataset.back) send({ t: 'back' });
    else if (t.dataset.invite) invite();
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'raiseRange') updateRaise(+e.target.value); });

  $('#roomPill').onclick = invite;
  $('#inviteBtn').onclick = invite;
  $('#soundBtn').onclick = () => sfx.toggle();
  $('#handsBtn').onclick = () => { const p = $('#handsPanel'); p.hidden = !p.hidden; };
  $('#handsClose').onclick = () => { $('#handsPanel').hidden = true; };
  $('#leaveBtn').onclick = () => {
    if (!confirm('Leave this table? Your seat will be given up.')) return;
    store.del('bp_room');
    send({ t: 'leave' });
    leaveToLobby();
  };
  window.addEventListener('resize', () => { if (state) renderTable(state); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && inGame && ws && ws.readyState !== 1) connect();
  });

  // ---------------------------------------------------------------- boot
  buildLegend();
  lobby.init();
  if (store.get('bp_room')) { connect(); }
  // test hook
  window.__bp = { get state() { return state; } };
})();
