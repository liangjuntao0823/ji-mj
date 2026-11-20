# -*- coding: utf-8 -*-
"""把多文件工程打成一个可双击运行的单文件 HTML（内联 CSS / 全部模块 / 牌面 / 头像 / PeerJS）。"""
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "监利红中-横屏版.html"

ORDER = [
    "tileArt.js", "tiles.js", "win.js", "engine.js",
    "bot.js", "version.js", "ui.js", "net.js", "p2p.js", "game.js",
]


def read(p):
    return (ROOT / p).read_text(encoding="utf-8")


def data_uri_img(p, mime="image/jpeg"):
    b = (ROOT / p).read_bytes()
    return "data:%s;base64,%s" % (mime, base64.b64encode(b).decode("ascii"))


css = read("css/ui.css")
peer = read("js/vendor/peerjs.min.js")
html = read("index.html")

mods = {}
for name in ORDER:
    src = read("js/tileArt.base64.js") if name == "tileArt.js" else read("js/" + name)
    mods[name] = src

# 头像换成 data URI，避免单文件还要带 assets 目录
for avatar in sorted((ROOT / "assets/img").glob("avatar-*.jpg")):
    rel = avatar.relative_to(ROOT).as_posix()
    uri = data_uri_img(rel)
    for k in mods:
        mods[k] = mods[k].replace(rel, uri)

json_mods = json.dumps(mods, ensure_ascii=False).replace("</", "<\\/")

loader = r"""
/* 单文件运行器：把内联的模块源码按依赖顺序做成 blob 模块并载入 */
(async function () {
  const files = JSON.parse(document.getElementById('mods').textContent);
  const order = ['tileArt.js','tiles.js','win.js','engine.js','bot.js','version.js','ui.js','net.js','p2p.js','game.js'];
  const url = {};
  for (const name of order) {
    let code = files[name];
    code = code.replace(/(['"])\.\/([\w.\-]+)\1/g, (m, q, dep) => (url[dep] ? q + url[dep] + q : m));
    url[name] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  try {
    await import(url['game.js']);
  } catch (err) {
    console.error(err);
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#04130f;color:#f2e4c0;font:16px/1.8 system-ui,sans-serif;text-align:center;padding:40px';
    box.innerHTML = '游戏脚本未能启动。<br>请用 Chrome / Edge 打开本文件，或改用文件夹版（index.html + server.js）。<br><span style="opacity:.6;font-size:13px">' + String(err && err.message || err) + '</span>';
    document.body.appendChild(box);
  }
})();
""".strip()

html = html.replace(
    '<link rel="stylesheet" href="css/ui.css">',
    "<style>\n%s\n</style>" % css,
)
html = html.replace(
    '<script src="js/vendor/peerjs.min.js"></script>',
    "<script>\n%s\n</script>" % peer,
)
html = html.replace(
    '<script type="module" src="js/game.js"></script>',
    '<script id="mods" type="application/json">%s</script>\n<script>\n%s\n</script>' % (json_mods, loader),
)

OUT.write_text(html, encoding="utf-8")
print("built", OUT, len(html.encode("utf-8")), "bytes")
