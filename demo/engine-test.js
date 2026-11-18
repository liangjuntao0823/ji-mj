/* 引擎自测：纯逻辑，不碰 DOM、不碰 UI。
 * 四个座位全交给机器人，连续跑 20 小局，统计结果类型 / 番型 / 倍数 / 分数守恒。
 * 用来证明剥离 UI 之后规则、流程、结算都在。
 */
import { Engine } from '../js/engine.js';
import { nextAction } from '../js/bot.js';
import { label } from '../js/tiles.js';

const out = [];
const stat = {
  hands: 0, huSelf: 0, drawn: 0,
  fanNames: {}, peng: 0, gang: 0, reds: 0, gangSettled: 0,
  errors: [], totalScoreOk: true,
};

function runHand(seed, dealer, roundIndex) {
  const e = new Engine({ seed, names: ['A', 'B', 'C', 'D'], botSeats: [0, 1, 2, 3], dealer, roundIndex });
  e.startHand();
  let steps = 0;
  while (e.state.phase !== 'finished' && steps < 4000) {
    steps++;
    const s = e.state;
    if (s.phase === 'awaitingClaim' && s.pending) {
      const seat = s.pending.outstanding[0];
      if (seat === undefined) { e.apply({ type: 'pass' }, 0); continue; }
      const a = nextAction(e, seat) || { type: 'pass' };
      try { e.apply(a, seat); } catch (err) { try { e.apply({ type: 'pass' }, seat); } catch (e2) {} }
    } else if (s.phase === 'awaitingDiscard') {
      const seat = s.current;
      const a = nextAction(e, seat);
      try {
        e.apply(a || { type: 'discard', tile: s.players[seat].hand[0] }, seat);
      } catch (err) {
        try { e.apply({ type: 'discard', tile: s.players[seat].hand[0] }, seat); }
        catch (e2) { stat.errors.push(`第${roundIndex}局 座位${seat} 出牌失败 ${e2.message}`); break; }
      }
    } else break;
  }
  return { e, steps };
}

for (let i = 0; i < 20; i++) {
  const dealer = i % 4;
  const { e, steps } = runHand(1000 + i, dealer, i + 1);
  const s = e.state;
  stat.hands++;
  if (s.drawnGame) stat.drawn++;
  if (s.result && s.result.winner !== undefined && s.result.winner !== null) {
    stat.huSelf++;
    const name = s.result.fanName || '未知';
    stat.fanNames[name] = (stat.fanNames[name] || 0) + 1;
    out.push(`第 ${i + 1} 局：${['东', '南', '西', '北'][s.result.winner]}家 自摸　${name} ${s.result.mult} 倍　基础 ${s.result.base}　分数 ${s.result.scores.join(' / ')}　步数 ${steps}`);
    if (s.result.gangSettled && s.result.gangSettled.length) stat.gangSettled++;
  } else {
    out.push(`第 ${i + 1} 局：流局　分数 ${s.players.map((p) => p.score).join(' / ')}　步数 ${steps}`);
  }
  for (const p of s.players) {
    for (const m of p.melds) {
      if (m.kind === 'peng') stat.peng++;
      else stat.gang++;
    }
    stat.reds += p.redsPlayed;
  }
  const sum = s.players.reduce((a, p) => a + p.score, 0);
  if (sum !== 0) { stat.totalScoreOk = false; out.push(`  ✗ 分数不守恒：合计 ${sum}`); }
}

const summary = [
  `小局数 ${stat.hands}　自摸胡 ${stat.huSelf}　流局 ${stat.drawn}`,
  `碰 ${stat.peng} 次　杠 ${stat.gang} 次　红中打出 ${stat.reds} 张　带杠结算的局 ${stat.gangSettled}`,
  `番型分布：${Object.entries(stat.fanNames).map(([k, v]) => `${k}×${v}`).join('、') || '无'}`,
  `分数守恒（每家合计=0）：${stat.totalScoreOk ? '✓ 通过' : '✗ 不通过'}`,
  `异常：${stat.errors.length ? stat.errors.join('；') : '无'}`,
];
console.log(summary.join('\n'));
for (const l of out) console.log(l);

window.__TEST_RESULT = { ok: stat.errors.length === 0 && stat.totalScoreOk, summary, detail: out };
document.getElementById('out').textContent = summary.join('\n') + '\n\n' + out.join('\n');
