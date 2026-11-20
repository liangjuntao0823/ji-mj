/* v1.2.5 专项测试：中发白局末、四张同色油、满天星、30 秒托管。
 * 运行：node tools/test_v125.mjs
 */
import { Engine } from '../js/engine.js';
import { timeoutAction } from '../js/bot.js';
import { Wall, RED_RAW, FA_RAW, BAI_RAW } from '../js/tiles.js';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}${detail ? ' · ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`);
}

function newEngine(rule = {}) {
  return new Engine({ seed: 125, names: ['A', 'B', 'C', 'D'], rule });
}

function finishWithHand(hand, rule = {}) {
  const e = newEngine(rule);
  const s = e.state;
  s.finalMode = true;
  s.phase = 'finalDraw';
  s.current = 0;
  s.finalQueue = [0, 1, 2, 3];
  s.finalIndex = 3;
  s.players[0].hand = hand.slice();
  e.apply({ type: 'finalPass' }, 0);
  return e.state.result;
}

/* 1. 中发白局末各 2 / 各 3 */
{
  const r = finishWithHand([RED_RAW, RED_RAW, FA_RAW, FA_RAW, BAI_RAW, BAI_RAW, 0, 1, 2], { withDragons: true });
  ok('中发白各 2 → 回头笑', r.dragonSets.length === 1 && r.dragonSets[0].kind === 'added' && r.dragonSets[0].base === 5);
  ok('中发白各 2 每家付 5', r.gangSettled.length === 3 && r.gangSettled.every((g) => g.amount === 5 && g.reason === 'dragonAdded'));
}
{
  const r = finishWithHand([RED_RAW, RED_RAW, RED_RAW, FA_RAW, FA_RAW, FA_RAW, BAI_RAW, BAI_RAW, BAI_RAW, 0, 1], { withDragons: true });
  ok('中发白各 3 → 暗杠', r.dragonSets.length === 1 && r.dragonSets[0].kind === 'concealed' && r.dragonSets[0].base === 15);
  ok('中发白各 3 每家付 15', r.gangSettled.length === 3 && r.gangSettled.every((g) => g.amount === 15 && g.reason === 'dragonConcealed'));
}
{
  const r = finishWithHand([RED_RAW, RED_RAW, FA_RAW, FA_RAW, BAI_RAW, BAI_RAW, 0, 1, 2], {});
  ok('红中模式不触发中发白各 2', r.dragonSets.length === 0 && r.gangSettled.length === 0);
}
{
  const r = finishWithHand([RED_RAW, RED_RAW, RED_RAW, RED_RAW, FA_RAW, FA_RAW, BAI_RAW, BAI_RAW, 0], { withDragons: true });
  const labels = r.dragonSets.map((d) => d.kind);
  ok('4 红 + 2 发 + 2 白只算四张红中暗杠', labels.length === 1 && labels[0] === 'quad');
  ok('4 红同色油按暗杠每家付 15', r.gangSettled.length === 3 && r.gangSettled.every((g) => g.reason === 'dragonQuad' && g.amount === 15));
}

/* 2. 台面 4 张同色油：只算一次，按油份子付款；2+2 不误判 */
function buWithHand(hand, withDragons) {
  const e = newEngine({ withDragons });
  const s = e.state;
  s.wall = new Wall(Array.from({ length: 30 }, (_, i) => i % 27), 0, 29);
  s.phase = 'awaitingDiscard';
  s.current = 0;
  s.players[0].hand = hand.slice();
  const out = e.apply({ type: 'bu' }, 0);
  return { e, s, out };
}
{
  const { s, out } = buWithHand([RED_RAW, RED_RAW, RED_RAW, RED_RAW, 0, 1, 2, 3], true);
  ok('台面 4 张红中 → piziGang 只一次', out.filter((x) => x.type === 'piziGang').length === 1);
  ok('台面 4 张红中按油份子付 75', s.gangLedger.length === 3 && s.gangLedger.every((g) => g.reason === 'redGang' && g.amount === 75));
}
{
  const { s, out } = buWithHand([RED_RAW, RED_RAW, FA_RAW, FA_RAW, 0, 1, 2, 3], true);
  ok('2 红 + 2 发不误判为四张同色油', out.filter((x) => x.type === 'piziGang').length === 0 && s.gangLedger.length === 0);
}
{
  const { s, out } = buWithHand([RED_RAW, RED_RAW, RED_RAW, RED_RAW, 0, 1, 2, 3], false);
  ok('红中模式 4 张红中照常暗杠', out.filter((x) => x.type === 'piziGang').length === 1 && s.gangLedger.length === 3);
}

/* 3. 满天星 */
{
  const { s } = buWithHand([...Array(4).fill(RED_RAW), ...Array(4).fill(FA_RAW), ...Array(4).fill(BAI_RAW), 0, 1], true);
  ok('满天星：中发白各 4 张立即胡', s.phase === 'finished' && !!s.result && !!s.result.manTianXing);
  ok('满天星基础倍数 10', s.result && s.result.mult === 10 && s.result.base === 100);
}
{
  const e = newEngine({ withDragons: true });
  const s = e.state;
  s.finalMode = true;
  s.phase = 'finalDraw';
  s.current = 0;
  s.finalQueue = [0, 1, 2, 3];
  s.finalIndex = 0;
  s.lastDrawnAfterGang = true;
  s.players[0].hand = [...Array(4).fill(RED_RAW), ...Array(4).fill(FA_RAW), ...Array(4).fill(BAI_RAW), 0, 1];
  const out = e.apply({ type: 'bu' }, 0);
  const r = s.result || {};
  const names = (r.fans || []).map((f) => f.name);
  ok('满天星可叠加杠上开花', names.includes('杠上开花') && names.includes('满天星'));
  ok('满天星可叠加海底捞月', names.includes('海底捞月'));
  ok('满天星 10 + 0.5 + 0.5 = 11', r.mult === 11 && r.base === 110, `实际 ${r.mult}`);
  ok('满天星立即结束小局', s.phase === 'finished' && out.some((x) => x.type === 'hu'));
}
{
  const r = finishWithHand([RED_RAW, RED_RAW, RED_RAW, FA_RAW, FA_RAW, FA_RAW, BAI_RAW, BAI_RAW, BAI_RAW, 0, 1], { withDragons: true });
  ok('满天星不误伤普通各 3 牌局', !r.manTianXing);
}

/* 4. 30 秒托管动作选择 */
{
  const e = newEngine({ withDragons: true });
  const s = e.state;
  s.phase = 'awaitingDiscard';
  s.current = 0;
  s.players[0].hand = [RED_RAW, 0, 1, 2];
  eq('超时手上有油 → 自动补', timeoutAction(e, 0), { type: 'bu' });
}
{
  const e = newEngine();
  const s = e.state;
  s.phase = 'awaitingDiscard';
  s.current = 0;
  s.lastDrawn = 5;
  s.players[0].hand = [0, 1, 2, 3, 4, 5];
  eq('超时正常摸牌 → 打刚摸的牌', timeoutAction(e, 0), { type: 'discard', tile: 5 });
}
{
  const e = newEngine();
  const s = e.state;
  s.phase = 'awaitingDiscard';
  s.current = 0;
  s.mustDiscard = 0;
  s.lastDrawn = null;
  s.players[0].hand = [0, 1, 2, 3, 4];
  const a = timeoutAction(e, 0);
  ok('碰后超时 → 从手牌随机打一张', a.type === 'discard' && [0, 1, 2, 3, 4].includes(a.tile));
}

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
