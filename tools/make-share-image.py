#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/make-share-image.py -- 生成社交分享卡片图（og:image）

为什么手写 PNG 编码器：
  这台机器没有 Pillow，也没有 cairosvg，且离线装不了。
  PNG 本身只是「zlib 压缩的扫描行 + 每行一个过滤字节」，标准库的 zlib 就够，
  所以这里不依赖任何第三方包。

画的是什么：
  一个五线谱系统（真实的五条线、谱号、按音高排的符头与符干），
  取站点的暖色纸底与墨色，右下角一条主色竖线。
  **不画中文**：没有可用的字体渲染库，用矩形拼汉字只会得到一坨噪声，
  所以只画几何图形，文字交给平台自己显示（og:title）。

输出：1200x630 的 PNG，正好是社交卡片的推荐尺寸。

用法：python tools/make-share-image.py
"""

import json
import math
import struct
import zlib
import os
import sys

W, H = 1200, 630
SS = 3                      # 超采样倍率（3x 之后再缩，边缘才不锯齿）
CW, CH = W * SS, H * SS

# 站点配色（与 assets/css/site.css 的 :root 一致）
BG      = (250, 248, 244)   # --bg        #faf8f4
INK     = (28, 27, 25)      # --ink       #1c1b19
INK2    = (85, 82, 76)      # --ink-2     #55524c
LINE    = (228, 223, 212)   # --line      #e4dfd4
ACCENT  = (163, 64, 31)     # --accent    #a3401f
PANEL   = (255, 255, 255)   # --panel     #ffffff


class Canvas:
    """RGB 画布，带距离场抗锯齿的图元。坐标是超采样空间的浮点数。"""

    def __init__(self, w, h, bg):
        self.w, self.h = w, h
        self.px = bytearray(bg * (w * h))

    def _blend(self, x, y, c, a):
        if a <= 0 or x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        i = (y * self.w + x) * 3
        if a >= 1:
            self.px[i], self.px[i + 1], self.px[i + 2] = c
            return
        inv = 1.0 - a
        self.px[i]     = int(self.px[i] * inv + c[0] * a)
        self.px[i + 1] = int(self.px[i + 1] * inv + c[1] * a)
        self.px[i + 2] = int(self.px[i + 2] * inv + c[2] * a)

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(math.floor(y0)), int(math.ceil(y1))):
            for x in range(int(math.floor(x0)), int(math.ceil(x1))):
                self._blend(x, y, c, 1.0)

    def disc(self, cx, cy, r, c, squash=1.0):
        """圆/椭圆；squash<1 得到扁的符头"""
        x0, x1 = int(cx - r - 2), int(cx + r + 2)
        yy0, yy1 = int(cy - r / squash - 2), int(cy + r / squash + 2)
        for y in range(yy0, yy1):
            for x in range(x0, x1):
                dx = (x + 0.5 - cx)
                dy = (y + 0.5 - cy) * squash
                d = math.hypot(dx, dy) - r
                if d <= 0:
                    self._blend(x, y, c, 1.0)

    def line(self, x0, y0, x1, y1, c, w):
        """粗线段（带圆头），用点线距离算覆盖率"""
        hw = w / 2.0
        x0, y0, x1, y1 = float(x0), float(y0), float(x1), float(y1)
        vx, vy = x1 - x0, y1 - y0
        L2 = vx * vx + vy * vy
        for y in range(int(min(y0, y1) - hw - 2), int(max(y0, y1) + hw + 2)):
            for x in range(int(min(x0, x1) - hw - 2), int(max(x0, x1) + hw + 2)):
                px, py = x + 0.5, y + 0.5
                if L2 <= 0:
                    t = 0.0
                else:
                    t = max(0.0, min(1.0, ((px - x0) * vx + (py - y0) * vy) / L2))
                d = math.hypot(px - (x0 + t * vx), py - (y0 + t * vy)) - hw
                if d <= 0:
                    self._blend(x, y, c, 1.0)

    def taper(self, pts, c, w_start, w_end):
        """变宽曲线：折线逐段绘制，线宽从 w_start 线性变到 w_end。
        高音谱号的螺旋是越往中心越细，用等宽线画会糊成一团。"""
        n = len(pts) - 1
        if n <= 0:
            return
        for i in range(n):
            t = i / float(n)
            w = w_start + (w_end - w_start) * t
            self.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, w)

    def fill_polygons(self, polys, c):
        """按【奇偶规则】扫描线填充一组多边形。
        谱号这种字形是轮廓套轮廓（笔画 + 内部空白），必须用奇偶规则，
        否则实心一片、中间的孔没了。多边形必须是闭合的（首尾点相同）。"""
        if not polys:
            return
        ys = [p[1] for poly in polys for p in poly]
        y0, y1 = int(math.floor(min(ys))), int(math.ceil(max(ys)))
        for y in range(y0, y1 + 1):
            sy = y + 0.5
            xs = []
            for poly in polys:
                n = len(poly)
                for i in range(n):
                    ax, ay = poly[i]
                    bx, by = poly[(i + 1) % n]
                    if ay == by:
                        continue
                    lo, hi = (ay, by) if ay < by else (by, ay)
                    if lo <= sy < hi:
                        t = (sy - ay) / (by - ay)
                        xs.append(ax + t * (bx - ax))
            if not xs:
                continue
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                a, b = xs[i], xs[i + 1]
                if b - a < 0.5:
                    continue
                for x in range(int(math.floor(a)), int(math.ceil(b))):
                    cov = min(b, x + 1.0) - max(a, float(x))
                    if cov <= 0:
                        continue
                    self._blend(x, y, c, min(1.0, cov))

    def circle_outline(self, cx, cy, r, c, w):
        hw = w / 2.0
        for y in range(int(cy - r - hw - 2), int(cy + r + hw + 2)):
            for x in range(int(cx - r - hw - 2), int(cx + r + hw + 2)):
                d = abs(math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r) - hw
                if d <= 0:
                    self._blend(x, y, c, 1.0)

    def downscale(self, factor):
        """box filter 缩小，得到抗锯齿结果"""
        ow, oh = self.w // factor, self.h // factor
        out = bytearray(ow * oh * 3)
        n = factor * factor
        for oy in range(oh):
            for ox in range(ow):
                r = g = b = 0
                for dy in range(factor):
                    base = ((oy * factor + dy) * self.w + ox * factor) * 3
                    for dx in range(factor):
                        i = base + dx * 3
                        r += self.px[i]; g += self.px[i + 1]; b += self.px[i + 2]
                o = (oy * ow + ox) * 3
                out[o] = r // n; out[o + 1] = g // n; out[o + 2] = b // n
        return ow, oh, out


def parse_clef_from_svg(svg_path, steps=12):
    """从 MuseScore 导出的 SVG 里直接抽出高音谱号的闭合轮廓。

    为什么不去手写谱号曲线：那样试了三版都不像（等宽圆环糊成一团、
    参数化螺旋摆不对位置）。而真实谱面的 SVG 里本来就有
    <path class="Clef"> 的真轮廓，直接解析最省事也最准。

    只实现 MuseScore 实际用到的命令：M/m L/l H/h V/v C/c S/s Z。
    三次贝塞尔按固定步数打散成折线（字形缩到 120px 高，12 段足够）。
    """
    import re
    with open(svg_path, 'r', encoding='utf-8') as f:
        svg = f.read()
    ds = re.findall(r'<path\s+class="Clef"[^>]*\sd="([^"]+)"', svg)
    if not ds:
        raise ValueError('在 %s 里没找到 class="Clef" 的 path' % svg_path)

    num_re = re.compile(r'[MmLlHhVvCcSsZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?')

    def flatten(d):
        toks = num_re.findall(d)
        polys, cur = [], None
        x = y = sx = sy = 0.0
        prev = None
        cmd = None
        i = 0

        def push(p):
            if cur is not None:
                cur.append(p)

        while i < len(toks):
            t = toks[i]
            if t.isalpha():
                cmd = t
                i += 1
            elif cmd is None:
                i += 1
                continue
            elif cmd == 'M':
                cmd = 'L'
            elif cmd == 'm':
                cmd = 'l'

            rel = cmd.islower()
            C = cmd.upper()

            def take(n):
                nonlocal i
                vals = [float(v) for v in toks[i:i + n]]
                i += n
                return vals

            if C == 'M':
                a, b = take(2)
                x = x + a if rel else a
                y = y + b if rel else b
                sx, sy = x, y
                cur = []
                polys.append(cur)
                push((x, y))
                prev = None
            elif C == 'L':
                a, b = take(2)
                x = x + a if rel else a
                y = y + b if rel else b
                push((x, y))
                prev = None
            elif C == 'H':
                a = float(toks[i]); i += 1
                x = x + a if rel else a
                push((x, y))
                prev = None
            elif C == 'V':
                a = float(toks[i]); i += 1
                y = y + a if rel else a
                push((x, y))
                prev = None
            elif C in ('C', 'S'):
                if C == 'C':
                    a = take(6)
                    x1 = x + a[0] if rel else a[0]
                    y1 = y + a[1] if rel else a[1]
                    x2 = x + a[2] if rel else a[2]
                    y2 = y + a[3] if rel else a[3]
                    x3 = x + a[4] if rel else a[4]
                    y3 = y + a[5] if rel else a[5]
                else:
                    a = take(4)
                    if prev:
                        x1, y1 = 2 * x - prev[0], 2 * y - prev[1]
                    else:
                        x1, y1 = x, y
                    x2 = x + a[0] if rel else a[0]
                    y2 = y + a[1] if rel else a[1]
                    x3 = x + a[2] if rel else a[2]
                    y3 = y + a[3] if rel else a[3]
                x0c, y0c = x, y
                for k in range(1, steps + 1):
                    u = k / float(steps)
                    v = 1 - u
                    bx = (v ** 3) * x0c + 3 * (v ** 2) * u * x1 + 3 * v * (u ** 2) * x2 + (u ** 3) * x3
                    by = (v ** 3) * y0c + 3 * (v ** 2) * u * y1 + 3 * v * (u ** 2) * y2 + (u ** 3) * y3
                    push((bx, by))
                prev = (x2, y2)
                x, y = x3, y3
            elif C == 'Z':
                push((sx, sy))
                prev = None
                i += 1
            else:
                i += 1
        return [p for p in polys if len(p) >= 3]

    return [flatten(d) for d in ds]


def write_png(path, w, h, rgb):
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)                                  # 过滤类型 0 = None
        raw += rgb[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))   # 8bit truecolor
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def s(v):
    """设计坐标（1200x630）→ 超采样坐标"""
    return v * SS


def main():
    cv = Canvas(CW, CH, BG)

    # ---- 纸张顶部的一条浅色带（呼应站点的 .top 顶栏）----
    cv.rect(s(0), s(0), s(W), s(40), PANEL)
    cv.rect(s(0), s(37), s(W), s(40), LINE)

    # ---- 主色竖线（呼应 .note 的左边框）----
    cv.rect(s(72), s(168), s(78), s(560), ACCENT)

    # ---- 五线谱：一个系统，五条线 ----
    # 纵向位置是权衡出来的：谱号【上端】要留在顶部色带之下，
    # 【尾巴】又不能压到下面的文字条上。谱号总高 7.2 个线距，不是 5 个，
    # 所以谱表的上下都要多留 —— 按"五条线的高度"排会撞头撞脚。
    x0, x1 = s(120), s(W - 120)
    top = s(190)
    gap = s(15)
    for i in range(5):
        y = top + gap * i
        cv.line(x0, y, x1, y, INK, s(2.4))

    # ---- 谱号：用【真实】的高音谱号轮廓 ----
    # 直接从 MuseScore 导出的谱面 SVG 里解析 <path class="Clef">，
    # 不需要任何中间文件，也不需要 node。
    # 手写参数化曲线试了三版都不像 —— 字形这种东西必须用真数据。
    #
    # 原始坐标系：谱表线距 24.8，谱号高约 178（= 7.2 个线距）。
    # 这里把线距映射到卡片上的 gap，谱号就自动得到正确比例。
    here = os.path.dirname(os.path.abspath(__file__))
    clef_src = os.path.join(here, '..', 'assets', 'scores', 'b1-first-species.svg')
    clef_paths = parse_clef_from_svg(os.path.normpath(clef_src))

    SRC_GAP = 24.8                      # 原谱面线距（谱表线 y 429.6/454.4/... 相差 24.8）
    k = (gap / SRC_GAP) * SS            # 原坐标 → 超采样坐标（gap 已是超采样后的线距）
    # 原轮廓的 y=0 落在【第二线（G 线）】上，不是第一线：
    # 谱号 path 的 y 范围是 -111→67，即向上 4.5 个线距、向下 2.7 个线距，
    # 与真实高音谱号的比例吻合（G 线以上到顶端约 4.5 个间，以下到尾巴约 2.7 个间）。
    # 第一版把它对齐到第一线，整个谱号浮上去 4.5 个线距。
    clef_x = x0 + s(18)
    clef_y = top + gap * 3

    for polys in clef_paths:
        mapped = [[(clef_x + px * k, clef_y + py * k) for px, py in poly] for poly in polys]
        cv.fill_polygons(mapped, INK)

    # ---- 符头：按音高位置排几个音，配符干 ----
    # 位置写成「第几线/间」的偏移，视觉上像一个上行后下行的旋律
    steps_mel = [0, 1, 2, 4, 3, 1, 0, 2]
    # 谱号右边缘与原轮廓 x≈66 对应，所以第一个符头要留出谱号宽度 + 呼吸
    nx = x0 + s(152)
    step_x = s(76)
    last_x = nx
    for i, st in enumerate(steps_mel):
        # st 越大越高：y 越小
        y = top + gap * 4 - (gap / 2.0) * st
        x = nx + step_x * i
        last_x = x
        cv.disc(x, y, s(8.6), INK, squash=0.78)          # 扁椭圆符头
        # 符干：音高在中线以下时向上，否则向下
        if st < 2:
            cv.line(x + s(7.6), y, x + s(7.6), y - s(52), INK, s(3.0))
        else:
            cv.line(x - s(7.6), y, x - s(7.6), y + s(52), INK, s(3.0))

    # 末尾一条小节线（留出与最后一个符头的间距，否则会贴上去）
    cv.line(last_x + s(42), top, last_x + s(42), top + gap * 4, INK, s(2.6))

    # ---- 下方：三段"说明文字"的示意条（不画真字，避免字形噪声）----
    #    用长度不等的圆角条，读起来像一段标题 + 两行小字
    def bar(x, y, w, h_, c):
        cv.rect(s(x), s(y), s(x + w), s(y + h_), c)
    bar(120, 400, 420, 26, INK)       # 主标题
    bar(120, 448, 330, 12, INK2)      # 副标题
    bar(120, 474, 250, 12, INK2)

    # 右下角：三个小圆点，呼应站点的注释标记
    for i in range(3):
        cv.disc(s(W - 150 + i * 34), s(500), s(8), ACCENT)

    # ---- 缩小 + 写文件 ----
    ow, oh, rgb = cv.downscale(SS)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'share.png')
    out = os.path.normpath(out)
    size = write_png(out, ow, oh, rgb)
    print('已生成 %s' % out)
    print('尺寸 %dx%d，%d 字节（%.1f KB）' % (ow, oh, size, size / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
