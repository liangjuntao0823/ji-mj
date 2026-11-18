# UI 接口契约（设计师必读）

逻辑层只认下面这些东西。**函数名、参数顺序不能改**；函数内部怎么做界面随你。

---

## 1. 必须实现的 15 个函数（都在 `js/ui.js`）

| 函数 | 逻辑层什么时候调 | 你要做什么 |
|---|---|---|
| `initTable(opts)` | 每次开局/进入牌桌 | 保存 `opts` 到导出的 `G`（`Object.assign(G, opts)`）；切到牌桌界面；重置选中态、计时条 |
| `renderAll()` | 任何状态变化后（每张牌、每次碰杠胡） | 读 `G.getState()`，把整个牌桌重画一遍：手牌、四家牌河、四家副露、余牌数、局数、庄家、当前出牌人、按钮（碰/杠/胡/过/报听） |
| `updateTimer(ratio, totalSeconds)` | 每 100ms 一次（30 秒倒计时） | `ratio` 从 1 → 0，画计时条/数字。`ratio` 为 0 时逻辑层会自动替你操作 |
| `showToast(text, cls, ms)` | 提示信息（碰了、杠了、报听等） | 顶部/中间弹一条字，`ms` 毫秒后自己消失 |
| `clearToast()` | 状态切换 | 清掉提示 |
| `showResult(payload)` | 一局结束（胡牌或流局）、整场结束 | 画结算面板。见第 5 节字段 |
| `hideResult()` | 点「下一局」时 | 关掉结算面板 |
| `updateReadyBar(ready, names, mySeat, rebuild)` | 联机：准备状态变化 | 画准备/等待条，`ready` 是已准备人数（0-4） |
| `setRoomCode(code)` | 联机：建房成功/加入房间 | 显示房号，`code` 为空表示隐藏 |
| `showBoard()` / `hideBoard()` | 联机：有人掉线、整场结束 | 打开/关闭记分板（四家总分） |
| `setPaused(names, waiting)` | 联机：有人掉线 | 屏幕中间弹浮窗「XX 掉线，等待重连」，`names` 是掉线的名字数组 |
| `backToHome()` | 退出牌桌 | 回首页 |
| `resetEventState()` | 每次开局 | 清掉上一次的语音/动画状态标记 |
| `initHome()` | 模块加载时 | 首页初始化（`game.js` 顶部会直接调用它，所以 UI 必须在模块加载时就可用） |
| `toggleFullscreen()` / `applyLayoutUnits()` / `bindLayout()` / `voiceOn()` / `setVoice(on)` / `boardVisible()` / `toggleBoard()` / `renderScoreboard()` | 全屏按钮、语音开关、记分板 | 这些是纯界面功能，逻辑层不依赖结果，可以简化但**别删**（`game.js` 会 import 其中一部分） |

> 最短可行做法：先把 `renderAll()` 做成「把状态 JSON 打印到页面」，其余函数留空。这样就能开局、能出牌、能走完 8 局——之后再把打印换成真界面，一个函数一个函数替换。

### 导出的会话对象 `G`

```js
export const G = {
  getState:        () => engine.state,  // 引擎状态（读它渲染）
  humanSeat:       0,                   // 我是几号位
  selected:        null,                // 我当前选中的牌（UI 自己用）
  onDiscard:       (tile) => {},        // 出牌：tile 是牌的 raw 数字
  onAct:           (action) => {},      // 碰/杠/胡/过/报听
  onNext:          () => {},            // 点「下一局」
  onExit:          () => {},            // 点「退出」
  getMyActions:    () => [],            // 我当前能做的动作列表
  getPendingOptions: () => null,        // 别人打牌后我能应答的选项
  getDeclareOptions: () => [],          // 我能报听的选项
  canNewMatch:     () => false,         // 能否开新一轮（8 局打满）
  newMatchClicks:  () => 0,             // 已有几人点了「开始新一轮」
  onNewMatch:      () => {},            // 点「开始新一轮对局」
  mode: 'single',                       // single / lan / p2p
  totalRounds: 8,
  seatNames: ['涛','老李','小美','阿强'],
  voicePrimed: false,
};
```

**所有交互都只能通过 `G.onDiscard` / `G.onAct` 提交**，不要直接改 `engine.state`（会被引擎判为非法并抛错）。

---

## 2. 引擎状态 `state`（`renderAll` 全靠它）

| 字段 | 类型 | 含义 |
|---|---|---|
| `players[]` | 4 个 | 见下表 |
| `dealer` | 0-3 | 庄家座位 |
| `current` | 0-3 | 当前该谁操作 |
| `phase` | 字符串 | `idle` 未开局 / `awaitingDiscard` 该出牌 / `awaitingClaim` 等别人碰杠胡应答 / `finished` 本局结束 |
| `wall.remaining` | 数字 | 牌墙剩余张数（顶「余 X 张」） |
| `pending` | 对象/null | `{ tile, from, outstanding:[座位], options:{座位:[…]} }` 当前应答窗口 |
| `lastDrawn` | 数字/null | 刚摸进来的牌（要单独高亮/拉开） |
| `lastDrawnFromTail` | bool | 是否从尾牌摸（杠后补牌） |
| `winner` | 0-3/null | 本局胡牌者 |
| `drawnGame` | bool | 本局是否流局 |
| `result` | 对象/null | 结算数据，见第 5 节 |
| `mustDiscard` | 0-3/null | 碰完之后必须先打牌的人（自己不允许立刻胡） |
| `drawCount` | 数字 | 本局已摸牌次数（天胡/地胡用） |
| `lastDrawnAfterGang` | bool | 这张是不是杠后补的（杠上开花） |
| `lastDiscard` | `{seat,tile}` | 全场最后打出的那张（高亮标记是谁打的什么牌） |
| `gangLedger[]` | 数组 | 本局待结算的杠分（局末统一加减） |
| `seed` / `roundIndex` | 数字 | 种子 / 第几局 |

`players[i]`：

| 字段 | 含义 |
|---|---|
| `seat` / `name` / `isBot` | 座位 / 名字 / 是否机器人 |
| `hand[]` | 手牌 raw 数组（**已排序**，含刚摸的牌） |
| `river[]` | 牌河（打出去的牌，raw 数组，不含红中） |
| `melds[]` | 副露：`{ kind:'peng'|'gangExposed'|'gangConcealed'|'gangAdded', tile, from }` |
| `redsPlayed` | 已打出的红中数（决定份子倍数） |
| `score` | 累计总分 |
| `singleLocked` | 单钓已锁定的牌（非 null 时只能打这张） |
| `declared` / `declareIntent` | 已报听 / 正在报听 |

**牌的编码（raw）**：`0-8` 万 1-9，`9-17` 筒 1-9，`18-26` 条 1-9，`27` 红中。共 112 张。

**显示顺序**：`hand` 已是排好序的数组，直接按顺序铺即可（同类按 raw 升序）。

---

## 3. 我这边能做什么（按钮从哪来）

`G.getMyActions()` 返回字符串数组，取值：

| 值 | 含义 | 提交方式 |
|---|---|---|
| `'hu'` | 可以自摸胡 | `G.onAct({type:'hu'})` |
| `'peng'` | 可以碰 | `G.onAct({type:'peng'})` |
| `'gang'` | 可以明杠 | `G.onAct({type:'gangExposed'})` |
| `'pass'` | 可以过 | `G.onAct({type:'pass'})` |

出牌：`G.onDiscard(tile)`。
报听：`G.getDeclareOptions()` 有值就显示「报听」，`G.onAct({type:'declare'})`；取消报听 `G.onAct({type:'cancelDeclare'})`（等价于不打这张）。
暗杠 / 回头笑：`G.onAct({type:'gangConcealed', tile})` / `G.onAct({type:'gangAdded', tile})`，`tile` 从 `getMyActions()` 关联的选项里取（引擎会校验手里有没有 4 张）。

**别人打牌后**：`phase === 'awaitingClaim'` 且 `G.getPendingOptions()` 有值时，说明轮到我应答，显示「碰/杠/胡/过」按钮。

---

## 4. 事件（可选，不想用 `renderAll` 主动拉状态的话可以监听）

引擎 `apply()` 返回的事件数组，UI 层不需要自己订阅（`renderAll` 足够）。如果要做动画/语音，事件类型是：

`handStarted` 开局 · `turn` 轮到谁（含摸到的牌）· `discarded` 打出一张 · `claimWindow` 开应答窗口 · `peng` 碰 · `gang` 明杠 · `gangConcealed` 暗杠 · `gangAdded` 回头笑 · `hu` 胡牌 · `redDiscarded` 摸到红中直接打 · `wallRemaining` 余牌变化 · `score` 杠分记账 · `declareIntent` 报听 · `drawnGame` 流局。

`js/ui.js` 占位版还会在 `window` 上派发同名事件：`jianli:initTable` / `jianli:render` / `jianli:timer` / `jianli:toast` / `jianli:result` / `jianli:ready` / `jianli:roomcode` / `jianli:scoreboard` / `jianli:paused`，`detail` 里带数据，方便先做无 UI 调试。

---

## 5. 结算面板要显示的字段（`showResult(payload)`）

| 字段 | 说明 |
|---|---|
| `winner` | 胡牌座位（0-3） |
| `hand[]` / `melds[]` | 赢家手牌和副露，要摆出来 |
| `fans[]` | 番型明细 `[{name, mult}]`，例如 `屁胡1 + 清一色4` |
| `fanName` / `mult` / `base` | 主番型名 / 总倍数 / 基础分（`base = 10 × mult`，四舍五入） |
| `payments{座位:金额}` | 三家各付多少（已乘红中份子） |
| `scores[]` | 结算后四家总分 |
| `gangSettled[]` | 本局结算的杠分记录 |
| `winnerReds` | 赢家打出的红中数 |
| `roundIndex` | 第几局 |
| `final: true` | **整场结束**（8 局打满）。此时要给排名表 `ranked[{seat,name,score}]` 和两个按钮：「再来一场」→ `JianliGame.startSingle()`；「回首页」→ 首页 |

流局时 `payload` 只有 `{ gangSettled }`，`state.drawnGame === true`，也要弹结算（提示「流局，杠分已结算」）。

---

## 6. 联机模式（局域网 / 手机 P2P）

联机代码已完整随包（`net.js` 房主权威 + SSE，`p2p.js` WebRTC + 断线重连），UI 只需要提供这些元素：

| 元素 id | 用途 |
|---|---|
| `lobby` | 联机房间面板容器 |
| `lobby-name` | 名字输入框（**必填**，用于重连认人） |
| `lobby-name-row` | 名字输入行 |
| `lobby-join` | 加入房间按钮 |
| `lobby-status` | 状态文字（等待/已开始/掉线） |
| `lobby-seats` | 四个座位列表（显示谁在、谁准备） |
| `lobby-actions` | 准备/开始按钮区 |
| `lobby-back` | 返回 |
| `result` / `result-card` | 结算面板容器（占位版已改成 `showResult` 数据，容器可自定） |

无服务器（纯静态、手机本地打开）自动走 `openP2P()` 建房；有 `/api/room` 后端时走 `openLAN()`。这部分已内置于 `btn-lan` 逻辑，也可以由 UI 直接调 `JianliGame.openLAN()` / `JianliGame.openP2P()`。

---

## 7. 三个入口

```js
window.JianliGame = {
  startSingle(),                             // 单机：我 + 3 个机器人，8 局
  attachEngine(engine, humanSeat, mode, names, rounds),  // 联机/自定义：接管一个已有引擎
  openLAN(),                                 // 局域网联机
  openP2P(),                                 // 手机 P2P 建房
  S,                                         // 对局控制内部状态（一般不用碰）
};
```

---

## 8. 别做的事

- 不要直接改 `engine.state.players[i].hand` 之类，界面只能读。改动一律走 `G.onDiscard` / `G.onAct`。
- 不要自己算番算分，`engine.judgeFans` 和 `engine.amount` 是唯一口径。
- 不要改 `engine.rule`（默认规则见 RULES.md 第 10 节），要改规则得同步 iOS 版。
- 不要删 `js/ui.js` 里任何导出函数名，`game.js` / `net.js` / `p2p.js` 都 import 它们。
