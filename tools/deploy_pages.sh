#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN="${CLOUDFLARE_API_TOKEN:-$(cat "$HOME/.config/cloudflare/jianli-majiang.token")}"
export CLOUDFLARE_API_TOKEN="$TOKEN"
export CLOUDFLARE_ACCOUNT_ID="8b60fc3149eb63e41e897667b5772bd0"
python3 tools/build_single.py
rm -rf /tmp/jianli-pages && mkdir -p /tmp/jianli-pages
cp 监利红中-横屏版.html /tmp/jianli-pages/index.html
# 同域 API 代理：Pages 静态部署必须带 _worker.js，否则 /api/* 会返回 405
cp worker/pages-proxy.js /tmp/jianli-pages/_worker.js
npx --yes wrangler pages deploy /tmp/jianli-pages --project-name=jianli-majiang --branch=main --commit-dirty=true
