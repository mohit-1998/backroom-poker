'use strict';
const { newDeck, shuffle, bestScore, handLabel, describe } = require('./cards');
const { decide } = require('./bots');

const fmt = (n) => Number(n).toLocaleString('en-US');
const MAX = 8;
const SEAT_ORDER = [0, 4, 2, 6, 1, 5, 3, 7]; // spread players around the table
const BOT_NAMES = ['Vega', 'Orion', 'Nova', 'Atlas', 'Lyra', 'Rigel', 'Sirius', 'Cygnus', 'Altair', 'Deneb'];

class Table {
  constructor(settings = {}, hooks = {}) {
    this.startChips = settings.startChips || 2000;
    this.sb = settings.sb || 10;
    this.bb = settings.bb || 20;
    this.actionTime = settings.actionTime || 30; // seconds
    this.speed = settings.speed === undefined ? 1 : settings.speed; // test hook: scales all delays
    this.botDelay = settings.botDelay || [2200, 4200]; // how long a bot "thinks", in ms
    this.hooks = hooks;

    this.seats = new Array(MAX).fill(null);
    this.started = false;
    this.street = null; // null | preflop | flop | turn | river | showdown
    this.handNo = 0;
    this.turnId = 0;
    this.dealer = -1;
    this.sbSeat = -1;
    this.bbSeat = -1;
    this.toAct = -1;
    this.deadline = 0;
    this.board = [];
    this.deck = [];
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.result = null;
    this.allInReveal = false;
    this.msg = '';
    this.log = [];
    this.rebuys = 0;
    this.timers = new Set();
    this.turnTimer = null;
    this.nextTimer = null;
    this.runTimer = null;
    this.destroyed = false;
    this.botNames = BOT_NAMES.slice();
  }

  // ---------- plumbing ----------
  later(fn, ms) {
    const h = setTimeout(() => {
      this.timers.delete(h);
      if (this.destroyed) return;
      try { fn(); } catch (e) { console.error('table timer error', e); }
    }, Math.max(0, ms * this.speed));
    this.timers.add(h);
    return h;
  }

  cancel(h) {
    if (h) { clearTimeout(h); this.timers.delete(h); }
  }

  destroy() {
    this.destroyed = true;
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
  }

  changed() { if (this.hooks.onChange) this.hooks.onChange(); }
  emit(k, data) { if (this.hooks.onEvent) this.hooks.onEvent(Object.assign({ k }, data || {})); }
  // Log entries are small objects so the client can render them nicely:
  // { k: kind, t: text, seat, n: name, a: action, cards, h: hand number }
  logAdd(t, k = 'sys', extra = {}) {
    this.log.push(Object.assign({ k, t, h: this.handNo }, extra));
    if (this.log.length > 160) this.log.shift();
  }

  // ---------- helpers ----------
  handRunning() { return this.street === 'preflop' || this.street === 'flop' || this.street === 'turn' || this.street === 'river'; }
  alive() { return this.seats.filter((p) => p && p.inHand && !p.folded); }
  potTotal() { return this.seats.reduce((s, p) => s + (p ? p.total : 0), 0); }
  totalChips() { return this.seats.reduce((s, p) => s + (p ? p.chips : 0), 0); }

  nextSeat(from, pred) {
    for (let k = 1; k <= MAX; k++) {
      const i = (from + k + MAX * 2) % MAX;
      const p = this.seats[i];
      if (p && pred(p)) return i;
    }
    return -1;
  }

  pay(p, amt) {
    p.chips -= amt;
    p.bet += amt;
    p.total += amt;
    if (p.chips === 0) p.allIn = true;
  }

  legalFor(p) {
    const toCallRaw = Math.max(0, this.currentBet - p.bet);
    const toCall = Math.min(toCallRaw, p.chips);
    const maxTo = p.bet + p.chips;
    const others = this.alive().some((q) => q !== p && !q.allIn);
    return {
      toCall,
      canCheck: toCallRaw === 0,
      canRaise: !!(p.raiseOK && p.chips > toCall && others),
      minRaiseTo: Math.min(this.currentBet + this.minRaise, maxTo),
      maxRaiseTo: maxTo
    };
  }

  // ---------- seating ----------
  sit({ name, token, bot }) {
    let i = -1;
    for (const s of SEAT_ORDER) { if (!this.seats[s]) { i = s; break; } }
    if (i < 0) return -1;
    this.seats[i] = {
      seat: i, name, token: token || null, bot: !!bot,
      chips: this.startChips, bet: 0, total: 0,
      folded: false, allIn: false, hole: [], acted: false, raiseOK: true,
      inHand: false, connected: !bot, sitOut: false, busted: false, left: false,
      lastAction: '', handName: '', win: 0, timeouts: 0, score: 0,
      persona: bot ? { aggr: 0.25 + Math.random() * 0.55, loose: 0.2 + Math.random() * 0.6 } : null
    };
    this.logAdd(`${name} sat down`);
    this.maybeStart();
    this.changed();
    return i;
  }

  addBot() {
    const taken = new Set(this.seats.filter(Boolean).map((p) => p.name));
    let name = this.botNames.find((n) => !taken.has(n));
    if (!name) name = 'Bot' + (1 + Math.floor(Math.random() * 99));
    return this.sit({ name, bot: true });
  }

  leave(seat) {
    const p = this.seats[seat];
    if (!p) return;
    if (this.handRunning() && p.inHand && !p.folded) {
      p.left = true;
      this.logAdd(`${p.name} left the table`);
      if (this.toAct === seat) {
        this.act(seat, 'fold', 0, true);
      } else {
        p.folded = true;
        p.lastAction = 'Fold';
        if (this.alive().length <= 1) this.progress();
        else this.changed();
      }
    } else {
      this.logAdd(`${p.name} left the table`);
      this.seats[seat] = null;
      this.changed();
    }
  }

  rebuy(seat) {
    const p = this.seats[seat];
    if (!p || p.chips > 0 || p.inHand && this.handRunning()) return;
    p.chips = this.startChips;
    p.busted = false;
    this.rebuys++;
    this.logAdd(`${p.name} bought back in`);
    this.maybeStart();
    this.changed();
  }

  back(seat) {
    const p = this.seats[seat];
    if (!p) return;
    p.sitOut = false;
    p.timeouts = 0;
    this.maybeStart();
    this.changed();
  }

  startGame() {
    this.started = true;
    if (!this.handRunning()) {
      this.cancel(this.nextTimer);
      this.nextTimer = null;
      this.startHand();
    }
  }

  maybeStart() {
    if (this.started && !this.handRunning() && !this.nextTimer) {
      this.nextTimer = this.later(() => this.startHand(), 1200);
    }
  }

  // ---------- hand flow ----------
  startHand() {
    this.cancel(this.nextTimer);
    this.nextTimer = null;
    if (this.handRunning()) return;

    // drop players who left during the previous hand
    this.seats.forEach((p, i) => { if (p && p.left) this.seats[i] = null; });
    for (const p of this.seats) {
      if (!p) continue;
      if (p.chips <= 0) {
        if (p.bot) { p.chips = this.startChips; this.rebuys++; } else { p.busted = true; }
      }
    }

    const anyHuman = this.seats.some((p) => p && !p.bot && p.connected && !p.sitOut && !p.busted);
    const players = this.seats.filter((p) => p && p.chips > 0 && !p.sitOut && !p.busted);

    for (const p of this.seats) {
      if (!p) continue;
      p.bet = 0; p.total = 0; p.folded = false; p.allIn = false; p.hole = [];
      p.acted = false; p.raiseOK = true; p.inHand = false; p.lastAction = '';
      p.handName = ''; p.win = 0; p.score = 0;
    }

    if (players.length < 2 || !anyHuman) {
      this.street = null;
      this.result = null;
      this.toAct = -1;
      this.msg = players.length < 2 ? 'Waiting for more players…' : 'Paused — waiting for a player to come back…';
      this.changed();
      return;
    }

    for (const p of players) p.inHand = true;
    this.handNo++;
    this.msg = '';
    this.result = null;
    this.allInReveal = false;
    this.board = [];
    this.deck = shuffle(newDeck());
    this.currentBet = this.bb;
    this.minRaise = this.bb;

    this.dealer = this.nextSeat(this.dealer < 0 ? -1 : this.dealer, (p) => p.inHand);
    let sb;
    let bb;
    if (players.length === 2) {
      sb = this.dealer;
      bb = this.nextSeat(this.dealer, (p) => p.inHand);
    } else {
      sb = this.nextSeat(this.dealer, (p) => p.inHand);
      bb = this.nextSeat(sb, (p) => p.inHand);
    }
    this.sbSeat = sb;
    this.bbSeat = bb;

    const post = (i, amt, label) => {
      const p = this.seats[i];
      const pay = Math.min(amt, p.chips);
      this.pay(p, pay);
      p.lastAction = `${label} ${pay}`;
    };
    post(sb, this.sb, 'SB');
    post(bb, this.bb, 'BB');

    for (const p of players) p.hole = [this.deck.pop(), this.deck.pop()];

    this.street = 'preflop';
    this.logAdd(`Hand #${this.handNo} · ${this.seats[this.dealer].name} has the button`, 'hand');
    for (const [i, label] of [[sb, 'small'], [bb, 'big']]) {
      const q = this.seats[i];
      this.logAdd(`posts ${label} blind ${fmt(q.bet)}`, 'act', { seat: i, n: q.name, a: 'blind' });
    }
    this.emit('deal', {});
    this.toAct = bb;
    this.progress();
  }

  progress() {
    const alive = this.alive();
    if (alive.length <= 1) { this.finishUncontested(alive[0]); return; }
    const need = alive.filter((p) => !p.allIn && (!p.acted || p.bet < this.currentBet));
    if (need.length === 0) {
      // betting is over: a short beat so players can see the last action before the next card
      if (!this.runTimer) {
        this.toAct = -1;
        this.changed();
        this.runTimer = this.later(() => { this.runTimer = null; this.endStreet(); }, 1100);
      }
      return;
    }
    this.toAct = this.nextSeat(this.toAct, (p) => need.includes(p));
    this.startTurn();
  }

  startTurn() {
    this.cancel(this.turnTimer);
    const seat = this.toAct;
    const p = this.seats[seat];
    this.turnId++;
    if (p.bot) {
      this.deadline = 0;
      const [lo, hi] = this.botDelay;
      this.turnTimer = this.later(() => this.botAct(seat), lo + Math.random() * (hi - lo));
    } else {
      this.deadline = Date.now() + this.actionTime * 1000;
      this.turnTimer = this.later(() => this.timeout(seat), this.actionTime * 1000);
    }
    this.emit('turn', { seat });
    this.changed();
  }

  botAct(seat) {
    if (this.toAct !== seat || !this.handRunning()) return;
    const p = this.seats[seat];
    let d;
    try { d = decide(this, p); } catch (e) { console.error('bot error', e); d = { a: 'check' }; }
    const lg = this.legalFor(p);
    if (d.a === 'check' && !lg.canCheck) d = { a: lg.toCall > 0 ? 'call' : 'check' };
    const err = this.act(seat, d.a, d.amt, true);
    if (err) {
      const e2 = this.act(seat, lg.canCheck ? 'check' : 'fold', 0, true);
      if (e2) console.error('bot stuck', err, e2);
    }
  }

  timeout(seat) {
    if (this.toAct !== seat || !this.handRunning()) return;
    const p = this.seats[seat];
    p.timeouts = (p.timeouts || 0) + 1;
    const lg = this.legalFor(p);
    this.logAdd(`${p.name} ran out of time`);
    this.act(seat, lg.canCheck ? 'check' : 'fold', 0, true);
    if (p.timeouts >= 2 && !p.bot) {
      p.sitOut = true;
      this.logAdd(`${p.name} is sitting out`);
      this.changed();
    }
  }

  act(seat, type, amt, auto) {
    if (!this.handRunning() || this.toAct !== seat) return 'Not your turn';
    const p = this.seats[seat];
    if (!p) return 'No such player';
    const lg = this.legalFor(p);
    if (type === 'raise' && !lg.canRaise) type = lg.canCheck ? 'check' : 'call';
    if (type === 'call' && lg.canCheck) type = 'check';
    if (type === 'check' && !lg.canCheck) return 'You must call or fold';
    if (type !== 'fold' && type !== 'check' && type !== 'call' && type !== 'raise') return 'Bad action';

    this.cancel(this.turnTimer);
    this.turnTimer = null;
    this.deadline = 0;
    if (!auto) p.timeouts = 0;
    const prevCur = this.currentBet;

    if (type === 'fold') {
      p.folded = true;
      p.lastAction = 'Fold';
      this.logAdd('folds', 'act', { seat, n: p.name, a: 'fold' });
      this.emit('fold', { seat });
    } else if (type === 'check') {
      p.lastAction = 'Check';
      this.logAdd('checks', 'act', { seat, n: p.name, a: 'check' });
      this.emit('check', { seat });
    } else if (type === 'call') {
      this.pay(p, lg.toCall);
      p.lastAction = p.allIn ? `All-in ${p.bet}` : `Call ${lg.toCall}`;
      this.logAdd(`calls ${fmt(lg.toCall)}${p.allIn ? ' · all-in' : ''}`, 'act', { seat, n: p.name, a: p.allIn ? 'allin' : 'call' });
      this.emit('chips', { seat, amount: lg.toCall });
    } else {
      let to = Math.floor(Number(amt));
      if (!Number.isFinite(to)) to = lg.minRaiseTo;
      to = Math.max(Math.min(to, lg.maxRaiseTo), lg.minRaiseTo);
      const paid = to - p.bet;
      this.pay(p, paid);
      const size = to - prevCur;
      const full = size >= this.minRaise;
      this.currentBet = to;
      for (const q of this.alive()) {
        if (q === p || q.allIn) continue;
        if (full) { q.acted = false; q.raiseOK = true; }
        else if (q.acted) { q.acted = false; q.raiseOK = false; }
      }
      if (full) this.minRaise = size;
      p.lastAction = (prevCur === 0 ? `Bet ${to}` : `Raise to ${to}`) + (p.allIn ? ' (all-in)' : '');
      this.logAdd(`${prevCur === 0 ? 'bets' : 'raises to'} ${fmt(to)}${p.allIn ? ' · all-in' : ''}`, 'act', { seat, n: p.name, a: p.allIn ? 'allin' : 'raise' });
      this.emit('chips', { seat, amount: paid });
    }
    p.acted = true;
    this.emit('act', { seat, text: p.lastAction });
    this.progress();
    return null;
  }

  endStreet() {
    if (!this.handRunning()) return;
    for (const p of this.seats) if (p) p.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.bb;
    const alive = this.alive();
    for (const p of alive) { p.acted = false; p.raiseOK = true; if (!p.allIn) p.lastAction = ''; }
    if (this.street === 'river') { this.doShowdown(); return; }

    const next = { preflop: 'flop', flop: 'turn', turn: 'river' }[this.street];
    this.street = next;
    const n = next === 'flop' ? 3 : 1;
    const dealt = [];
    for (let i = 0; i < n; i++) { const c = this.deck.pop(); this.board.push(c); dealt.push(c); }
    this.logAdd(next[0].toUpperCase() + next.slice(1), 'street', { cards: this.board.slice() });
    this.emit(next, {});
    this.toAct = this.dealer;

    const canAct = alive.filter((p) => !p.allIn);
    if (canAct.length <= 1) {
      this.allInReveal = true;
      this.toAct = -1;
      this.changed();
      this.runTimer = this.later(() => { this.runTimer = null; this.endStreet(); }, 2400);
      return;
    }
    this.progress();
  }

  // Build main pot + side pots from each player's total contribution.
  buildPots() {
    const all = this.seats.filter((p) => p && p.inHand);
    const alive = all.filter((p) => !p.folded);
    const levels = [...new Set(alive.map((p) => p.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lvl of levels) {
      let amount = 0;
      for (const p of all) amount += Math.max(0, Math.min(p.total, lvl) - Math.min(p.total, prev));
      pots.push({ amount, eligible: alive.filter((p) => p.total >= lvl) });
      prev = lvl;
    }
    return pots;
  }

  doShowdown() {
    this.street = 'showdown';
    this.toAct = -1;
    this.cancel(this.turnTimer);
    const alive = this.alive();
    for (const p of alive) {
      p.score = bestScore(p.hole.concat(this.board));
      p.handName = handLabel(p.score);
    }
    if (alive.length > 1) {
      for (const p of alive) this.logAdd(p.handName, 'show', { seat: p.seat, n: p.name, cards: p.hole.slice() });
    }
    const potTotal = this.potTotal();
    const pots = this.buildPots();
    const won = new Map();
    const resPots = [];
    for (const pot of pots) {
      if (pot.amount <= 0 || pot.eligible.length === 0) continue;
      const top = Math.max(...pot.eligible.map((p) => p.score));
      const winners = pot.eligible.filter((p) => p.score === top);
      // order winners clockwise from the dealer so the odd chip goes to the first one
      winners.sort((a, b) => ((a.seat - this.dealer - 1 + MAX * 2) % MAX) - ((b.seat - this.dealer - 1 + MAX * 2) % MAX));
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        w.chips += amt;
        won.set(w.seat, (won.get(w.seat) || 0) + amt);
      }
      resPots.push({ amount: pot.amount, winners: winners.map((w) => w.seat), hand: winners[0].handName });
    }
    const winners = [...won.entries()].map(([seat, amount]) => ({ seat, amount, hand: this.seats[seat].handName }));
    for (const w of winners) this.seats[w.seat].win = w.amount;
    // describe the contested outcome (ignore pots that were just an uncalled bet coming back)
    const headline = winners.slice().sort((a, b) => b.amount - a.amount)[0];
    const text = winners.length === 1
      ? `${this.seats[headline.seat].name} wins ${headline.amount} with ${headline.hand}`
      : winners.map((w) => `${this.seats[w.seat].name} +${w.amount} (${w.hand})`).join(' · ');
    this.result = { showdown: true, winners, pots: resPots, pot: potTotal, text };
    this.logAdd(text, 'win', { seat: headline ? headline.seat : -1 });
    this.emit('win', { seats: winners.map((w) => w.seat), amount: potTotal });
    this.finishHand();
  }

  finishUncontested(p) {
    this.cancel(this.turnTimer);
    this.cancel(this.runTimer);
    this.runTimer = null;
    this.street = 'showdown';
    this.toAct = -1;
    const pot = this.potTotal();
    for (const q of this.seats) if (q) q.bet = 0;
    if (p) {
      p.chips += pot;
      p.win = pot;
      p.handName = '';
      this.result = { showdown: false, winners: [{ seat: p.seat, amount: pot, hand: '' }], pots: [{ amount: pot, winners: [p.seat], hand: '' }], pot, text: `${p.name} wins ${pot}` };
      this.logAdd(this.result.text, 'win', { seat: p.seat });
      this.emit('win', { seats: [p.seat], amount: pot });
    }
    this.finishHand();
  }

  finishHand() {
    for (const p of this.seats) if (p) p.bet = 0;
    this.changed();
    if (this.started) {
      this.nextTimer = this.later(() => this.startHand(), 8000);
    }
  }

  // ---------- what a client is allowed to see ----------
  publicState(viewerSeat) {
    const v = viewerSeat >= 0 ? this.seats[viewerSeat] : null;
    const showdown = (this.result && this.result.showdown) || this.allInReveal;
    const running = this.handRunning();
    const players = this.seats.map((p, i) => {
      if (!p) return null;
      const reveal = p === v || (showdown && p.inHand && !p.folded);
      return {
        seat: i, name: p.name, bot: p.bot, chips: p.chips, bet: p.bet,
        folded: p.folded, allIn: p.allIn, inHand: p.inHand && (running || this.street === 'showdown'),
        connected: p.bot || p.connected, sitOut: p.sitOut, busted: p.busted, left: p.left,
        last: p.lastAction, win: p.win,
        hole: reveal && p.hole.length ? p.hole : null,
        hand: reveal && p.handName ? p.handName : ''
      };
    });
    let legal = null;
    if (v && running && this.toAct === viewerSeat) legal = this.legalFor(v);
    let myHand = '';
    if (v && v.inHand && !v.folded && v.hole.length === 2) myHand = describe(v.hole, this.board);
    return {
      street: this.street, handNo: this.handNo, turnId: this.turnId,
      board: this.board.slice(),
      pot: running ? this.potTotal() : (this.result ? this.result.pot : 0),
      currentBet: this.currentBet, minRaise: this.minRaise,
      dealer: this.dealer, sbSeat: this.sbSeat, bbSeat: this.bbSeat,
      toAct: this.toAct, timeLeftMs: this.toAct >= 0 && this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      started: this.started, msg: this.msg,
      settings: { sb: this.sb, bb: this.bb, startChips: this.startChips, actionTime: this.actionTime },
      players, legal, myHand,
      result: this.result,
      log: this.log.slice(-90)
    };
  }
}

module.exports = { Table, MAX };
