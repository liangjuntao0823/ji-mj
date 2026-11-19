/* 局域网联机客户端：轮询服务器快照 + 提交动作 */
import { G, initTable, renderAll, updateTimer, showToast, showResult, hideResult, backToHome, updateReadyBar, setRoomCode, showBoard, hideBoard, setPaused, setNetLatency, clearNetLatency } from './ui.js';
import { label, SEAT_LABEL } from './tiles.js';

const NET = {
  seat: 0,
  token: null,
  name: '',
  entryMode: 'join',
  version: -1,
  snap: null,
  started: false,
  over: false,
  inGame: false,
  pollTimer: null,
  localTimer: null,
  resultKey: '',
  code: '',
  nextReady: [false, false, false, false],
};

/* 公网服务器地址：空 = 当前页面同源（局域网版 / 本机 server.js）。
 * B 模式填 https://jianli-majiang.pages.dev，跨网络也能入座。 */
let BASE = '';
try { BASE = (localStorage.getItem('jianli_server_base') || '').replace(/\/+$/, ''); } catch (e) {}

const el = (id) => document.getElementById(id);

function api(path, opts) {
  return fetch(BASE + path, opts).then((r) => r.json());
}

function clearToken() {
  NET.token = null;
  try {
    localStorage.removeItem('jianli_token');
    localStorage.removeItem('jianli_token_base');
  } catch (e) {}
}

/* ---------------- 入口 ---------------- */

export function openLAN(serverBase, mode = 'join') {
  clearNetLatency();
  window.__jianliReconnect = reconnectSelf;
  NET.entryMode = mode === 'create' ? 'create' : 'join';
  window.__lobbyBack = exitLAN;

  if (typeof serverBase === 'string') {
    const next = serverBase.trim().replace(/\/+$/, '');
    if (next !== BASE) clearToken();
    BASE = next;
    try { localStorage.setItem('jianli_server_base', BASE); } catch (e) {}
  }

  if (location.protocol === 'file:' && !BASE) {
    alert('局域网联机要先启动服务器：\n\n1. 双击 start-server.bat（或运行 node server.js）\n2. 用浏览器打开控制台显示的地址\n\n单机模式可以直接玩；跨网络请选「公网服务器」。');
    return;
  }

  /* 刷新页面后用本地保存的 token 直接回座（断线重连） */
  try {
    if (localStorage.getItem('jianli_token_base') !== BASE) clearToken();
    if (!NET.token) NET.token = localStorage.getItem('jianli_token') || null;
  } catch (e) {}

  el('lobby').classList.add('show');
  const staleP2P = el('p2p-box');
  if (staleP2P) staleP2P.remove();
  const staleCode = el('p2p-code-show');
  if (staleCode) staleCode.remove();
  el('lobby-name-row').style.display = NET.token ? 'none' : 'flex';
  const title = document.querySelector('.lobby-title');
  const sub = document.querySelector('.lobby-sub');
  const create = NET.entryMode === 'create';
  if (title) title.textContent = BASE ? (create ? '创建公网房间' : '加入公网房间') : (create ? '创建联机房间' : '加入联机房间');
  if (sub) sub.textContent = BASE
    ? (create ? '公网服务器 · 第一人自动当房主 · 开局后空位补机器人' : '公网服务器 · 输入名字，加入当前公共房间')
    : (create ? '同一个 WiFi · 第一人当房主 · 开局后空位补机器人' : '同一个 WiFi · 输入名字，加入当前房间');
  const joinBtn = el('lobby-join');
  if (joinBtn) joinBtn.textContent = create ? '创建房间' : '加入房间';
  const nameInput = el('lobby-name');
  if (nameInput) nameInput.placeholder = '你的名字（重连要用同一个）';
  el('lobby-name').value = NET.name || localStorage.getItem('jianli_name') || '';
  if (NET.token) {
    pollOnce().then(() => { if (NET.token) startPolling(); });
  }
}

el('lobby-join').addEventListener('click', async () => {
  const name = el('lobby-name').value.trim();
  if (!name) { el('lobby-name').focus(); return; }
  const btn = el('lobby-join');
  const hint = NET.entryMode === 'create' ? '正在创建房间…' : '正在加入房间…';
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = hint; }
  el('lobby-status').textContent = hint;
  NET.name = name;
  localStorage.setItem('jianli_name', name);
  try {
    const r = await api('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (r.error) { el('lobby-status').textContent = r.error; return; }
    NET.token = r.token;
    NET.seat = r.seat;
    localStorage.setItem('jianli_token', r.token);
    localStorage.setItem('jianli_token_base', BASE);
    el('lobby-name-row').style.display = 'none';
    startPolling();
  } catch (e) {
    el('lobby-status').textContent = '服务器没连上，稍后再试';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || (NET.entryMode === 'create' ? '创建房间' : '加入房间'); }
  }
});

/* ---------------- 轮询 ---------------- */

const POLL_MS = 40;

function startPolling() {
  if (NET.pollTimer) clearTimeout(NET.pollTimer);
  NET.pollTimer = true;
  const loop = async () => {
    if (!NET.pollTimer) return;
    await pollOnce();
    if (!NET.pollTimer) return;
    /* 串行轮询：上一次请求回来后再排下一次，避免 120ms 定时器把慢请求堆成雪崩 */
    NET.pollTimer = setTimeout(loop, POLL_MS);
  };
  loop();
  if (!NET.localTimer) {
    NET.localTimer = setInterval(() => {
      if (!NET.snap || !NET.snap.turnDeadline) return;
      const total = NET.snap.phase === 'awaitingClaim' ? 8000 : 30000;
      updateTimer((NET.snap.turnDeadline - Date.now()) / total);
    }, 100);
  }
}

function stopPolling() {
  clearTimeout(NET.pollTimer);
  NET.pollTimer = null;
  clearInterval(NET.localTimer);
  NET.localTimer = null;
}

async function pollOnce() {
  if (!NET.token) return;
  let r;
  let started = 0;
  try {
    started = performance.now();
    r = await api('/api/state?token=' + encodeURIComponent(NET.token));
    setNetLatency(performance.now() - started, 'server');
  } catch {
    el('lobby-status').textContent = '服务器连不上了';
    if (NET.inGame) setPaused([NET.name || '我'], true, { roomCode: NET.code, canRefresh: true, onRefresh: reconnectSelf });
    return;
  }
  if (r.error) {
    const dissolved = /解散/.test(r.error);
    NET.token = null;
    localStorage.removeItem('jianli_token');
    el('lobby-status').textContent = dissolved ? r.error : '座位已失效，请重新输入名字加入';
    el('lobby-name-row').style.display = 'flex';
    stopPolling();
    if (dissolved) {
      showToast(r.error);
      exitLAN();
    }
    return;
  }
  NET.seat = r.seat;
  NET.started = r.started;
  const snap = r.snapshot;
  const changed = r.version !== NET.version || (snap && snap.phase !== NET.lastPhase);
  NET.version = r.version;

  if (snap) {
    NET.snap = wrapSnapshot(snap);
    if (Array.isArray(snap.nextReady)) NET.nextReady = snap.nextReady.slice();
    NET.over = snap.over;
    if (snap.phase !== NET.lastPhase) NET.lastPhase = snap.phase;
    /* 掉线暂停：弹浮窗 + 自动开记分板，恢复后自动收起 */
    setPaused(snap.offlineNames || [], !!snap.paused, { roomCode: NET.code, canRefresh: false });
    if (snap.paused && !NET.boardForced) { NET.boardForced = true; showBoard(); }
    else if (!snap.paused && NET.boardForced) { NET.boardForced = false; hideBoard(); }
    if (snap.phase !== 'finished') {
      const rb = el('result');
      if (rb && rb.classList.contains('show')) hideResult();
    }
  }

  if (r.started && snap) {
    if (!NET.inGame) enterGame();
    if (changed) renderAll();
    maybeShowResult();
  } else {
    renderLobby(r);
  }
}

/** 把服务器快照包装成 ui.js 认的 state 形状 */
function wrapSnapshot(snap) {
  return {
    ...snap,
    wall: { remaining: snap.wallRemaining },
  };
}

function showCode(code) {
  if (!code) return;
  NET.code = code;
  let box = el('p2p-code-show');
  if (!box) {
    box = document.createElement('div');
    box.id = 'p2p-code-show';
    box.className = 'hidden';
    const sub = document.querySelector('.lobby-sub');
    if (sub && sub.parentElement) sub.parentElement.insertBefore(box, sub.nextSibling);
    else return;
  }
  box.classList.remove('hidden');
  box.innerHTML = `<div class="p2p-code-label">房号</div><div class="p2p-code">${code}</div>`;
}

/* ---------------- 房间等待 ---------------- */

async function dissolveRoom() {
  if (!confirm('解散房间？其他三个人会被移出，房间清空。')) return;
  try {
    const r = await api('/api/dissolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: NET.token }) });
    if (r.error) { showToast(r.error); return; }
    clearToken();
    NET.token = null;
    stopPolling();
    exitLAN();
  } catch {
    showToast('解散失败，检查网络后重试');
  }
}

function renderLobby(r) {
  showCode(r.code);
  el('lobby-name-row').style.display = NET.token ? 'none' : 'flex';
  el('lobby-seats').style.display = 'block';
  const box = el('lobby-seats');
  box.innerHTML = '';
  const seats = r.seats || [];
  const names = ['东（房主）', '南', '西', '北'];
  for (let i = 0; i < 4; i++) {
    const p = seats[i];
    const row = document.createElement('div');
    row.className = 'seat-row' + (p ? ' filled' : '') + (i === NET.seat ? ' me' : '');
    row.textContent = `${names[i]}   ${p ? p.name + (p.isBot ? '（机器人）' : '') : '空位'}`;
    box.append(row);
  }

  const actions = el('lobby-actions');
  const sig = `${NET.seat}|${(r.seats || []).length}|${r.started ? 1 : 0}`;
  if (actions.dataset.sig !== sig) {
    actions.dataset.sig = sig;
    actions.innerHTML = '';
    if (r.seats && r.seats.length >= 4 && NET.seat === 0) {
      const b = document.createElement('button');
      b.className = 'big-btn';
      b.textContent = '开始对局';
      b.onclick = async () => { await api('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: NET.token, rule: window.JIANLI_HOME_RULE || null }) }); pollOnce(); };
      actions.append(b);
    } else if (NET.seat === 0) {
      const b = document.createElement('button');
      b.className = 'big-btn';
      b.textContent = '开始对局（空位补机器人）';
      b.onclick = async () => { await api('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: NET.token, rule: window.JIANLI_HOME_RULE || null }) }); pollOnce(); };
      actions.append(b);
    } else {
      const t = document.createElement('div');
      t.style.cssText = 'color: rgba(243,236,216,.6); font-size: 14px;';
      t.textContent = '等待房主开始对局…';
      actions.append(t);
    }
    if (NET.seat === 0) {
      const d = document.createElement('button');
      d.className = 'big-btn ghost';
      d.textContent = '解散房间';
      d.onclick = dissolveRoom;
      actions.append(d);
    }
  }
}

/* ---------------- 进入牌桌 ---------------- */

function enterGame() {
  NET.inGame = true;
  el('lobby').classList.remove('show');
  initTable({
    humanSeat: NET.seat,
    mode: BASE ? 'net' : 'lan',
    totalRounds: (NET.snap && NET.snap.rounds) || 8,
    getState: () => NET.snap,
    getMyActions: () => (NET.snap && NET.snap.myActions) || [],
    getPendingOptions: () => (NET.snap && NET.snap.pending ? NET.snap.pending.myOptions : null),
    onDiscard: (tile) => send({ type: 'discard', tile }),
    onAct: (a) => send(a),
    onNext: () => nextHand(),
    onExit: () => exitLAN(),
    canNewMatch: () => !!(NET.snap && NET.snap.over),
    newMatchClicks: () => (NET.snap && NET.snap.newMatchCount) || 0,
    newMatchTotal: () => (NET.snap && NET.snap.newMatchNeed) || 4,
    onNewMatch: () => {
      api('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: NET.token }) })
        .then((r) => { if (r.error) showToast(r.error); NET.resultKey = ''; pollOnce(); });
    },
  });
  renderAll();
}

function send(action) {
  api('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: NET.token, action }), })
    .then((r) => { if (r.error) showToast(r.error); pollOnce(); });
}

function nextHand() {
  if (!NET.nextReady) NET.nextReady = [false, false, false, false];
  NET.nextReady[NET.seat] = true;
  updateReadyBar(NET.nextReady, namesOf(), NET.seat);
  api('/api/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: NET.token }) })
    .then((r) => {
      if (r.error) showToast(r.error);
      if (Array.isArray(r.nextReady)) NET.nextReady = r.nextReady.slice();
      pollOnce();
    });
}

async function reconnectSelf() {
  if (!NET.token || !BASE) { window.location.reload(); return; }
  try {
    const r = await api('/api/state?token=' + encodeURIComponent(NET.token));
    if (r && !r.error) {
      NET.version = -1;
      setPaused([], false);
      await pollOnce();
      if (NET.inGame) startPolling();
      return;
    }
  } catch (e) {}
  // token 失效时，用保存的名字重新进同一个公网房间
  try {
    const rr = await api('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: NET.name || localStorage.getItem('jianli_name') || '我' }) });
    if (!rr.error) {
      NET.token = rr.token; NET.seat = rr.seat;
      localStorage.setItem('jianli_token', rr.token);
      localStorage.setItem('jianli_token_base', BASE);
      NET.version = -1;
      setPaused([], false);
      await pollOnce();
      startPolling();
      return;
    }
  } catch (e) {}
  el('pause-text').innerHTML = '还是连不上，请检查网络后再点一次「刷新重连」';
}
window.__jianliReconnect = reconnectSelf;

function exitLAN() {
  setRoomCode(null);
  clearNetLatency();
  stopPolling();
  NET.inGame = false;
  NET.snap = null;
  NET.version = -1;
  NET.lastPhase = '';
  clearToken();
  try { localStorage.removeItem('jianli_token'); localStorage.removeItem('jianli_token_base'); } catch (e) {}
  hideResult();
  backToHome();
  el('lobby').classList.remove('show');
}

/* ---------------- 结算 ---------------- */

function namesOf() {
  return (NET.snap && NET.snap.seats ? NET.snap.seats.map((s) => s.name) : ['东', '南', '西', '北']);
}

function maybeShowResult() {
  const snap = NET.snap;
  if (!snap || snap.phase !== 'finished') return;
  const key = `${snap.roundIndex}|${snap.winner}|${snap.drawnGame}|${NET.over}|${snap.newMatchCount || 0}`;
  const mySeat = NET.seat;
  if (NET.resultKey === key) { updateReadyBar(snap.nextReady, namesOf(), mySeat); return; }
  NET.resultKey = key;

  if (snap.over) {
    const names = namesOf();
    const scores = snap.players.map((p) => p.score);
    showResult({
      final: true,
      scores,
      names,
      ranked: names.map((name, seat) => ({ seat, name, score: scores[seat] })).sort((a, b) => b.score - a.score),
      rounds: snap.rounds || 8,
      mySeat,
      stats: snap.stats,
      winnerSeat: (!snap.drawnGame && snap.result && snap.result.winner != null) ? snap.result.winner : null,
      hand: (!snap.drawnGame && snap.result && snap.result.hand) || null,
      melds: (!snap.drawnGame && snap.result && snap.result.melds) || null,
      fans: (!snap.drawnGame && snap.result && snap.result.fans) || null,
    });
    return;
  }

  if (snap.drawnGame) {
    showResult({
      title: '流局',
      subtitle: '牌墙摸完 · 庄家不变，下一局继续',
      hand: null,
      payments: null,
      scores: snap.players.map((p) => p.score),
      names: namesOf(),
    ready: snap.nextReady,
    mySeat,
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
    subtitle: `${fanText}${multText} · 每家 ${r.base} 分起 · 第 ${snap.roundIndex}/${snap.rounds || 8} 局`,
    winnerSeat: r.winner,
    hand: r.hand,
    melds: r.melds,
    payments: r.payments,
    scores: r.scores,
    names: namesOf(),
    ready: snap.nextReady,
    mySeat,
    reds: snap.players.map((p) => p.redsPlayed),
  });
}

function showFinal() {
  const snap = NET.snap;
  const card = el('result-card');
  card.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'result-title';
  t.textContent = '本场结束';
  card.append(t);
  const sub = document.createElement('div');
  sub.className = 'result-sub';
  sub.textContent = '共 8 局 · 感谢陪打';
  card.append(sub);

  const table = document.createElement('table');
  table.className = 'result-table';
  table.innerHTML = '<thead><tr><th>排名</th><th>名字</th><th>总分</th></tr></thead>';
  const tbody = document.createElement('tbody');
  const ranked = snap.players.map((p) => ({ name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${r.name}</td><td class="${r.score >= 0 ? 'pos' : 'neg'}">${r.score > 0 ? '+' : ''}${r.score}</td>`;
    tbody.append(tr);
  });
  table.append(tbody);
  card.append(table);

  const actions = document.createElement('div');
  actions.className = 'result-actions';
  if (NET.seat === 0) {
    const again = document.createElement('button');
    again.className = 'big-btn';
    again.textContent = '再来一场';
    again.onclick = async () => { hideResult(); await api('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: NET.token }) }); NET.resultKey = ''; pollOnce(); };
    actions.append(again);
    const diss = document.createElement('button');
    diss.className = 'big-btn ghost';
    diss.textContent = '解散房间';
    diss.onclick = dissolveRoom;
    actions.append(diss);
  }
  const home = document.createElement('button');
  home.className = 'big-btn ghost';
  home.textContent = '回首页';
  home.onclick = () => { hideResult(); exitLAN(); };
  actions.append(home);
  card.append(actions);
  el('result').classList.add('show');
}

window.LAN = { open: openLAN };

/* 刷新 / 断线重连：本地还留着座位 token，就自动用 LAN 通道回座 */
if (location.protocol !== 'file:') {
  try {
    if (localStorage.getItem('jianli_token')) {
      setTimeout(() => {
        if (!el('lobby').classList.contains('show') && !document.querySelector('#view-table.is-on')) openLAN();
      }, 30);
    }
  } catch (e) {}
}
