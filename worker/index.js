/* 公网服务器（Cloudflare Worker + Durable Object）
 * 把 server.js 的房间逻辑搬进一个单例 Durable Object，供公网模式使用。
 * 前端仍从 Pages / GitHub Pages 打开，只把 /api/* 指到这里。
 */
import { Engine, DEFAULT_RULE } from '../js/engine.js';
import { nextAction, timeoutAction } from '../js/bot.js';

const ROUNDS = 8;
const OFFLINE_MS = 12000;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanName(s) {
  return String(s || '').replace(/[<>{}"'`\\]/g, '').trim().slice(0, 8) || '玩家';
}

export class RoomCore {
  constructor() {
    this.room = {
      code: String(Math.floor(100000 + Math.random() * 900000)),
      nextReady: [false, false, false, false],
      newMatch: [false, false, false, false],
      players: [],
      engine: null,
      started: false,
      over: false,
      paused: false,
      pausedAt: null,
      stats: { wins: [0, 0, 0, 0], fan: [0, 0, 0, 0] },
      lastResultKey: '',
      version: 0,
      lastBotAt: 0,
      lastKey: '',
      deadline: null,
      rule: { ...DEFAULT_RULE, rounds: ROUNDS },
    };
  }

  seatByToken(t) {
    return this.room.players.findIndex((p) => p.token && p.token === t);
  }

  applyAction(action, seat) {
    if (!this.room.engine) return false;
    try {
      this.room.engine.apply(action, seat);
      this.room.version++;
      this.trackStats();
      return true;
    } catch (e) {
      return false;
    }
  }

  trackStats() {
    const s = this.room.engine && this.room.engine.state;
    if (!s || s.phase !== 'finished' || s.drawnGame || !s.result) return;
    const w = s.result.winner;
    const key = `${s.roundIndex}|${w}`;
    if (this.room.lastResultKey === key) return;
    this.room.lastResultKey = key;
    if (w != null && w >= 0) {
      this.room.stats.wins[w]++;
      this.room.stats.fan[w] = Math.round((this.room.stats.fan[w] + (s.result.mult || 0)) * 100) / 100;
    }
  }

  fillWithBots() {
    let n = 1;
    while (this.room.players.length < 4) {
      this.room.players.push({ name: '机器人' + n++, token: null, isBot: true, online: true, lastSeen: 0 });
    }
  }

  resetReady() { this.room.nextReady = [false, false, false, false]; }
  resetNewMatch() { this.room.newMatch = [false, false, false, false]; }

  resetRoom() {
    const fresh = new RoomCore().room;
    this.room = { ...fresh, code: String(Math.floor(100000 + Math.random() * 900000)) };
  }

  dissolve() {
    this.room.closed = true;
    this.room.players = [];
    this.room.engine = null;
    this.room.started = false;
    this.room.over = false;
    this.room.paused = false;
    this.room.deadline = null;
    this.room.nextReady = [false, false, false, false];
    this.room.newMatch = [false, false, false, false];
    this.room.version++;
  }

  offlineNames() {
    return this.room.players.filter((p) => p && !p.isBot && !p.online).map((p) => p.name);
  }

  syncPresence() {
    const now = Date.now();
    for (const p of this.room.players) {
      if (!p || p.isBot) continue;
      if (p.online && p.lastSeen && now - p.lastSeen > OFFLINE_MS) p.online = false;
    }
    const inGame = this.room.engine && this.room.engine.state.phase !== 'finished';
    const off = this.offlineNames();
    if (off.length && inGame && !this.room.paused) {
      this.room.paused = true;
      this.room.pausedAt = now;
      this.room.version++;
    } else if (!off.length && this.room.paused) {
      this.room.paused = false;
      const gap = now - (this.room.pausedAt || now);
      if (this.room.deadline) this.room.deadline.at += gap;
      this.room.pausedAt = null;
      this.room.version++;
    }
  }

  allReady() {
    for (let i = 0; i < 4; i++) {
      const p = this.room.players[i];
      if (!p || p.isBot || !p.online) continue;
      if (!this.room.nextReady[i]) return false;
    }
    return true;
  }

  startGame(rule = null) {
    this.fillWithBots();
    this.resetReady();
    this.resetNewMatch();
    this.room.paused = false;
    this.room.pausedAt = null;
    this.room.stats = { wins: [0, 0, 0, 0], fan: [0, 0, 0, 0] };
    this.room.lastResultKey = '';
    if (rule && typeof rule === 'object') {
      this.room.rule = { ...DEFAULT_RULE, ...this.room.rule, ...rule };
      this.room.rule.rounds = [8, 16, 32].includes(Number(this.room.rule.rounds)) ? Number(this.room.rule.rounds) : 8;
    }
    const names = this.room.players.map((p, i) => p.name || '玩家' + (i + 1));
    const botSeats = [];
    for (let i = 0; i < 4; i++) if (this.room.players[i].isBot) botSeats.push(i);
    this.room.engine = new Engine({ seed: (Date.now() & 0xffffffff) >>> 0, names, botSeats, dealer: 0, roundIndex: 1, rule: this.room.rule });
    this.room.engine.startHand();
    this.room.started = true;
    this.room.over = false;
    this.room.lastKey = '';
    this.room.deadline = null;
    this.room.version++;
  }

  snapshotFor(seat) {
    const snap = this.room.engine.snapshotFor(seat);
    snap.turnDeadline = this.room.deadline && !this.room.paused ? this.room.deadline.at : null;
    snap.over = this.room.over;
    snap.seats = this.room.players.map((p) => ({ name: p.name, isBot: p.isBot, online: p.online }));
    snap.canStart = seat === 0 && !this.room.started;
    snap.canNext = this.room.engine && this.room.engine.state.phase === 'finished';
    snap.rounds = this.room.rule.rounds || ROUNDS;
    snap.nextReady = this.room.nextReady.slice();
    snap.newMatch = this.room.newMatch.slice();
    snap.newMatchCount = this.room.newMatch.filter(Boolean).length;
    snap.newMatchNeed = this.room.players.filter((p) => p && !p.isBot && p.online).length;
    snap.stats = { wins: this.room.stats.wins.slice(), fan: this.room.stats.fan.slice() };
    snap.paused = !!this.room.paused;
    snap.offlineNames = this.offlineNames();
    return snap;
  }

  tick() {
    const now = Date.now();
    this.syncPresence();
    if (!this.room.started || !this.room.engine) return;
    if (this.room.paused) return;
    const s = this.room.engine.state;

    if (s.phase === 'finished') {
      this.room.deadline = null;
      if (s.roundIndex >= (this.room.rule.rounds || ROUNDS) && !this.room.over) {
        this.room.over = true;
        this.room.version++;
      }
      return;
    }

    const key = `${s.phase}|${s.current}|${s.pending ? s.pending.outstanding.join(',') : ''}|${s.wall.remaining}`;
    if (key !== this.room.lastKey) {
      this.room.lastKey = key;
      this.room.deadline = null;
      if (s.phase === 'awaitingDiscard' && this.room.players[s.current] && !this.room.players[s.current].isBot) {
        this.room.deadline = { at: now + DEFAULT_RULE.playSeconds * 1000, kind: 'discard', seat: s.current };
      } else if (s.phase === 'awaitingClaim' && s.pending) {
        const humans = s.pending.outstanding.filter((x) => this.room.players[x] && !this.room.players[x].isBot);
        if (humans.length) this.room.deadline = { at: now + DEFAULT_RULE.claimSeconds * 1000, kind: 'pass', seat: humans[0] };
      }
    }

    if (this.room.deadline && now >= this.room.deadline.at) {
      const d = this.room.deadline;
      this.room.deadline = null;
      if (d.kind === 'discard') {
        const p = s.players[d.seat];
        p.declareIntent = false;
        const a = timeoutAction(this.room.engine, d.seat);
        if (a.type !== 'pass') this.applyAction(a, d.seat);
      } else {
        this.applyAction({ type: 'pass' }, d.seat);
      }
      return;
    }

    if (now - this.room.lastBotAt < 420) return;
    let botSeat = -1;
    if (s.phase === 'awaitingClaim' && s.pending) {
      botSeat = s.pending.outstanding.find((x) => this.room.players[x] && this.room.players[x].isBot);
      if (botSeat === undefined) botSeat = -1;
    } else if ((s.phase === 'awaitingDiscard' || s.phase === 'finalDraw') && this.room.players[s.current] && this.room.players[s.current].isBot) {
      botSeat = s.current;
    }
    if (botSeat >= 0) {
      const a = nextAction(this.room.engine, botSeat) || { type: 'pass' };
      this.applyAction(a, botSeat);
      this.room.lastBotAt = now;
    }
  }

  async handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    this.tick();
    const url = new URL(request.url);
    let room = this.room;

    if (url.pathname === '/api/room' && request.method === 'GET') {
      return json({
        code: room.code, started: room.started, over: room.over, paused: room.paused,
        seats: room.players.map((p) => ({ name: p.name, isBot: p.isBot, online: p.online })), rounds: room.rule.rounds || ROUNDS,
        rule: room.rule,
      });
    }

    if (url.pathname === '/api/join' && request.method === 'POST') {
      if (room.closed) { this.resetRoom(); room = this.room; }
      const body = await request.json().catch(() => ({}));
      const name = cleanName(body.name);
      const oldSeat = room.players.findIndex((p) => p && !p.isBot && p.name === name);
      const canReclaim = oldSeat >= 0 && !room.players[oldSeat].online;
      if (canReclaim) {
        const t = token();
        room.players[oldSeat] = { ...room.players[oldSeat], token: t, online: true, lastSeen: Date.now() };
        room.version++;
        this.syncPresence();
        return json({ seat: oldSeat, token: t, name: room.players[oldSeat].name, resumed: true });
      }
      if (room.started && !room.over) return json({ error: '本局已经开始，等这局打完再加入' }, 409);
      if (oldSeat >= 0 && room.players[oldSeat].online) return json({ error: '这个名字已经在座，换一个名字' }, 409);
      if (room.players.length >= 4) return json({ error: '房间已满（4 人）' }, 409);
      const t = token();
      const seat = room.players.length;
      room.players.push({ name, token: t, isBot: false, online: true, lastSeen: Date.now() });
      room.version++;
      return json({ seat, token: t, name: room.players[seat].name });
    }

    if (url.pathname === '/api/dissolve' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const seat = this.seatByToken(body.token || '');
      if (seat !== 0) return json({ error: '只有房主能解散房间' }, 403);
      this.dissolve();
      return json({ ok: true });
    }

    if (url.pathname === '/api/state' && request.method === 'GET') {
      if (room.closed) return json({ error: '房间已解散，请回首页' }, 410);
      const t = url.searchParams.get('token') || '';
      const seat = this.seatByToken(t);
      if (seat < 0) return json({ error: '未入座' }, 401);
      room.players[seat].lastSeen = Date.now();
      room.players[seat].online = true;
      this.syncPresence();
      if (!room.engine) {
        return json({
          seat, code: room.code, started: false, version: room.version,
          seats: room.players.map((p) => ({ name: p.name, isBot: p.isBot, online: p.online })), snapshot: null, rounds: room.rule.rounds || ROUNDS,
        });
      }
      return json({
        seat, code: room.code, started: room.started, version: room.version,
        snapshot: this.snapshotFor(seat), rounds: room.rule.rounds || ROUNDS,
      });
    }

    if (url.pathname === '/api/action' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const seat = this.seatByToken(body.token || '');
      if (seat < 0) return json({ error: '未入座' }, 401);
      if (room.paused) return json({ error: '有玩家掉线，等待重连' }, 409);
      if (!room.engine || room.engine.state.phase === 'finished') return json({ error: '当前不能操作' }, 400);
      const ok = this.applyAction(body.action || {}, seat);
      return json({ ok }, ok ? 200 : 400);
    }

    if (url.pathname === '/api/start' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const seat = this.seatByToken(body.token || '');
      if (seat !== 0) return json({ error: '只有房主能开局' }, 403);
      if (room.started && !room.over) return json({ error: '已经开局了' }, 400);
      this.startGame(body.rule || room.rule);
      return json({ ok: true });
    }

    if (url.pathname === '/api/next' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const seat = this.seatByToken(body.token || '');
      if (seat < 0) return json({ error: '未入座' }, 401);
      if (room.paused) return json({ error: '有玩家掉线，等待重连' }, 409);
      if (!room.engine) return json({ error: '还没开局' }, 400);
      const s = room.engine.state;
      if (s.phase !== 'finished') return json({ error: '本局还没结束' }, 400);
      if (s.roundIndex >= (room.rule.rounds || ROUNDS)) {
        room.over = true;
        room.version++;
        return json({ ok: true, over: true });
      }
      room.nextReady[seat] = true;
      room.version++;
      if (!this.allReady()) return json({ ok: true, waiting: true, nextReady: room.nextReady.slice() });
      this.resetReady();
      room.engine.startNextHand((Date.now() & 0xffffffff) >>> 0);
      room.lastKey = '';
      room.deadline = null;
      room.version++;
      return json({ ok: true, over: false });
    }

    if (url.pathname === '/api/restart' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const seat = this.seatByToken(body.token || '');
      if (seat < 0) return json({ error: '未入座' }, 401);
      if (room.paused) return json({ error: '有玩家掉线，等待重连' }, 409);
      if (!room.over) return json({ error: '本场还没打完' }, 400);
      if (room.players[seat] && room.players[seat].isBot) return json({ error: '机器人不投票' }, 403);
      room.newMatch[seat] = true;
      room.version++;
      const humans = [];
      room.players.forEach((p, i) => { if (p && !p.isBot && p.online) humans.push(i); });
      const got = humans.filter((i) => room.newMatch[i]).length;
      if (got < humans.length) return json({ ok: true, waiting: true, count: got, need: humans.length, newMatch: room.newMatch.slice() });
      this.resetNewMatch();
      room.over = false;
      room.engine = null;
      room.started = false;
      this.startGame();
      return json({ ok: true, over: false });
    }

    return json({ error: 'unknown api' }, 404);
  }
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.core = new RoomCore();
  }

  async fetch(request) {
    return this.core.handle(request);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'jianli-majiang-api', version: 'v125', time: Date.now() });
    }
    if (!url.pathname.startsWith('/api/')) {
      return json({ error: 'not found' }, 404);
    }
    const stub = env.ROOM.get(env.ROOM.idFromName('v125'));
    return stub.fetch(request);
  },
};
