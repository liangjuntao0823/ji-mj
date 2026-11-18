/* 牌面图索引（默认版：引用 assets/tiles/ 下的 28 张 PNG）
 *
 * keys 与 tiles.js 的 tileImage(raw) 一一对应：
 *   Man1-9 = 万 一~九 ｜ Pin1-9 = 筒 一~九 ｜ Sou1-9 = 条 一~九 ｜ Chun = 红中
 * 路径用 import.meta.url 解析，和 HTML 放哪一层无关，换目录也不会断图。
 *
 * 要打成单文件 HTML（不能有外部请求）时，把 import 换成同目录的 tileArt.base64.js。
 */
const base = new URL('../assets/tiles/', import.meta.url);
const map = {};
for (const s of ['Man', 'Pin', 'Sou']) {
  for (let i = 1; i <= 9; i++) map[s + i] = new URL(`${s}${i}.png`, base).href;
}
map.Chun = new URL('Chun.png', base).href;

export const TILE_SRC = map;
