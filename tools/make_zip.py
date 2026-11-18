# -*- coding: utf-8 -*-
"""把成品工程打成 zip（排除验证截图）。"""
import zipfile
from pathlib import Path

ROOT = Path(r"C:\Users\梁俊涛\Doubao\chats\2026-11-18\new-chat\监利红中-横屏版")
OUT = Path(r"C:\Users\梁俊涛\Doubao\chats\2026-11-18\new-chat\监利红中-横屏版.zip")
SKIP_DIRS = {"shots", "node_modules", ".git", "__pycache__", "core_extract"}

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if p.is_dir():
            continue
        z.write(p, "监利红中-横屏版/" + str(rel).replace("\\", "/"))

print(OUT, OUT.stat().st_size, "bytes")
