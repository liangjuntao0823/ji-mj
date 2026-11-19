/* 手机联机（P2P）：房主的浏览器当主机，其他人输房号通过 WebRTC 直连。
 * 不需要电脑、不需要服务器，四个人在同一个 WiFi 下就能打。
 */
import { Engine, DEFAULT_RULE } from './engine.js';
import { nextAction, discardCandidate } from './bot.js';
import { isPizi } from './tiles.js';
import { initTable, renderAll, updateTimer, showResult, hideResult, backToHome, updateReadyBar, setRoomCode, setPaused, showBoard, hideBoard, setNetLatency, clearNetLatency } from './ui.js';

const ROUNDS = 8;
const HOST_PREFIX = 'jianli-mj-';
const TURN_KEY = { id: 'bd217c091ed00f411628c818e5b83d0b', secret: '5e07f1b5ed89771c54b6f48f6fd8b47dcea4492ea84901fde686f4954f44fbfb' };
const STUN_LIST = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.chat.bilibili.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const ICE = { iceServers: STUN_LIST.slice(), iceCandidatePoolSize: 4 };

/* Cloudflare Calls TURN：key/secret 不能当账号密码直接用，必须现换短期凭证。
 * 页面里 fetch 该接口带 CORS 头，可直接拿 iceServers；失败就只走 STUN 直连。 */
async function refreshIce() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY.id}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TURN_KEY.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
      signal: ac.signal,
    });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length) {
      ICE.iceServers = data.iceServers.concat(STUN_LIST);
    }
  } catch (e) {
    /* 没网 / 接口挂了：退回 STUN 直连 */
  } finally {
    clearTimeout(timer);
  }
}
const iceReady = refreshIce();
async function ensureIce() { try { await iceReady; } catch (e) {} }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* 信令服务器：
 *  - 页面从 https 域名打开（云服务器 / 云托管）→ 用同域的 /peer，摆脱公共服务的波动
 *  - 其他情况（本地文件、http 调试）→ 用 PeerJS 公共云
 *  - 想强制指定时，在页面里写 window.JIANLI_PEER_CONFIG = { host:'x', port:443, path:'/peer', secure:true }
 */
function peerOptions() {
  const forced = window.JIANLI_PEER_CONFIG;
  const cfg = { ...(forced && forced.config ? forced.config : ICE) };
  if (window.JIANLI_FORCE_RELAY) cfg.iceTransportPolicy = 'relay';
  if (forced && typeof forced === 'object') return { ...forced, config: cfg, debug: 0 };
  if (window.JIANLI_PEER_SELF === true && location.hostname) {
    const secure = location.protocol === 'https:';
    return { host: location.hostname, port: Number(location.port) || (secure ? 443 : 80), path: '/peer', secure, config: cfg, debug: 0 };
  }
  return { config: cfg, debug: 0 };
}

const P = {
  role: null,          // 'host' | 'guest'
  entryMode: 'create',
  code: '',
  name: '',
  seat: 0,
  peer: null,
  conns: [],           // host: [{ conn, seat }]
  players: [],         // host: [{ name, isBot, online }]
  engine: null,
  started: false,
  over: false,
  version: 0,
  deadline: null,
  lastKey: '',
  lastBotAt: 0,
  lastSentVersion: -1,
  snap: null,
  inGame: false,
  resultKey: '',
  stats: { wins: [0, 0, 0, 0], fan: [0, 0, 0, 0] },
  statsKey: '',
  lastPhase: '',
  lastStateVersion: -1,
  hostConn: null,
  nextReady: [false, false, false, false],
  lobbySig: '',
  loop: null,
  uiTimer: null,
  joinTimer: null,
  clockOffset: 0,      // 房主时钟 - 本机时钟（毫秒），用来对齐倒计时
  reconnectTimer: null,
  reconnectTry: 0,
  latencyTimer: null,
  rule: { ...DEFAULT_RULE, rounds: ROUNDS },
};

const el = (id) => document.getElementById(id);
const status = (t) => { const s = el('lobby-status'); if (s) s.textContent = t; };

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* ---------------- 大厅 UI ---------------- */

function buildEntryUI(mode = 'create') {
  const isJoin = mode === 'join';
  el('lobby').classList.add('show');
  el('lobby-name-row').style.display = 'none';
  document.querySelector('.lobby-title').textContent = isJoin ? '加入房间' : '创建房间';
  document.querySelector('.lobby-sub').textContent = isJoin
    ? '手机直连 · 输入房主给你的 6 位房号'
    : '手机直连 · 自己当房主，开局后空位补机器人';

  let box = el('p2p-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'p2p-box';
    const card = document.querySelector('.lobby-card');
    card.insertBefore(box, el('lobby-seats'));
  }
  box.innerHTML = `
    <div id="p2p-entry">
      <input id="p2p-name" maxlength="8" placeholder="你的名字" autocomplete="off">
      ${isJoin ? `
      <div class="p2p-join-row">
        <input id="p2p-code" maxlength="6" placeholder="6 位房号" autocomplete="off" spellcheck="false">
        <button class="big-btn ghost" id="p2p-join">加入房间</button>
      </div>` : `
      <button class="big-btn" id="p2p-create">创建房间</button>`}
    </div>
    <div id="p2p-code-show" class="hidden"></div>
  `;
  el('p2p-name').value = P.name || localStorage.getItem('jianli_name') || '';
  const createBtn = el('p2p-create');
  if (createBtn) createBtn.onclick = () => createRoom();
  const joinBtn = el('p2p-join');
  if (joinBtn) joinBtn.onclick = () => joinRoom();
  const codeInput = el('p2p-code');
  if (codeInput) codeInput.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  el('lobby-actions').innerHTML = '';
  el('lobby-seats').innerHTML = '';
  status('');
}

function setEntryVisible(v) {
  const e = el('p2p-entry');
  if (e) e.style.display = v ? 'block' : 'none';
}

function readName() {
  const input = el('p2p-name') || el('lobby-name');
  const v = (input && input.value.trim()) || '';
  if (!v) { status('先填名字，再进房'); if (input) input.focus(); return null; }
  const name = v.slice(0, 8);
  P.name = name;
  localStorage.setItem('jianli_name', name);
  return name;
}

/* ---------------- 房主 ---------------- */

async function createRoom() {
  if (!window.Peer) { status('联机组件没加载，刷新一下页面'); return; }
  const name = readName();
  if (!name) return;
  await ensureIce();
  P.role = 'host';
  P.seat = 0;
  const cfg = window.JIANLI_HOME_RULE || {};
  P.rule = { ...DEFAULT_RULE, rounds: [8, 16, 32].includes(Number(cfg.rounds)) ? Number(cfg.rounds) : ROUNDS, withDragons: !!cfg.withDragons, addonEnabled: !!cfg.addonEnabled, baseShare: Math.max(1, Math.min(3, Number(cfg.baseShare) || 1)) };
  P.players = [{ name, isBot: false, online: true }];
  P.version++;

  const tryBind = (attempt) => {
    P.code = makeCode();
    const peer = new Peer(HOST_PREFIX + P.code, peerOptions());
    P.peer = peer;
    peer.on('open', () => {
      setEntryVisible(false);
      showRoomCode();
      renderSeats();
      renderHostActions();
      status('把房号发给其他三个人，他们打开同一个页面输入房号');
      startHostLoop();
    });
    peer.on('error', (e) => {
      if (e && e.type === 'unavailable-id' && attempt < 5) { try { peer.destroy(); } catch {} ; tryBind(attempt + 1); return; }
      status('建房失败：' + errText(e));
      P.role = null;
    });
    peer.on('connection', onGuest);
  };
  tryBind(0);
}

function showRoomCode() {
  const box = el('p2p-code-show');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = `<div class="p2p-code-label">房号</div><div class="p2p-code">${P.code}</div>`;
  setRoomCode(P.code);
  document.querySelector('.lobby-sub').textContent = '让其他人打开本页面 → 输入这个房号 → 加入';
}

function renderSeats() {
  const box = el('lobby-seats');
  box.style.display = 'block';
  box.innerHTML = '';
  const names = ['东（房主）', '南', '西', '北'];
  for (let i = 0; i < 4; i++) {
    const p = P.players[i];
    const row = document.createElement('div');
    const mine = P.role === 'host' ? i === 0 : i === P.seat;
    row.className = 'seat-row' + (p ? ' filled' : '') + (mine ? ' me' : '');
    row.textContent = `${names[i]}   ${p ? p.name + (p.isBot ? '（机器人）' : '') : '空位'}`;
    box.append(row);
  }
}

function renderHostActions() {
  const actions = el('lobby-actions');
  actions.innerHTML = '';
  if (P.started && !P.over && P.engine && P.engine.state.phase !== 'finished') return;
  const b = document.createElement('button');
  b.className = 'big-btn';
  const n = P.players.filter((p) => p).length;
  b.textContent = n >= 4 ? '开始对局' : '开始对局（空位补机器人）';
  b.onclick = () => startHostGame();
  actions.append(b);
}

let hostPeerSeq = 0;

/* 给单个玩家推 hello + 完整 state。连接刚建立时立即发有可能丢包，所以补一次延迟重发 */
function pushToGuest(conn, seat) {
  const send = () => {
    if (P.role !== 'host' || !conn || !conn.open) return;
    try {
      conn.send({ t: 'hello', seat, started: P.started, over: P.over, code: P.code, players: P.players });
      conn.send({ t: 'state', seat, started: P.started, over: P.over, version: P.version, snap: snapshotFor(seat) });
    } catch {}
  };
  send();
  setTimeout(send, 300);
}

/* 绑定一条玩家连接的事件；close 时只有这条连接仍是该座位的当前连接才降级为机器人 */
/* 心跳：3 秒 ping 一次，10 秒没 pong 判掉线（手机切后台、直接关页面都能兜住） */
function heartbeatGuests(now) {
  for (const c of P.conns) {
    const p = P.players[c.seat];
    if (!p || p.isBot) continue;
    if (c.lastPong && now - c.lastPong > 10000 && p.online) {
      p.online = false;
      P.version++;
      P.lastKey = '';
      P.deadline = null;
    }
    if (!c.lastPingAt || now - c.lastPingAt > 3000) {
      c.lastPingAt = now;
      try { if (c.conn.open) c.conn.send({ t: 'ping', ts: now }); } catch (e) {}
    }
  }
}

function bindGuestConn(conn, seat, name) {
  conn.on('data', (msg) => hostMsg(conn, seat, msg));
  conn.on('close', () => {
    const i = P.conns.findIndex((c) => c.conn === conn);
    if (i < 0) return;
    P.conns.splice(i, 1);
    if (P.players[seat]) P.players[seat].online = false;
    P.lastKey = '';          /* 恢复时重建倒计时 */
    P.deadline = null;
    P.version++;
    if (!P.inGame) { renderSeats(); renderHostActions(); }
    hostPush(true);
  });
}

function onGuest(conn) {
  const name = cleanName(conn.metadata && conn.metadata.name);
  let metaSeat = conn.metadata && typeof conn.metadata.seat === 'number' ? conn.metadata.seat : -1;

  /* 断线重连：先按座位号 + 名字对；页面刷新后座位号会丢，再按名字找空位还原 */
  if ((metaSeat <= 0 || !P.players[metaSeat]) && name) {
    const idx = P.players.findIndex((p, i) => i > 0 && p && p.name === name);
    if (idx > 0) metaSeat = idx;
  }
  /* 断线重连：座位号 + 名字都对得上就原座还原，对局进行中也允许回来 */
  if (metaSeat > 0 && P.players[metaSeat] && P.players[metaSeat].name === name) {
    const seat = metaSeat;
    for (const c of P.conns.slice()) {
      if (c.seat === seat && c.conn !== conn) { try { c.conn.close(); } catch {} }
    }
    P.conns = P.conns.filter((c) => c.seat !== seat);
    P.players[seat].online = true;
    P.players[seat].isBot = false;
    P.conns.push({ conn, seat, lastPong: Date.now(), lastPingAt: 0 });
    P.version++;
    P.lastKey = '';
    bindGuestConn(conn, seat, name);
    pushToGuest(conn, seat);
    hostPush(true);
    if (!P.inGame) { renderSeats(); renderHostActions(); hostBroadcastLobby(); }
    return;
  }

  if (P.started && P.engine && P.engine.state.phase !== 'finished') {
    try { conn.send({ t: 'reject', reason: '这一局已经开始，等这局打完再进来' }); } catch {}
    setTimeout(() => { try { conn.close(); } catch {} }, 300);
    return;
  }
  const used = new Set(P.conns.map((c) => c.seat));
  let seat = -1;
  for (let i = 1; i < 4; i++) if (!used.has(i) && !P.players[i]) { seat = i; break; }
  if (seat < 0) {
    try { conn.send({ t: 'reject', reason: '房间满了（4 人）' }); } catch {}
    setTimeout(() => { try { conn.close(); } catch {} }, 300);
    return;
  }
  P.players[seat] = { name, isBot: false, online: true };
  P.conns.push({ conn, seat });
  P.version++;
  hostPeerSeq++;

  bindGuestConn(conn, seat, name);

  pushToGuest(conn, seat);
  if (!P.inGame) { renderSeats(); renderHostActions(); hostBroadcastLobby(); status(`${name} 加入了（${P.conns.length + 1}/4）`); }
}

function hostBroadcastLobby() {
  const players = P.players.map((p) => ({ name: p && p.name, isBot: !!(p && p.isBot), online: !!(p && p.online) }));
  for (const g of P.conns) {
    try { if (g.conn.open) g.conn.send({ t: 'lobby', code: P.code, players }); } catch {}
  }
}

function hostMsg(conn, seat, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'pong') {
    const c = P.conns.find((x) => x.conn === conn);
    if (c) {
      c.lastPong = Date.now();
      const rtt = Number(msg.ts) ? Date.now() - Number(msg.ts) : NaN;
      if (Number.isFinite(rtt) && rtt >= 0) { c.lastRtt = rtt; updateHostLatency(); }
    }
    return;
  }
  if (msg.t === 'gping') {
    try { if (conn.open) conn.send({ t: 'gpong', ts: msg.ts }); } catch (e) {}
    return;
  }
  if (msg.type === 'act' || msg.t === 'act') {
    applyHostAction(msg.action, seat);
  } else if (msg.t === 'start' && seat === 0) {
    startHostGame();
  } else if (msg.t === 'next') {
    markReady(seat);
  } else if (msg.t === 'restart' && seat === 0) {
    P.over = false; P.started = false; P.engine = null; startHostGame();
  } else if (msg.t === 'lobbyReq') {
    /* 客机连上后主动拉一次：房主开局前后立即推的消息可能丢失，这步保证座位号和牌面一定拿得到 */
    pushToGuest(conn, seat);
    try { conn.send({ t: 'lobby', code: P.code, players: P.players }); } catch {}
  } else if (msg.t === 'newmatch') {
    voteNewMatch(seat);
  } else if (msg.t === 'bye') {
    try { conn.close(); } catch {}
  }
}

function applyHostAction(action, seat) {
  if (!P.engine || P.engine.state.phase === 'finished') return;
  try {
    P.engine.apply(action, seat);
    P.version++;
    hostPush();
  } catch {}
}

function startHostGame() {
  P.stats = { wins: [0, 0, 0, 0], fan: [0, 0, 0, 0] };
  P.statsKey = '';
  if (!P.engine) {
    while (P.players.length < 4) P.players.push({ name: '机器人' + (P.players.length), isBot: true, online: true });
    const names = P.players.map((p, i) => (p && p.name) || '玩家' + (i + 1));
    const botSeats = [];
    for (let i = 0; i < 4; i++) if (P.players[i] && P.players[i].isBot) botSeats.push(i);
    P.engine = new Engine({ seed: (Date.now() & 0xffffffff) >>> 0, names, botSeats, dealer: 0, roundIndex: 1, rule: P.rule });
    P.engine.startHand();
  } else {
    P.engine.startNextHand((Date.now() & 0xffffffff) >>> 0);
  }
  P.started = true;
  P.over = false;
  P.nextReady = [false, false, false, false];
  P.lastKey = '';
  P.deadline = null;
  P.lastBotAt = 0;
  P.version++;
  P.lastSentVersion = -1;
  enterGame();
  hostPush();
}

/* 有人点了「下一局」：记下来，广播，全员都点了才真的开下一局 */
function markReady(seat) {
  if (!P.engine || P.engine.state.phase !== 'finished') return;
  if (P.engine.state.roundIndex >= (P.rule.rounds || ROUNDS)) return;
  if (!P.nextReady) P.nextReady = [false, false, false, false];
  P.nextReady[seat] = true;
  P.version++;
  hostPush();
  if (allReady()) doNextHand();
}

function allReady() {
  for (let i = 0; i < 4; i++) {
    const p = P.players[i];
    if (!p || p.isBot || !p.online) continue;   // 机器人 / 掉线的自动算
    if (!P.nextReady[i]) return false;
  }
  return true;
}

function doNextHand() {
  P.nextReady = [false, false, false, false];
  if (!P.engine || P.engine.state.phase !== 'finished') return;
  if (P.engine.state.roundIndex >= (P.rule.rounds || ROUNDS)) {
    P.over = true;
    P.version++;
    hostPush();
    maybeShowResult(true);
    return;
  }
  hideResult();
  P.resultKey = '';
  P.engine.startNextHand((Date.now() & 0xffffffff) >>> 0);
  P.lastKey = '';
  P.deadline = null;
  P.version++;
  P.lastSentVersion = -1;
  hostPush();
}

/* 最终局打完 → 四个人都点「开始新一轮对局」才重开，分数清零 */
function voteNewMatch(seat) {
  if (!P.engine) return;
  const st = P.engine.state;
  if (st.phase !== 'finished' || st.roundIndex < ROUNDS) return;
  if (!P.newMatch) P.newMatch = [false, false, false, false];
  P.newMatch[seat] = true;
  P.version++;
  hostPush(true);
  const humans = [];
  P.players.forEach((p, i) => { if (p && !p.isBot) humans.push(i); });
  const got = humans.filter((i) => P.newMatch[i]).length;
  if (got >= humans.length) doNewMatch();
}

function doNewMatch() {
  P.newMatch = [false, false, false, false];
  P.over = false;
  P.started = false;
  P.engine = null;
  P.nextReady = [false, false, false, false];
  P.resultKey = '';
  P.lastKey = '';
  P.deadline = null;
  P.stats = { wins: [0, 0, 0, 0], fan: [0, 0, 0, 0] };
  P.statsKey = '';
  hideResult();
  hideBoard();
  for (const p of P.players) if (p) p.score = 0;
  startHostGame();
}

/* ---------------- 房主驱动 ---------------- */

function updateHostLatency() {
  const vals = P.conns.map((c) => Number(c.lastRtt)).filter((n) => Number.isFinite(n) && n >= 0);
  if (vals.length) setNetLatency(Math.max(...vals));
}

/* 客机每 2.5 秒测一次到房主的往返延迟；房主在心跳里测每一台客机 */
function startLatencyLoop() {
  if (P.latencyTimer) clearInterval(P.latencyTimer);
  if (P.role !== 'guest') return;
  P.latencyTimer = setInterval(() => {
    if (!P.hostConn || !P.hostConn.open) return;
    try { P.hostConn.send({ t: 'gping', ts: Date.now() }); } catch (e) {}
  }, 2500);
}

function startHostLoop() {
  if (P.loop) clearInterval(P.loop);
  P.loop = setInterval(hostTick, 120);
}

/* 累计「胡局 / 总番」，供最终记分板用（P2P 房主算，广播给客人） */
function trackStatsP() {
  const s = P.engine && P.engine.state;
  if (!s || s.phase !== 'finished' || s.drawnGame || !s.result) return;
  const w = s.result.winner;
  const key = `${s.roundIndex}|${w}`;
  if (P.statsKey === key) return;
  P.statsKey = key;
  if (w != null && w >= 0) {
    P.stats.wins[w] = (P.stats.wins[w] || 0) + 1;
    P.stats.fan[w] = Math.round(((P.stats.fan[w] || 0) + (s.result.mult || 0)) * 100) / 100;
  }
}

function hostTick() {
  if (!P.engine) return;
  trackStatsP();
  const s = P.engine.state;
  const now = Date.now();
  heartbeatGuests(now);
  if (s.phase === 'finished') {
    P.deadline = null;
    if (s.roundIndex >= (P.rule.rounds || ROUNDS) && !P.over) {   // 打满 8 局直接出总排名，等四人齐点再来一场
      P.over = true;
      P.version++;
      hostPush();
      return;
    }
    hostPush();
    return;
  }

  /* 有人掉线：全局限时暂停，不推进、不代打，等人回来 */
  const offlineNames = P.players.filter((p) => p && !p.isBot && !p.online).map((p) => p.name);
  if (offlineNames.length) {
    if (P.deadline) { P.deadline.pausedAt = P.deadline.pausedAt || now; }
    setPaused(offlineNames, true, { roomCode: P.code, canRefresh: false });
    if (!P.boardForced) { P.boardForced = true; showBoard(); }
    hostPush();
    return;
  }
  setPaused([], false);
  if (P.boardForced) { P.boardForced = false; hideBoard(); }
  if (P.deadline && P.deadline.pausedAt) {
    P.deadline.at += now - P.deadline.pausedAt;
    delete P.deadline.pausedAt;
    P.version++;
  }
  const key = `${s.phase}|${s.current}|${s.pending ? s.pending.outstanding.join(',') : ''}|${s.wall.remaining}`;
  if (key !== P.lastKey) {
    P.lastKey = key;
    P.deadline = null;
    if (s.phase === 'awaitingDiscard' && P.players[s.current] && !P.players[s.current].isBot && P.players[s.current].online) {
      P.deadline = { at: now + DEFAULT_RULE.playSeconds * 1000, kind: 'discard', seat: s.current };
    } else if (s.phase === 'awaitingClaim' && s.pending) {
      const humans = s.pending.outstanding.filter((x) => P.players[x] && !P.players[x].isBot && P.players[x].online);
      if (humans.length) P.deadline = { at: now + DEFAULT_RULE.claimSeconds * 1000, kind: 'pass', seat: humans[0] };
    }
    /* 倒计时起点变了必须通知所有人，否则只有房主自己的计时器在走 */
    P.version++;
  }

  if (P.deadline && now >= P.deadline.at) {
    const d = P.deadline;
    P.deadline = null;
    if (d.kind === 'discard') {
      const who = s.players[d.seat];
      who.declareIntent = false;  /* 超时自动出牌，报听声明作废 */
      if (who.hand.some(isPizi)) { applyHostAction({ type: 'bu' }, d.seat); return; }
      /* 单钓已明牌时只能打刚摸的那张 */
      const forced = (who.singleLocked !== null && s.lastDrawn !== null && who.hand.includes(s.lastDrawn))
        ? s.lastDrawn : null;
      const t = forced !== null ? forced : discardCandidate(who.hand);
      if (t !== null) applyHostAction({ type: 'discard', tile: t }, d.seat);
    } else {
      applyHostAction({ type: 'pass' }, d.seat);
    }
    return;
  }

  if (now - P.lastBotAt >= 420) {
    let botSeat = -1;
    if (s.phase === 'awaitingClaim' && s.pending) {
      const x = s.pending.outstanding.find((i) => P.players[i] && P.players[i].isBot);
      if (x !== undefined) botSeat = x;
    } else if ((s.phase === 'awaitingDiscard' || s.phase === 'finalDraw') && P.players[s.current] && P.players[s.current].isBot) {
      botSeat = s.current;
    }
    if (botSeat >= 0) {
      const a = nextAction(P.engine, botSeat) || { type: 'pass' };
      try { P.engine.apply(a, botSeat); P.version++; } catch {}
      P.lastBotAt = now;
    }
  }
  hostPush();
}

function snapshotFor(seat) {
  if (!P.engine) return null;   // 大厅阶段（还没开局）没有牌面快照
  const snap = P.engine.snapshotFor(seat);
  /* 倒计时同步：房主下发自己的绝对时间戳 + 自己的当前时钟 + 这一段的总时长，
   * 各端用 clockOffset 换算成本机时间，避免两台手机系统时钟不一致导致倒计时对不上。 */
  snap.turnDeadline = P.deadline ? P.deadline.at : null;
  snap.srvNow = Date.now();
  snap.turnTotal = P.deadline
    ? (P.deadline.kind === 'discard' ? DEFAULT_RULE.playSeconds : DEFAULT_RULE.claimSeconds) * 1000
    : 0;
  snap.over = P.over;
  snap.seats = P.players.map((p) => ({ name: p && p.name, isBot: !!(p && p.isBot), online: !!(p && p.online) }));
  snap.canStart = seat === 0 && !P.started;
  snap.canNext = !!(P.engine && P.engine.state.phase === 'finished');
  snap.rounds = P.rule.rounds || ROUNDS;
  snap.code = P.code;
  snap.nextReady = (P.nextReady || [false, false, false, false]).slice();
  snap.paused = P.players.some((p) => p && !p.isBot && !p.online);
  snap.offlineNames = P.players.filter((p) => p && !p.isBot && !p.online).map((p) => p.name);
  snap.seriesOver = !!(P.engine && P.engine.state.phase === 'finished' && P.engine.state.roundIndex >= (P.rule.rounds || ROUNDS));
  snap.stats = { wins: (P.stats.wins || []).slice(), fan: (P.stats.fan || []).slice() };
  snap.newMatch = (P.newMatch || [false, false, false, false]).slice();
  snap.newMatchCount = (P.newMatch || []).filter((v, i) => v && P.players[i] && !P.players[i].isBot).length;
  snap.newMatchNeed = P.players.filter((p) => p && !p.isBot).length;
  return snap;
}

function hostPush(force = false) {
  if (force || P.version !== P.lastSentVersion) {
    P.lastSentVersion = P.version;
    for (const g of P.conns) {
      try { if (g.conn.open) g.conn.send({ t: 'state', seat: g.seat, started: P.started, over: P.over, version: P.version, snap: snapshotFor(g.seat) }); } catch {}
    }
    if (P.engine && P.role === 'host') {
      P.snap = wrapSnapshot(snapshotFor(0));
      if (P.inGame) { renderAll(); maybeShowResult(); }
      const s = P.engine.state;
      if (s.phase === 'finished' && P.deadline === null) {}
    }
  } else if (P.engine && P.role === 'host' && P.inGame) {
    P.snap = wrapSnapshot(snapshotFor(0));
  }
}

/* ---------------- 玩家 ---------------- */

async function joinRoom() {
  if (!window.Peer) { status('联机组件没加载，刷新一下页面'); return; }
  const codeInput = el('p2p-code');
  if (!codeInput) { status('请从首页「加入房间」进入'); return; }
  const code = (codeInput.value || '').trim().toUpperCase();
  if (code.length !== 6) { status('请输入 6 位房号'); codeInput.focus(); return; }
  if (!readName()) return;
  await ensureIce();
  P.role = 'guest';
  P.code = code;
  P.reconnectTry = 0;
  status('正在连接房主…');

  clearTimeout(P.joinTimer);
  P.joinTimer = setTimeout(() => {
    if (!P.hostConn || !P.hostConn.open) guestRetry('还没连上房主');
  }, 9000);

  guestConnect();
}

/* 建立（或重建）到房主的连接；断线由 guestRetry 负责重试 */
function guestConnect() {
  if (P.role !== 'guest' || !P.code) return;
  /* 连接代数：旧连接的回调一律丢弃，避免重连风暴 */
  const gen = (P.connGen = (P.connGen || 0) + 1);
  const oldPeer = P.peer;
  P.peer = null;
  if (oldPeer) { try { oldPeer.destroy(); } catch {} }

  const peer = new Peer(peerOptions());
  P.peer = peer;
  peer.on('open', () => {
    if (gen !== P.connGen || P.role !== 'guest') return;
    const conn = peer.connect(HOST_PREFIX + P.code, {
      reliable: true,
      metadata: { name: P.name, seat: P.seat || 0 },
    });
    P.hostConn = conn;
    conn.on('open', () => {
      if (gen !== P.connGen || P.role !== 'guest') return;
      clearTimeout(P.joinTimer);
      P.joinTimer = null;
      P.reconnectTry = 0;
      setPaused([], false);
      status('');
      if (!P.inGame) { setEntryVisible(false); showRoomCode(); renderGuestSeats(); }
      startLatencyLoop();
      /* 握手：房主在连接刚建立时推的 hello/state 可能丢，这里主动拉，直到拿到座位号为止 */
      clearInterval(P.handshakeTimer);
      let tries = 0;
      const greet = () => {
        if (gen !== P.connGen || P.role !== 'guest' || P.seat > 0) {
          clearInterval(P.handshakeTimer);
          P.handshakeTimer = null;
          return;
        }
        if (++tries > 8) {
          clearInterval(P.handshakeTimer);
          P.handshakeTimer = null;
          guestRetry('没拿到座位号');
          return;
        }
        try { conn.send({ t: 'lobbyReq' }); } catch {}
      };
      greet();
      P.handshakeTimer = setInterval(greet, 700);
    });
    conn.on('data', (msg) => { if (gen === P.connGen) guestMsg(msg); });
    conn.on('close', () => {
      if (gen !== P.connGen || P.role !== 'guest') return;
      guestRetry('房主那边断开了');
    });
    conn.on('error', () => {
      if (gen !== P.connGen || P.role !== 'guest') return;
      guestRetry('连接出错');
    });
  });
  peer.on('error', (e) => {
    if (gen !== P.connGen || P.role !== 'guest') return;
    const t = e && e.type;
    if (t === 'peer-unavailable') { guestRetry('房号还没上线'); return; }
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') { guestRetry(errText(e)); return; }
    status(errText(e));
  });
}

/* 自动重连：逐步拉长间隔，最多 20 次（约一分钟） */
function guestRetry(reason) {
  if (P.role !== 'guest') return;
  if (P.reconnectTimer) return;
  P.reconnectTry = (P.reconnectTry || 0) + 1;
  if (P.reconnectTry > 20) {
    status('重连失败：房主可能已经结束对局，回首页重新进房');
    return;
  }
  const delay = Math.min(1000 + P.reconnectTry * 800, 6000);
  /* 直连两次没通就改走 TURN 中继，跨运营商/跨网络时更稳 */
  if (P.reconnectTry === 2 && !window.JIANLI_FORCE_RELAY) {
    window.JIANLI_FORCE_RELAY = true;
    status('直连没通，改用中继重连…');
  }
  status(`${reason || '连接断了'}，正在重连房主…（第 ${P.reconnectTry} 次）`);
  if (P.inGame) setPaused([P.name || '我'], true, { roomCode: P.code, canRefresh: true, onRefresh: guestReconnectNow });
  P.reconnectTimer = setTimeout(() => {
    P.reconnectTimer = null;
    if (P.role === 'guest') guestConnect();
  }, delay);
}

function guestReconnectNow() {
  clearTimeout(P.reconnectTimer);
  P.reconnectTimer = null;
  P.reconnectTry = 0;
  if (P.role !== 'guest') return;
  const t = el('pause-text'); if (t) t.innerHTML = '正在按原房号和名字重连…';
  guestConnect();
}
window.__jianliReconnect = guestReconnectNow;

function guestMsg(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'ping') {
    try { if (P.hostConn && P.hostConn.open) P.hostConn.send({ t: 'pong', ts: msg.ts }); } catch (e) {}
    return;
  }
  if (msg.t === 'gpong') {
    const rtt = Number(msg.ts) ? Date.now() - Number(msg.ts) : NaN;
    if (Number.isFinite(rtt) && rtt >= 0) setNetLatency(rtt);
    return;
  }
  if (msg.t === 'reject') {
    clearTimeout(P.joinTimer);
    status(msg.reason || '进不去');
    try { P.hostConn.close(); } catch {}
    reset();
    return;
  }
  if (msg.t === 'hello') {
    P.seat = msg.seat || 0;
    P.code = msg.code || P.code;
    if (Array.isArray(msg.players)) { P.players = msg.players; P.lobbySig = ''; }
    if (!P.inGame) { setEntryVisible(false); showRoomCode(); renderGuestSeats(); }
    return;
  }
  if (msg.t === 'lobby') {
    if (Array.isArray(msg.players)) { P.players = msg.players; P.lobbySig = ''; }
    if (msg.code) P.code = msg.code;
    if (!P.inGame) { showRoomCode(); renderGuestSeats(); }
    return;
  }
  if (msg.t === 'state') {
    if (typeof msg.seat === 'number') P.seat = msg.seat;
    const snap = msg.snap;
    if (!snap) return;
    const ver = typeof msg.version === 'number' ? msg.version : -1;
    const changed = ver !== P.lastStateVersion || snap.phase !== P.lastPhase;
    P.lastStateVersion = ver;
    P.snap = wrapSnapshot(snap);
    /* 用房主的下发时刻校准本机时钟，让倒计时在两边同时走完 */
    if (typeof snap.srvNow === 'number') {
      const off = snap.srvNow - Date.now();
      if (!P.clockOffset || Math.abs(off - P.clockOffset) > 800) P.clockOffset = off;
    }
    if (Array.isArray(snap.nextReady)) P.nextReady = snap.nextReady.slice();
    P.over = !!snap.over;
    P.lastPhase = snap.phase;
    /* 新一局已经开始就必须关掉结算层：房主的 hideResult 只作用于他自己那台手机 */
    if (snap.phase !== 'finished') hideResult();
    if (!P.inGame) {
      setEntryVisible(false);
      renderGuestSeats();
      if (msg.started || snap.started) enterGame();
    }
    if (snap.code) P.code = snap.code;
    setRoomCode(P.code);
    setPaused(snap.offlineNames || [], !!snap.paused, { roomCode: P.code, canRefresh: false });
    if (snap.paused) showBoard();
    /* 只有版本真的变了才重绘，否则每 250ms 白跑一遍 DOM 会卡 */
    if (P.inGame && changed) { renderAll(); maybeShowResult(); }
  }
}

function wrapSnapshot(snap) {
  return { ...snap, wall: { remaining: snap.wallRemaining } };
}

function renderGuestSeats() {
  const seats = (P.players && P.players.length) ? P.players
    : ((P.snap && P.snap.seats) || []);
  const box = el('lobby-seats');
  box.style.display = 'block';
  box.innerHTML = '';
  const names = ['东（房主）', '南', '西', '北'];
  for (let i = 0; i < 4; i++) {
    const p = seats[i];
    const row = document.createElement('div');
    row.className = 'seat-row' + (p ? ' filled' : '') + (i === P.seat ? ' me' : '');
    row.textContent = `${names[i]}   ${p ? p.name + (p.isBot ? '（机器人）' : '') : '空位'}`;
    box.append(row);
  }
  document.querySelector('.lobby-sub').textContent = `房号 ${P.code} · 等房主开始`;
  el('lobby-actions').innerHTML = '';
  const tip = document.createElement('div');
  tip.style.cssText = 'color: rgba(243,236,216,.6); font-size: 14px; margin-top: 10px;';
  tip.textContent = '等待房主开始对局…';
  el('lobby-actions').append(tip);
}

/* ---------------- 共用：进牌桌 ---------------- */

function enterGame() {
  if (P.inGame) return;
  /* 客机必须已经拿到房主分配的座位号才能进牌桌，否则座位方向、下一局就绪标记全会错位 */
  if (P.role === 'guest' && !P.seat) return;
  if (!P.snap && P.engine) P.snap = wrapSnapshot(snapshotFor(P.role === 'host' ? 0 : P.seat));
  P.inGame = true;
  el('lobby').classList.remove('show');
  initTable({
    humanSeat: P.seat,
    mode: 'p2p',
    totalRounds: (P.snap && P.snap.rounds) || ROUNDS,
    getState: () => P.snap,
    getMyActions: () => (P.snap && P.snap.myActions) || [],
    getDeclareOptions: () => (P.snap && P.snap.myDeclareOptions) || [],
    getPendingOptions: () => (P.snap && P.snap.pending ? P.snap.pending.myOptions : null),
    onDiscard: (tile) => send({ type: 'discard', tile }),
    onAct: (a) => send(a),
    onNext: () => nextHand(),
    onExit: () => exitP2P(),
    canNewMatch: () => !!(P.snap && P.snap.seriesOver),
    newMatchClicks: () => (P.snap && P.snap.newMatchCount) || 0,
    newMatchTotal: () => (P.snap && P.snap.newMatchNeed) || 4,
    onNewMatch: () => sendNewMatch(),
  });
  renderAll();
  if (!P.uiTimer) {
    P.uiTimer = setInterval(() => {
      const s = P.snap;
      if (!s || !s.turnDeadline) return;
      const totalMs = s.turnTotal || (s.phase === 'awaitingClaim' ? DEFAULT_RULE.claimSeconds : DEFAULT_RULE.playSeconds) * 1000;
      const left = s.turnDeadline - (Date.now() + (P.clockOffset || 0));
      updateTimer(left / totalMs, totalMs / 1000);
    }, 100);
  }
}

function sendNewMatch() {
  if (P.role === 'host') { voteNewMatch(0); return; }
  try { if (P.hostConn && P.hostConn.open) P.hostConn.send({ t: 'newmatch' }); } catch {}
}

function send(action) {
  if (P.role === 'host') {
    applyHostAction(action, 0);
    return;
  }
  try { if (P.hostConn && P.hostConn.open) P.hostConn.send({ t: 'act', action }); } catch {}
}

function nextHand() {
  if (P.role === 'host') { markReady(0); return; }
  if (!P.nextReady) P.nextReady = [false, false, false, false];
  P.nextReady[P.seat] = true;
  updateReadyBar(P.nextReady, namesOf(), P.seat);

  /* 跨省网络偶尔丢包：这一局还没真正开起来就多补发两次，避免房主一直等下一个人 */
  const again = () => {
    if (!P.snap || P.snap.phase !== 'finished') return;
    try { if (P.hostConn && P.hostConn.open) P.hostConn.send({ t: 'next' }); } catch {}
  };
  again();
  setTimeout(again, 1200);
  setTimeout(again, 3000);
}

function exitP2P() {
  if (P.latencyTimer) { clearInterval(P.latencyTimer); P.latencyTimer = null; }
  clearNetLatency();
  const role = P.role;
  P.role = null;          // 先摘掉身份，避免主动退出时触发自动重连
  if (role === 'host') {
    for (const g of P.conns) { try { g.conn.send({ t: 'bye' }); g.conn.close(); } catch {} }
  } else {
    try { if (P.hostConn) P.hostConn.close(); } catch {}
  }
  try { if (P.peer) P.peer.destroy(); } catch {}
  hideResult();
  hideBoard();
  setPaused([], false);
  setRoomCode(null);
  backToHome();
  el('lobby').classList.remove('show');
  const entryBox = el('p2p-box');
  if (entryBox) entryBox.remove();
  const codeShow = el('p2p-code-show');
  if (codeShow) codeShow.remove();
  reset();
  if (window.__lobbyBack === exitP2P) window.__lobbyBack = null;
}

function reset() {
  if (P.latencyTimer) { clearInterval(P.latencyTimer); P.latencyTimer = null; }
  clearNetLatency();
  clearInterval(P.loop);
  clearInterval(P.uiTimer);
  clearInterval(P.handshakeTimer);
  clearTimeout(P.joinTimer);
  clearTimeout(P.reconnectTimer);
  Object.assign(P, {
    role: null, code: '', seat: 0, peer: null, conns: [], players: [],
    engine: null, started: false, over: false, version: 0, deadline: null,
    lastKey: '', lastBotAt: 0, lastSentVersion: -1, snap: null, inGame: false,
    resultKey: '', lastPhase: '', lastStateVersion: -1, hostConn: null, loop: null, uiTimer: null, joinTimer: null,
    clockOffset: 0, connGen: 0, reconnectTimer: null, reconnectTry: 0, handshakeTimer: null, latencyTimer: null,
  });
}

/* ---------------- 结算 ---------------- */

function namesOf() {
  return (P.snap && P.snap.seats ? P.snap.seats.map((s) => s && s.name) : ['东', '南', '西', '北']);
}

function maybeShowResult(isFinal) {
  const snap = P.snap;
  if (snap && snap.phase === 'finished' && snap.roundIndex >= (P.rule.rounds || ROUNDS)) {
    showBoard();
  }
  if (!snap || snap.phase !== 'finished') return;
  const key = `${snap.roundIndex}|${snap.winner}|${snap.drawnGame}|${P.over}|${snap.players.map((p) => p.score).join(',')}|${snap.newMatchCount || 0}`;
  const mySeat = P.role === 'host' ? 0 : P.seat;
  if (P.resultKey === key && !isFinal) {
    updateReadyBar(snap.nextReady, namesOf(), mySeat);
    return;
  }
  P.resultKey = key;

  if (snap.over) { showFinal(); return; }

  if (snap.drawnGame) {
    showResult({
      title: '流局',
      subtitle: `牌墙摸完 · 庄家不变，下一局继续（${snap.roundIndex}/${P.rule.rounds || ROUNDS}）`,
      hand: null,
      payments: null,
      scores: snap.players.map((p) => p.score),
      names: namesOf(),
      ready: snap.nextReady,
      mySeat,
      reds: snap.players.map((p) => p.redsPlayed),
      drawnGame: true,
    });
    return;
  }
  const r = snap.result;
  if (!r) return;
  const winner = snap.players[r.winner];
  const fanText = (r.fans || []).map((f) => f.name).join(' + ');
  const multText = r.mult ? ` ×${r.mult}` : '';
  showResult({
    title: `${winner.name} 自摸`,
    subtitle: `${fanText}${multText} · 每家 ${r.base} 分起 · 第 ${snap.roundIndex}/${P.rule.rounds || ROUNDS} 局`,
    winnerSeat: r.winner,
    hand: r.hand,
    melds: r.melds,
    payments: r.payments,
    scores: r.scores,
    names: namesOf(),
    reds: snap.players.map((p) => p.redsPlayed),
    ready: snap.nextReady,
    mySeat,
  });
}

function showFinal() {
  const snap = P.snap;
  if (!snap) return;
  const names = namesOf();
  const scores = snap.players.map((p) => p.score);
  showResult({
    final: true,
    scores,
    names,
    ranked: names.map((name, seat) => ({ seat, name, score: scores[seat] })).sort((a, b) => b.score - a.score),
    rounds: snap.rounds || P.rule.rounds || ROUNDS,
    mySeat: P.role === 'host' ? 0 : P.seat,
    stats: snap.stats,
    winnerSeat: (!snap.drawnGame && snap.result && snap.result.winner != null) ? snap.result.winner : null,
    hand: (!snap.drawnGame && snap.result && snap.result.hand) || null,
    melds: (!snap.drawnGame && snap.result && snap.result.melds) || null,
    fans: (!snap.drawnGame && snap.result && snap.result.fans) || null,
  });
}


/* ---------------- 工具 ---------------- */

function cleanName(s) {
  return String(s || '').replace(/[<>{}"'`\\]/g, '').trim().slice(0, 8) || '玩家';
}

function errText(e) {
  if (!e) return '未知错误';
  const t = e.type || '';
  if (t === 'peer-unavailable') return '房号不存在，确认一下是不是输错了';
  if (t === 'network') return '网络连不上（信令服务器不可达），换个网络试试';
  if (t === 'server-error') return '信令服务器忙，稍后再试';
  if (t === 'unavailable-id') return '房号被占用，重新建一次';
  if (t === 'browser-incompatible') return '这个浏览器不支持联机，换 Chrome / Safari 新版';
  if (t === 'webrtc') return '点对点连接失败，两个人先连同一个 WiFi';
  return t || (e.message || '未知错误');
}

export function openP2P(mode = 'create') {
  window.__lobbyBack = exitP2P;
  window.__jianliReconnect = guestReconnectNow;
  if (P.role) { el('lobby').classList.add('show'); return; }
  P.entryMode = mode === 'join' ? 'join' : 'create';
  buildEntryUI(P.entryMode);
}

window.P2P = { open: openP2P, _state: () => P };
