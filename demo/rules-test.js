/* 番型逐项断言：直接调 judgeFans，把“每个番型能不能算、算多少倍”钉死。
 * 这是给验收看的硬证据：规则一个都没丢。
 */
import { judgeFans } from '../js/engine.js';

const cases = [];
function T(name, expect, input, expectNames) {
  const got = judgeFans({
    hand: [], melds: [], lastDrawn: null, wallRemaining: 40,
    afterGang: false, drawCount: 6, dealer: 1, seat: 0, declared: false,
    ...input,
  });
  const ok = got.mult === expect && (!expectNames || expectNames.every((n) => got.fans.some((f) => f.name === n)));
  cases.push({ name, expect, got: got.mult, fans: got.fans.map((f) => `${f.name}${f.mult}`).join('+'), ok });
}

/* 0-8 万，9-17 筒，18-26 条，27 红中
 * 手牌故意跨花色，避免误触“清一色”；不碰的牌型会出现“清摸球 +0.5”，期望值按代码口径写。 */
const MI = [0, 1, 2, 9, 10, 11, 18, 19, 20, 0, 1, 2, 3, 3];   /* 混花色 14 张，普通胡型 */
T('屁胡 1 倍（碰过一张，无清摸球）', 1, { hand: [0, 1, 2, 10, 11, 12, 18, 19, 20, 3, 4], melds: [{ kind: 'peng', tile: 9 }], drawCount: 6 });
T('屁胡 + 清摸球 1.5 倍', 1.5, { hand: MI, melds: [], drawCount: 6 });
T('七对 4 倍', 4, { hand: [0, 0, 1, 1, 9, 9, 10, 10, 18, 18, 19, 19, 20, 20], melds: [], drawCount: 6 });
T('豪华七对 8 倍', 8, { hand: [0, 0, 0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 18, 18], melds: [], drawCount: 6 });
T('对子胡 3 倍 + 清摸球 3.5', 3.5, { hand: [0, 0, 0, 9, 9, 9, 18, 18, 18, 1, 1, 1, 2, 2], melds: [], drawCount: 6 });
T('清一色 4 倍（屁胡不记）+ 清摸球 4.5', 4.5, { hand: [0, 1, 2, 0, 1, 2, 3, 4, 5, 3, 4, 5, 6, 7], melds: [], drawCount: 6, seat: 2, dealer: 3 });
T('清一色 + 对子胡 + 清摸球 7.5', 7.5, { hand: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4], melds: [], drawCount: 6 });
T('明活带 3 + 清一色 4 = 7', 7, { hand: [0, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4], melds: [{ kind: 'peng', tile: 0 }], drawCount: 7 }, ['明活带', '清一色']);
T('只是碰过 + 清一色 = 4（屁胡底不记）', 4, { hand: [1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5], melds: [{ kind: 'peng', tile: 0 }], drawCount: 7 }, ['清一色']);
T('裸奔 7 倍（+清一色 11）', 11, { hand: [6, 6], melds: [{ kind: 'peng', tile: 0 }, { kind: 'peng', tile: 1 }, { kind: 'peng', tile: 2 }, { kind: 'peng', tile: 3 }], drawCount: 8 });
T('裸奔 7 倍（3 副露含杠 + 单钓）', 7, { hand: [9, 9], melds: [{ kind: 'peng', tile: 0 }, { kind: 'peng', tile: 1 }, { kind: 'gangAdded', tile: 2 }, { kind: 'gangExposed', tile: 3 }], drawCount: 8 });
T('十八罗汉 10 倍（+清一色 14）', 14, { hand: [6, 6], melds: [{ kind: 'gangConcealed', tile: 0 }, { kind: 'gangExposed', tile: 1 }, { kind: 'gangAdded', tile: 2 }, { kind: 'gangConcealed', tile: 3 }], drawCount: 8 });
T('明活带 3 倍（碰过的牌又摸回来）', 3, { hand: [5, 9, 9, 9, 18, 18, 18, 0, 0, 1, 2], melds: [{ kind: 'peng', tile: 5 }], drawCount: 6 }, ['明活带']);
T('天胡 +5（屁胡不记）', 5, { hand: MI, melds: [], drawCount: 1, dealer: 0, seat: 0 }, ['天胡']);
T('地胡 +5', 5, { hand: MI, melds: [], drawCount: 1, dealer: 0, seat: 1 }, ['地胡']);
T('报听 +3（屁胡不记）', 3, { hand: MI, melds: [], drawCount: 6, declared: true }, ['报听']);
T('杠上开花 +0.5（合计 2）', 2, { hand: MI, melds: [], drawCount: 6, afterGang: true }, ['杠上开花']);
T('海底捞月 +0.5（合计 2）', 2, { hand: MI, melds: [], drawCount: 6, wallRemaining: 0 }, ['海底捞月']);
T('三加番叠加 2.5', 2.5, { hand: MI, melds: [], drawCount: 6, afterGang: true, wallRemaining: 0 }, ['杠上开花', '海底捞月']);

const pass = cases.filter((c) => c.ok).length;
const summary = `番型断言 ${pass}/${cases.length} 通过`;
console.log(summary);
for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.name} → 实际 ${c.got}（${c.fans || '无番'}）`);
window.__RULES_RESULT = { ok: pass === cases.length, summary, cases };
document.getElementById('out').textContent = summary + '\n\n' + cases.map((c) => `${c.ok ? '✓' : '✗'} ${c.name} → 实际 ${c.got}（${c.fans || '无番'}）`).join('\n');
