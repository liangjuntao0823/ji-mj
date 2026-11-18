import base64
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

OWNER = "liangjuntao0823"
REPO = "ji-mj"
HTML = Path(__file__).resolve().parent.parent / "监利红中-横屏版.html"
TOKEN = os.environ["GITHUB_TOKEN"]


def api(method, path, body=None):
    req = urllib.request.Request(
        "https://api.github.com" + path,
        method=method,
        headers={
            "Authorization": "Bearer " + TOKEN,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "jianli-majiang-release",
            "Content-Type": "application/json",
        },
        data=None if body is None else json.dumps(body).encode("utf-8"),
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        return e.code, text


status, ref = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/main")
if status != 200:
    raise SystemExit(f"get main failed: {status} {ref}")
main_sha = ref["object"]["sha"]

status, out = api("POST", f"/repos/{OWNER}/{REPO}/git/refs", {
    "ref": "refs/heads/gh-pages",
    "sha": main_sha,
})
if status not in (200, 201):
    print("branch create:", status, out)
    status2, ref2 = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/gh-pages")
    if status2 != 200:
        raise SystemExit("cannot create or read gh-pages")
else:
    print("branch created:", out.get("ref"))

content = base64.b64encode(HTML.read_bytes()).decode("ascii")
status, current = api("GET", f"/repos/{OWNER}/{REPO}/contents/index.html?ref=gh-pages")
sha = current.get("sha") if status == 200 and isinstance(current, dict) else None
payload = {
    "message": "release: v1.0.3 playable html (mirror)",
    "content": content,
    "branch": "gh-pages",
}
if sha:
    payload["sha"] = sha
status, out = api("PUT", f"/repos/{OWNER}/{REPO}/contents/index.html", payload)
print("file:", status, out if status >= 400 else "ok")


status, out = api("POST", f"/repos/{OWNER}/{REPO}/pages", {
    "source": {"branch": "gh-pages", "path": "/"},
})
if status in (200, 201):
    print("pages:", json.dumps(out, ensure_ascii=False))
elif status == 409:
    s, out = api("GET", f"/repos/{OWNER}/{REPO}/pages")
    print("pages existing:", s, json.dumps(out, ensure_ascii=False))
else:
    print("pages:", status, out)
