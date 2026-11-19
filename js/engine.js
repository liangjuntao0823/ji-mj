/* 监利红中麻将 —— 牌局引擎（移植自 iOS JianliCore/Engine.swift）
 * 房主权威的纯逻辑引擎：输入动作，输出事件；全程只有发牌用随机数。
 */
import {
  RED_RAW, FA_RAW, BAI_RAW, PIZI_RAWS, isPizi, ALL_KINDS, Wall, sortHand, nextSeat, othersOf, seatDistance, SEAT_LABEL,
} from './tiles.js';
import { isWinning, waitingTiles, isBaDuiShape } from './win.js';

export const DEFAULT_RULE = {
  name: '监利红中',
  tileCount: 112,
  selfDrawBase: 10,      // 自摸：三家各付
  pointGangBase: 10,     // 点杠：点杠者独付
  concealedGangBase: 15, // 暗杠：三家各付
  addedGangBase: 5,      // 蓄杠（回头笑）：三家各付
  redGangBase: 15,       // 四张红中打完，按暗杠计
  allowChi: false,
  allowPointHu: false,
  allowSevenPairs: true,
  redAsPizi: true,
  playSeconds: 30,
  claimSeconds: 30,
  rounds: 8,
  withDragons: false,   // 中发白：发财、白板与红中同为皮子
  addonEnabled: false,  // 自由加增：每小局开局前每人选 0~3 份
};

export class EngineError extends Error {}

/* ---------------- 番型判定（监利红中规则表） ---------------- */

function countsOf(tiles) {
  const c = new Array(28).fill(0);
  for (const t of tiles) if (t >= 0 && t < 28) c[t]++;
  return c;
}

/** 全部成对（七对 / 清八对类） */
function allPairs(tiles) {
  const c = countsOf(tiles);
  for (let i = 0; i < 28; i++) if (c[i] % 2 !== 0) return false;
  return tiles.length > 0;
}

/** 是否含 4 张相同 */
function hasQuad(tiles) {
  return countsOf(tiles).some((n) => n >= 4);
}

/** 手牌能拆成全部刻子 + 恰好一对将 */
function isAllTriplets(hand) {
  const c = countsOf(hand);
  const rest = [];
  for (let i = 0; i < 28; i++) {
    while (c[i] >= 3) c[i] -= 3;
    if (c[i] > 0) rest.push(c[i]);
  }
  return rest.length === 1 && rest[0] === 2;
}

const SUIT_OF = (t) => Math.floor(t / 9);

/** 清八对/豪华清八对：手里/副露里至少两个杠，并且没有碰 */
function baDuiOK(hand, melds) {
  const gangs = melds.filter((m) => m.kind === 'gangExposed' || m.kind === 'gangConcealed' || m.kind === 'gangAdded');
  if (melds.some((m) => m.kind === 'peng')) return false;
  return isBaDuiShape(hand, gangs.length);
}

/**
 * 判番：返回 { fans:[{name,mult}], mult }
 * 倍数一律相加：牌型取最高的一个，其余番（清一色、明/暗活带、天地胡）叠加相加，
 * 清摸球 / 杠上开花 / 海底捞月 各 +0.5。
 * 明活带、暗活带只与清一色叠加（不与牌型本身相加，也不与特殊牌型叠）。
 */
export function judgeFans({ hand, melds, lastDrawn, wallRemaining, afterGang, drawCount, dealer, seat, declared, seaBottom = false }) {
  const fans = [];
  const gangs = melds.filter((m) => m.kind === 'gangExposed' || m.kind === 'gangConcealed' || m.kind === 'gangAdded');
  const pengLike = melds.filter((m) => m.kind === 'peng');  /* 明杠/暗杠/回头笑都不算碰 */
  /* 手上攥着没杠出来的 4 张同牌（暗杠形态留在手里） */
  const handQuads = [];
  for (const t of new Set(hand)) if (hand.filter((x) => x === t).length === 4) handQuads.push(t);
  const restHand = hand.slice();
  for (const t of handQuads) for (let i = 0; i < 4; i++) restHand.splice(restHand.indexOf(t), 1);
  const pairHand = restHand.length % 2 === 0 && allPairs(restHand);
  const pairHandRaw = hand.length % 2 === 0 && allPairs(hand);
  const totalGangs = gangs.length + handQuads.length;
  const allTiles = hand.concat(melds.map((m) => m.tile));
  const pure = allTiles.length > 0 && allTiles.every((t) => !isPizi(t) && SUIT_OF(t) === SUIT_OF(allTiles[0]));

  let base = 1;
  let baseName = '屁胡';
  if (gangs.length === 4 && hand.length === 2 && hand[0] === hand[1]) {
    base = 10; baseName = '十八罗汉';
  } else if (totalGangs >= 2 && pairHand && restHand.length >= 4) {
    if (totalGangs >= 3) { base = 10; baseName = '豪华清八对'; }
    else { base = 8; baseName = '清八对'; }
  } else if (melds.length === 0 && hand.length === 14 && pairHandRaw) {
    if (hasQuad(hand)) { base = 8; baseName = '豪华七对'; }
    else { base = 4; baseName = '七对'; }
  } else if (melds.length === 4 && hand.length === 2 && hand[0] === hand[1]) {
    /* 裸奔 = 4 副露 + 单钓。碰、明杠、暗杠、回头笑都算副露；
       4 个杠的十八罗汉已在上面优先命中。 */
    base = 7; baseName = '裸奔';
  } else if (melds.every((m) => m.kind === 'peng' || m.kind.startsWith('gang')) && isAllTriplets(hand)) {
    base = 3; baseName = '对子胡';
  }

  /* 明活带 / 暗活带：只与清一色叠加 —— 成立时取代牌型本身，不再与对子胡等相加 */
  const SPECIAL = ['裸奔', '十八罗汉', '清八对', '豪华清八对', '七对', '豪华七对'];
  const pengTiles = pengLike.map((m) => m.tile);
  if (!SPECIAL.includes(baseName)) {
    if (handQuads.length > 0 && isWinning(hand, melds.length, true)) { base = 5; baseName = '暗活带'; }
    else if (pengTiles.some((t) => hand.includes(t))) { base = 3; baseName = '明活带'; }
  }

  /* 独立叠加的番：天地胡、清一色、报听 */
  const isTian = drawCount === 1 && seat === dealer;
  const isDi = drawCount !== null && drawCount !== undefined && drawCount > 1 && drawCount <= 4 && seat !== dealer;
  const extra = [];
  if (isTian) extra.push({ name: '天胡', mult: 5 });
  else if (isDi) extra.push({ name: '地胡', mult: 5 });
  if (pure) extra.push({ name: '清一色', mult: 4 });
  if (declared) extra.push({ name: '报听', mult: 3 });

  /* 屁胡的 1 倍只在"一个番都没有"时算。只要有清一色/天地胡/报听，这手牌就不是屁胡了。 */
  const isPihu = baseName === '屁胡';
  const baseValue = isPihu && extra.length > 0 ? 0 : base;
  if (!(isPihu && baseValue === 0)) fans.push({ name: baseName, mult: base });
  for (const e of extra) fans.push(e);

  let total = baseValue;
  for (const e of extra) total += e.mult;

  /* 清摸球：一个都没碰过自摸。七对、豪华七对、清八对、豪华清八对、十八罗汉、天地胡本身
     就是没碰过就能成的牌型，不再额外加这 0.5。 */
  const NO_QING = ['七对', '豪华七对', '清八对', '豪华清八对', '十八罗汉'];
  if (pengLike.length === 0 && !NO_QING.includes(baseName) && !declared && !isTian && !isDi) {
    total += 0.5; fans.push({ name: '清摸球', mult: 0.5, add: true });
  }
  if (afterGang) { total += 0.5; fans.push({ name: '杠上开花', mult: 0.5, add: true }); }
  if (wallRemaining === 0 || seaBottom) { total += 0.5; fans.push({ name: '海底捞月', mult: 0.5, add: true }); }

  return { fans, mult: total, base: baseValue, baseName };
}

export const PHASE = { IDLE: 'idle', ADDON: 'awaitingAddon', DISCARD: 'awaitingDiscard', CLAIM: 'awaitingClaim', FINALDRAW: 'finalDraw', FINISHED: 'finished' };

function newPlayer(seat, name, isBot) {
  return { seat, name, hand: [], melds: [], river: [], redsPlayed: 0, piziTiles: [], score: 0, isBot: !!isBot, connected: true, singleLocked: null, declared: false, declareWaits: null, declareIntent: false, discardCount: 0 };
}

export class Engine {
  constructor({ seed = Date.now(), names = [], dealer = 0, roundIndex = 1, botSeats = [], rule = DEFAULT_RULE, state = null } = {}) {
    this.rule = { ...DEFAULT_RULE, ...(rule || {}) };
    this.events = [];
    if (state) {
      this.state = state;
      return;
    }
    const players = [];
    for (let i = 0; i < 4; i++) {
      const name = names[i] && names[i].length ? names[i] : SEAT_LABEL[i] + '家';
      players.push(newPlayer(i, name, botSeats.includes(i)));
    }
    this.state = {
      players,
      dealer,
      current: dealer,
      phase: PHASE.IDLE,
      wall: new Wall(seed >>> 0, 0, undefined, this.rule.withDragons),
      seed: seed >>> 0,
      roundIndex,
      pending: null,
      lastDrawn: null,
      lastDrawnFromTail: false,
      winner: null,
      drawnGame: false,
      result: null,
      /* 碰牌后必须先打出一张，不能立刻胡（本规则不允许放炮/碰后即胡） */
      mustDiscard: null,
      /* 本局已摸牌次数（天胡/地胡判定用） */
      drawCount: 0,
      /* 当前这张摸牌是否来自杠后补牌（杠上开花判定） */
      lastDrawnAfterGang: false,
      /* 全场最后一张打出的牌：用于牌桌高亮 */
      lastDiscard: null,
      /* 杠分/回头笑分：本局先记账，局末统一结算 */
      gangLedger: [],
      /* 自由加增：本局每人选的加增份数（0~3），开局前四家选完才发牌 */
      addons: [0, 0, 0, 0],
      addonChosen: [true, true, true, true],
      addonEnabled: !!this.rule.addonEnabled,
      withDragons: !!this.rule.withDragons,
      /* 海底捞月：牌墙只剩最后 4 张后，四家各摸一张、只摸不打 */
      finalMode: false,
      finalQueue: [],
      finalIndex: 0,
    };
  }

  get players() { return this.state.players; }
  get phase() { return this.state.phase; }

  /* ---------------- 开局 ---------------- */

  startHand() {
    const { state, rule } = this;
    state.phase = PHASE.IDLE;
    state.finalMode = false;
    state.finalQueue = [];
    state.finalIndex = 0;
    state.gangLedger = [];
    state.lastDiscard = null;
    state.addons = [0, 0, 0, 0];
    state.addonChosen = state.players.map((p) => !!p.isBot);
    if (rule.addonEnabled) {
      state.phase = PHASE.ADDON;
      if (!state.addonChosen.every(Boolean)) {
        this.events = [{ type: 'addonWindow', roundIndex: state.roundIndex }];
        return this.events;
      }
      return this.#dealHand();
    }
    return this.#dealHand();
  }

  /** 自由加增：每个小局开始前，四家各选一次 0~3 份；四家选完才发牌 */
  #chooseAddon(value, seat) {
    const s = this.state;
    if (!this.rule.addonEnabled || s.phase !== PHASE.ADDON) throw new EngineError('现在不能选加增');
    if (seat < 0 || seat > 3) throw new EngineError('座位不对');
    if (s.addonChosen[seat]) throw new EngineError('已经选过了');
    s.addons[seat] = Math.max(0, Math.min(3, Number(value) || 0));
    s.addonChosen[seat] = true;
    const out = [{ type: 'addonChosen', seat, value: s.addons[seat] }];
    if (s.addonChosen.every(Boolean)) out.push(...this.#dealHand());
    this.events.push(...out);
    return out;
  }

  #dealHand() {
    const { state } = this;
    const wallSeed = (state.seed ^ Math.imul(state.roundIndex, 0x9e3779b9)) >>> 0;
    state.wall = new Wall(wallSeed, 0, undefined, this.rule.withDragons);
    for (let i = 0; i < 4; i++) {
      Object.assign(state.players[i], { hand: [], melds: [], river: [], redsPlayed: 0, piziTiles: [], singleLocked: null, declared: false, declareWaits: null, declareIntent: false, discardCount: 0 });
    }
    state.pending = null;
    state.lastDrawn = null;
    state.winner = null;
    state.drawnGame = false;
    state.result = null;
    state.current = state.dealer;
    state.phase = PHASE.IDLE;
    state.mustDiscard = null;
    state.drawCount = 0;
    state.lastDrawnAfterGang = false;
    state.finalMode = false;
    state.finalQueue = [];
    state.finalIndex = 0;
    state.gangLedger = [];
    state.lastDiscard = null;

    // 发 13 轮，庄家起手各 1 张
    for (let r = 0; r < 13; r++) {
      for (let k = 0; k < 4; k++) {
        const seat = (state.dealer + k) % 4;
        const t = state.wall.drawFront();
        if (t !== null) state.players[seat].hand.push(t);
      }
    }

    const out = [];
    // 起手带的皮子（红中/发财/白板）同样必打：摆台面，从牌墙尾换真牌
    for (let i = 0; i < 4; i++) {
      let guard = 0;
      const hand = state.players[i].hand;
      let pi = hand.findIndex(isPizi);
      while (pi >= 0 && guard < 12) {
        guard++;
        const pizi = hand[pi];
        hand.splice(pi, 1);
        state.players[i].redsPlayed++;
        state.players[i].piziTiles.push(pizi);
        out.push({ type: 'redDiscarded', seat: i, tile: pizi, count: state.players[i].redsPlayed });
        const re = state.wall.drawBack();
        if (re !== null) hand.push(re);
        pi = hand.findIndex(isPizi);
      }
      state.players[i].hand = sortHand(hand);
    }

    out.unshift({ type: 'handStarted', dealer: state.dealer, seed: state.seed, roundIndex: state.roundIndex });
    out.push(...this.drawTurn(state.dealer));
    this.events = out;
    return out;
  }

  /** 下一局：谁胡谁坐庄，流局庄家不变 */
  startNextHand(seed) {
    if (this.state.winner !== null && this.state.winner !== undefined) this.state.dealer = this.state.winner;
    this.state.seed = seed >>> 0;
    this.state.roundIndex++;
    return this.startHand();
  }

  /* ---------------- 动作入口 ---------------- */

  apply(action, seat) {
    if (action && action.type === 'addon') return this.#chooseAddon(action.value, seat);
    if (this.state.phase === PHASE.FINISHED) throw new EngineError('本局已结束');
    let out;
    switch (action.type) {
      case 'discard': out = this.#discard(action.tile, seat); break;
      case 'peng': out = this.#respond('peng', seat); break;
      case 'gangExposed': out = this.#respond('gang', seat); break;
      case 'pass': out = this.#respond('pass', seat); break;
      case 'gangConcealed': out = this.#concealedGang(action.tile, seat); break;
      case 'gangAdded': out = this.#addedGang(action.tile, seat); break;
      case 'declare': out = this.#declare(seat); break;
      case 'hu': out = this.#hu(seat); break;
      case 'finalDraw': out = this.#finalDraw(seat); break;
      case 'finalPass': out = this.#finalPass(seat); break;
      default: throw new EngineError('未知动作 ' + action.type);
    }
    this.events.push(...out);
    return out;
  }

  /* ---------------- 出牌 ---------------- */

  #discard(raw, seat) {
    const s = this.state;
    if (s.phase !== PHASE.DISCARD || s.current !== seat) throw new EngineError('没轮到你');
    const p = s.players[seat];
    const idx = p.hand.indexOf(raw);
    if (idx < 0) throw new EngineError('手里没有这张牌');
    /* 已经亮牌后不能换牌：摸进来的那张必须打出去，除非它能胡。
       刚碰完/刚杠完（还没锁定）时两张可以任选，选完剩下那张才锁定。 */
    if (p.melds.length === 4 && p.singleLocked !== null && s.lastDrawn !== null && raw !== s.lastDrawn) {
      throw new EngineError('这张已经明牌，只能打刚摸进来的那张');
    }
    if (p.declared && s.lastDrawn !== null && raw !== s.lastDrawn) {
      throw new EngineError('报听后不能换牌，只能打刚摸进来的那张');
    }
    if (p.declareIntent) {
      const rest = p.hand.slice(); rest.splice(idx, 1);
      if (!waitingTiles(rest, 0, this.rule.allowSevenPairs, this.#gangCount(p), p.melds.filter((m) => m.kind === 'peng').length).length) {
        throw new EngineError('这张打出去不听牌，报听不成立，请换一张或者取消报听');
      }
    }
    p.hand.splice(idx, 1);
    s.lastDrawn = null;
    if (s.mustDiscard === seat) s.mustDiscard = null;
    if (!isPizi(raw)) p.river.push(raw);
    p.discardCount += 1;
    /* 每次出牌都更新 lastDiscard（红中也算），联机各端据此播报，不只房主 */
    s.lastDiscard = { seat, tile: raw, seq: p.discardCount };
    if (p.declareIntent) {
      const w = waitingTiles(p.hand, 0, this.rule.allowSevenPairs, this.#gangCount(p), p.melds.filter((m) => m.kind === 'peng').length);
      p.declared = true; p.declareWaits = w.slice(); p.declareIntent = false;
    }
    /* 四副露后手牌只剩一张：这张从此明牌并锁定 */
    if (p.melds.length === 4 && p.hand.length === 1 && p.singleLocked === null) p.singleLocked = p.hand[0];

    let out = [{ type: 'discarded', seat, tile: raw }, { type: 'wallRemaining', n: s.wall.remaining }];

    // 皮子：红中/发财/白板必打，摆台面、尾补一张、结算翻倍
    if (isPizi(raw)) {
      p.redsPlayed++;
      p.piziTiles.push(raw);
      out.push({ type: 'redDiscarded', seat, tile: raw, count: p.redsPlayed });
      if (p.redsPlayed >= 4) out.push(...this.#pay(this.rule.redGangBase, seat, othersOf(seat), 'redGang'));
      if (s.finalMode) {
        // 海底阶段抓到皮子：只摆出来，不从牌尾补牌，也不打牌
        s.current = nextSeat(seat);
        return out;
      }
      /* 墙只剩最后 4 张时打出皮子：只摆出来，不补牌，直接进入各摸各胡 */
      if (s.wall.remaining <= 4) {
        out.push(...this.#beginFinal(nextSeat(seat)));
        return out;
      }
      const re = s.wall.drawBack();
      if (re !== null) {
        p.hand.push(re);
        p.hand = sortHand(p.hand);
        s.lastDrawn = re;
        s.current = seat;
        s.phase = PHASE.DISCARD;
        out.push({ type: 'turn', seat, drawn: re }, { type: 'wallRemaining', n: s.wall.remaining });
      } else {
        out.push(...this.#finishDrawn());
      }
      return out;
    }

    // 声明窗口：只能碰、杠，不能吃、不能点炮胡
    const options = {};
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      const same = s.players[o].hand.filter((t) => t === raw).length;
      if (same >= 3) options[o] = ['pass', 'peng', 'gang'];
      else if (same === 2) options[o] = ['pass', 'peng'];
    }
    if (Object.keys(options).length === 0) {
      out.push(...this.drawTurn(nextSeat(seat)));
    } else {
      s.phase = PHASE.CLAIM;
      s.pending = { discarder: seat, tile: raw, options, outstanding: Object.keys(options).map(Number).sort(), answers: {} };
      out.push({ type: 'claimWindow', discarder: seat, tile: raw });
    }
    return out;
  }

  /* ---------------- 声明（碰/杠/过） ---------------- */

  #respond(option, seat) {
    const s = this.state;
    if (s.phase !== PHASE.CLAIM || !s.pending) throw new EngineError('当前阶段不允许这个操作');
    const opts = s.pending.options[seat];
    if (!opts || !opts.includes(option)) throw new EngineError('当前不能这样声明');
    s.pending.answers[seat] = option;
    s.pending.outstanding = s.pending.outstanding.filter((x) => x !== seat);
    if (s.pending.outstanding.length > 0) return [];
    return this.#resolve(s.pending);
  }

  #resolve(pending) {
    const s = this.state;
    const nearest = (seats) => seats.length === 0 ? null
      : seats.slice().sort((a, b) => seatDistance(s.players[a].seat, pending.discarder) - seatDistance(s.players[b].seat, pending.discarder))[0];
    const gangs = Object.keys(pending.answers).map(Number).filter((k) => pending.answers[k] === 'gang').sort((a, b) => a - b);
    const pengs = Object.keys(pending.answers).map(Number).filter((k) => pending.answers[k] === 'peng').sort((a, b) => a - b);
    s.pending = null;

    s.finalStart = nextSeat(pending.discarder);
    const g = nearest(gangs);
    if (g !== null) return this.#claimGang(g, pending);
    const pg = nearest(pengs);
    if (pg !== null) return this.#claimPeng(pg, pending);
    return this.drawTurn(nextSeat(pending.discarder));
  }

  #claimPeng(seat, pending) {
    const s = this.state;
    const p = s.players[seat];
    this.#removeTiles(pending.tile, 2, seat);
    p.melds.push({ kind: 'peng', tile: pending.tile });
    this.#removeFromRiver(pending.tile, pending.discarder);
    s.current = seat;
    s.phase = PHASE.DISCARD;
    s.lastDrawn = null;
    s.mustDiscard = seat;
    this.#lockSingle(seat);
    return [{ type: 'peng', seat, tile: pending.tile }];
  }

  #claimGang(seat, pending) {
    const s = this.state;
    const p = s.players[seat];
    if (p.declared) {
      const nh = p.hand.slice();
      for (let i = 0; i < 3; i++) nh.splice(nh.indexOf(pending.tile), 1);
      this.#checkDeclaredGang(p, nh, p.melds.length + 1);
    }
    this.#removeTiles(pending.tile, 3, seat);
    p.melds.push({ kind: 'gangExposed', tile: pending.tile });
    this.#removeFromRiver(pending.tile, pending.discarder);
    const out = [{ type: 'gang', seat, kind: 'gangExposed', tile: pending.tile }];
    out.push(...this.#pay(this.rule.pointGangBase, seat, [pending.discarder], 'pointGang'));
    this.#lockSingle(seat);
    if (s.finalMode || s.wall.remaining <= 4) out.push(...this.#beginFinal(s.finalStart ?? seat));
    else out.push(...this.drawTurn(seat, true, true));
    return out;
  }

  /* ---------------- 自己回合的杠 ---------------- */

  #concealedGang(raw, seat) {
    const s = this.state;
    if ((s.phase !== PHASE.DISCARD && s.phase !== PHASE.FINALDRAW) || s.current !== seat) throw new EngineError('没轮到你');
    const p = s.players[seat];
    if (raw >= 27 || p.hand.filter((t) => t === raw).length !== 4) throw new EngineError('没有四张一样的牌');
    if (p.declared) {
      const nh = p.hand.slice();
      for (let i = 0; i < 4; i++) nh.splice(nh.indexOf(raw), 1);
      this.#checkDeclaredGang(p, nh, p.melds.length + 1);
    }
    this.#removeTiles(raw, 4, seat);
    p.melds.push({ kind: 'gangConcealed', tile: raw });
    const out = [{ type: 'gang', seat, kind: 'gangConcealed', tile: raw }];
    out.push(...this.#pay(this.rule.concealedGangBase, seat, othersOf(seat), 'concealedGang'));
    this.#lockSingle(seat);
    if (s.finalMode) out.push(...this.#advanceFinal());
    else if (s.wall.remaining <= 4) out.push(...this.#beginFinal(seat));
    else out.push(...this.drawTurn(seat, true, true));
    return out;
  }

  #addedGang(raw, seat) {
    const s = this.state;
    if ((s.phase !== PHASE.DISCARD && s.phase !== PHASE.FINALDRAW) || s.current !== seat) throw new EngineError('没轮到你');
    const p = s.players[seat];
    const mi = p.melds.findIndex((m) => m.tile === raw && m.kind === 'peng');
    if (mi < 0) throw new EngineError('没有这张牌的碰');
    if (!p.hand.includes(raw)) throw new EngineError('手里没有第四张');
    this.#removeTiles(raw, 1, seat);
    p.melds[mi].kind = 'gangAdded';
    const out = [{ type: 'gang', seat, kind: 'gangAdded', tile: raw }];
    out.push(...this.#pay(this.rule.addedGangBase, seat, othersOf(seat), 'addedGang'));
    this.#lockSingle(seat);
    if (s.finalMode) out.push(...this.#advanceFinal());
    else if (s.wall.remaining <= 4) out.push(...this.#beginFinal(seat));
    else out.push(...this.drawTurn(seat, true, true));
    return out;
  }

  /* ---------------- 胡（只能自摸） ---------------- */

  #hu(seat) {
    const s = this.state;
    if ((s.phase !== PHASE.DISCARD && s.phase !== PHASE.FINALDRAW) || s.current !== seat) throw new EngineError('没轮到你');
    const p = s.players[seat];
    if (p.hand.some(isPizi)) throw new EngineError('手上带皮子，不能胡');
    if (s.mustDiscard === seat) throw new EngineError('碰牌后必须先打出一张，不能直接胡');
    if (!isWinning(p.hand, p.melds.length, this.rule.allowSevenPairs) && !baDuiOK(p.hand, p.melds)) {
      throw new EngineError('牌型不成和');
    }

    const fan = judgeFans({
      hand: p.hand,
      melds: p.melds,
      lastDrawn: s.lastDrawn,
      wallRemaining: s.wall.remaining,
      afterGang: !!s.lastDrawnAfterGang,
      drawCount: s.drawCount,
      dealer: s.dealer,
      seat,
      declared: !!p.declared,
      seaBottom: !!s.finalMode,
    });
    const baseScore = Math.round(this.rule.selfDrawBase * fan.mult);
    const payments = {};
    for (const o of othersOf(seat)) payments[o] = this.amount(baseScore, seat, o);
    for (const o of othersOf(seat)) {
      const v = payments[o] || 0;
      s.players[o].score -= v;
      p.score += v;
    }
    const gangSettled = this.#settleGangLedger();
    const result = {
      winner: seat,
      hand: p.hand.slice(),
      melds: p.melds.map((m) => ({ ...m })),
      payments,
      winnerReds: p.redsPlayed,
      base: baseScore,
      baseMult: this.rule.selfDrawBase,
      mult: fan.mult,
      gangSettled,
      fans: fan.fans,
      fanName: fan.baseName,
      scores: s.players.map((x) => x.score),
      roundIndex: s.roundIndex,
      seed: s.seed,
    };
    s.phase = PHASE.FINISHED;
    s.winner = seat;
    s.drawnGame = false;
    s.result = result;
    return [{ type: 'hu', seat, payments }];
  }

  /* ---------------- 摸牌 / 流局 ---------------- */

  drawTurn(seat, fromBack = false, afterGang = false) {
    const s = this.state;
    if (s.finalMode) return this.#finalDraw(seat);
    if (s.wall.remaining <= 4) return this.#beginFinal(seat);
    const p = s.players[seat];
    let out = [];
    let back = !!fromBack;
    let gangDraw = !!afterGang;

    // 红中必打：摸到红中直接摆台面，从尾牌换，直到摸到真牌
    for (;;) {
      const drawn = back ? s.wall.drawBack() : s.wall.drawFront();
      if (drawn === null) {
        out.push(...this.#finishDrawn());
        return out;
      }
      s.lastDrawn = drawn;
      s.lastDrawnFromTail = back;

      if (isPizi(drawn)) {
        p.redsPlayed++;
        p.piziTiles.push(drawn);
        out.push({ type: 'redDiscarded', seat, tile: drawn, count: p.redsPlayed });
        if (p.redsPlayed >= 4) out.push(...this.#pay(this.rule.redGangBase, seat, othersOf(seat), 'redGang'));
        out.push({ type: 'wallRemaining', n: s.wall.remaining });
        back = true;
        continue;
      }

      p.hand.push(drawn);
      p.hand = sortHand(p.hand);
      s.current = seat;
      s.phase = PHASE.DISCARD;
      s.pending = null;
      s.mustDiscard = null;
      s.drawCount = (s.drawCount || 0) + 1;
      s.lastDrawnAfterGang = gangDraw;
      out.push({ type: 'turn', seat, drawn }, { type: 'wallRemaining', n: s.wall.remaining });
      return out;
    }
  }


  /* ---------------- 海底捞月：最后 4 张各摸各胡 ---------------- */

  #beginFinal(startSeat) {
    const s = this.state;
    if (s.finalMode) return this.#finalDraw(s.current);
    s.finalMode = true;
    s.phase = PHASE.FINALDRAW;
    s.pending = null;
    s.mustDiscard = null;
    s.finalQueue = [0, 1, 2, 3].map((k) => (startSeat + k) % 4);
    s.finalIndex = 0;
    return this.#finalDraw(s.finalQueue[0]);
  }

  /** 海底每人只抓一张：抓到皮子摆出来不补牌；抓到真牌可胡、可暗杠/回头笑，杠了也不补牌 */
  #finalDraw(seat) {
    const s = this.state;
    if (s.finalIndex >= s.finalQueue.length) return this.#finishDrawn();
    const expected = s.finalQueue[s.finalIndex];
    const p = s.players[seat] || s.players[expected];
    seat = expected;
    if (s.wall.remaining <= 0) return this.#finishDrawn();
    const drawn = s.wall.drawFront();
    if (drawn === null) return this.#finishDrawn();
    s.current = seat;
    s.phase = PHASE.FINALDRAW;
    s.lastDrawn = drawn;
    s.lastDrawnFromTail = false;
    s.lastDrawnAfterGang = false;
    s.drawCount = (s.drawCount || 0) + 1;
    const out = [{ type: 'finalTurn', seat }, { type: 'wallRemaining', n: s.wall.remaining }];
    if (isPizi(drawn)) {
      p.redsPlayed++;
      p.piziTiles.push(drawn);
      if (p.redsPlayed >= 4) out.push(...this.#pay(this.rule.redGangBase, seat, othersOf(seat), 'redGang'));
      out.push({ type: 'redDiscarded', seat, tile: drawn, count: p.redsPlayed });
      out.push(...this.#advanceFinal());
      return out;
    }
    p.hand.push(drawn);
    p.hand = sortHand(p.hand);
    s.mustDiscard = null;
    out.push({ type: 'turn', seat, drawn }, { type: 'finalTurn', seat });
    return out;
  }

  #finalPass(seat) {
    const s = this.state;
    if (s.phase !== PHASE.FINALDRAW || s.current !== seat) throw new EngineError('现在不能过');
    return this.#advanceFinal();
  }

  #advanceFinal() {
    const s = this.state;
    s.finalIndex++;
    if (s.finalIndex >= s.finalQueue.length) return this.#finishDrawn();
    return this.#finalDraw(s.finalQueue[s.finalIndex]);
  }

  #finishDrawn() {
    const s = this.state;
    const gangSettled = this.#settleGangLedger();
    s.phase = PHASE.FINISHED;
    s.drawnGame = true;
    s.winner = null;
    s.result = { gangSettled };
    return [{ type: 'drawnGame' }];
  }

  /* ---------------- 分账 ---------------- */

  /** 皮子（红中）份子：每方份子 = 1 + 该方打出的红中数，赢家与付钱方互乘。
   *  双方都没红中 → 1×1；一方 1 个红中 → 2；双方各 1 个 → 2×2=4。 */
  amount(base, winner, payer) {
    const cap = this.rule.withDragons ? 12 : 8;
    const add = (seat) => (this.rule.addonEnabled ? (this.state.addons?.[seat] || 0) : 0);
    const wm = 1 + add(winner) + Math.min(this.state.players[winner].redsPlayed, cap);
    const pm = 1 + add(payer) + Math.min(this.state.players[payer].redsPlayed, cap);
    return base * wm * pm;
  }

  #gangCount(p) {
    return p.melds.filter((m) => m.kind === 'gangExposed' || m.kind === 'gangConcealed' || m.kind === 'gangAdded').length;
  }

  /** 杠分/回头笑：本局先记账，等这一小局结束（胡牌或流局）再统一加减 */
  #pay(base, winner, payers, reason) {
    const out = [];
    for (const payer of payers) {
      if (payer === winner) continue;
      const v = this.amount(base, winner, payer);
      const entry = { type: 'score', from: payer, to: winner, amount: v, reason, pending: true };
      this.state.gangLedger.push(entry);
      out.push(entry);
    }
    return out;
  }

  /** 局末统一结算本局攒下的杠分 */
  #settleGangLedger() {
    const s = this.state;
    const list = s.gangLedger || [];
    for (const e of list) {
      s.players[e.from].score -= e.amount;
      s.players[e.to].score += e.amount;
      e.pending = false;
    }
    const done = list.slice();
    s.gangLedger = [];
    return done;
  }

  /* ---------------- 工具 ---------------- */

  #removeTiles(raw, count, seat) {
    const hand = this.state.players[seat].hand;
    for (let i = 0; i < count; i++) {
      const idx = hand.indexOf(raw);
      if (idx < 0) throw new EngineError('手牌不足');
      hand.splice(idx, 1);
    }
  }

  #removeFromRiver(raw, seat) {
    const river = this.state.players[seat].river;
    const idx = river.lastIndexOf(raw);
    if (idx >= 0) river.splice(idx, 1);
  }

  /** 报听：手上有能让自己听牌的出法时可用，打出去之前先声明 */
  declareOptions(seat) {
    const s = this.state;
    const p = s.players[seat];
    if (!p || p.declared) return [];
    if (p.melds.length > 0 || p.discardCount > 0) return [];   // 碰过、杠过或已经打过牌就不能报听
    if (s.phase !== PHASE.DISCARD || s.current !== seat) return [];
    const out = [];
    for (const t of [...new Set(p.hand)]) {
      const rest = p.hand.slice();
      rest.splice(rest.indexOf(t), 1);
      if (rest.length % 3 !== 1) continue;
      const w = waitingTiles(rest, 0, this.rule.allowSevenPairs, 0, 0);
      if (w.length) out.push({ discard: t, waits: w });
    }
    return out;
  }

  #declare(seat) {
    const s = this.state;
    const p = s.players[seat];
    if (s.phase !== PHASE.DISCARD || s.current !== seat) throw new EngineError('没轮到你');
    if (p.declared) throw new EngineError('已经报过听了');
    if (p.melds.length > 0 || p.discardCount > 0) throw new EngineError('碰过杠过或者已经打过牌，不能报听');
    if (!this.declareOptions(seat).length) throw new EngineError('现在还没听牌，不能报听');
    p.declareIntent = true;
    return [{ type: 'declareIntent', seat }];
  }

  /** 报听的人杠之前，杠完必须还听原来那几张牌，否则不允许 */
  #checkDeclaredGang(p, afterHand, meldCount) {
    if (!p.declared) return;
    const waits = waitingTiles(afterHand, meldCount, this.rule.allowSevenPairs, 0, p.melds.filter((m) => m.kind === 'peng').length);
    const old = p.declareWaits || [];
    const same = waits.length > 0 && waits.length === old.length && waits.every((t) => old.includes(t));
    if (!same) throw new EngineError('这一杠会改口或不再听牌，报听时不能这么杠');
  }

  /** 四副露凑齐且手里正好剩一张：立刻亮牌锁定，之后不能换 */
  #lockSingle(seat) {
    const p = this.state.players[seat];
    if (this.state.mustDiscard === seat) return;   // 还要打牌的回合不锁，打完再说
    if (p.melds.length === 4 && p.hand.length === 1 && p.singleLocked === null) {
      p.singleLocked = p.hand[0];
    }
  }

  /** 轮到某人时他能做的非出牌动作（给 UI 与 AI 用） */
  options(seat) {
    const s = this.state;
    if ((s.phase !== PHASE.DISCARD && s.phase !== PHASE.FINALDRAW) || s.current !== seat) return [];
    const p = s.players[seat];
    const out = [];
    if (this.canHu(seat)) out.push({ type: 'hu' });
    for (const kind of ALL_KINDS) {
      if (isPizi(kind)) continue;
      if (p.hand.filter((t) => t === kind).length === 4) out.push({ type: 'gangConcealed', tile: kind });
      if (p.melds.some((m) => m.kind === 'peng' && m.tile === kind) && p.hand.includes(kind)) {
        out.push({ type: 'gangAdded', tile: kind });
      }
    }
    if (s.phase === PHASE.FINALDRAW) out.push({ type: 'finalPass' });
    return out;
  }

  canHu(seat) {
    if (this.state.mustDiscard === seat) return false;
    const p = this.state.players[seat];
    if (p.hand.some(isPizi)) return false;
    if (isWinning(p.hand, p.melds.length, this.rule.allowSevenPairs)) return true;
    return baDuiOK(p.hand, p.melds);
  }

  /** 玩家视角快照（联机传输 / UI 渲染用），隐藏别人的手牌 */
  snapshotFor(seat) {
    const s = this.state;
    return {
      dealer: s.dealer,
      current: s.current,
      phase: s.phase,
      roundIndex: s.roundIndex,
      wallRemaining: s.wall.remaining,
      finalMode: !!s.finalMode,
      finalQueue: (s.finalQueue || []).slice(),
      finalIndex: s.finalIndex || 0,
      addons: (s.addons || []).slice(),
      addonChosen: (s.addonChosen || []).slice(),
      addonEnabled: !!this.rule.addonEnabled,
      rounds: this.rule.rounds,
      withDragons: !!this.rule.withDragons,
      lastDrawn: s.current === seat ? s.lastDrawn : null,
      myActions: this.options(seat),
      myDeclareOptions: this.declareOptions(seat),
      pending: s.pending ? {
        discarder: s.pending.discarder,
        tile: s.pending.tile,
        myOptions: s.pending.options[seat] || null,
      } : null,
      lastDiscard: s.lastDiscard,
      winner: s.winner,
      drawnGame: s.drawnGame,
      result: s.result ? { ...s.result } : null,
      players: s.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        handCount: p.hand.length,
        /* 单钓明牌：碰杠到只剩最后一张时，这张牌对所有人公开 */
        hand: (p.seat === seat || p.singleLocked !== null) ? p.hand.slice() : null,
        singleLocked: p.singleLocked,
        declared: p.declared,
        declareIntent: p.declareIntent,
        melds: p.melds.map((m) => ({ ...m })),
        river: p.river.slice(),
        redsPlayed: p.redsPlayed,
        piziTiles: (p.piziTiles || []).slice(),
        score: p.score,
        isBot: p.isBot,
      })),
    };
  }
}
