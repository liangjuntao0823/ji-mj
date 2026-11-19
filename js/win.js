/* 胡牌判定 —— 与 iOS 版 WinChecker 一致
 * 红中是皮子：手里带红中一律不算胡。
 * 标准型：4 组面子（顺子/刻子）+ 1 对将；七对只在无副露时成立。
 */
import { RED_RAW, ALL_KINDS } from './tiles.js';

/**
 * @param {number[]} hand 手牌 raw 数组（不含副露的牌）
 * @param {number} meldCount 已副露组数（碰/杠都算 1 组面子）
 * @param {boolean} allowSevenPairs
 */
export function isWinning(hand, meldCount = 0, allowSevenPairs = true) {
  if (hand.some((t) => t === RED_RAW)) return false;

  const counts = new Array(27).fill(0);
  for (const t of hand) {
    if (t >= 27) return false;
    counts[t]++;
  }

  const setsNeeded = 4 - meldCount;
  if (setsNeeded < 0) return false;
  if (hand.length !== setsNeeded * 3 + 2) return false;

  if (allowSevenPairs && meldCount === 0 && hand.length === 14) {
    let pairs = 0;
    let allEven = true;
    for (let i = 0; i < 27; i++) {
      pairs += Math.floor(counts[i] / 2);
      if (counts[i] % 2 !== 0) allEven = false;
    }
    if (allEven && pairs === 7) return true;
  }

  for (let pair = 0; pair < 27; pair++) {
    if (counts[pair] < 2) continue;
    const rest = counts.slice();
    rest[pair] -= 2;
    if (canFormSets(rest, setsNeeded)) return true;
  }
  return false;
}

function canFormSets(counts, sets) {
  if (sets === 0) return counts.every((c) => c === 0);
  let first = -1;
  for (let i = 0; i < 27; i++) {
    if (counts[i] > 0) {
      first = i;
      break;
    }
  }
  if (first < 0) return false;

  // 刻子
  if (counts[first] >= 3) {
    const c = counts.slice();
    c[first] -= 3;
    if (canFormSets(c, sets - 1)) return true;
  }

  // 顺子（同花色内连续）
  const rank = first % 9;
  if (rank <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
    const c = counts.slice();
    c[first] -= 1;
    c[first + 1] -= 1;
    c[first + 2] -= 1;
    if (canFormSets(c, sets - 1)) return true;
  }
  return false;
}

/** 听牌提示：返回所有能和的牌 raw（只用于 UI，不参与裁决）
 *  gangCount = 已副露的杠数；pengCount = 已副露的碰数（清八对不允许带碰）
 *  清八对 / 豪华清八对：至少两个杠（含手里没杠出来的四张），余牌全部成对。
 */
export function waitingTiles(hand, meldCount = 0, allowSevenPairs = true, gangCount = 0, pengCount = 0) {
  if (hand.some((t) => t >= 27)) return [];
  const out = [];
  for (const kind of ALL_KINDS) {
    if (kind >= 27) continue;
    if (isWinning([...hand, kind], meldCount, allowSevenPairs)) { out.push(kind); continue; }
    if (pengCount === 0 && isBaDuiShape([...hand, kind], gangCount)) out.push(kind);
  }
  return unique(out);
}

function unique(list) {
  return [...new Set(list)].sort((a, b) => a - b);
}

/**
 * 清八对 / 豪华清八对的和牌形状：
 * 至少两个杠（副露的杠 + 手里攥着的四张同牌），余下手牌全部成对。
 * hand 只算手牌；melds 里的牌不传进来，只传杠/碰数量。
 */
export function isBaDuiShape(hand, gangCount = 0) {
  if (!Array.isArray(hand) || hand.some((t) => t >= 27)) return false;
  const c = new Array(27).fill(0);
  for (const t of hand) c[t]++;
  const quads = [];
  for (let i = 0; i < 27; i++) if (c[i] >= 4) quads.push(i);
  for (const t of quads) c[t] -= 4;
  const totalGangs = gangCount + quads.length;
  if (totalGangs < 2) return false;
  let rest = 0;
  for (let i = 0; i < 27; i++) {
    if (c[i] % 2 !== 0) return false;
    rest += c[i];
  }
  return rest >= 4;
}
