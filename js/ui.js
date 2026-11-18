/* ============================================================
   监利红中 · 横屏版界面层
   —— 严格实现 INTERFACE.md 的 15 个接口函数，函数名 / 参数不改。
   界面只读引擎状态，所有操作一律走 G.onDiscard / G.onAct。
   ============================================================ */
import { TILE_SRC, label, RED_RAW, SEAT_LABEL } from './tiles.js';
import { waitingTiles } from './win.js';
import { APP_VERSION, APP_RELEASED_AT, APP_RELEASES } from './version.js';

/* 会话对象：字段与契约版完全一致 */
export const G = {
  getState: null,
  humanSeat: 0,
  selected: null,
  onDiscard: null,
  onAct: null,
  onNext: null,
  onExit: null,
  getMyActions: null,
  getPendingOptions: null,
  getDeclareOptions: null,
  canNewMatch: null,
  newMatchClicks: null,
  onNewMatch: null,
  mode: 'single',
  totalRounds: 8,
  timerFill: null,
  seatNames: null,
  voicePrimed: false,
};

const D = document;
const $ = (id) => D.getElementById(id);
const WIND = SEAT_LABEL;                       /* ['东','南','西','北'] */
const AVATARS = [
  'assets/img/avatar-tao.jpg',
  'assets/img/avatar-li.jpg',
  'assets/img/avatar-mei.jpg',
  'assets/img/avatar-qiang.jpg',
];
const AVATAR_BY_NAME = { '涛': 0, '老李': 1, '小美': 2, '阿强': 3 };
const MODE_TAG = { single: '单机对局', lan: '局域网联机', p2p: '手机联机' };
const REASON = { selfDraw: '自摸', pointGang: '明杠', concealedGang: '暗杠', addedGang: '回头笑', redGang: '红中杠' };
const UI = {
  view: 'home',
  state: null,
  me: 0,
  sel: null,            /* { raw, i } */
  acts: [],
  timer: { ratio: 0, total: 30 },
  scale: 1,
  toastTimer: null,
  result: null,
  boardOpen: false,
  paused: false,
  lock: false,
  roomCode: '',
  voiceRound: 0,
  voiceKey: '',
  voiceMelds: ['', '', '', ''],
  voiceResult: '',
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => ((n || 0) > 0 ? '+' + n : String(n == null ? 0 : n));

/* ---------------- 基础渲染单元 ---------------- */

function imgName(raw) {
  if (raw === RED_RAW) return 'Chun';
  const suit = ['Man', 'Pin', 'Sou'][Math.floor(raw / 9)];
  return suit + ((raw % 9) + 1);
}

function tileHtml(raw, cls = '', extra = '') {
  const src = TILE_SRC[imgName(raw)] || '';
  return `<div class="tile ${cls}" ${extra}><img src="${src}" alt="${esc(label(raw))}" draggable="false"></div>`;
}

function backHtml(style = '') {
  return `<div class="tile-back"${style ? ` style="${style}"` : ''}></div>`;
}

function rotTile(raw, cls = '', extra = '') {
  return `<div class="rot-slot">${tileHtml(raw, cls, extra)}</div>`;
}

/** 副露：碰 / 明杠 / 暗杠 / 回头笑 —— 杠一律「下 3 上 1，上面一张居中堆着」 */
function meldHtml(m, rotated = false, big = false) {
  const t = m.tile;
  const tc = big ? 'tile meld meld-big' : 'tile meld';
  const bc = big ? 'tile-back meld-back big-back' : 'tile-back meld-back';
  const F = () => (rotated ? `<div class="rot-slot">${tileHtml(t, tc)}</div>` : tileHtml(t, tc));
  const B = () => (rotated ? `<div class="rot-slot"><div class="${bc}"></div></div>` : `<div class="${bc}"></div>`);
  const group = `meld-group${rotated ? ' rot' : ''}${big ? ' big' : ''}`;
  const stack = (top, bottom) =>
    `<div class="${group} gang"><div class="mg-top">${top}</div><div class="mg-row">${bottom}</div></div>`;

  if (m.kind === 'gangConcealed') return stack(F(), B() + B() + B());   /* 下 3 暗，上 1 明 */
  if (m.kind === 'gangAdded') return stack(B(), F() + F() + F());       /* 下 3 明，上 1 暗（回头笑） */
  if (m.kind === 'gangExposed') return stack(F(), F() + F() + F());     /* 下 3 明，上 1 明 */
  return `<div class="${group}"><div class="mg-row">${F()}${F()}${F()}</div></div>`;
}

/* ---------------- 座位几何 ---------------- */
const relOf = (seat) => (seat - UI.me + 4) % 4;
const POS = ['me', 'right', 'top', 'left'];
const posOf = (seat) => POS[relOf(seat)];

/* ---------------- 视图切换 ---------------- */

function showView(name) {
  UI.view = name;
  const home = $('view-home');
  const table = $('view-table');
  if (home) home.classList.toggle('is-on', name === 'home');
  if (table) table.classList.toggle('is-on', name === 'table');
  if (name !== 'lobby') {
    const lb = $('lobby');
    if (lb) lb.classList.remove('show');
  }
  if (name === 'home') closeOverlays();
}

function closeOverlays() {
  const r = $('result'); if (r) r.classList.remove('show');
  const b = $('board'); if (b) b.classList.remove('show');
  const p = $('paused'); if (p) p.classList.remove('show');
  const rb = $('ready-bar'); if (rb) rb.classList.remove('is-on');
  const rm = $('rules-modal'); if (rm) rm.classList.remove('show');
  const cm = $('changelog-modal'); if (cm) cm.classList.remove('show');
  UI.boardOpen = false;
  UI.result = null;
  UI.paused = false;
}

/* ---------------- 会话（契约函数） ---------------- */

function renderVersion() {
  const badge = $('home-version');
  if (badge) badge.textContent = `v${APP_VERSION} · ${APP_RELEASED_AT}`;
  const lead = $('changelog-lead');
  if (lead) lead.textContent = `当前版本 v${APP_VERSION} · ${APP_RELEASED_AT}`;
  const list = $('changelog-list');
  if (!list) return;
  list.innerHTML = APP_RELEASES.map((rel) => {
    const rows = (items, cls, title) => items && items.length
      ? `<div class="release-col ${cls}"><div class="release-col-title">${title}</div><ul>${items.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`
      : '';
    return `<div class="release-row">
      <div class="release-head"><strong>v${esc(rel.version)}</strong><span>${esc(rel.date)}</span></div>
      <div class="release-body">${rows(rel.updates, 'upd', '更新')}${rows(rel.fixes, 'fix', '修复')}</div>
    </div>`;
  }).join('');
}

export function initHome() {
  showView('home');
  renderHomeTiles();
  renderVersion();
  syncVoice();
  applyLayoutUnits();
}

export function initTable(opts) {
  Object.assign(G, opts || {});
  UI.me = Number(G.humanSeat || 0) % 4;
  UI.sel = null;
  UI.acts = [];
  UI.lock = false;
  UI.toastTimer = null;
  G.selected = null;
  G.timerFill = null;
  G.voicePrimed = false;
  UI.voiceRound = 0;
  UI.voiceKey = '';
  UI.voiceMelds = ['', '', '', ''];
  UI.voiceResult = '';
  UI.result = null; UI.boardOpen = false; UI.paused = false;
  UI.matchStats = { wins: [0, 0, 0, 0], fan: [0, 0, 0, 0] };
  UI.statRound = -1;
  const r = $('result'); if (r) r.classList.remove('show');
  const b = $('board'); if (b) b.classList.remove('show');
  const p = $('paused'); if (p) p.classList.remove('show');
  const rb = $('ready-bar'); if (rb) rb.classList.remove('is-on');
  showView('table');
  renderAll();
}

export function backToHome() {
  clearTimeout(UI.toastTimer);
  const t = $('toast'); if (t) { t.classList.remove('is-on'); t.textContent = ''; }
  setRoomCode(null);
  UI.sel = null;
  UI.acts = [];
  showView('home');
}

export function resetEventState() {
  UI.sel = null;
  UI.acts = [];
  G.selected = null;
  UI.lock = false;
  const t = $('toast'); if (t) { t.classList.remove('is-on'); t.textContent = ''; }
}

/* ---------------- 主渲染 ---------------- */

export function renderAll() {
  const s = G.getState ? G.getState() : null;
  UI.state = s;
  if (!s || !s.players) return;
  if (UI.view !== 'table') showView('table');
  drawTable(s);
}

function drawTable(s) {
  const me = UI.me;
  const wall = s.wall && typeof s.wall.remaining === 'number' ? s.wall.remaining
    : (typeof s.wallRemaining === 'number' ? s.wallRemaining : 0);

  /* HUD */
  const roundEl = $('hud-round');
  if (roundEl) roundEl.textContent = `${s.roundIndex || 1}/${G.totalRounds || 8}`;
  const wallEl = $('hud-wall');
  if (wallEl) wallEl.textContent = wall;
  const dealerEl = $('hud-dealer');
  if (dealerEl) {
    dealerEl.innerHTML = `庄 · <b>${esc(WIND[s.dealer] || '')}</b>`;
    dealerEl.title = s.players[s.dealer] ? s.players[s.dealer].name : '';
  }
  const tag = $('mode-tag');
  if (tag) tag.textContent = MODE_TAG[G.mode] || '对局';
  if (G.mode !== 'single') {
    const inline = s.code ? String(s.code) : ((D.querySelector('#p2p-code-show .p2p-code') || {}).textContent || '');
    setRoomCodeState(inline.trim());
  }
  /* 四家板块 */
  for (let seat = 0; seat < 4; seat++) {
    const pos = posOf(seat);
    const p = s.players[seat];
    if (!p) continue;

    const plate = $('plate-' + pos);
    if (plate) {
      plate.innerHTML = plateHtml(s, seat, p);
      plate.classList.add('plate');
      plate.classList.toggle('is-turn', s.phase === 'awaitingDiscard' && s.current === seat);
      plate.classList.toggle('is-dealer', s.dealer === seat);
      plate.classList.toggle('is-off', p.online === false);
    }

    if (pos !== 'me') {
      const backs = $('backs-' + pos);
      if (backs) {
        const n = (p.hand && p.hand.length) || p.handCount || 0;
        const showFace = p.singleLocked !== null && p.singleLocked !== undefined;
        const side = pos === 'left' || pos === 'right';
        const one = side ? `<div class="back-slot">${backHtml()}</div>` : backHtml();
        backs.innerHTML = showFace ? '' : new Array(Math.max(0, n)).fill(0).map(() => one).join('');
        const pub = $('pub-' + pos);
        if (pub) pub.innerHTML = showFace ? tileHtml(p.singleLocked, 'sm') : '';
      }
    }

    const melds = $('melds-' + pos);
    if (melds) {
      const rot = pos === 'left' || pos === 'right';
      const big = pos === 'me';
      melds.innerHTML = (p.melds || []).map((m) => meldHtml(m, rot, big)).join('') + redsHtml(p, rot, big);
    }
  }

  /* 方位箭头：谁在出牌指谁 */
  const ARROW_OF = { me: 'bottom', right: 'right', top: 'top', left: 'left' };
  let activePos = '';
  if (s.phase === 'awaitingDiscard') activePos = ARROW_OF[posOf(s.current)];
  else if (s.phase === 'awaitingClaim') {
    const pend = G.getPendingOptions ? G.getPendingOptions() : null;
    if (pend && pend.length) activePos = 'bottom';
  }
  for (const pos of ['top', 'right', 'bottom', 'left']) {
    const a = $('arrow-' + pos);
    if (a) a.classList.toggle('is-on', activePos === pos);
  }

  /* 杠的盖牌：现在直接堆在露牌上，桌心不再重复显示 */
  const cover = $('gang-cover');
  if (cover) cover.innerHTML = '';

  /* 牌河 */
  drawRiver($('river-top'), s.players[(me + 2) % 4], s, false);
  drawRiver($('river-bottom'), s.players[me], s, false);
  drawRiver($('river-left'), s.players[(me + 3) % 4], s, true);
  drawRiver($('river-right'), s.players[(me + 1) % 4], s, true);

  /* 手牌 / 按钮 / 提示 */
  drawHand(s);
  drawActions(s);
  drawHint(s);
  drawTing(s);
  updateTimerDom();
  announceState(s);
}

function plateHtml(s, seat, p) {
  const isMe = seat === UI.me;
  const name = p.name || WIND[seat] + '家';
  const idx = AVATAR_BY_NAME[p.name] != null ? AVATAR_BY_NAME[p.name] : seat % 4;
  const score = p.score || 0;
  return `
    <div class="av">
      <img src="${AVATARS[idx]}" alt="${esc(name)}" draggable="false">
      <div class="ring"></div>
      <div class="wind">${esc(WIND[seat] || '')}</div>
      <div class="dealer">庄</div>
    </div>
    <div class="pm">
      <div class="pname">${esc(name)}${isMe ? '<span class="me-tag">我</span>' : ''}</div>
      <div class="pstat">
        <span class="score ${score < 0 ? 'neg' : ''}">${num(score)}</span>
      </div>
    </div>
    <div class="thinking"><i></i><i></i><i></i></div>
    <div class="timer-num"></div>`;
}

/** 打出去的红中（皮子）：摆在露牌区，一张牌一张 */
function redsHtml(p, rotated = false, big = false) {
  const n = Math.min(4, (p && p.redsPlayed) || 0);
  if (!n) return '';
  const tc = big ? 'tile meld meld-big' : 'tile meld';
  const one = rotated ? `<div class="rot-slot">${tileHtml(RED_RAW, 'tile meld')}</div>` : tileHtml(RED_RAW, tc);
  return `<div class="meld-group is-reds${rotated ? ' rot' : ''}">${new Array(n).fill(one).join('')}${''}</div>`;
}

/* ---------------- 牌河 ---------------- */

function drawRiver(el, p, s, rotated) {
  if (!el || !p) return;
  const river = p.river || [];
  const last = s.lastDiscard;
  let lastIdx = -1;
  if (last && last.seat === p.seat) {
    for (let i = river.length - 1; i >= 0; i--) if (river[i] === last.tile) { lastIdx = i; break; }
  }
  const per = 6;
  const chunks = [];
  for (let i = 0; i < river.length; i += per) chunks.push(river.slice(i, i + per));
  const mark = (gi) => (gi === lastIdx ? 'is-last' : '');

  if (rotated) {
    el.innerHTML = chunks.map((col, ci) => `<div class="col">${col.map((raw, k) => rotTile(raw, 'sm ' + mark(ci * per + k))).join('')}</div>`).join('');
  } else {
    el.innerHTML = chunks.map((row, ri) => `<div class="row">${row.map((raw, k) => tileHtml(raw, 'sm ' + mark(ri * per + k))).join('')}</div>`).join('');
  }
}

/* ---------------- 手牌 ---------------- */

function drawHand(s) {
  const el = $('my-hand');
  if (!el) return;
  const p = s.players[UI.me];
  if (!p) { el.innerHTML = ''; return; }
  const hand = (p.hand || []).slice();
  const drawn = s.lastDrawn !== null && s.lastDrawn !== undefined ? s.lastDrawn : null;
  let drawnIdx = -1;
  if (drawn !== null) for (let i = hand.length - 1; i >= 0; i--) if (hand[i] === drawn) { drawnIdx = i; break; }

  const allowed = allowedSet();
  if (UI.sel && hand[UI.sel.i] !== UI.sel.raw) UI.sel = null;
  const sel = UI.sel;
  const myTurn = s.phase === 'awaitingDiscard' && s.current === UI.me;

  let html = '';
  hand.forEach((raw, i) => {
    if (i === drawnIdx) return;
    const cls = [myTurn && !allowed.has(raw) ? 'is-locked' : '', sel && sel.i === i ? 'is-sel' : ''].join(' ');
    html += tileHtml(raw, cls, `data-raw="${raw}" data-i="${i}"`);
  });
  if (drawnIdx >= 0) {
    const raw = hand[drawnIdx];
    const cls = ['is-drawn', myTurn && !allowed.has(raw) ? 'is-locked' : '', sel && sel.i === drawnIdx ? 'is-sel' : ''].join(' ');
    html += tileHtml(raw, cls, `data-raw="${raw}" data-i="${drawnIdx}"`);
  }
  el.innerHTML = html;
  fitHandRow();
}

/* 手牌 + 露牌整行过宽时自动缩小，保证不出屏 */
function fitHandRow() {
  const wrap = $('hand-wrap');
  if (!wrap) return;
  wrap.style.transformOrigin = '50% 100%';
  wrap.style.transform = 'translateX(-50%)';
  const w = wrap.scrollWidth;
  const avail = 920;
  const k = w > avail ? Math.max(0.78, avail / w) : 1;
  wrap.style.transform = `translateX(-50%) scale(${k})`;
}

function allowedSet() {
  const s = UI.state;
  const p = s && s.players && s.players[UI.me];
  if (!s || !p) return new Set();
  const hand = p.hand || [];
  if (s.phase !== 'awaitingDiscard' || s.current !== UI.me) return new Set();
  const drawn = s.lastDrawn !== null && s.lastDrawn !== undefined ? s.lastDrawn : null;
  if (p.singleLocked !== null && p.singleLocked !== undefined && drawn !== null && hand.includes(drawn)) return new Set([drawn]);
  if (p.declared && drawn !== null) return new Set([drawn]);
  if (p.declareIntent) {
    const out = new Set();
    for (const t of new Set(hand)) {
      const rest = hand.slice();
      rest.splice(rest.indexOf(t), 1);
      if (rest.length % 3 === 1 && waitingTiles(rest, (p.melds || []).length, true).length) out.add(t);
    }
    return out;
  }
  return new Set(hand);
}

/* 某张牌台面上还剩几张（按已见牌推算） */
function remainingOf(raw) {
  const s = UI.state;
  if (!s || !s.players) return 0;
  let seen = 0;
  for (const p of s.players) {
    if (!p) continue;
    /* 只看自己的手牌：单机模式下引擎快照里也带着别人的手牌，不能当成「已见」 */
    if (p.seat === UI.me && p.hand) for (const t of p.hand) if (t === raw) seen++;
    const locked = p.singleLocked !== null && p.singleLocked !== undefined && p.singleLocked === raw;
    if (locked && !(p.seat === UI.me && (p.hand || []).includes(raw))) seen++;
    for (const m of (p.melds || [])) {
      if (m.tile !== raw) continue;
      seen += (m.kind === 'gangConcealed' || m.kind === 'gangAdded' || m.kind === 'gangExposed') ? 4 : 3;
    }
    for (const t of (p.river || [])) if (t === raw) seen++;
    if (raw === RED_RAW) seen += (p.redsPlayed || 0);
  }
  return Math.max(0, 4 - seen);
}

/* 右下角听牌提示：听哪几张、每张还剩几张；手上有 14 张时跟着选中的牌实时变 */
function drawTing(s) {
  const el = $('ting-panel');
  if (!el) return;
  const p = s && s.players && s.players[UI.me];
  let waits = [];
  let tag = '';
  /* 只在轮到自己出牌时才提示，别在家还没选牌/别人回合里乱报听口 */
  const myTurn = !!s && s.phase === 'awaitingDiscard' && s.current === UI.me;
  if (p && UI.view === 'table' && myTurn) {
    const hand = p.hand || [];
    const melds = (p.melds || []).length;
    const calc = (idx) => {
      const rest = hand.slice();
      rest.splice(idx, 1);
      if (rest.includes(RED_RAW)) return [];
      return waitingTiles(rest, melds, true);
    };
    if (hand.length % 3 === 1) {
      if (!hand.includes(RED_RAW)) waits = waitingTiles(hand, melds, true);
    } else if (hand.length % 3 === 2) {
      /* 碰完要自己选打哪张时，不算「默认打掉摸的这张」，等选中再提示 */
      const afterPeng = s.mustDiscard === UI.me || s.lastDrawn === null || s.lastDrawn === undefined;
      const selOK = !!(UI.sel && hand[UI.sel.i] === UI.sel.raw);
      if (selOK) {
        waits = calc(UI.sel.i);
        tag = `打 ${label(UI.sel.raw)} 听`;
      } else if (afterPeng) {
        waits = [];
      } else {
        /* 没选牌时先按「打掉刚摸的那张」算，保证抓牌后提示不消失 */
        let drawnIdx = -1;
        if (s.lastDrawn !== null && s.lastDrawn !== undefined) {
          for (let i = hand.length - 1; i >= 0; i--) if (hand[i] === s.lastDrawn) { drawnIdx = i; break; }
        }
        if (drawnIdx < 0) drawnIdx = hand.length - 1;
        waits = calc(drawnIdx);
        if (!waits.length) {
          /* 摸到的那张打掉不听时，退而显示当前最宽的听口 */
          let best = [];
          for (let i = 0; i < hand.length; i++) {
            const w = calc(i);
            if (w.length > best.length) best = w;
          }
          waits = best;
        }
      }
    }
  }
  if (!waits.length) {
    el.classList.remove('is-on');
    el.innerHTML = '';
    return;
  }
  const shown = waits.slice(0, 3);
  const items = shown.map((t) => {
    const n = remainingOf(t);
    return `<div class="ting-item">${tileHtml(t, 'ting')}<span class="cnt${n === 0 ? ' is-dead' : ''}">×${n}</span></div>`;
  }).join('');
  const more = waits.length > shown.length ? `<span class="ting-more">等 ${waits.length} 种</span>` : '';
  el.innerHTML = `${tag ? `<div class="ting-note">${tag}</div>` : ''}<div class="ting-tiles">${items}${more}</div>`;
  el.classList.add('is-on');
  /* 有操作按钮时贴着按钮上方，否则贴右下角 */
  const rows = Math.ceil((UI.acts || []).length / 2);
  el.style.right = '36px';
  el.style.bottom = rows ? (84 + rows * 78 + (rows - 1) * 12 + 12) + 'px' : '22px';
}

/* ---------------- 动作按钮 ---------------- */

function drawActions(s) {
  const box = $('actions');
  const zone = $('declare-zone');
  if (!box) return;
  const acts = [];
  const pend = G.getPendingOptions ? G.getPendingOptions() : null;

  if (s.phase === 'awaitingClaim' && pend && pend.length) {
    if (pend.includes('peng')) acts.push({ type: 'peng', label: '碰', cls: 'peng' });
    if (pend.includes('gang')) acts.push({ type: 'gangExposed', label: '杠', cls: 'gang' });
    acts.push({ type: 'pass', label: '过', cls: 'pass' });
  } else if (s.phase === 'awaitingDiscard' && s.current === UI.me) {
    const raw = (G.getMyActions ? G.getMyActions() : []) || [];
    const gangs = [];
    let hasHu = false;
    for (const a of raw) {
      const t = typeof a === 'string' ? a : a.type;
      if (t === 'hu') { acts.push({ type: 'hu', label: '胡', cls: 'hu' }); hasHu = true; }
      else if (t === 'gangConcealed' || t === 'gangAdded') gangs.push(a);
    }
    if (gangs.length) acts.push({ type: 'gangPick', label: '杠', cls: 'gang', gangs });
    const p = s.players[UI.me];
    const decl = G.getDeclareOptions ? (G.getDeclareOptions() || []) : (s.myDeclareOptions || []);
    if (p && !p.declared && !p.declareIntent && !hasHu && decl.length > 0) {
      acts.push({ type: 'declare', label: '报听', cls: 'declare' });
    }
  }

  UI.acts = acts;
  box.innerHTML = acts.map((a, i) => `<button class="act-btn ${a.cls}" data-i="${i}">${a.label}</button>`).join('');
  if (zone) zone.innerHTML = '';
}

function showGangPick(gangs) {
  const zone = $('declare-zone');
  if (!zone) return;
  zone.innerHTML = `<div class="gang-pick">${gangs.map((g, i) => `<div class="gang-opt" data-g="${i}">${tileHtml(g.tile, 'meld-lg')}</div>`).join('')}</div>`;
}

/* ---------------- 提示条 ---------------- */

function drawHint(s) {
  const el = $('hand-hint');
  if (!el) return;
  const p = s.players[UI.me];
  const parts = [];
  const pend = G.getPendingOptions ? G.getPendingOptions() : null;
  const myTurn = s.phase === 'awaitingDiscard' && s.current === UI.me;

  if (s.phase === 'awaitingClaim' && pend && pend.length) {
    parts.push(`别家打出 <b>${esc(label(s.pending ? s.pending.tile : 0))}</b>，可以碰 / 杠 / 过`);
  } else if (myTurn) {
    if (UI.sel) parts.push(`已选中 <b>${esc(label(UI.sel.raw))}</b> · 再点一次打出`);
    else if (p && p.declared) parts.push(`<span class="warn">已报听</span> · 只能打摸到的 <b>${esc(label(s.lastDrawn))}</b>`);
    else if (p && p.declareIntent) parts.push(`<span class="warn">已声明报听</span> · 请打出能听牌的牌`);
    else if (p && s.mustDiscard === UI.me) parts.push('碰完先打一张 · 点牌选中，再点打出');
    else parts.push('轮到你出牌 · 点牌选中，再点打出');
  } else if (s.phase === 'finished') {
    parts.push(s.drawnGame ? '本局流局' : '本局结束');
  } else {
    const cur = s.players[s.current];
    if (cur) parts.push(`等待 <b>${esc(cur.name)}</b> 出牌`);
  }

  if (!parts.length) { el.classList.add('is-off'); return; }
  el.classList.remove('is-off');
  el.innerHTML = parts.join(' · ');
}

/* ---------------- 计时 ---------------- */

export function updateTimer(ratio, totalSeconds = 30) {
  UI.timer.ratio = Math.max(0, Math.min(1, Number(ratio) || 0));
  UI.timer.total = totalSeconds || 30;
  G.timerFill = UI.timer.ratio;
  updateTimerDom();
}

function updateTimerDom() {
  const s = UI.state;
  let active = null;
  if (s) {
    if (s.phase === 'awaitingClaim') {
      const pend = G.getPendingOptions ? G.getPendingOptions() : null;
      active = pend && pend.length ? UI.me : null;
    } else if (s.phase === 'awaitingDiscard') {
      active = s.current;
    }
  }
  const ratio = UI.timer.ratio;
  const secs = Math.max(0, Math.ceil(ratio * UI.timer.total));
  for (let seat = 0; seat < 4; seat++) {
    const el = $('plate-' + posOf(seat));
    if (!el) continue;
    const ring = el.querySelector('.ring');
    const tn = el.querySelector('.timer-num');
    if (ring) {
      ring.style.opacity = (active === seat && ratio > 0) ? '1' : '0';
      ring.style.setProperty('--p', active === seat ? String(ratio) : '0');
    }
    if (tn) {
      if (active === seat && ratio > 0) { tn.textContent = secs + 's'; tn.classList.add('is-on'); }
      else tn.classList.remove('is-on');
    }
  }
  /* 桌心倒计时 */
  const ct = $('center-timer');
  if (ct) {
    if (active !== null && ratio > 0) {
      ct.textContent = secs;
      ct.classList.add('is-on');
      ct.classList.toggle('is-low', secs <= 5);
    } else {
      ct.textContent = '';
      ct.classList.remove('is-on', 'is-low');
    }
  }
}

/* ---------------- 提示 ---------------- */

export function showToast(text, cls = '', ms = 2000) {
  const el = $('toast');
  if (!el) return;
  if (!text) { el.classList.remove('is-on'); return; }
  el.textContent = text;
  el.className = 'is-on' + (cls ? ' ' + cls : '');
  clearTimeout(UI.toastTimer);
  if (ms > 0) UI.toastTimer = setTimeout(() => { el.classList.remove('is-on'); }, ms);
  sfxForText(text, cls);
}

export function clearToast() {
  clearTimeout(UI.toastTimer);
  const el = $('toast');
  if (el) { el.classList.remove('is-on'); el.textContent = ''; }
}

/* ---------------- 结算 ---------------- */

export function showResult(payload) {
  const card = $('result-card');
  const box = $('result');
  if (!card || !box) return;
  UI.result = payload;

  /* 同一局只累计一次：谁胡了几局、累计几番 */
  const st = UI.state;
  if (st && !payload.final && UI.matchStats && UI.statRound !== st.roundIndex) {
    UI.statRound = st.roundIndex;
    if (!payload.drawnGame) {
      const r = st.result || {};
      const w = r.winner != null ? r.winner : payload.winnerSeat;
      const m = r.mult != null ? r.mult : payload.mult;
      if (w != null && w >= 0 && m != null) {
        UI.matchStats.wins[w] = (UI.matchStats.wins[w] || 0) + 1;
        UI.matchStats.fan[w] = Math.round(((UI.matchStats.fan[w] || 0) + m) * 100) / 100;
      }
    }
  }

  if (payload.final) {
    card.innerHTML = finalHtml(payload);
    sfx('win');
  } else if (payload.drawnGame) {
    card.innerHTML = drawnHtml(payload);
    sfx('draw');
  } else {
    card.innerHTML = winHtml(payload);
    sfx('hu');
  }
  bindResult(card);
  box.classList.add('show');
  const rb = $('ready-bar'); if (rb) rb.classList.remove('is-on');
}

export function hideResult() {
  const box = $('result');
  if (box) box.classList.remove('show');
  UI.result = null;
}

function resultCtx(payload) {
  const s = UI.state || {};
  const r = (s.result && !payload.drawnGame && !payload.final) ? s.result : {};
  const players = s.players || [];
  const names = payload.names || players.map((p) => p.name) || [];
  return { s, r, players, names };
}

function winHtml(payload) {
  const { s, r, players, names } = resultCtx(payload);
  const winner = (r.winner != null ? r.winner : payload.winnerSeat) || 0;
  const wn = names[winner] || (players[winner] && players[winner].name) || '赢家';
  const fans = r.fans || payload.fans || [];
  const mult = r.mult != null ? r.mult : payload.mult;
  const base = r.base != null ? r.base : payload.base;
  const payments = r.payments || payload.payments || {};
  const scores = r.scores || payload.scores || players.map((p) => p.score);
  const hand = r.hand || payload.hand || [];
  const melds = r.melds || payload.melds || [];
  const gang = r.gangSettled || payload.gangSettled || [];
  const winnerReds = r.winnerReds != null ? r.winnerReds : ((players[winner] && players[winner].redsPlayed) || 0);

  const fanChips = fans.map((f) => `<span class="fan-chip${f.add ? ' add' : ''}">${esc(f.name)} <b>${f.add ? '+' : '×'}${f.mult}</b></span>`).join('');
  const handTiles = hand.map((t) => tileHtml(t, '')).join('') + melds.map((m) => meldHtml(m)).join('');
  const total = Object.values(payments).reduce((a, b) => a + b, 0);

  /* 本局分数：赢牌付款 + 本局杠分 */
  const delta = [0, 0, 0, 0];
  for (const k of Object.keys(payments)) delta[+k] -= payments[k];
  delta[winner] += total;
  for (const g of gang) {
    if (g.amount == null) continue;
    delta[g.from] -= g.amount;
    delta[g.to] += g.amount;
  }

  return `
    <div class="result-title">${esc(wn)} 自摸</div>
    <div class="result-sub">第 ${s.roundIndex || 1}/${G.totalRounds || 8} 局 · 自摸${mult != null ? ` · 总倍数 ${mult}` : ''}</div>
    ${fanChips ? `<div class="result-fans">${fanChips}</div>` : ''}
    <div class="result-hand">${handTiles}</div>
    <div class="round-board">${roundBoard(scores, delta, names, { winner, wr: winnerReds, reds: players.map((p) => p.redsPlayed || 0) })}</div>
    ${readyStrip(payload.ready, names, payload.mySeat)}
    <div class="result-actions">
      <button class="big-btn" id="res-next">下 一 局</button>
      <button class="big-btn ghost" id="res-exit">退出牌桌</button>
    </div>`;
}

/* 单局分数面板：本局份数（1+N油互乘）+ 本局得分 + 总分，赢家高亮 */
function roundBoard(scores, delta, names, opt = {}) {
  const winner = opt.winner != null ? opt.winner : -1;
  const wr = opt.wr || 0;
  const reds = opt.reds || [0, 0, 0, 0];
  const fmt = (v) => {
    const f = Math.round((v / 10) * 10) / 10;
    return (f > 0 ? '+' : '') + String(f);
  };
  return (scores || []).map((v, i) => {
    const fen = delta[i] || 0;
    const isWin = i === winner;
    const pr = reds[i] || 0;
    const oil = winner < 0 ? '' : isWin ? `(1+${wr}油)×3家` : `(1+${wr}油)×(1+${pr}油)`;
    return `
    <div class="rb-cell${i === UI.me ? ' is-me' : ''}${isWin ? ' is-win' : ''}">
      <span class="rb-name">${esc(names[i] || ('座位' + i))}${isWin ? '<i class="rb-hu">胡</i>' : ''}</span>
      <b class="rb-fen ${fen > 0 ? 'pos' : fen < 0 ? 'neg' : ''}">${fmt(fen)}<em>份</em></b>
      <span class="rb-oil">${oil}</span>
      <span class="rb-total">本局 ${num(fen)} 分 · 总分 ${num(v)}</span>
    </div>`;
  }).join('');
}

function drawnHtml(payload) {
  const { s, players, names } = resultCtx(payload);
  const gang = (s.result && s.result.gangSettled) || payload.gangSettled || [];
  const scores = payload.scores || players.map((p) => p.score);
  const delta = [0, 0, 0, 0];
  for (const g of gang) {
    if (g.amount == null) continue;
    delta[g.from] -= g.amount;
    delta[g.to] += g.amount;
  }
  return `
    <div class="result-title">流 局</div>
    <div class="result-sub">牌墙摸完 · 庄家不变 · 第 ${s.roundIndex || 1}/${G.totalRounds || 8} 局</div>
    <div class="round-board">${roundBoard(scores, delta, names, { winner: -1, reds: (players || []).map((p) => p.redsPlayed || 0) })}</div>
    ${readyStrip(payload.ready, names, payload.mySeat)}
    <div class="result-actions">
      <button class="big-btn" id="res-next">下 一 局</button>
      <button class="big-btn ghost" id="res-exit">退出牌桌</button>
    </div>`;
}

function finalHtml(payload) {
  const { s, players, names } = resultCtx(payload);
  const scores = payload.scores || players.map((p) => p.score);
  const st = payload.stats || UI.matchStats || { wins: [], fan: [] };
  const ranked = payload.ranked || (scores || []).map((score, seat) => ({ seat, name: names[seat] || ('座位' + seat), score })).sort((a, b) => b.score - a.score);
  const rows = ranked.map((r, i) => `
    <tr class="${r.seat === UI.me ? 'is-me' : ''}">
      <td><span class="rank-medal ${i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : ''}">${i + 1}</span></td>
      <td class="name">${esc(r.name)}${r.seat === UI.me ? '（我）' : ''}${r.seat === s.dealer ? ' · 庄' : ''}</td>
      <td>${st.wins[r.seat] || 0} 局</td>
      <td>${st.fan[r.seat] || 0} 番</td>
      <td class="${r.score >= 0 ? 'pos' : 'neg'}">${num(r.score)}</td>
    </tr>`).join('');
  const canNew = G.canNewMatch ? G.canNewMatch() : true;
  const clicks = G.newMatchClicks ? G.newMatchClicks() : 4;
  const need = G.newMatchTotal ? G.newMatchTotal() : 4;
  return `
    <div class="result-title">本 场 结 束</div>
    <div class="result-sub">共 ${payload.rounds || G.totalRounds || 8} 局</div>
    <table class="result-table">
      <thead><tr><th style="width:56px">名次</th><th>玩家</th><th style="width:80px">胡局</th><th style="width:80px">总番</th><th style="width:100px">总分</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="result-actions">
      ${canNew ? `<button class="big-btn" id="res-again">再来一场${G.mode !== 'single' ? `（${clicks}/${need}）` : ''}</button>` : ''}
      <button class="big-btn ghost" id="res-home">回首页</button>
    </div>`;
}

function readyStrip(ready, names, mySeat) {
  if (!ready || !ready.length) return '';
  const chips = ready.map((ok, i) => `<span class="ready-chip ${ok ? 'is-ok' : ''}"><span class="dot"></span>${esc(names[i] || ('座位' + i))}${ok ? ' 已准备' : ' 等待中'}</span>`).join('');
  return `<div class="ready-strip" data-ready>${chips}</div>`;
}

function bindResult(card) {
  const next = card.querySelector('#res-next');
  if (next) next.addEventListener('click', () => { sfx('tap'); if (G.onNext) G.onNext(); });
  const exit = card.querySelector('#res-exit');
  if (exit) exit.addEventListener('click', () => { sfx('tap'); if (G.onExit) G.onExit(); else backToHome(); });
  const again = card.querySelector('#res-again');
  if (again) again.addEventListener('click', () => {
    sfx('tap');
    const all = G.newMatchClicks ? G.newMatchClicks() : 4;
    const need = G.newMatchTotal ? G.newMatchTotal() : 4;
    if (G.onNewMatch) G.onNewMatch();
    if (G.mode !== 'single') showToast(`已点「再来一场」（${Math.min(need, all + 1)}/${need}），等人齐`);
  });
  const home = card.querySelector('#res-home');
  if (home) home.addEventListener('click', () => { sfx('tap'); if (G.onExit) G.onExit(); else backToHome(); });
}

/* ---------------- 准备条 ---------------- */

export function updateReadyBar(ready, names, mySeat, rebuild) {
  const list = ready || [];
  const nm = names || [];
  const showBar = list.some(Boolean) && !list.every(Boolean) && !$('result').classList.contains('show');
  const bar = $('ready-bar');
  if (bar) {
    if (showBar) {
      bar.classList.add('is-on');
      bar.innerHTML = list.map((ok, i) => `<span class="ready-chip ${ok ? 'is-ok' : ''}"><span class="dot"></span>${esc(nm[i] || ('座位' + i))}${ok ? ' 已准备' : ' 等待中'}</span>`).join('');
    } else {
      bar.classList.remove('is-on');
    }
  }
  const card = $('result-card');
  const strip = card && card.querySelector('[data-ready]');
  if (strip) strip.outerHTML = readyStrip(list, nm, mySeat);
}

/* ---------------- 房间号 / 记分板 ---------------- */

export function setRoomCode(code) {
  UI.roomCode = code || '';
  setRoomCodeState(UI.roomCode);
}

function setRoomCodeState(code) {
  const chip = $('room-chip');
  const val = $('room-code');
  if (!chip) return;
  chip.classList.toggle('is-on', !!code);
  if (code && val) val.textContent = code;
}

export function showBoard() {
  UI.boardOpen = true;
  renderScoreboard();
  const b = $('board');
  if (b) b.classList.add('show');
}

export function hideBoard() {
  UI.boardOpen = false;
  const b = $('board');
  if (b) b.classList.remove('show');
}

export function toggleBoard() {
  if (UI.boardOpen) hideBoard(); else showBoard();
}

export function boardVisible() { return UI.boardOpen; }

export function renderScoreboard() {
  const box = $('board');
  if (!box) return;
  const s = UI.state;
  if (!s || !s.players) { box.innerHTML = ''; return; }
  const rows = s.players.map((p, i) => ({ ...p, seat: i })).sort((a, b) => (b.score || 0) - (a.score || 0));
  const st = UI.matchStats || { wins: [], fan: [] };
  box.innerHTML = `
    <div class="board-card">
      <div class="board-title">记 分 板</div>
      <div class="board-sub">累计总分 · 第 ${s.roundIndex || 1}/${G.totalRounds || 8} 局 · ${MODE_TAG[G.mode] || ''}</div>
      <div class="board-rows">
        ${rows.map((p, i) => `
          <div class="board-row ${p.seat === UI.me ? 'is-me' : ''}">
            <span class="idx">${i + 1}</span>
            <span class="bname">${esc(p.name)}<span class="bwind">${esc(WIND[p.seat] || '')}${p.seat === s.dealer ? ' · 庄' : ''}</span></span>
            <span class="bstat">胡 ${st.wins[p.seat] || 0} 局</span>
            <span class="bstat">${st.fan[p.seat] || 0} 番</span>
            <span class="bscore ${(p.score || 0) < 0 ? 'neg' : ''}">${num(p.score || 0)}</span>
          </div>`).join('')}
      </div>
      <div class="board-actions"><button class="big-btn ghost" id="board-close">收 起</button></div>
    </div>`;
  const close = box.querySelector('#board-close');
  if (close) close.addEventListener('click', hideBoard);
  box.onclick = (e) => { if (e.target === box) hideBoard(); };
}

/* ---------------- 掉线 ---------------- */

export function setPaused(names, waiting) {
  const on = !!waiting && Array.isArray(names) && names.length > 0;
  const box = $('paused');
  if (!box) return;
  UI.paused = on;
  box.classList.toggle('show', on);
  if (on) {
    const t = $('pause-text');
    if (t) t.innerHTML = `${esc(names.join('、'))} 掉线<br><span style="font-size:13px;opacity:.6">全场暂停，等待重连…</span>`;
  }
}

/* ---------------- 布局 / 全屏 / 声音 ---------------- */

let ZOOM_OK = null;
/* 用 zoom 代替 transform:scale，浏览器会按实际像素重新排版/渲染，字和牌面不发虚 */
function zoomSupported() {
  if (ZOOM_OK !== null) return ZOOM_OK;
  try {
    const d = D.createElement('div');
    d.style.cssText = 'position:absolute;left:-9999px;top:0;width:100px;height:10px;zoom:2';
    D.body.appendChild(d);
    ZOOM_OK = d.getBoundingClientRect().width >= 190;
    d.remove();
  } catch (e) { ZOOM_OK = false; }
  return ZOOM_OK;
}

export function applyLayoutUnits() {
  /* Safari 独立窗口里 clientHeight 有时只到工具栏上方，innerHeight 才是整屏；
     两边取最大值，保证旋转后的 app 真正铺满屏幕，不在底部留黑边。 */
  const root = D.documentElement;
  const vv = window.visualViewport;
  const vw = Math.round(Math.max(root.clientWidth || 0, window.innerWidth || 0, (vv && vv.width) || 0));
  const vh = Math.round(Math.max(root.clientHeight || 0, window.innerHeight || 0, (vv && vv.height) || 0));
  /* 手机竖屏锁定也能直接横过来：把整个 app 旋转 90°，再按横屏尺寸排版。
     舞台尺寸 = 视口 / 缩放比，缩放后刚好铺满视口，宽屏不再留左右黑边。 */
  const portrait = !!(window.matchMedia && window.matchMedia('(orientation: portrait) and (max-width: 900px)').matches);
  const W = portrait ? vh : vw;
  const H = portrait ? vw : vh;
  const s = Math.min(W / 1440, H / 810);
  const sc = $('scaler');
  const st = $('stage');
  const app = $('app');
  if (app) {
    app.classList.toggle('is-rotate', portrait);
    /* 关键：旋转后 app 的宽 = 竖屏高度，高 = 竖屏宽度；显式写像素并居中，
       避免 Safari 独立窗口下 100vh 与实际可视高度不一致造成的黑边/上缩。 */
    if (portrait) {
      app.style.width = `${vh}px`;
      app.style.height = `${vw}px`;
      app.style.left = `${(vw - vh) / 2}px`;
      app.style.top = `${(vh - vw) / 2}px`;
      app.style.transform = 'rotate(90deg)';
    } else {
      app.style.width = `${vw}px`;
      app.style.height = `${vh}px`;
      app.style.left = '0px';
      app.style.top = '0px';
      app.style.transform = 'none';
    }
  }
  if (sc && st) {
    st.style.width = `${W / s}px`;
    st.style.height = `${H / s}px`;
    if (zoomSupported()) {
      sc.style.transform = 'none';
      st.style.zoom = String(s);
    } else {
      st.style.zoom = '';
      sc.style.transform = `scale(${s})`;
    }
  }
  UI.scale = s;
  const rh = $('rotate-hint');
  if (rh) rh.classList.toggle('is-on', !portrait && vw < vh * 1.02);
}

function requestLandscapeLock() {
  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      const p = screen.orientation.lock('landscape');
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) {}
}

export function bindLayout() {
  applyLayoutUnits();
  window.addEventListener('resize', applyLayoutUnits);
  window.addEventListener('orientationchange', () => setTimeout(applyLayoutUnits, 320));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', applyLayoutUnits);
  D.addEventListener('fullscreenchange', () => setTimeout(applyLayoutUnits, 320));
  if (D.readyState !== 'complete') D.addEventListener('DOMContentLoaded', applyLayoutUnits);
}

export function toggleFullscreen() {
  const d = D;
  requestLandscapeLock();
  if (!d.fullscreenElement) {
    try {
      const p = d.documentElement.requestFullscreen ? d.documentElement.requestFullscreen() : null;
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  } else if (d.exitFullscreen) {
    try { d.exitFullscreen().catch(() => {}); } catch (e) {}
  }
  setTimeout(applyLayoutUnits, 350);
}

let VOICE_ON = true;
try { VOICE_ON = localStorage.getItem('jianli_voice') !== '0'; } catch (e) {}

export function voiceOn() { return VOICE_ON; }

export function setVoice(on) {
  VOICE_ON = !!on;
  try { localStorage.setItem('jianli_voice', VOICE_ON ? '1' : '0'); } catch (e) {}
  if (!VOICE_ON && SPEECH) {
    try { SPEECH.cancel(); } catch (e) {}
    speechQueue.length = 0;
    speechBusy = false;
  }
  if (VOICE_ON) primeSpeech();
  syncVoice();
  showToast(VOICE_ON ? '已开启声音' : '已关闭声音', '', 1200);
  if (VOICE_ON) sfx('tap');
}

function syncVoice() {
  const a = $('btn-voice');
  const b = $('home-voice');
  if (a) a.classList.toggle('is-off', !VOICE_ON);
  if (b) b.classList.toggle('is-off', !VOICE_ON);
}

/* ---------------- 语音播报（出牌 / 碰 / 杠 / 胡 / 流局） ----------------
 * 播报只依赖“快照里的状态变化”，不依赖本地动作事件，
 * 所以单机、局域网、P2P 的每个客户端都会各自播报，不会只有房主响。
 */
const SPEECH = (typeof window !== 'undefined' && 'speechSynthesis' in window
  && typeof window.SpeechSynthesisUtterance !== 'undefined') ? window.speechSynthesis : null;
let speechVoice = null;
let speechBusy = false;
const speechQueue = [];

function pickSpeechVoice() {
  if (!SPEECH) return;
  try {
    const voices = SPEECH.getVoices() || [];
    speechVoice = voices.find((v) => /^zh[-_]CN/i.test(v.lang))
      || voices.find((v) => /zh|Chinese|中文/i.test((v.lang || '') + ' ' + (v.name || '')))
      || null;
  } catch (e) { speechVoice = null; }
}

function primeSpeech() {
  G.voicePrimed = true;
  pickSpeechVoice();
  if (!SPEECH) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    SPEECH.speak(u);
    SPEECH.cancel();
  } catch (e) {}
}

function speak(text) {
  if (!VOICE_ON || !SPEECH || !text) return;
  if (speechQueue.length > 8) speechQueue.shift();
  speechQueue.push(text);
  if (!speechBusy) drainSpeech();
}

function drainSpeech() {
  if (!VOICE_ON || !SPEECH) { speechQueue.length = 0; speechBusy = false; return; }
  const text = speechQueue.shift();
  if (!text) { speechBusy = false; return; }
  speechBusy = true;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.02;
    u.pitch = 0.96;
    if (!speechVoice) pickSpeechVoice();
    if (speechVoice) u.voice = speechVoice;
    u.onend = () => setTimeout(drainSpeech, 40);
    u.onerror = () => setTimeout(drainSpeech, 40);
    SPEECH.speak(u);
  } catch (e) {
    setTimeout(drainSpeech, 40);
  }
}

if (SPEECH) {
  pickSpeechVoice();
  if (SPEECH.addEventListener) SPEECH.addEventListener('voiceschanged', pickSpeechVoice);
}
D.addEventListener('pointerdown', () => { if (!G.voicePrimed) primeSpeech(); }, { once: true });
D.addEventListener('touchstart', () => { if (!G.voicePrimed) primeSpeech(); }, { once: true, passive: true });

function voiceName(s, seat) {
  const p = s && s.players && s.players[seat];
  return (p && p.name) || (G.seatNames && G.seatNames[seat]) || (WIND[seat] + '家');
}

function announceState(s) {
  if (!VOICE_ON || !s || !s.players) return;
  const round = s.roundIndex || 1;
  if (UI.voiceRound !== round) {
    UI.voiceRound = round;
    UI.voiceKey = '';
    UI.voiceMelds = ['', '', '', ''];
    UI.voiceResult = '';
  }

  /* 出牌：lastDiscard 每次出牌都会更新（红中也会），用座位+牌+该家出牌数去重 */
  const ld = s.lastDiscard;
  if (ld && ld.tile !== undefined && ld.tile !== null) {
    const p = s.players[ld.seat];
    const key = `${round}|${ld.seat}|${ld.tile}|${(p && p.discardCount) || 0}|${ld.seq || 0}`;
    if (key !== UI.voiceKey) {
      UI.voiceKey = key;
      speak(`${voiceName(s, ld.seat)}，打${label(ld.tile)}`);
    }
  }

  /* 碰 / 杠 / 回头笑：对比每家露牌的签名，新增或变化就播报 */
  for (let seat = 0; seat < 4; seat++) {
    const p = s.players[seat];
    const melds = (p && p.melds) || [];
    const sig = melds.map((m) => `${m.kind}:${m.tile}`).join('|');
    const old = (UI.voiceMelds && UI.voiceMelds[seat]) || '';
    if (sig !== old) {
      if (!old) { UI.voiceMelds[seat] = sig; continue; }  /* 进桌时已有副露，不补播 */
      const oldParts = old ? old.split('|') : [];
      let changed = null;
      for (let i = 0; i < melds.length; i++) {
        const now = `${melds[i].kind}:${melds[i].tile}`;
        if (now !== oldParts[i]) { changed = melds[i]; break; }
      }
      if (changed) {
        const kind = changed.kind === 'peng' ? '碰'
          : changed.kind === 'gangExposed' ? '明杠'
            : changed.kind === 'gangConcealed' ? '暗杠'
              : changed.kind === 'gangAdded' ? '回头笑' : '杠';
        const t = label(changed.tile);
        speak(kind === '碰' ? `${voiceName(s, seat)}，碰${t}` : `${voiceName(s, seat)}，${kind}${t}`);
      }
      UI.voiceMelds[seat] = sig;
    }
  }

  /* 胡 / 流局：只在进入 finished 的那一次播 */
  if (s.phase === 'finished') {
    const resultKey = `${round}|${s.drawnGame ? 'draw' : (s.result && s.result.winner) || ''}`;
    if (resultKey !== UI.voiceResult) {
      UI.voiceResult = resultKey;
      if (s.drawnGame) speak('流局');
      else if (s.result && s.result.winner !== undefined) {
        const winner = s.result.winner;
        const fans = (s.result.fans || []).map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean).join('，');
        speak(`${voiceName(s, winner)}，自摸${fans ? '，' + fans : ''}`);
      }
    }
  }
}


/* ---------------- 音效（WebAudio 合成，无外部文件） ---------------- */

let AC = null;
function audio() {
  if (!VOICE_ON) return null;
  if (!AC) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { AC = new C(); } catch (e) { return null; }
  }
  if (AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
  return AC;
}

function blip(freq, dur, type = 'sine', gain = 0.16, when = 0, slide = 0) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(60, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function sfx(kind) {
  if (!VOICE_ON) return;
  switch (kind) {
    case 'tap': blip(1850, 0.035, 'square', 0.05); break;
    case 'discard': blip(1180, 0.05, 'square', 0.065); blip(720, 0.09, 'triangle', 0.065, 0.01, -320); break;
    case 'peng': blip(660, 0.11, 'triangle', 0.12); blip(880, 0.13, 'triangle', 0.1, 0.08); break;
    case 'gang': blip(520, 0.16, 'sawtooth', 0.09); blip(330, 0.22, 'triangle', 0.11, 0.05, -120); break;
    case 'hu': [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.32, 'sine', 0.12, i * 0.09)); break;
    case 'win': [392, 523, 659, 784, 1047].forEach((f, i) => blip(f, 0.42, 'triangle', 0.1, i * 0.1)); break;
    case 'draw': blip(300, 0.34, 'sine', 0.09, 0, -120); break;
    default: break;
  }
}

function sfxForText(text, cls) {
  if (!text) return;
  if (text.includes('碰')) sfx('peng');
  else if (text.includes('杠') || text.includes('蓄')) sfx('gang');
  else if (text.includes('自摸') || text.includes('胡') || cls === 'score') sfx('hu');
  else if (text.includes('流局')) sfx('draw');
}

/* ---------------- 首页牌面 ---------------- */

function renderHomeTiles() {
  const box = $('home-tiles');
  if (!box) return;
  box.innerHTML = [RED_RAW, 0, 17, 26].map((t) => tileHtml(t, '')).join('');
}

/* ---------------- 交互 ---------------- */

function bindAll() {
  const p2p = $('home-p2p');
  if (p2p) p2p.addEventListener('click', () => {
    sfx('tap');
    const g = window.JianliGame;
    if (g && typeof g.openP2P === 'function') { closeOverlays(); g.openP2P(); }
  });
  const rules = $('home-rules');
  if (rules) rules.addEventListener('click', () => { sfx('tap'); const m = $('rules-modal'); if (m) m.classList.add('show'); });
  const rc = $('rules-close');
  if (rc) rc.addEventListener('click', () => { const m = $('rules-modal'); if (m) m.classList.remove('show'); });
  const rmodal = $('rules-modal');
  if (rmodal) rmodal.addEventListener('click', (e) => { if (e.target === rmodal) rmodal.classList.remove('show'); });
  const cl = $('home-changelog');
  if (cl) cl.addEventListener('click', () => { sfx('tap'); const m = $('changelog-modal'); if (m) { renderVersion(); m.classList.add('show'); } });
  const cc = $('changelog-close');
  if (cc) cc.addEventListener('click', () => { const m = $('changelog-modal'); if (m) m.classList.remove('show'); });
  const cmodal = $('changelog-modal');
  if (cmodal) cmodal.addEventListener('click', (e) => { if (e.target === cmodal) cmodal.classList.remove('show'); });

  const hv = $('home-voice'); if (hv) hv.addEventListener('click', () => setVoice(!voiceOn()));
  const tv = $('btn-voice'); if (tv) tv.addEventListener('click', () => setVoice(!voiceOn()));
  const hf = $('home-full'); if (hf) hf.addEventListener('click', toggleFullscreen);
  const tf = $('btn-full'); if (tf) tf.addEventListener('click', toggleFullscreen);
  const tb = $('btn-board'); if (tb) tb.addEventListener('click', () => { sfx('tap'); toggleBoard(); });
  const ex = $('btn-exit'); if (ex) ex.addEventListener('click', () => {
    sfx('tap');
    if (G.onExit) G.onExit(); else backToHome();
  });

  const hand = $('my-hand');
  if (hand) hand.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    onTileClick(Number(tile.getAttribute('data-raw')), Number(tile.getAttribute('data-i')));
  });

  const acts = $('actions');
  if (acts) acts.addEventListener('click', (e) => {
    const btn = e.target.closest('.act-btn');
    if (!btn) return;
    const a = UI.acts[Number(btn.getAttribute('data-i'))];
    if (!a) return;
    sfx('tap');
    if (a.type === 'gangPick') { showGangPick(a.gangs); return; }
    submitAction({ type: a.type });
  });

  const zone = $('declare-zone');
  if (zone) zone.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-g]');
    if (opt) {
      const g = Number(opt.getAttribute('data-g'));
      const list = (G.getMyActions ? (G.getMyActions() || []) : []).filter((x) => x && (x.type === 'gangConcealed' || x.type === 'gangAdded'));
      const o = list[g];
      if (o) submitAction({ type: o.type, tile: o.tile });
      return;
    }
    if (e.target.closest('#btn-declare')) submitAction({ type: 'declare' });
  });

  const unlock = () => { audio(); requestLandscapeLock(); D.removeEventListener('pointerdown', unlock); };
  D.addEventListener('pointerdown', unlock);

  D.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const rm = $('rules-modal'); if (rm) rm.classList.remove('show');
      const cm = $('changelog-modal'); if (cm) cm.classList.remove('show');
      if (UI.boardOpen) hideBoard();
    }
  });
}

function onTileClick(raw, i) {
  if (UI.lock) return;
  if (UI.paused) { showToast('有人掉线，等重连后再打', '', 1500); return; }
  const s = UI.state;
  if (!s) return;
  if (s.phase !== 'awaitingDiscard' || s.current !== UI.me) {
    showToast('还没轮到你出牌', '', 1200);
    return;
  }
  const p = s.players[UI.me];
  const allowed = allowedSet();
  if (!allowed.has(raw)) {
    if (p.declared) showToast('报听后只能打刚摸到的这张', '', 1500);
    else if (p.singleLocked !== null && p.singleLocked !== undefined) showToast('已经明牌，只能打刚摸到的这张', '', 1500);
    else if (p.declareIntent) showToast('报听只能打能听牌的牌', '', 1500);
    else showToast('这张现在打不了', '', 1200);
    return;
  }
  if (UI.sel && UI.sel.raw === raw && UI.sel.i === i) {
    UI.sel = null;
    UI.lock = true;
    setTimeout(() => { UI.lock = false; }, 220);
    sfx('discard');
    if (G.onDiscard) G.onDiscard(raw);
    const el = $('hand-hint'); if (el) el.classList.add('is-off');
    return;
  }
  UI.sel = { raw, i };
  G.selected = raw;
  sfx('tap');
  drawHand(s);
  drawHint(s);
  drawTing(s);
}

function submitAction(a) {
  if (UI.lock) return;
  if (UI.paused) { showToast('有人掉线，等重连后再打', '', 1500); return; }
  UI.lock = true;
  setTimeout(() => { UI.lock = false; }, 260);
  UI.sel = null;
  const zone = $('declare-zone'); if (zone) zone.innerHTML = '';
  if (G.onAct) G.onAct(a);
}

/* ---------------- 启动 ---------------- */
bindAll();
bindLayout();
if (window.__JL_DEBUG__) window.__JLUI = { renderAll, showResult, hideResult, updateReadyBar, setPaused, showBoard, G, UI };
