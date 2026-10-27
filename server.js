'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Table } = require('./engine/table');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_ROOMS = 200;
const ROOM_IDLE_MS = 10 * 60 * 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain'
};

// ---------- static files ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('ok');
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

// ---------- rooms ----------
const rooms = new Map();

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function cleanName(n) {
  const s = String(n || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 14);
  return s || 'Player';
}

function validToken(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);
}

function num(v, lo, hi, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

class Room {
  constructor(code, settings) {
    this.code = code;
    this.clients = new Set();
    this.hostToken = null;
    this.lastActive = Date.now();
    this.table = new Table(settings, {
      onChange: () => this.broadcast(),
      onEvent: (ev) => this.sendAll({ t: 'ev', ...ev })
    });
  }

  seatOf(token) {
    return this.table.seats.findIndex((p) => p && p.token === token && !p.left);
  }

  isHost(ws) { return ws.token === this.hostToken; }

  sendAll(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(msg);
  }

  broadcast() {
    for (const ws of this.clients) {
      const seat = this.seatOf(ws.token);
      send(ws, {
        t: 'state', code: this.code, you: seat, host: this.isHost(ws),
        ...this.table.publicState(seat)
      });
    }
  }

  humans() { return this.table.seats.filter((p) => p && !p.bot && !p.left); }

  assignHost() {
    const connected = this.humans().find((p) => p.connected);
    const any = connected || this.humans()[0];
    this.hostToken = any ? any.token : null;
  }

  touch() { this.lastActive = Date.now(); }

  destroy() {
    this.table.destroy();
    for (const ws of this.clients) { send(ws, { t: 'closed' }); try { ws.close(); } catch (e) { /* ignore */ } }
    this.clients.clear();
  }
}

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function attach(ws, room, name) {
  ws.room = room;
  room.clients.add(ws);
  room.touch();
  let seat = room.seatOf(ws.token);
  if (seat >= 0) {
    const p = room.table.seats[seat];
    p.connected = true;
    if (name) p.name = name;
    room.table.logAdd(`${p.name} reconnected`);
  } else {
    seat = room.table.sit({ name, token: ws.token, bot: false });
    if (seat < 0) {
      room.clients.delete(ws);
      ws.room = null;
      send(ws, { t: 'error', m: 'This table is full (8 players).', fatal: true });
      return false;
    }
  }
  if (!room.hostToken) room.assignHost();
  send(ws, { t: 'joined', code: room.code });
  room.table.maybeStart();
  room.broadcast();
  return true;
}

function detach(ws) {
  const room = ws.room;
  if (!room) return;
  room.clients.delete(ws);
  ws.room = null;
  const seat = room.seatOf(ws.token);
  // another tab/socket with the same token may still be connected
  const stillThere = [...room.clients].some((c) => c.token === ws.token);
  if (seat >= 0 && !stillThere) {
    const p = room.table.seats[seat];
    p.connected = false;
    room.table.logAdd(`${p.name} disconnected`);
  }
  if (room.hostToken === ws.token && !stillThere) room.assignHost();
  room.touch();
  room.broadcast();
}

function handle(ws, m) {
  switch (m.t) {
    case 'ping': send(ws, { t: 'pong' }); return;

    case 'create': {
      if (!validToken(m.token)) return send(ws, { t: 'error', m: 'Bad session id', fatal: true });
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', m: 'Server is busy, try again in a few minutes.', fatal: true });
      if (ws.room) detach(ws);
      const code = newCode();
      if (!code) return send(ws, { t: 'error', m: 'Could not create a room', fatal: true });
      const bb = num(m.bb, 2, 5000, 20);
      const settings = {
        startChips: num(m.startChips, bb * 20, 1000000, 2000),
        bb, sb: Math.max(1, Math.floor(bb / 2)),
        actionTime: num(m.actionTime, 10, 120, 30),
        speed: process.env.POKER_SPEED ? Number(process.env.POKER_SPEED) : 1 // tests only
      };
      const room = new Room(code, settings);
      rooms.set(code, room);
      ws.token = m.token;
      room.hostToken = m.token;
      if (!attach(ws, room, cleanName(m.name))) return undefined;
      const bots = num(m.bots, 0, 7, 3);
      for (let i = 0; i < bots; i++) room.table.addBot();
      return undefined;
    }

    case 'join': {
      if (!validToken(m.token)) return send(ws, { t: 'error', m: 'Bad session id', fatal: true });
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', m: `Room ${code || '—'} was not found. Check the code with your host.`, fatal: true, notFound: true });
      if (ws.room) detach(ws);
      ws.token = m.token;
      attach(ws, room, cleanName(m.name));
      return undefined;
    }

    default: break;
  }

  const room = ws.room;
  if (!room) return undefined;
  room.touch();
  const t = room.table;
  const seat = room.seatOf(ws.token);

  switch (m.t) {
    case 'act': {
      if (seat < 0) return undefined;
      const err = t.act(seat, String(m.a), m.amt);
      if (err) send(ws, { t: 'error', m: err });
      return undefined;
    }
    case 'start':
      if (room.isHost(ws)) t.startGame();
      return undefined;
    case 'addBot':
      if (room.isHost(ws)) { if (t.addBot() < 0) send(ws, { t: 'error', m: 'Table is full' }); }
      return undefined;
    case 'removeSeat': {
      if (!room.isHost(ws)) return undefined;
      const s = num(m.seat, 0, 7, -1);
      const p = t.seats[s];
      if (p && p.bot) t.leave(s);
      return undefined;
    }
    case 'rebuy': if (seat >= 0) t.rebuy(seat); return undefined;
    case 'back': if (seat >= 0) t.back(seat); return undefined;
    case 'leave': {
      if (seat >= 0) t.leave(seat);
      const wasHost = room.isHost(ws);
      ws.room = null;
      room.clients.delete(ws);
      if (wasHost) room.assignHost();
      send(ws, { t: 'left' });
      room.broadcast();
      return undefined;
    }
    default: return undefined;
  }
}

// ---------- websocket ----------
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.msgCount = 0;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    ws.msgCount++;
    if (ws.msgCount > 60) { ws.close(1008, 'rate limit'); return; }
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(ws, m); } catch (e) { console.error('handler error', e); }
  });
  ws.on('close', () => detach(ws));
  ws.on('error', () => { /* handled by close */ });
});

// per-second message budget reset
setInterval(() => {
  for (const ws of wss.clients) ws.msgCount = 0;
}, 1000).unref();

// drop dead connections (phones that went to sleep, etc.)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 25 * 1000).unref();

// clean up rooms nobody is in
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.clients.size > 0;
    if (!anyone && now - room.lastActive > ROOM_IDLE_MS) {
      room.destroy();
      rooms.delete(code);
      console.log('closed idle room', code);
    }
  }
}, 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Backroom Poker listening on :${PORT}`));
}

module.exports = { server, rooms };
