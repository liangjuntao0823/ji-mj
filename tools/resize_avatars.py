# -*- coding: utf-8 -*-
"""把生成的头像压缩到游戏 HUD 需要的尺寸（240x240，JPEG q86）。"""
from PIL import Image
import os

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'img')
NAMES = ['avatar-tao.png', 'avatar-li.png', 'avatar-mei.png', 'avatar-qiang.png']

for n in NAMES:
    src = os.path.join(BASE, n)
    im = Image.open(src).convert('RGB')
    im = im.resize((240, 240), Image.LANCZOS)
    out = src.replace('.png', '.jpg')
    im.save(out, 'JPEG', quality=86, optimize=True, progressive=True)
    print(n, '->', os.path.basename(out), os.path.getsize(out) // 1024, 'KB')
