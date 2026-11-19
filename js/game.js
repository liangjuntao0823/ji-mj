/* 单机对局控制 */
import { Engine, DEFAULT_RULE } from './engine.js';
import { nextAction, discardCandidate } from './bot.js';
import { label, SEAT_LABEL, isPizi } from './tiles.js';
import {
  G as UIView, initTable, renderAll, updateTimer, showToast, clearToast,
  showResult, hideResult, backToHome, resetEventState, initHome,
  showBoard, hideBoard, setRoomCode, setNetLatency,
} from './ui.js';
import { openLAN } from './net.js';
import { openP2P } from './p2p.js';

const PLAY_SECONDS = 30;
const CLAIM_SECONDS = 30;
const BOT_DELAY = 850;

const S = {
  engine: null,
  humanSeat: 0,
  mode: 'single',
  botTimer: null,
  timerInt: null,
  timerStart: 0,
  timerLen: 0,
  running: false,
  rounds: 8,
  names: ['涛', '老李', '小美', '阿强'],
  finalShown: false,
};

const el = (id) => document.getElementById(id) || null;
/* 首页按钮是 UI 的东西：新 UI 自己放按钮，然后调 window.JianliGame.startSingle() / openLAN() / openP2P()。
 * 如果 UI 提供了同 id 的按钮，这里会自动绑上，不需要额外代码。 */
const on = (id, fn) => { const n = el(id); if (n) n.addEventListener('click', fn); };

/* 首页房间设置：局数 / 中发白 / 自由加增 / 围增 */
const HOME_RULE = { rounds: 8, withDragons: false, addonEnabled: false, baseShare: 1 };
function readHomeRule() {
  const seg = el('cfg-rounds');
  if (seg) {
    const on = seg.querySelector('.is-on');
    HOME_RULE.rounds = Number(on && on.dataset.rounds) || 8;
  }
  HOME_RULE.withDragons = !!(el('cfg-dragons') && el('cfg-dragons').checked);
  HOME_RULE.addonEnabled = !!(el('cfg-addon') && el('cfg-addon').checked);
  const shareSeg = el('cfg-share');
  if (shareSeg) {
    const on = shareSeg.querySelector('.is-on');
    HOME_RULE.baseShare = Math.max(1, Math.min(3, Number(on && on.dataset.share) || 1));
  }
  const singleSub = el('single-sub');
  if (singleSub) singleSub.textContent = `我 + 三台机器人 · ${HOME_RULE.rounds} 局一场`;
  const statRounds = el('home-stat-rounds');
  if (statRounds) statRounds.textContent = String(HOME_RULE.rounds);
  const statTiles = el('home-stat-tiles');
  if (statTiles) statTiles.textContent = HOME_RULE.withDragons ? '120' : '112';
  const statCap = el('home-stat-cap');
  if (statCap) statCap.textContent = HOME_RULE.withDragons ? '×12' : '×8';
  const modeSummary = el('mode-summary');
  if (modeSummary) {
    modeSummary.textContent = `${HOME_RULE.rounds} 局 · ${HOME_RULE.withDragons ? '中发白' : '默认'} · ${HOME_RULE.addonEnabled ? '自由加增' : '不加增'}${HOME_RULE.baseShare > 1 ? ` · 围增倒${HOME_RULE.baseShare}` : ''}`;
  }
  window.JIANLI_HOME_RULE = { ...HOME_RULE };
  return { ...HOME_RULE };
}
(function bindHomeRule() {
  const seg = el('cfg-rounds');
  if (seg) seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rounds]');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b));
    readHomeRule();
  });
  ['cfg-dragons', 'cfg-addon'].forEach((id) => { const n = el(id); if (n) n.addEventListener('change', readHomeRule); });
  const shareSeg = el('cfg-share');
  if (shareSeg) shareSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-share]');
    if (!b) return;
    shareSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b));
    readHomeRule();
  });
  readHomeRule();
  const modal = el('mode-modal');
  const open = el('mode-open');
  const close = el('mode-close');
  if (open && modal) open.addEventListener('click', () => { readHomeRule(); modal.classList.add('show'); });
  if (close && modal) close.addEventListener('click', () => modal.classList.remove('show'));
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
})();

/* ---------------- 入口 ---------------- */
initHome();

/* 联机方式：手机直连（P2P）或公网服务器（同域 /api）。
 * 首页的切换入口只改行为，不删原来的两个入口。 */
const SERVER_URL = String(window.JIANLI_SERVER_URL || '').replace(/\/+$/, '');
const NET_MODE_KEY = 'jianli_net_mode';
let NET_MODE = 'p2p';
try { NET_MODE = localStorage.getItem(NET_MODE_KEY) === 'server' ? 'server' : 'p2p'; } catch (e) {}
try {
  const q = new URLSearchParams(location.search).get('net');
  if (q === 'server' || q === 'p2p') NET_MODE = q;
} catch (e) {}

function paintNetMode() {
  document.querySelectorAll('.net-opt').forEach((b) => {
    const on = b.dataset.net === NET_MODE;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const createSub = el('lan-sub');
  const joinSub = el('p2p-sub');
  if (NET_MODE === 'server') {
    if (createSub) createSub.textContent = '公网服务器 · 第一人当房主';
    if (joinSub) joinSub.textContent = '公网服务器 · 进当前房间';
  } else {
    if (createSub) createSub.textContent = '手机直连 · 自己当房主';
    if (joinSub) joinSub.textContent = '手机直连 · 输入 6 位房号';
  }
}

function setNetMode(mode) {
  NET_MODE = mode === 'server' ? 'server' : 'p2p';
  try { localStorage.setItem(NET_MODE_KEY, NET_MODE); } catch (e) {}
  paintNetMode();
}

/* action: 'create' 开一桌当房主；'join' 进别人的房间 */
function openNetwork(action = 'join') {
  const mode = action === 'create' ? 'create' : 'join';
  readHomeRule();
  if (NET_MODE === 'server') {
    if (!SERVER_URL) {
      showToast('公网服务器地址还没配置');
      return;
    }
    openLAN(SERVER_URL, mode);
    return;
  }
  openP2P(mode);
}

paintNetMode();
document.querySelectorAll('.net-opt').forEach((b) => {
  b.addEventListener('click', () => { setNetMode(b.dataset.net); });
});

on('lobby-back', () => {
  if (window.__lobbyBack) { window.__lobbyBack(); return; }
  const lb = el('lobby'); if (lb) lb.classList.remove('show');
  backToHome();
});

on('btn-single', startSingle);
on('btn-lan', () => openNetwork('create'));

function startSingle() {
  const seed = (Date.now() & 0xffffffff) >>> 0;
  const cfg = readHomeRule();
  S.rounds = cfg.rounds;
  const e = new Engine({ seed, names: S.names, botSeats: [1, 2, 3], dealer: 0, roundIndex: 1, rule: { ...DEFAULT_RULE, rounds: cfg.rounds, withDragons: cfg.withDragons, addonEnabled: cfg.addonEnabled, baseShare: cfg.baseShare } });
  S.engine = e;
  S.mode = 'single';
  S.humanSeat = 0;
  S.running = true;
  S.finalShown = false;
  e.startHand();

  UIView.seatNames = S.names;
  resetEventState();
  initTable(tableOpts(e, 0, 'single', S.names, S.rounds));
  renderAll();
  schedule();
}

function exitToHome() {
  S.running = false;
  clearTimeout(S.botTimer);
  stopTimer();
  clearToast();
  backToHome();
}

function tableOpts(engine, humanSeat, mode, names, rounds) {
  return {
    humanSeat,
    mode,
    totalRounds: rounds,
    names,
    getState: () => engine.state,
    getMyActions: () => (engine.state.phase === 'awaitingClaim' ? [] : engine.options(humanSeat)),
    getDeclareOptions: () => engine.declareOptions(humanSeat),
    getPendingOptions: () => (engine.state.pending && engine.state.pending.options ? (engine.state.pending.options[humanSeat] || null) : null),
    onDiscard: (tile) => act({ type: 'discard', tile }, humanSeat),
    onAct: (a) => act(a, humanSeat),
    onNext: () => nextHand(),
    onExit: () => exitToHome(),
    canNewMatch: () => !!(S.engine && S.engine.state.phase === 'finished' && S.engine.state.roundIndex >= S.rounds),
    newMatchClicks: () => (S.engine && S.engine.state.phase === 'finished' ? 4 : 0),
    onNewMatch: () => startSingle(),
  };
}

/* ---------------- 动作执行 ---------------- */

function act(action, seat) {
  if (!S.running) return;
  clearTimeout(S.botTimer);
  let events;
  try {
    events = S.engine.apply(action, seat);
  } catch (err) {
    console.warn(err);
    return;
  }
  clearToast();
  toastEvents(events);
  renderAll();
  schedule();
}

function toastEvents(events) {
  const s = S.engine.state;
  for (const ev of events) {
    switch (ev.type) {
      case 'bu':
        showToast(`${s.players[ev.seat].name} 补油 ${label(ev.tile)}（第 ${ev.count} 张）`);
        break;
      case 'redDiscarded':
        showToast(`${s.players[ev.seat].name} 补油 ${label(ev.tile)}（第 ${ev.count} 张）`);
        break;
      case 'peng':
        showToast(`${s.players[ev.seat].name} 碰 ${label(ev.tile)}`);
        break;
      case 'gang': {
        const kindName = { gangExposed: '点杠', gangConcealed: '暗杠', gangAdded: '蓄杠' }[ev.kind] || '杠';
        showToast(`${s.players[ev.seat].name} ${kindName} ${label(ev.tile)}`);
        break;
      }
      case 'score':
        showToast(`${s.players[ev.from].name} → ${s.players[ev.to].name} ${ev.amount} 分 · ${reasonName(ev.reason)}`, 'score');
        break;
      case 'hu':
        showToast(`${s.players[ev.seat].name} 自摸！`, 'score');
        break;
      case 'drawnGame':
        showToast('牌墙摸完，流局');
        break;
    }
  }
}

const reasonName = (r) => ({ selfDraw: '自摸', pointGang: '点杠', concealedGang: '暗杠', addedGang: '蓄杠', redGang: '油暗杠' }[r] || r);

/* ---------------- 调度 ---------------- */

function schedule() {
  clearTimeout(S.botTimer);
  const s = S.engine.state;
  if (!S.running) return;

  if (s.phase === 'awaitingAddon') { stopTimer(); return; }
  if (s.phase === 'finalDraw' && s.players[s.current] && s.players[s.current].isBot) {
    S.botTimer = setTimeout(() => {
      const a = nextAction(S.engine, s.current) || { type: 'finalPass' };
      act(a, s.current);
    }, BOT_DELAY);
    return;
  }
  if (s.phase === 'finished') {
    stopTimer();
    setTimeout(showHandResult, 950);
    return;
  }

  // 声明窗口
  if (s.phase === 'awaitingClaim' && s.pending) {
    const outstanding = s.pending.outstanding;
    const bots = outstanding.filter((x) => s.players[x].isBot);
    if (bots.length > 0) {
      S.botTimer = setTimeout(() => {
        const a = nextAction(S.engine, bots[0]) || { type: 'pass' };
        actForBot(a, bots[0]);
      }, BOT_DELAY);
      return;
    }
    if (outstanding.includes(S.humanSeat)) {
      startTimer(CLAIM_SECONDS, () => act({ type: 'pass' }, S.humanSeat));
    }
    return;
  }

  // 出牌阶段
  if (s.phase === 'awaitingDiscard') {
    const cur = s.current;
    if (s.players[cur].isBot) {
      S.botTimer = setTimeout(() => {
        const a = nextAction(S.engine, cur);
        if (a) actForBot(a, cur);
      }, BOT_DELAY);
      return;
    }
    if (cur === S.humanSeat) {
      startTimer(PLAY_SECONDS, () => {
        const st = S.engine.state;
        const me = st.players[S.humanSeat];
        me.declareIntent = false;   /* 超时自动出牌，报听声明作废 */
        if (me.hand.some(isPizi)) { act({ type: 'bu' }, S.humanSeat); return; }
        /* 单钓已明牌时只能打刚摸的那张 */
        const forced = (me.singleLocked !== null && st.lastDrawn !== null && me.hand.includes(st.lastDrawn))
          ? st.lastDrawn : null;
        const tile = forced !== null ? forced : discardCandidate(me.hand);
        if (tile !== null) act({ type: 'discard', tile }, S.humanSeat);
      });
    }
    return;
  }
  stopTimer();
}

function actForBot(a, seat) {
  // 机器人在声明窗口里不能「胡」（本玩法只自摸），其余动作直接执行
  act(a, seat);
}

/* ---------------- 计时 ---------------- */

function startTimer(seconds, onTimeout) {
  stopTimer();
  S.timerLen = seconds;
  S.timerStart = performance.now();
  updateTimer(1);
  S.timerInt = setInterval(() => {
    const left = 1 - (performance.now() - S.timerStart) / (seconds * 1000);
    if (left <= 0) {
      stopTimer();
      onTimeout();
    } else {
      updateTimer(left);
    }
  }, 120);
}

function stopTimer() {
  if (S.timerInt) clearInterval(S.timerInt);
  S.timerInt = null;
  updateTimer(0);
}

/* ---------------- 结算 ---------------- */

function showHandResult() {
  const s = S.engine.state;
  if (s.roundIndex >= S.rounds) setTimeout(() => showBoard(), 500);
  if (s.drawnGame) {
    showResult({
      title: '流局',
      subtitle: '牌墙摸完 · 庄家不变，下一局继续',
      hand: null,
      payments: null,
      scores: s.players.map((p) => p.score),
      names: S.names,
      reds: s.players.map((p) => p.redsPlayed),
      drawnGame: true,
    });
    return;
  }
  const r = s.result;
  if (!r) return;
  const winner = s.players[r.winner];
  const fanText = (r.fans || []).map((f) => f.name).join(' + ');
  const multText = r.mult ? ` ×${r.mult}` : '';
  showResult({
    title: `${winner.name} 自摸`,
    subtitle: `${fanText}${multText} · 每家 ${r.base} 分起 · 第 ${s.roundIndex}/${S.rounds} 局`,
    winnerSeat: r.winner,
    hand: r.hand,
    melds: r.melds,
    payments: r.payments,
    scores: r.scores,
    names: S.names,
    reds: s.players.map((p) => p.redsPlayed),
  });
}

function nextHand() {
  const s = S.engine.state;
  hideResult();
  if (s.roundIndex >= S.rounds) {
    showFinal();
    return;
  }
  S.engine.startNextHand((Date.now() & 0xffffffff) >>> 0);
  renderAll();
  schedule();
}

function showFinal() {
  const s = S.engine.state;
  const ranked = s.players
    .map((p, i) => ({ seat: i, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  /* 终局只把数据交给 UI，由 UI 自己画排名表和按钮：
   * 「再来一场」按钮 → window.JianliGame.startSingle()（或 G.onNewMatch）
   * 「回首页」按钮   → G.onExit() */
  showResult({
    final: true,
    title: '本场结束',
    subtitle: `共 ${S.rounds} 局 · 感谢陪打`,
    names: s.players.map((p) => p.name),
    scores: s.players.map((p) => p.score),
    ranked,
    mySeat: S.humanSeat,
    rounds: S.rounds,
    winnerSeat: (!s.drawnGame && s.result && s.result.winner != null) ? s.result.winner : null,
    hand: (!s.drawnGame && s.result && s.result.hand) || null,
    melds: (!s.drawnGame && s.result && s.result.melds) || null,
    fans: (!s.drawnGame && s.result && s.result.fans) || null,
  });
}

/* 供联机模式复用 */
export function attachEngine(engine, humanSeat, mode, names, rounds) {
  S.engine = engine;
  S.humanSeat = humanSeat || 0;
  S.mode = mode || 'single';
  S.names = names || S.names;
  S.rounds = rounds || S.rounds;
  S.running = true;
  S.finalShown = false;
  UIView.seatNames = S.names;
  resetEventState();
  initTable(tableOpts(engine, S.humanSeat, S.mode, S.names, S.rounds));
  renderAll();
  schedule();
}

/* 新 UI 的入口就这三个：开局、局域网、手机 P2P */
/* 公网服务器连通测试：请求回来即记录本次往返延迟 */
async function testServerLatency() {
  const btn = document.getElementById('home-net-test');
  const label = document.getElementById('home-net-test-label');
  if (btn) { btn.disabled = true; btn.classList.remove('is-ok', 'is-bad'); }
  if (label) label.textContent = '测试中…';
  if (!SERVER_URL) {
    if (label) label.textContent = '未配置';
    if (btn) { btn.disabled = false; btn.classList.add('is-bad'); }
    showToast('公网服务器地址还没配置');
    return;
  }
  const started = performance.now();
  try {
    const res = await fetch(`${SERVER_URL}/api/room?cb=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    await res.json();
    const ms = Math.round(performance.now() - started);
    setNetLatency(ms);
    if (label) label.textContent = `${ms}ms`;
    if (btn) { btn.classList.toggle('is-ok', ms <= 100); btn.classList.toggle('is-bad', ms > 100); }
  } catch (e) {
    setNetLatency(null);
    if (label) label.textContent = '连接失败';
    if (btn) btn.classList.add('is-bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.JianliGame = { startSingle, attachEngine, openLAN, openP2P, openNetwork, setNetMode, testServerLatency, S };
