/* 机器人 AI —— 移植自 iOS Bot.swift
 * 不追求强，要求「像人」：先打油、再拆孤张、不无脑碰杠。
 */
import { RED_RAW, isPizi, rankOf } from './tiles.js';

export function nextAction(engine, seat) {
  const s = engine.state;

  // 声明窗口：能杠就杠；碰要看牌型；否则过
  if (s.phase === 'awaitingClaim' && s.pending && s.pending.outstanding.includes(seat)) {
    const opts = s.pending.options[seat] || ['pass'];
    if (opts.includes('gang')) return { type: 'gangExposed' };
    if (opts.includes('peng') && shouldPeng(s.players[seat].hand, s.pending.tile)) return { type: 'peng' };
    return { type: 'pass' };
  }

  if (s.phase === 'finalDraw' && s.current === seat) {
    if (s.players[seat].hand.some(isPizi)) return { type: 'bu' };
    if (engine.canHu(seat)) return { type: 'hu' };
    for (const opt of engine.options(seat)) {
      if (opt.type === 'gangAdded' || opt.type === 'gangConcealed') return { type: opt.type, tile: opt.tile };
      if (opt.type === 'finalPass') return { type: 'finalPass' };
    }
    return { type: 'finalPass' };
  }
  if (s.phase !== 'awaitingDiscard' || s.current !== seat) return null;
  if (s.players[seat].hand.some(isPizi)) return { type: 'bu' };
  if (engine.canHu(seat)) return { type: 'hu' };

  /* 已经亮牌以后不能换牌：只能打刚摸进来的那张（还没亮牌时可以任选） */
  const me = s.players[seat];
  if (me.singleLocked !== null && s.lastDrawn !== null && me.hand.includes(s.lastDrawn)) {
    return { type: 'discard', tile: s.lastDrawn };
  }

  for (const opt of engine.options(seat)) {
    if (opt.type === 'gangAdded') return { type: 'gangAdded', tile: opt.tile };
    if (opt.type === 'gangConcealed' && s.players[seat].melds.length >= 1) {
      return { type: 'gangConcealed', tile: opt.tile };
    }
  }

  const tile = discardCandidate(s.players[seat].hand);
  return tile === null ? null : { type: 'discard', tile };
}

export function shouldPeng(hand, tile) {
  if (hand.filter((t) => t === tile).length < 2) return false;
  const pairs = new Map();
  for (const t of hand) {
    if (isPizi(t)) continue;
    pairs.set(t, (pairs.get(t) || 0) + 1);
  }
  let pairCount = 0;
  for (const v of pairs.values()) if (v >= 2) pairCount++;
  const rank = rankOf(tile);
  if (rank === 1 || rank === 9) return true;
  return pairCount >= 2;
}

export function discardCandidate(hand) {
  if (hand.length === 0) return null;
  const pi = hand.find(isPizi);
  if (pi !== undefined) return pi; // 油留不得

  let best = null;
  let bestScore = Infinity;
  for (const tile of hand) {
    let score = 0;
    const same = hand.filter((t) => t === tile).length;
    score += same * 4;

    if (!isPizi(tile)) {
      const suit = Math.floor(tile / 9);
      for (const delta of [-2, -1, 1, 2]) {
        const target = tile + delta;
        if (target < 0 || target >= 27 || Math.floor(target / 9) !== suit) continue;
        if (hand.includes(target)) score += Math.abs(delta) === 1 ? 3 : 1;
      }
      const rank = rankOf(tile);
      if (rank === 1 || rank === 9) score -= 2;
      if (rank >= 3 && rank <= 7) score += 1;
    }

    if (score < bestScore) {
      bestScore = score;
      best = tile;
    }
  }
  return best;
}

/** 30 秒超时托管：按用户口径统一单机 / 联机 / 公网服务器。
 *  - 手里有油：先补油；
 *  - 碰牌后必须出牌：随机打一张；
 *  - 正常摸牌后：打刚摸进来的那张；
 *  - 其余情况才用常规候选牌。
 */
export function timeoutAction(engine, seat) {
  const s = engine && engine.state;
  if (!s || !s.players || !s.players[seat]) return { type: 'pass' };
  const p = s.players[seat];
  if ((p.hand || []).some(isPizi)) return { type: 'bu' };

  if (s.mustDiscard === seat) {
    const legal = (p.hand || []).filter((t) => !isPizi(t));
    if (!legal.length) return { type: 'pass' };
    return { type: 'discard', tile: legal[Math.floor(Math.random() * legal.length)] };
  }

  const drawn = s.lastDrawn;
  if (drawn !== null && drawn !== undefined && (p.hand || []).includes(drawn)) {
    return { type: 'discard', tile: drawn };
  }

  const tile = discardCandidate(p.hand || []);
  return tile === null ? { type: 'pass' } : { type: 'discard', tile };
}
