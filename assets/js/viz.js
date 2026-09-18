/* ==========================================================================
 * viz.js — 可视化模块
 * --------------------------------------------------------------------------
 * 五张图，共用一套基础设施：
 *   viz-voice       声部进行图 + 协和度色带（对位专用）
 *   viz-suspension  挂留生命周期动画（第四类对位）
 *   viz-form        曲式时间轴图
 *   viz-journey     调性旅程图（奏鸣曲式的"离家与回家"）
 *   viz-tonnetz     音网（Tonnetz）—— 和弦的空间
 *
 * 全部是内联 SVG + requestAnimationFrame + 已有的 Web Audio，
 * 没有任何第三方库，file:// 直接打开就能用。
 *
 * 音乐数据一律复用文字记谱（见 docs/记谱速查.md），与检查器同源。
 * ========================================================================== */
(function (global) {
  'use strict';

  var SITE = global.SITE, TH = global.TH, CP = global.CP;
  var esc = SITE.esc, el = SITE.el;
  var NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------ SVG 工具 */

  function sv(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) {
      n.setAttribute(k, attrs[k]);
    }
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function group(parent, attrs) { var g = sv('g', attrs); parent.appendChild(g); return g; }

  /* 协和度配色（CSS 变量，深浅色自动切换） */
  var CLS_FILL = { perfect: 'var(--vz-perfect)', imperfect: 'var(--vz-imperfect)', dissonant: 'var(--vz-dissonant)' };
  var CLS_ZH = { perfect: '完全协和', imperfect: '不完全协和', dissonant: '不协和' };

  /* ---------------------------------------------------- 播放 + 动画游标 */

  var RAF = null;
  function stopAnim() {
    if (RAF) { global.cancelAnimationFrame(RAF); RAF = null; }
    SITE.audio.stop();          // 统一出口：合成音和 MP3 一起停
  }

  /**
   * 播放并驱动游标。返回播放令牌；令牌失效（被别的播放抢占）时自动收尾。
   *
   * 两条要害，都是踩过的坑：
   *   ① 各声部各自调度、共用一条时间轴（SITE.audio.playVoices），
   *      【不要】先合并成一个和弦串：parse 是顺序累加时值定位音的，
   *      合并串的时值一旦不首尾相接，后面每个音都会往后漂，
   *      片段越长漂得越多（图 73 尾部音频比游标慢 20 拍）。
   *   ② 游标读【音频时钟】并减掉输出延迟，不要读墙钟：
   *      曾经用 performance.now() + 100ms 猜音频的提前量，而音频时钟在
   *      AudioContext 建立/设备启动期间是停住的，于是首次播放会偏几百毫秒。
   *
   * @param {string[]} voiceStrs 各声部的文字记谱
   * @param {number} tempo 每分钟四分音符数
   * @param {number} totalQ 总拍数（画图用的那把尺子）
   * @param {function(number)} onTick 每帧回调，参数是当前拍位 0..totalQ
   * @param {function()} onEnd 结束（或被抢占）时回调
   */
  function playAnim(voiceStrs, tempo, totalQ, onTick, onEnd) {
    stopAnim();
    var started = SITE.audio.playVoices(voiceStrs, tempo);
    var my = started.token;
    var beat = started.beat;      // 拍长只认 playVoices 给的那个数
    var wall0 = global.performance.now();     // 没有音频上下文时的兜底
    /* 听到的位置 = (音频时钟 − 输出延迟 − 起奏时刻) / 每拍秒数 */
    function quartersHeard() {
      var ct = SITE.audio.now();
      if (ct === null || started.t0 === null) {
        return (global.performance.now() - wall0) / (beat * 1000);
      }
      return (ct - SITE.audio.latency() - started.t0) / beat;
    }
    var endQ = totalQ + (SITE.audio.latency() * 1000 + 220) / (beat * 1000);
    function frame() {
      if (!SITE.audio.alive(my)) { RAF = null; if (onEnd) onEnd(); return; }
      var q = quartersHeard();
      onTick(Math.max(0, Math.min(q, totalQ)));
      /* 结束判定要用没被夹住的 q，否则到了末尾永远是 totalQ，循环停不下来 */
      if (q < endQ) RAF = global.requestAnimationFrame(frame);
      else { RAF = null; if (onEnd) onEnd(); }
    }
    RAF = global.requestAnimationFrame(frame);
    return my;
  }

  /** 逐拍求两个声部之间的音程（用于协和度色带） */
  function intervalSeries(strA, strB) {
    var a = SITE.audio.parse(strA), b = SITE.audio.parse(strB);
    var grid = {};
    a.notes.forEach(function (n) { grid[n.at] = grid[n.at] || {}; grid[n.at].a = n; });
    b.notes.forEach(function (n) { grid[n.at] = grid[n.at] || {}; grid[n.at].b = n; });
    var times = Object.keys(grid).map(Number).sort(function (x, y) { return x - y; });
    var out = [], cursor = 0;
    times.forEach(function (t, i) {
      var g = grid[t];
      var next = i + 1 < times.length ? times[i + 1] : Math.max(a.total, b.total);
      var cur = { at: t, dur: next - t };
      /* 取此刻正在发声的音（延续中的也算） */
      function sounding(list) {
        for (var k = list.length - 1; k >= 0; k--) {
          if (list[k].at <= t + 1e-9 && t < list[k].at + list[k].dur - 1e-9) return list[k];
        }
        return list.filter(function (n) { return n.at <= t + 1e-9; }).pop() || null;
      }
      var na = sounding(a.notes), nb = sounding(b.notes);
      if (na && nb) {
        var low = na.midi <= nb.midi ? na : nb, high = na.midi <= nb.midi ? nb : na;
        cur.iv = TH.intervalBetween(TH.pitch(TH.midiToName(low.midi)), TH.pitch(TH.midiToName(high.midi)));
      }
      out.push(cur);
    });
    return { cols: out, total: Math.max(a.total, b.total) };
  }

  /* ============================================================ 1. 声部进行图 */

  function voiceLeading(s) {
    var box = el('div', 'viz');
    var head = el('div', 'viz-head');
    head.appendChild(el('div', 'viz-title', esc(s.title || '声部进行图')));
    box.appendChild(head);

    var voices = (s.voices || []).map(function (v) {
      return { name: v.name || '', notes: v.notes, m: SITE.audio.parse(v.notes), color: v.color };
    });
    if (voices.length < 2) {
      box.appendChild(el('div', 'ph', '需要至少两个声部'));
      return box;
    }
    var totalQ = Math.max.apply(null, voices.map(function (v) { return v.m.total; }));

    /* 音高范围 */
    var all = [];
    voices.forEach(function (v) { v.m.notes.forEach(function (n) { all.push(n.midi); }); });
    var lo = Math.min.apply(null, all) - 3, hi = Math.max.apply(null, all) + 3;

    var W = 780, H = s.height || 250;
    var hasStrip = s.strip !== false;
    /* 纵向布局：[上部留白][绘图区][协和度色带][小节号][下部留白] */
    var mg = { l: 50, r: 14, t: 18, b: hasStrip ? 64 : 28 };
    var pw = W - mg.l - mg.r, ph = H - mg.t - mg.b;
    var X = function (q) { return mg.l + (q / totalQ) * pw; };
    var Y = function (mi) { return mg.t + (hi - mi) / (hi - lo) * ph; };
    var stripY = mg.t + ph + 10, stripH = 15;
    var rulerY = hasStrip ? stripY + stripH + 15 : mg.t + ph + 18;

    var root = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'vz-svg' });
    root.style.width = '100%'; root.style.height = 'auto';

    /* 八度网格线 */
    var grid = group(root, { class: 'vz-grid' });
    for (var mi = Math.ceil(lo / 12) * 12; mi <= hi; mi += 12) {
      var yy = Y(mi);
      grid.appendChild(sv('line', { x1: mg.l, y1: yy, x2: W - mg.r, y2: yy }));
      grid.appendChild(sv('text', { x: mg.l - 8, y: yy + 4, class: 'vz-axis', 'text-anchor': 'end' },
        TH.midiToName(mi)));
    }
    /* 小节线 */
    var barQ = s.barQ || 4;
    var bars = Math.round(totalQ / barQ);
    for (var b = 0; b <= bars; b++) {
      var bx = X(b * barQ);
      grid.appendChild(sv('line', { x1: bx, y1: mg.t, x2: bx, y2: mg.t + ph, class: 'vz-bar' }));
      if (bars <= 16) {
        grid.appendChild(sv('text', { x: bx, y: rulerY, class: 'vz-axis', 'text-anchor': 'middle' }, b + 1));
      }
    }

    /* 声部折线：onset 到 onset 直连——反向运动就会画成一个张开的楔形 */
    var noteEls = [];
    voices.forEach(function (v, vi) {
      var g = group(root, { class: 'vz-voice' });
      var pts = v.m.notes.map(function (n) { return { x: X(n.at), y: Y(n.midi), n: n }; });
      var colorVar = v.color || (vi === 0 ? 'var(--vz-v1)' : 'var(--vz-v2)');
      if (pts.length > 1) {
        g.appendChild(sv('polyline', {
          points: pts.map(function (p) { return p.x + ',' + p.y; }).join(' '),
          fill: 'none', stroke: colorVar, 'stroke-width': 2.1,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.9
        }));
      }
      pts.forEach(function (p) {
        var c = sv('circle', { cx: p.x, cy: p.y, r: 5.2, fill: colorVar, class: 'vz-note' });
        var t = sv('title', null, v.name + '  ' + TH.midiToName(p.n.midi) +
          '   第 ' + (Math.floor(p.n.at / barQ) + 1) + ' 小节');
        c.appendChild(t);
        c.addEventListener('click', function () { SITE.audio.chord([p.n.midi], 0.5); });
        g.appendChild(c);
        noteEls.push({ node: c, at: p.n.at, dur: p.n.dur });
      });
      if (v.name) {
        var last = pts[pts.length - 1];
        g.appendChild(sv('text', { x: last.x + 10, y: last.y + 4, class: 'vz-label', fill: colorVar }, v.name));
      }
    });

    /* 协和度色带 */
    var strip = null, cols = null;
    if (hasStrip) {
      var isr = intervalSeries(voices[0].notes, voices[1].notes);
      cols = isr.cols;
      strip = group(root, { class: 'vz-strip' });
      var sy = stripY, sh = stripH;
      cols.forEach(function (c) {
        if (!c.iv) return;
        var w = Math.max(1.5, X(c.at + c.dur) - X(c.at) - 1.2);
        var r = sv('rect', {
          x: X(c.at) + 0.6, y: sy, width: w, height: sh, rx: 2,
          fill: CLS_FILL[c.iv.class], opacity: 0.85, class: 'vz-cell'
        });
        r.appendChild(sv('title', null, '第 ' + (Math.floor(c.at / barQ) + 1) + ' 小节　' +
          c.iv.name + '（' + CLS_ZH[c.iv.class] + '）'));
        strip.appendChild(r);
      });
      strip.appendChild(sv('text', {
        x: mg.l - 8, y: sy + sh - 2, class: 'vz-axis', 'text-anchor': 'end'
      }, '协和度'));
    }

    /* 检查器叠加：把违规位置标出来 */
    var markerG = group(root, { class: 'vz-marks' });
    if (s.species && s.cf && s.cp) {
      var res = CP.check(TH.makeScore({
        cf: s.cf, cp: s.cp, species: s.species, key: s.key || 'C', meter: s.meter || '4/4'
      }));
      var errs = res.messages.filter(function (m) { return m.level === 'error'; });
      errs.forEach(function (m, k) {
        if (!m.at || m.at.onset === undefined) return;
        var mx = X(m.at.onset);
        markerG.appendChild(sv('rect', {
          x: mx - 1, y: mg.t, width: 2.4, height: ph,
          fill: 'var(--vz-bad)', opacity: 0.55, class: 'vz-mark'
        }));
        /* 标签上下交错，避免相邻的违规标记文字互相压住 */
        var ty = mg.t - 5 - (k % 2) * 12;
        var t = sv('text', { x: mx, y: ty, class: 'vz-marktext', 'text-anchor': 'middle' }, m.id);
        t.appendChild(sv('title', null, m.zh + '：' + (m.detail || '')));
        markerG.appendChild(t);
      });
    }

    /* 播放游标 */
    var head1 = sv('line', { x1: mg.l, y1: mg.t, x2: mg.l, y2: mg.t + ph, class: 'vz-playhead' });
    root.appendChild(head1);

    box.appendChild(root);

    /* 控件：一个切换按钮 + 速度 */
    var row = el('div', 'playrow');
    var playBtn = el('button', 'btn', '▶ 播放并跟随');
    var speed = el('select', 'vz-select');
    var speeds = [['60', '慢速 60'], ['66', '中速 66'], ['84', '快速 84'], ['108', '很快 108']];
    /* 谱例自己的 tempo 可能不在这四档里（图 82 与图 154 都是 56）。
       必须把它补成一个真选项：<select> 的 value 一旦设成不存在的选项就变成 ''，
       parseInt('') = NaN，于是动画和音频各自退化成不同的默认拍长（9% 的漂移）。 */
    var want = String(SITE.audio.tempoOf(s.tempo || 66));   // 66 = 声部图一贯的默认速度
    if (!speeds.some(function (p) { return p[0] === want; })) speeds.unshift([want, '原速 ' + want]);
    speeds.forEach(function (o) {
      var op = el('option', null, o[1]); op.value = o[0]; speed.appendChild(op);
    });
    speed.value = want;
    row.appendChild(playBtn); row.appendChild(speed);
    box.appendChild(row);

    var myToken = null, watcher = null;
    function resetPlay() {
      playBtn.textContent = '▶ 播放并跟随';
      if (watcher) { global.clearInterval(watcher); watcher = null; }
      myToken = null;
      noteEls.forEach(function (ne) { ne.node.classList.remove('on'); });
      head1.setAttribute('x1', mg.l); head1.setAttribute('x2', mg.l);
    }
    playBtn.onclick = function () {
      if (myToken !== null && SITE.audio.alive(myToken)) { stopAnim(); resetPlay(); return; }
      var tempo = parseInt(speed.value, 10);
      myToken = playAnim(voices.map(function (v) { return v.notes; }), tempo, totalQ,
        function (q) {
          var hx = X(q);
          head1.setAttribute('x1', hx); head1.setAttribute('x2', hx);
          noteEls.forEach(function (ne) {
            ne.node.classList.toggle('on', q >= ne.at - 1e-6 && q < ne.at + ne.dur - 1e-6);
          });
        }, resetPlay);
      if (myToken === null) { playBtn.textContent = '（浏览器不支持音频）'; return; }
      playBtn.textContent = '⏹ 停止';
      /* 令牌被别人抢走时按钮要自己复位，否则会一直显示"停止" */
      watcher = global.setInterval(function () {
        if (myToken !== null && !SITE.audio.alive(myToken)) resetPlay();
      }, 120);
    };

    /* 图例 */
    var lg = el('div', 'vz-legend');
    [['perfect', '完全协和'], ['imperfect', '不完全协和'], ['dissonant', '不协和']].forEach(function (p) {
      var i = el('span', 'vz-key');
      i.innerHTML = '<i style="background:' + CLS_FILL[p[0]] + '"></i>' + p[1];
      lg.appendChild(i);
    });
    if (s.species && s.cf) {
      var i2 = el('span', 'vz-key');
      i2.innerHTML = '<i style="background:var(--vz-bad)"></i>检查器判定违规处';
      lg.appendChild(i2);
    }
    box.appendChild(lg);

    if (s.caption) box.appendChild(el('div', 'viz-cap', s.caption));
    return box;
  }

  /* ======================================================== 2. 挂留生命周期 */

  function suspension(s) {
    var box = el('div', 'viz');
    box.appendChild(el('div', 'viz-title', esc(s.title || '挂留的生命周期')));
    if (s.note) box.appendChild(el('div', 'viz-cap', s.note));

    /* 三个阶段：准备 / 挂留 / 解决。每阶段两个音（CF 与 CP）。 */
    var ph = s.phases || [];
    if (ph.length !== 3) {
      box.appendChild(el('div', 'ph', 'phases 需要正好三个阶段'));
      return box;
    }

    var W = 780, H = 262;
    var root = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'vz-svg' });
    root.style.width = '100%'; root.style.height = 'auto';

    var colW = (W - 40) / 3;
    var midis = [];
    ph.forEach(function (p) { midis.push(p.cf, p.cp); });
    var lo = Math.min.apply(null, midis) - 5, hi = Math.max.apply(null, midis) + 5;
    var Y = function (mi) { return 34 + (hi - mi) / (hi - lo) * 148; };
    var X0 = function (i) { return 20 + i * colW; };

    var cells = [];
    ph.forEach(function (p, i) {
      var g = group(root, { class: 'vz-phase' });
      /* 阶段底色 */
      var bg = sv('rect', { x: X0(i) + 4, y: 8, width: colW - 8, height: H - 16, rx: 9, class: 'vz-phasebg' });
      g.appendChild(bg);

      var cx = X0(i) + colW / 2;
      /* 两条声部的音 */
      [[p.cf, 'var(--vz-v1)', 'CF'], [p.cp, 'var(--vz-v2)', 'CP']].forEach(function (v) {
        var y = Y(v[0]);
        var nx = cx + (v[2] === 'CF' ? -30 : 30);
        var c = sv('circle', { cx: nx, cy: y, r: 13, fill: v[1], class: 'vz-big-note' });
        g.appendChild(c);
        g.appendChild(sv('text', { x: nx, y: y + 4.5, class: 'vz-notetext', 'text-anchor': 'middle' }, v[2]));
        g.appendChild(sv('text', {
          x: nx + (v[2] === 'CF' ? -20 : 20), y: y + 4.5, class: 'vz-axis',
          'text-anchor': v[2] === 'CF' ? 'end' : 'start'
        }, TH.midiToName(v[0])));
      });
      /* 纵向音程 */
      var lowM = Math.min(p.cf, p.cp), highM = Math.max(p.cf, p.cp);
      var iv = TH.intervalBetween(TH.pitch(TH.midiToName(lowM)), TH.pitch(TH.midiToName(highM)));
      var y1 = Y(lowM), y2 = Y(highM);
      g.appendChild(sv('line', {
        x1: cx, y1: y1, x2: cx, y2: y2, class: 'vz-ivline',
        stroke: CLS_FILL[iv.class]
      }));
      g.appendChild(sv('text', {
        x: cx + 8, y: (y1 + y2) / 2 + 4.5, class: 'vz-ivtext',
        fill: CLS_FILL[iv.class], 'text-anchor': 'start'
      }, iv.name));
      /* 阶段标题 */
      g.appendChild(sv('text', { x: cx, y: H - 26, class: 'vz-phasetitle', 'text-anchor': 'middle' }, p.label));
      g.appendChild(sv('text', { x: cx, y: H - 10, class: 'vz-axis', 'text-anchor': 'middle' }, p.sub || ''));
      cells.push({ bg: bg, iv: iv });
    });

    /* 阶段之间的连接箭头：CP 保持（挂留）然后下行（解决） */
    for (var i = 0; i < 2; i++) {
      var yA = Y(ph[i].cp), yB = Y(ph[i + 1].cp);
      var xA = X0(i) + colW / 2 + 30, xB = X0(i + 1) + colW / 2 + 30;
      var arrow = sv('path', {
        d: 'M ' + (xA + 15) + ' ' + yA + ' C ' + ((xA + xB) / 2) + ' ' + yA + ' ' +
           ((xA + xB) / 2) + ' ' + yB + ' ' + (xB - 17) + ' ' + yB,
        class: 'vz-arrow', 'marker-end': 'url(#vz-ah)'
      });
      root.appendChild(arrow);
    }
    var defs = sv('defs');
    var mk = sv('marker', { id: 'vz-ah', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' });
    mk.appendChild(sv('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--vz-v2)' }));
    defs.appendChild(mk);
    root.insertBefore(defs, root.firstChild);

    box.appendChild(root);

    var row = el('div', 'playrow');
    var b = el('button', 'btn', '▶ 逐阶段播放');
    row.appendChild(b);
    box.appendChild(row);

    var timer = null;
    function resetPhases() {
      if (timer) { clearInterval(timer); timer = null; }
      cells.forEach(function (c) { c.bg.classList.remove('live'); });
      b.textContent = '▶ 逐阶段播放';
    }
    b.onclick = function () {
      if (timer) { stopAnim(); resetPhases(); return; }   // 再点一次 = 停
      stopAnim();
      var i = 0;
      function step() {
        if (i >= 3) { resetPhases(); return; }
        cells.forEach(function (c, k) { c.bg.classList.toggle('live', k === i); });
        SITE.audio.chord([ph[i].cf, ph[i].cp], s.speed || 1.15);
        b.textContent = '阶段 ' + (i + 1) + ' / 3';
        i++;
      }
      step();
      timer = global.setInterval(step, (s.speed || 1.15) * 1000 + 260);
    };
    return box;
  }

  /* ============================================================ 3. 曲式时间轴 */

  function formChart(s) {
    var box = el('div', 'viz');
    box.appendChild(el('div', 'viz-title', esc(s.title || '曲式时间轴')));
    if (s.note) box.appendChild(el('div', 'viz-cap', s.note));

    var total = s.totalMeasures || Math.max.apply(null, (s.sections || []).map(function (x) { return x.to; }));
    var W = 800;
    var laneH = 34, gap = 6;
    var hasHarmony = !!(s.harmony && s.harmony.length);
    var hasCadence = !!(s.cadences && s.cadences.length);
    var H = 34 + laneH + (hasHarmony ? laneH + gap : 0) + (hasCadence ? 30 : 0) + 20;

    var root = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'vz-svg' });
    root.style.width = '100%'; root.style.height = 'auto';
    var L = 4, R = W - 4, plotW = R - L;
    var X = function (m) { return L + (m - 1) / Math.max(1, total - 1 + 1) * plotW; };

    /* 小节刻度 */
    var ruler = group(root, { class: 'vz-ruler' });
    var tickStep = total <= 16 ? 1 : total <= 48 ? 4 : total <= 120 ? 8 : 16;
    for (var m = 1; m <= total; m += tickStep) {
      ruler.appendChild(sv('line', { x1: X(m), y1: 20, x2: X(m), y2: H - 22, class: 'vz-tick' }));
      ruler.appendChild(sv('text', { x: X(m), y: H - 6, class: 'vz-axis', 'text-anchor': 'middle' }, m));
    }
    ruler.appendChild(sv('text', { x: L, y: 12, class: 'vz-axis' }, '小节'));

    /* 功能段 */
    var blocks = [];
    (s.sections || []).forEach(function (sec) {
      var x1 = X(sec.from), x2 = X(sec.to + 1);
      var g = group(root, { class: 'vz-blockg' });
      var r = sv('rect', {
        x: x1, y: 24, width: Math.max(6, x2 - x1 - 2), height: laneH, rx: 6,
        class: 'vz-block', fill: sec.color || undefined
      });
      r.appendChild(sv('title', null, sec.label + '　第 ' + sec.from + '–' + sec.to + ' 小节' +
        (sec.detail ? '\n' + sec.detail : '')));
      g.appendChild(r);
      var cx = (x1 + x2) / 2;
      g.appendChild(sv('text', {
        x: cx, y: 24 + laneH / 2 + 5, class: 'vz-blocktext', 'text-anchor': 'middle'
      }, sec.label));
      blocks.push({ node: r, sec: sec, x1: x1, x2: x2 });
    });

    /* 和声行 */
    if (hasHarmony) {
      var hy = 24 + laneH + gap;
      var hg = group(root, { class: 'vz-harmony' });
      s.harmony.forEach(function (h, i) {
        var next = i + 1 < s.harmony.length ? s.harmony[i + 1].at : total + 1;
        hg.appendChild(sv('text', {
          x: (X(h.at) + X(next)) / 2, y: hy + laneH / 2 + 5,
          class: 'vz-harmtext', 'text-anchor': 'middle'
        }, h.label));
      });
      hg.appendChild(sv('text', { x: L, y: hy - 4, class: 'vz-axis' }, '和声'));
    }

    /* 终止式标记 */
    if (hasCadence) {
      var cy = 24 + laneH + (hasHarmony ? laneH + gap : 0) + 4;
      var cg = group(root, { class: 'vz-cadences' });
      s.cadences.forEach(function (c) {
        var x = X(c.at + 0.5);
        cg.appendChild(sv('path', {
          d: 'M ' + x + ' ' + (24 + laneH) + ' l -5 9 l 10 0 z', class: 'vz-cadflag'
        }));
        var t = sv('text', { x: x, y: cy + 12, class: 'vz-cadtext', 'text-anchor': 'middle' }, c.type);
        if (c.detail) t.appendChild(sv('title', null, c.type + '：' + c.detail));
        cg.appendChild(t);
      });
    }

    /* 走查游标 */
    var head = sv('line', { x1: L, y1: 18, x2: L, y2: H - 24, class: 'vz-playhead' });
    root.appendChild(head);
    box.appendChild(root);

    var row = el('div', 'playrow');
    var b = el('button', 'btn', '▶ 走一遍结构');
    row.appendChild(b);
    var info = el('span', 'viz-cap');
    row.appendChild(info);
    box.appendChild(row);

    var timer = null;
    b.onclick = function () {
      if (timer) { clearInterval(timer); timer = null; b.textContent = '▶ 走一遍结构'; clearHL(); return; }
      b.textContent = '⏹ 停止';
      var cur = 0;
      var stepMs = s.stepMs || 260;
      timer = setInterval(function () {
        cur++;
        if (cur > total) { clearInterval(timer); timer = null; b.textContent = '▶ 走一遍结构'; clearHL(); info.textContent = ''; return; }
        var x = X(cur);
        head.setAttribute('x1', x); head.setAttribute('x2', x);
        var hit = blocks.filter(function (bl) { return cur >= bl.sec.from && cur <= bl.sec.to; })[0];
        blocks.forEach(function (bl) { bl.node.classList.toggle('live', bl === hit); });
        if (hit) {
          info.innerHTML = '<b>' + esc(hit.sec.label) + '</b>　第 ' + cur + ' 小节 / 共 ' + total +
            (hit.sec.detail ? '　· ' + esc(hit.sec.detail) : '');
        }
      }, stepMs);
    };
    function clearHL() { blocks.forEach(function (bl) { bl.node.classList.remove('live'); }); }

    if (s.caption) box.appendChild(el('div', 'viz-cap', s.caption));
    return box;
  }

  /* ============================================================ 4. 调性旅程 */

  function journey(s) {
    var box = el('div', 'viz');
    box.appendChild(el('div', 'viz-title', esc(s.title || '调性旅程')));
    if (s.note) box.appendChild(el('div', 'viz-cap', s.note));

    /* 五度圈位置：主调 = 0，属方向为正，下属方向为负 */
    var STEPS = { 'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6,
      'F': -1, 'Bb': -2, 'Eb': -3, 'Ab': -4, 'Db': -5, 'Gb': -6 };
    function stepOf(k) {
      var m = /^([A-G][#b]?)/.exec(k);
      var base = m ? m[1] : k;
      if (STEPS[base] !== undefined) return STEPS[base];
      return 0;
    }

    var keys = s.keys || [];
    var total = s.totalMeasures || (keys.length ? keys[keys.length - 1].at + 8 : 32);
    var steps = keys.map(function (k) { return stepOf(k.key); });
    /* 相对主调的偏移 */
    var home = steps.length ? steps[0] : 0;
    var rel = steps.map(function (x) { return x - home; });
    var loS = Math.min.apply(null, rel.concat([-1])) - 1;
    var hiS = Math.max.apply(null, rel.concat([1])) + 1;

    var W = 800, H = 220;
    var mg = { l: 62, r: 20, t: 20, b: 34 };
    var X = function (m) { return mg.l + (m - 1) / Math.max(1, total) * (W - mg.l - mg.r); };
    var Y = function (st) { return mg.t + (hiS - st) / (hiS - loS) * (H - mg.t - mg.b); };

    var root = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'vz-svg' });
    root.style.width = '100%'; root.style.height = 'auto';

    /* 台阶网格 */
    var g = group(root, { class: 'vz-grid' });
    for (var st = loS; st <= hiS; st++) {
      g.appendChild(sv('line', { x1: mg.l, y1: Y(st), x2: W - mg.r, y2: Y(st), class: 'vz-gridline' }));
      g.appendChild(sv('text', { x: mg.l - 8, y: Y(st) + 4, class: 'vz-axis', 'text-anchor': 'end' },
        st === 0 ? '主调' : (st > 0 ? '+' + st : String(st))));
    }
    /* 主调基准线 */
    g.appendChild(sv('line', { x1: mg.l, y1: Y(0), x2: W - mg.r, y2: Y(0), class: 'vz-home' }));

    /* 阶梯路径 */
    var pts = [], labels = [];
    keys.forEach(function (k, i) {
      var x = X(k.at), y = Y(rel[i]);
      var nextX = i + 1 < keys.length ? X(keys[i + 1].at) : X(total + 1);
      pts.push({ x: x, y: y, nextX: nextX, key: k.key, at: k.at });
    });
    var d = '';
    pts.forEach(function (p, i) {
      d += (i === 0 ? 'M ' : 'L ') + p.x + ' ' + p.y + ' ';
      d += 'L ' + p.nextX + ' ' + p.y + ' ';
    });
    root.appendChild(sv('path', { d: d, class: 'vz-journey' }));

    pts.forEach(function (p) {
      var c = sv('circle', { cx: p.x, cy: p.y, r: 5.5, class: 'vz-keynode' });
      c.appendChild(sv('title', null, p.key + '　第 ' + p.at + ' 小节起'));
      root.appendChild(c);
      labels.push(sv('text', { x: p.x + 9, y: p.y - 9, class: 'vz-keylabel' }, p.key));
      root.appendChild(labels[labels.length - 1]);
    });

    var head = sv('line', { x1: mg.l, y1: mg.t, x2: mg.l, y2: H - mg.b, class: 'vz-playhead' });
    root.appendChild(head);
    box.appendChild(root);

    var row = el('div', 'playrow');
    var b = el('button', 'btn', '▶ 走一遍调性');
    row.appendChild(b);
    var info = el('span', 'viz-cap');
    row.appendChild(info);
    box.appendChild(row);

    var timer = null;
    b.onclick = function () {
      if (timer) { clearInterval(timer); timer = null; b.textContent = '▶ 走一遍调性'; return; }
      b.textContent = '⏹ 停止';
      var m = 1;
      timer = setInterval(function () {
        if (m > total) { clearInterval(timer); timer = null; b.textContent = '▶ 走一遍调性'; info.textContent = ''; return; }
        head.setAttribute('x1', X(m)); head.setAttribute('x2', X(m));
        var cur = null;
        for (var i = 0; i < pts.length; i++) if (pts[i].at <= m) cur = pts[i];
        if (cur) info.innerHTML = '<b>' + esc(cur.key) + '</b>　第 ' + m + ' 小节　离主调 ' +
          (rel[pts.indexOf(cur)] === 0 ? '0（在家）' : Math.abs(rel[pts.indexOf(cur)]) + ' 步' +
            (rel[pts.indexOf(cur)] > 0 ? '（属方向）' : '（下属方向）'));
      }, s.stepMs || 130);
    };

    if (s.caption) box.appendChild(el('div', 'viz-cap', s.caption));
    return box;
  }

  /* ============================================================== 5. 音网 */

  function tonnetz(s) {
    var box = el('div', 'viz');
    box.appendChild(el('div', 'viz-title', esc(s.title || '音网 Tonnetz')));
    if (s.note) box.appendChild(el('div', 'viz-cap', s.note));

    var NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    var R = 4;
    function pcOf(i, j) { return ((7 * i + 4 * j) % 12 + 12) % 12; }
    function posOf(i, j) { return { x: i + j * 0.5, y: -j * 0.866 }; }

    /* 找某个音级在格点上的一个位置 */
    function nodeOf(pc) {
      var best = null;
      for (var i = -R; i <= R; i++) for (var j = -R; j <= R; j++) {
        if (pcOf(i, j) === pc && Math.abs(i) <= 2 && Math.abs(j) <= 2) {
          if (!best || Math.abs(i) + Math.abs(j) < Math.abs(best.i) + Math.abs(best.j)) best = { i: i, j: j };
        }
      }
      return best;
    }

    var SC = 48, CX = 400, CY = 134;
    var W = 800, H = 270;
    var LIMX = 4.15, LIMY = 2.75;   // 可见范围（以格点为单位）
    function visible(p) { return Math.abs(p.x) <= LIMX && Math.abs(p.y) <= LIMY; }
    var PX = function (p) { return CX + p.x * SC; };
    var PY = function (p) { return CY + p.y * SC; };
    var root = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'vz-svg' });
    root.style.width = '100%'; root.style.height = 'auto';

    /* 边：纯五度、大三度、小三度 */
    var edges = group(root, { class: 'vz-edges' });
    for (var i = -R; i <= R; i++) for (var j = -R; j <= R; j++) {
      [[1, 0], [0, 1], [1, -1]].forEach(function (dd) {
        var i2 = i + dd[0], j2 = j + dd[1];
        if (i2 < -R || i2 > R || j2 < -R || j2 > R) return;
        var p1 = posOf(i, j), p2 = posOf(i2, j2);
        if (!visible(p1) || !visible(p2)) return;
        edges.appendChild(sv('line', { x1: PX(p1), y1: PY(p1), x2: PX(p2), y2: PY(p2), class: 'vz-edge' }));
      });
    }
    /* 节点 */
    var nodeEls = {};
    for (var i = -R; i <= R; i++) for (var j = -R; j <= R; j++) {
      var p = posOf(i, j);
      if (!visible(p)) continue;
      var pc = pcOf(i, j);
      var c = sv('circle', { cx: PX(p), cy: PY(p), r: 13, class: 'vz-node', 'data-pc': pc });
      c.appendChild(sv('title', null, NAMES[pc]));
      root.appendChild(c);
      root.appendChild(sv('text', { x: PX(p), y: PY(p) + 4, class: 'vz-nodetext', 'text-anchor': 'middle' }, NAMES[pc]));
      nodeEls[i + ',' + j] = c;
    }

    /* 和弦三角形：在所有同音级的格点里，挑一个"三个顶点都可见"的位置 */
    var triG = group(root, { class: 'vz-tris' });
    function triFor(ch) {
      var found = null;
      for (var i = -R; i <= R; i++) for (var j = -R; j <= R; j++) {
        if (pcOf(i, j) !== ch.root) continue;
        var cells = ch.quality === 'm'
          ? [[i, j], [i + 1, j], [i + 1, j - 1]]
          : [[i, j], [i + 1, j], [i, j + 1]];
        var pts = cells.map(function (c) { return posOf(c[0], c[1]); });
        if (!pts.every(visible)) continue;
        var cost = Math.abs(i) + Math.abs(j);
        if (!found || cost < found.cost) found = { cells: cells, pts: pts, cost: cost };
      }
      return found;
    }

    box.appendChild(root);

    var prog = s.progression || [];
    var row = el('div', 'playrow');
    var b = el('button', 'btn', '▶ 走一遍和声进行');
    row.appendChild(b);
    var info = el('span', 'viz-cap');
    row.appendChild(info);
    box.appendChild(row);

    var liveTri = null, timer = null;
    function show(ch, silent) {
      if (liveTri) { liveTri.remove(); liveTri = null; }
      if (!ch) { info.textContent = ''; return; }
      var t = triFor(ch);
      if (!t) { info.innerHTML = '<b>' + esc(ch.label || '') + '</b>　（该和弦超出当前音网范围）'; return; }
      liveTri = sv('polygon', {
        points: t.pts.map(function (p) { return PX(p) + ',' + PY(p); }).join(' '),
        class: 'vz-tri-live'
      });
      triG.appendChild(liveTri);
      Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.remove('on'); });
      t.cells.forEach(function (c) { if (nodeEls[c[0] + ',' + c[1]]) nodeEls[c[0] + ',' + c[1]].classList.add('on'); });
      if (!silent) {
        var pcs = t.cells.map(function (c) { return pcOf(c[0], c[1]); })
          .map(function (pc) { return 60 + pc; });
        SITE.audio.chord(pcs, 0.85);
      }
      info.innerHTML = '<b>' + esc(ch.label) + '</b>　' +
        t.cells.map(function (c) { return NAMES[pcOf(c[0], c[1])]; }).join(' – ');
    }

    b.onclick = function () {
      if (timer) { clearInterval(timer); timer = null; b.textContent = '▶ 走一遍和声进行'; show(null); return; }
      b.textContent = '⏹ 停止';
      var k = 0;
      show(prog[0]);
      timer = setInterval(function () {
        k++;
        if (k >= prog.length) { clearInterval(timer); timer = null; b.textContent = '▶ 走一遍和声进行'; return; }
        show(prog[k]);
      }, s.stepMs || 900);
    };

    /* 初始就高亮第一个和弦，避免打开时是一片空白 */
    if (prog.length) show(prog[0], true);

    if (s.caption) box.appendChild(el('div', 'viz-cap', s.caption));
    return box;
  }

  /* -------------------------------------------------------------- 注册 */

  SITE.addSectionType('viz-voice', voiceLeading);
  SITE.addSectionType('viz-suspension', suspension);
  SITE.addSectionType('viz-form', formChart);
  SITE.addSectionType('viz-journey', journey);
  SITE.addSectionType('viz-tonnetz', tonnetz);

  global.VIZ = {
    voiceLeading: voiceLeading, suspension: suspension, form: formChart,
    journey: journey, tonnetz: tonnetz, stop: stopAnim
  };

})(typeof window !== 'undefined' ? window : globalThis);
