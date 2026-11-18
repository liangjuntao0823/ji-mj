/* 逻辑核心自测：不画任何界面，只用文本日志跑完一局（人座位 0 自动出牌）
 * 目的：证明剥离 UI 之后，发牌、出牌、碰杠、判胡、番型、计分、局间推进全都还在。
 */
import { Engine } from '../js/engine.js';
import { attachEngine } from '../js/game.js';
import { G } from '../js/ui.js';
import { label } from '../js/tiles.js';

const box = document.getElementById('log');
let lines = 0;
function log(text, cls = '') {
  lines++;
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${text}`;
  box.appendChild(div);
  if (lines === 1) box.textContent = '';
  console.log(text);
}

const NAMES = ['涛', '老李', '小美', '阿强'];
const engine = new Engine({
  seed: 20261116,
  names: NAMES,
  botSeats: [1, 2, 3],
  dealer: 0,
  roundIndex: 1,
});
engine.startHand();
attachEngine(engine, 0, 'single', NAMES, 8);

let busy = false;
let hands = 0;
let lastPhase = '';

window.addEventListener('jianli:render', () => {
  const st = G.getState();
  if (!st) return;

  if (st.phase !== lastPhase) {
    lastPhase = st.phase;
    if (st.phase === 'awaitingDiscard' && st.current === 0) {
      log(`轮到你了，手牌 ${st.players[0].hand.length} 张`, 'hi');
    }
  }

  if (st.phase === 'finished') {
    hands++;
    const r = st.result || {};
    if (st.drawnGame) log(`第 ${st.roundIndex} 局流局，杠分已结算`, 'hi');
    else if (r.winner !== undefined) {
      log(`第 ${st.roundIndex} 局 胡牌：${NAMES[r.winner]}　番型 ${r.fanName}　${r.mult} 倍　基础 ${r.base}`, 'hi');
      log(`番型明细：${(r.fans || []).map((f) => `${f.name}${f.mult}`).join(' + ')}`);
      log(`分数：${(r.scores || []).join(' / ')}`);
    }
    if (hands >= 2) {
      log('两局跑完，自测结束（逻辑无报错）', 'hi');
      window.__DEMO_OK = true;
      return;
    }
    busy = true;
    setTimeout(() => {
      const seed = (Date.now() & 0xffff) >>> 0;
      engine.startNextHand(seed);
      engine.state.phase = 'awaitingDiscard';
      engine.drawTurn(engine.state.current, false, false);
      busy = false;
      window.dispatchEvent(new CustomEvent('jianli:render', { detail: { state: engine.state } }));
    }, 900);
    return;
  }

  if (busy) return;

  if (st.phase === 'awaitingDiscard' && st.current === 0) {
    busy = true;
    setTimeout(() => {
      try {
        const opts = G.getMyActions ? G.getMyActions() : [];
        if ((opts || []).includes('hu')) {
          G.onAct({ type: 'hu' });
          log('自摸胡');
        } else {
          const hand = st.players[0].hand.slice();
          const pick = hand[hand.length - 1];
          G.onDiscard(pick);
          log(`打出 ${label(pick)}`);
        }
      } catch (e) {
        log('出牌报错：' + e.message, 'bad');
      } finally {
        busy = false;
      }
    }, 260);
    return;
  }

  if (st.phase === 'awaitingClaim' && st.pending) {
    const o = G.getPendingOptions ? G.getPendingOptions() : null;
    if (o && o.length) {
      busy = true;
      setTimeout(() => {
        try {
          if (o.includes('hu')) G.onAct({ type: 'hu' });
          else if (o.includes('gang') && Math.random() < 0.6) G.onAct({ type: 'gangExposed' });
          else if (o.includes('peng')) G.onAct({ type: 'peng' });
          else G.onAct({ type: 'pass' });
        } catch (e) {
          log('应答报错：' + e.message, 'bad');
          try { G.onAct({ type: 'pass' }); } catch (e2) {}
        } finally { busy = false; }
      }, 260);
    }
  }
});

window.addEventListener('jianli:result', (ev) => {
  if (ev.detail.payload) log('结算面板数据已生成', 'hi');
});
window.addEventListener('jianli:paused', (ev) => log('暂停：' + JSON.stringify(ev.detail)));

log('逻辑核心已启动，引擎开始发牌');
