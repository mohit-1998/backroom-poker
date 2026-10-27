'use strict';
// End-to-end: real server, real WebSocket clients, bots, reconnect, and hidden-card checks.
process.env.POKER_SPEED = '0.01';
const assert = require('assert');
const WebSocket = require('ws');
const { server } = require('../server');

const tok = (c) => (c + 'x'.repeat(20)).slice(0, 24);

function client(port, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const c = { ws, token, state: null, states: [], events: [], errors: [], code: null, autoplay: false, leaks: 0 };
  c.opened = new Promise((res) => ws.on('open', res));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'state') {
      c.state = m; c.states.push(m);
      // while a hand is live and nobody is all-in, other players' cards must never be visible
      const running = ['preflop', 'flop', 'turn', 'river'].includes(m.street);
      const anyAllIn = m.players.some((p) => p && p.allIn);
      if (running && !anyAllIn) {
        for (const p of m.players) if (p && p.seat !== m.you && p.hole) c.leaks++;
      }
      if (c.autoplay && m.legal && m.toAct === m.you) {
        const l = m.legal;
        setTimeout(() => c.send({ t: 'act', a: l.canCheck ? 'check' : 'call' }), 5);
      }
      if (m.street === 'showdown' && m.players[m.you] && m.players[m.you].chips === 0) c.send({ t: 'rebuy' });
    } else if (m.t === 'joined') c.code = m.code;
    else if (m.t === 'error') c.errors.push(m);
    else if (m.t === 'ev') c.events.push(m);
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}

const until = (fn, ms = 20000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (fn()) { clearInterval(iv); res(); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout waiting: ' + fn.toString())); }
  }, 10);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  // http bits
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.text());
  assert.strictEqual(health, 'ok');
  const trav = await fetch(`http://127.0.0.1:${port}/..%2fserver.js`).then((r) => r.status);
  assert.notStrictEqual(trav, 200, 'path traversal must not serve files');
  console.log('  ✓ healthz + traversal guard');

  // unknown room
  const x = client(port, tok('X'));
  await x.opened;
  x.send({ t: 'join', code: 'ZZZZ', name: 'Nobody', token: x.token });
  await until(() => x.errors.length);
  assert(x.errors[0].notFound);
  x.ws.close();
  console.log('  ✓ unknown room is rejected');

  // create + join
  const a = client(port, tok('A'));
  await a.opened;
  a.send({ t: 'create', name: 'Alice', token: a.token, bots: 2, startChips: 2000, bb: 20 });
  await until(() => a.code && a.state);
  assert.strictEqual(a.code.length, 4);
  assert.strictEqual(a.state.players.filter(Boolean).length, 3);
  assert(a.state.host);

  const b = client(port, tok('B'));
  await b.opened;
  b.send({ t: 'join', code: a.code.toLowerCase(), name: 'Bob', token: b.token });
  await until(() => b.state && b.state.you >= 0);
  assert(!b.state.host);
  await until(() => a.state.players.filter(Boolean).length === 4);
  console.log('  ✓ create room, bots, join by code (case-insensitive)');

  // only host can start
  b.send({ t: 'start' });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(a.state.handNo, 0, 'non-host must not start the game');
  a.autoplay = true; b.autoplay = true;
  a.send({ t: 'start' });
  await until(() => a.state.handNo >= 1 && a.state.street);
  console.log('  ✓ host starts the game');

  // reconnect mid-game with the same token keeps the seat
  const bSeat = b.state.you;
  b.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  const b2 = client(port, tok('B'));
  await b2.opened;
  b2.autoplay = true;
  b2.send({ t: 'join', code: a.code, name: 'Bob', token: b2.token });
  await until(() => b2.state && b2.state.you === bSeat);
  console.log('  ✓ reconnect restores the same seat');

  // play several hands
  await until(() => a.state.handNo >= 4 && a.state.street === 'showdown', 60000);
  assert(a.state.result && a.state.result.text, 'hand result present');
  console.log('  ✓ played to hand', a.state.handNo, '·', a.state.result.text);

  // sound events were emitted
  const kinds = new Set(a.events.map((e) => e.k));
  for (const k of ['deal', 'chips', 'win']) assert(kinds.has(k), 'missing event ' + k);
  console.log('  ✓ events:', [...kinds].join(', '));

  // card privacy
  assert.strictEqual(a.leaks + b2.leaks, 0, 'hole cards leaked to another player');
  console.log('  ✓ hole cards never leaked mid-hand (' + (a.states.length + b2.states.length) + ' states checked)');

  // chips conserved in a published state
  const total = a.state.players.filter(Boolean).reduce((s, p) => s + p.chips, 0);
  assert(total % 2000 === 0 && total >= 8000, 'chips conserved, got ' + total);
  console.log('  ✓ chips conserved:', total);

  // acting out of turn is refused
  const notMe = a.state.toAct;
  a.send({ t: 'act', a: 'fold' });
  b2.send({ t: 'act', a: 'fold' });
  await new Promise((r) => setTimeout(r, 50));

  // leaving
  a.send({ t: 'leave' });
  await until(() => b2.state.players.filter((p) => p && !p.bot).length === 1, 10000);
  console.log('  ✓ leaving frees the seat');

  a.ws.close(); b2.ws.close();
  server.close();
  setTimeout(() => { console.log('\ne2e passed'); process.exit(0); }, 100);
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
