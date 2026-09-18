/* ==========================================================================
 * site.js — 站点核心：内容注册、音频、进度、路由、区块渲染
 * 无构建、无依赖、可 file:// 直接打开。
 * ========================================================================== */
(function (global) {
  'use strict';

  var SITE = {};
  var UNITS = [];

  /* ---------------------------------------------------------------- 注册 */

  SITE.track = function (spec) {
    SITE.tracks = SITE.tracks || {};
    if (!SITE.tracks[spec.id]) {
      SITE.trackOrder = SITE.trackOrder || [];
      SITE.trackOrder.push(spec.id);          // 记住模块的注册顺序
    }
    SITE.tracks[spec.id] = spec;
    return spec;
  };
  SITE.trackIndex = function (id) {
    var o = SITE.trackOrder || [];
    var i = o.indexOf(id);
    return i < 0 ? 999 : i;
  };
  SITE.unit = function (spec) {
    UNITS.push(spec);
    return spec;
  };
  /* 排序必须【先按模块、再按模块内的序号】。
     曾经只按 order 排，而 A1/B1/C1/E1 的 order 都是 1，
     于是 A1 的「下一单元」被算成了 B1 —— 跨模块串线。
     同一模块内才按 order；模块之间按注册顺序。 */
  SITE.units = function (trackId) {
    return UNITS.filter(function (u) { return !trackId || u.track === trackId; })
      .sort(function (a, b) {
        var ta = SITE.trackIndex(a.track), tb = SITE.trackIndex(b.track);
        if (ta !== tb) return ta - tb;
        return (a.order || 0) - (b.order || 0);
      });
  };
  SITE.byId = function (id) {
    for (var i = 0; i < UNITS.length; i++) if (UNITS[i].id === id) return UNITS[i];
    return null;
  };

  /* -------------------------------------------------------------- 音频 */
  /*
   * 播放管理的四条原则（修 bug 时踩过的坑，写在这里免得再犯）：
   *   1. 同一时刻只允许一路声音。任何一次播放都先掐掉上一路。
   *   2. 播放令牌递增；动画游标靠比对令牌判断自己是否已被抢占，从而自动停。
   *   3. 合成音与 MP3 必须由同一个出口停止，否则"暂停"按钮只能停一半。
   *   4. 多声部一律走 playVoices：各自调度、共用一条时间轴。
   *      【不要】写成"把各声部合并成一个和弦串"再播——parse 是【顺序累加时值】
   *      定位音的（每个音的 at = 前面所有 token 的时值之和），合并串的时值
   *      必须首尾相接铺满时间轴才对得上；只要某个音的时值比"到下一个 onset
   *      的距离"长（全音符 CF 配二分音符 CP 就是这种情况），后面每个音都会
   *      往后漂，片段越长漂得越多（Fux 图 73 尾部差 20 拍、音频比游标慢 45%）。
   *      回归测试见 tools/check-viz-sync.js。
   */
  var Audio = (function () {
    var ctx = null, live = [], mp3El = null, token = 0;

    function ac() {
      if (!ctx) {
        var C = global.AudioContext || global.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    var SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function midiOf(name) {
      var m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name).trim());
      if (!m) return null;
      var acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
      return (parseInt(m[3], 10) + 1) * 12 + SEMI[m[1].toUpperCase()] + acc;
    }

    /* 写法："C4:1 E4:1 | <C4 E4 G4>:2 R:1"  时值以四分音符为单位
       注意和弦的冒号：<...>:2 与 <...>2 都要认，少一个就会静默丢音。 */
    var CHORD_RE = /^<([^>]*)>:?([\d.]*)$/;
    /* 拍长的【唯一来源】。动画和音频必须用同一个数：
       曾经 plot 用 60/(tempo||66)、音频用 60/(tempo||72)，tempo 一旦是 NaN
       （下拉框 value 设成了不存在的选项 → '' → parseInt → NaN），
       两边就各自退化成不同的默认值，音频比游标快 9%，长片段上越走越偏。 */
    function tempoOf(t) {
      return (typeof t === 'number' && isFinite(t) && t > 0) ? t : 72;
    }

    function parse(str) {
      var out = [], t = 0, bad = [];
      (String(str).match(/<[^>]*>[^\s|]*|\||[^\s|]+/g) || []).forEach(function (tok) {
        if (tok === '|') return;
        var cm = CHORD_RE.exec(tok);
        if (cm) {
          var d = cm[2] ? parseFloat(cm[2]) : 1;
          var names = cm[1].trim().split(/\s+/).filter(Boolean);
          var ms = [];
          names.forEach(function (nm) {
            var v = midiOf(nm);
            if (v === null) bad.push(nm); else ms.push(v);
          });
          ms.forEach(function (mm) { out.push({ midi: mm, at: t, dur: d }); });
          t += d; return;
        }
        var p = tok.split(':'), name = p[0], dur = p.length > 1 ? parseFloat(p[1]) : 1;
        if (isNaN(dur) || dur <= 0) dur = 1;
        if (name === 'R' || name === 'r') { t += dur; return; }
        var midi = midiOf(name);
        if (midi !== null) out.push({ midi: midi, at: t, dur: dur });
        else bad.push(name);
        t += dur;
      });
      if (bad.length && global.console) {
        console.warn('[audio] 无法识别的音名，已被跳过：', bad.join(', '), '（原始串：' + str + '）');
      }
      return { notes: out, total: t, bad: bad };
    }

    function tone(t0, midi, dur, gain) {
      var c = ac(); if (!c) return;
      var o1 = c.createOscillator(), o2 = c.createOscillator();
      var g = c.createGain(), g2 = c.createGain();
      var f = 440 * Math.pow(2, (midi - 69) / 12);
      o1.type = 'triangle'; o2.type = 'sine';
      o1.frequency.value = f; o2.frequency.value = f * 2.004;
      g2.gain.value = 0.13;
      var atk = 0.016, rel = Math.min(0.30, dur * 0.5);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + atk);
      g.gain.setValueAtTime(gain, t0 + Math.max(atk, dur - rel));
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(c.destination);
      o1.start(t0); o2.start(t0);
      o1.stop(t0 + dur + 0.05); o2.stop(t0 + dur + 0.05);
      live.push(o1, o2);
    }

    function killSynth() {
      live.forEach(function (n) {
        try { n.stop(0); } catch (e) { }
        try { n.disconnect(); } catch (e) { }
      });
      live = [];
    }
    function killMp3() {
      if (mp3El) {
        var el = mp3El; mp3El = null;
        try { el.onended = null; el.onerror = null; el.pause(); el.removeAttribute('src'); el.load(); }
        catch (e) { }
      }
    }

    return {
      parse: parse,
      midiOf: midiOf,
      /** 拍长归一化：任何调用方都该用它，别各写各的 `tempo || 默认值` */
      tempoOf: tempoOf,

      /** 当前的播放令牌。动画游标用它判断自己有没有被抢占。 */
      token: function () { return token; },
      alive: function (t) { return t === token; },

      /**
       * 音频时钟（秒）。动画游标必须读它，不要读 performance.now()：
       * 两者是不同的时间轴（音频时钟在 AudioContext 建立/设备启动期间会停住），
       * 拿墙钟去猜播放位置会得到一个肉眼可见的固定偏差。
       * @returns {number|null} null = 还没有音频上下文，调用方应退回墙钟
       */
      now: function () { return ctx ? ctx.currentTime : null; },

      /**
       * 输出延迟（秒）："排进音频线程"到"从扬声器出来"的间隔。
       * 游标要对齐【听到的】声音，所以要减掉它；拿不到就返回 0。
       */
      latency: function () {
        if (!ctx) return 0;
        var l = ctx.outputLatency;
        if (!(typeof l === 'number' && isFinite(l) && l > 0)) l = ctx.baseLatency;
        return (typeof l === 'number' && isFinite(l) && l > 0) ? l : 0;
      },

      /** 停掉一切声音（合成音 + MP3）。所有"停止"都应该走这里。 */
      stop: function () {
        token++;
        killSynth();
        killMp3();
      },

      /**
       * 把多个声部放在【同一条时间轴】上播放。
       * 每个声部保留自己的 onset 与时值——长音继续延音，不会被别的声部切断，
       * 也不会像"合并串"那样把后面的音整体推后。
       * @param {string|string[]} strs 声部（文字记谱，见 docs/记谱速查.md）
       * @param {number} tempo 每分钟四分音符数
       * @returns {{token:number, t0:number|null, beat:number, total:number}}
       *          t0 = 音频时钟上的起奏时刻，给动画游标对齐用；total = 总拍数；
       *          beat = 每拍秒数（调用方一律用它，别再自己算一遍）
       */
      playVoices: function (strs, tempo, opts) {
        opts = opts || {};
        this.stop();
        var my = token;
        var beat = 60 / tempoOf(tempo);
        var out = { token: my, t0: null, beat: beat, total: 0 };
        var list = strs == null ? [] : [].concat(strs);
        var parsed = list.map(parse);
        parsed.forEach(function (m) { out.total = Math.max(out.total, m.total); });
        var c = ac();
        if (!c || !out.total) return out;
        var t0 = c.currentTime + 0.10;      // 留 0.1s 排程余量，别排到"过去"
        var gain = (opts.volume === undefined ? 1 : opts.volume) * 0.20;
        parsed.forEach(function (m) {
          m.notes.forEach(function (n) {
            tone(t0 + n.at * beat, n.midi, Math.max(0.07, n.dur * beat * 0.94), gain);
          });
        });
        out.t0 = t0;
        return out;
      },

      /**
       * 播放一个文字记谱串（单声部）。多声部用 playVoices。
       * @returns {number} token
       */
      play: function (str, tempo, opts) {
        return this.playVoices([str], tempo, opts).token;
      },

      /** 只响一组音（点音符试听、和弦试听） */
      chord: function (midis, dur, volume) {
        var c = ac(); if (!c) return;
        var t0 = c.currentTime + 0.01;
        var g = (volume === undefined ? 1 : volume) * 0.20;
        midis.forEach(function (m) { tone(t0, m, dur || 0.9, g); });
      },

      /**
       * 播放谱面导出的 MP3。
       *
       * 要害：onEnd 只在【它自己播完或出错】时才来。停止（killMp3）会把元素上的
       * onended/onerror 摘掉，所以"用户点了停止"与"被别的播放抢占"这两种情况下
       * onEnd 永远不会触发 —— 按钮绝不能只靠 onEnd 复位，否则会永久卡在"⏹ 停止"。
       * 调用方要么自己复位，要么拿返回的 token 轮询（见 SITE.playButton）。
       *
       * @param {string} url
       * @param {function} onEnd (failed:boolean) 自然结束 / 出错时回调
       * @returns {{token:number, ok:boolean}}
       */
      playMp3: function (url, onEnd) {
        this.stop();
        var my = token;
        var el = new global.Audio(url);
        mp3El = el;
        var done = function (failed) {
          if (mp3El === el) { mp3El = null; if (onEnd) onEnd(!!failed); }
        };
        el.onended = function () { done(false); };
        el.onerror = function () { done(true); };
        var pr = el.play();
        if (pr && pr.catch) pr.catch(function () { mp3El = null; if (onEnd) onEnd(true); });
        return { token: my, ok: true };
      },

      mp3Playing: function () { return !!mp3El && !mp3El.paused; },

      /** 格式化一个音名的频率，调试用 */
      freqOf: function (m) { return 440 * Math.pow(2, (m - 69) / 12); }
    };
  })();
  SITE.audio = Audio;

  /**
   * 造一个「播放 / 停止」切换按钮。
   * 所有播放入口都应该用它——否则每个按钮各写一套状态，必然有的停不掉。
   * opts: { label, stopLabel, notes|fn, tempo|fn, totalQ|fn, cls, onTick, onEnd }
   *   notes 可以是【数组】：那就是多声部，各声部共用一条时间轴（见 playVoices）。
   */
  SITE.playButton = function (opts) {
    opts = opts || {};
    var label = opts.label || '▶ 播放';
    var stopLabel = opts.stopLabel || '⏹ 停止';
    var b = el('button', opts.cls || 'btn', label);
    var busy = false, watch = null;

    function reset() {
      busy = false;
      b.textContent = label;
      if (watch) { global.clearInterval(watch); watch = null; }
    }

    b.onclick = function () {
      /* 再点一次 = 停。这里【必须自己复位】：MP3 那条路的 onEnd 在"用户主动停止"
         时不会来（元素上的 onended 已被摘掉），只靠 onEnd 复位就永久卡在"停止"。 */
      if (busy) { Audio.stop(); reset(); return; }

      /* MP3 模式：和合成音模式共用这一套状态机 */
      if (opts.mp3) {
        var m = Audio.playMp3(opts.mp3, function (failed) {
          reset();
          if (opts.onEnd) opts.onEnd(!!failed);
        });
        busy = true;
        b.textContent = stopLabel;
        if (opts.onStart) opts.onStart();
        /* 被别的播放抢占时 MP3 的 onended 同样不会来，所以按令牌轮询复位 */
        watch = global.setInterval(function () {
          if (!Audio.alive(m.token)) reset();
        }, 120);
        return;
      }

      var raw = typeof opts.notes === 'function' ? opts.notes() : opts.notes;
      var tempo = typeof opts.tempo === 'function' ? opts.tempo() : (opts.tempo || 72);
      if (raw == null) return;
      var voices = [].concat(raw);              // 字符串或字符串数组都收
      var parsed = { notes: [], total: 0 };
      voices.forEach(function (s) {
        var m = Audio.parse(s);
        parsed.notes = parsed.notes.concat(m.notes);
        parsed.total = Math.max(parsed.total, m.total);
      });
      if (!parsed.notes.length) {
        b.textContent = '（没有可播放的音）';
        global.setTimeout(reset, 1400);
        return;
      }
      var totalQ = opts.totalQ !== undefined
        ? (typeof opts.totalQ === 'function' ? opts.totalQ() : opts.totalQ)
        : parsed.total;

      var started = Audio.playVoices(voices, tempo);
      var my = started.token;
      busy = true;
      b.textContent = stopLabel;

      var beat = started.beat;      // 拍长只认 playVoices 给的那个数
      /* 结束判定也读音频时钟：墙钟与音频时钟不是一条时间轴（见 Audio.now），
         用墙钟会让按钮在声音还在响的时候就自己复位。 */
      var t0 = started.t0;
      var wall0 = global.performance.now();
      var endSec = totalQ * beat + 0.26;
      /* 令牌变了说明被别的播放抢占了，按钮要自己复位 */
      watch = global.setInterval(function () {
        if (!Audio.alive(my)) { reset(); return; }
        var ct = Audio.now();
        var gone = (t0 !== null && ct !== null)
          ? ct - t0
          : (global.performance.now() - wall0) / 1000;
        if (gone > endSec) { reset(); if (opts.onEnd) opts.onEnd(); }
      }, 100);
    };
    b.resetState = reset;
    return b;
  };

  /* -------------------------------------------------------------- 进度 */

  var KEY = 'music-learning-site/v1';

  /* 读进来只认【普通对象】。
     原先只守了 JSON.parse 会抛的那一半：解析结果若是字符串/数字/布尔
     （`JSON.parse('"abc"')` 得到的就是字符串），对象本身是合法的，
     但严格模式下给字符串赋属性会抛 TypeError —— 于是 Store.set /
     markDone / drillOk 全部失效，而页面看起来完全正常：
     勾选框在抛异常前已经 checked=true，进度条却永远不动，也不报错。
     这是本项目自己反复强调的"静默失败"，所以这里要连形状一起验。
     （数组虽然也能挂属性，但键会撞上数字下标，同样只认普通对象。） */
  function readStore() {
    try {
      var v = JSON.parse(global.localStorage.getItem(KEY));
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
      if (v !== null && v !== undefined) {
        if (global.console) console.warn('[store] 存档不是对象，已忽略并重新开始：', typeof v);
      }
      return {};
    } catch (e) {
      if (global.console) console.warn('[store] 存档解析失败，已重新开始：', e.message);
      return {};
    }
  }

  var Store = {
    data: readStore(),
    /* 存不进去必须出声。原先这里是空 catch，正是"写入静默失效"藏得住的原因。 */
    save: function () {
      try { global.localStorage.setItem(KEY, JSON.stringify(this.data)); }
      catch (e) { if (global.console) console.warn('[store] 进度没能写进 localStorage：', e.message); }
    },
    get: function (k, d) { return this.data[k] === undefined ? d : this.data[k]; },
    set: function (k, v) { this.data[k] = v; this.save(); },
    done: function (id) { return !!this.data['done/' + id]; },
    markDone: function (id, on) {
      if (on) this.data['done/' + id] = Date.now();
      else delete this.data['done/' + id];
      this.save();
    },
    drillOk: function (k) { this.data['drill/' + k] = (this.data['drill/' + k] || 0) + 1; this.save(); }
  };
  SITE.store = Store;

  /* --------------------------------------------------------- 小工具 */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  /* decodeURIComponent 对畸形的百分号转义会抛 URIError（"#/u/100%" 就能触发）。
     路由是 hashchange 的监听器，外面没有 try/catch，而 VIEW.innerHTML=''
     已经先执行了 —— 结果是地址栏变了、内容清空、页面停在半渲染状态。
     解不开就按原样用：查不到单元会回首页，比白屏好。 */
  function safeDecode(s) {
    try { return decodeURIComponent(s); }
    catch (e) { if (global.console) console.warn('[router] 地址里的转义解不开，按原样处理：', s); return s; }
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  SITE.el = el; SITE.esc = esc;

  /* ---------------------------------------------------------- 区块渲染 */

  var RENDER = {
    prose: function (s) {
      var d = el('div', 'card');
      if (s.title) d.appendChild(el('h3', null, esc(s.title)));
      d.appendChild(el('div', null, s.html || ''));
      return d;
    },
    note: function (s) {
      return el('div', 'note', s.html || '');
    },
    terms: function (s) {
      var d = el('div', 'card');
      if (s.title) d.appendChild(el('h3', null, esc(s.title)));
      var t = el('table', 'terms');
      (s.items || []).forEach(function (row) {
        var tr = el('tr');
        tr.appendChild(el('td', 'zh', esc(row[0])));
        tr.appendChild(el('td', 'en', esc(row[1] || '')));
        var td = el('td', null, row[2] || '');
        /* 第四项 = 展开讲解。第一句是判据，第四项是把判据讲透：
           它为什么成立、容易和什么混淆、一个具体例子。
           写内容时尽量都补上——只有一句判据的术语表太薄。 */
        if (row[3]) td.appendChild(el('div', 'term-detail', row[3]));
        tr.appendChild(td);
        t.appendChild(tr);
      });
      d.appendChild(t);
      return d;
    },
    score: function (s) {
      var d = el('div', 'card score');
      var fig = el('figure');
      var host = el('div');
      fig.appendChild(host);
      if (s.caption) fig.appendChild(el('figcaption', null, s.caption));
      d.appendChild(fig);

      /* 优先内嵌 SVG（矢量、可改色）；没有就退到 PNG；再没有就给出指引 */
      var svgPath = s.svg, pngPath = s.png;

      function inject(text) {
        host.innerHTML = text;
        var sv = host.querySelector('svg');
        if (!sv) return;
        sv.removeAttribute('width');
        sv.removeAttribute('height');
        sv.style.width = '100%';
        sv.style.height = 'auto';
        /* 紧裁剪：用浏览器自己的排版结果算内容外框，比解析 path 数据可靠 */
        try {
          var bb = sv.getBBox();
          if (bb && bb.width > 1 && bb.height > 1) {
            var pad = 8;
            sv.setAttribute('viewBox',
              (bb.x - pad) + ' ' + (bb.y - pad) + ' ' +
              (bb.width + pad * 2) + ' ' + (bb.height + pad * 2));
          }
        } catch (e) { /* 拿不到就保留原 viewBox */ }
        /* 深色模式：纯黑描边/填充改用 currentColor */
        Array.prototype.forEach.call(
          sv.querySelectorAll('[fill="#000000"],[fill="#000"],[fill="black"]'),
          function (n) { n.setAttribute('fill', 'currentColor'); });
        Array.prototype.forEach.call(
          sv.querySelectorAll('[stroke="#000000"],[stroke="#000"],[stroke="black"]'),
          function (n) { n.setAttribute('stroke', 'currentColor'); });
      }

      /* 谱面优先用可选的 SCORE_SVG 内联数据（现在站点不再生成它，保留是为了
         兼容旧打包），否则直接读取 assets/scores/*.svg —— http(s) 托管下走这条路。
         注意：**file:// 双击打开时这条路走不通**（XHR 被 CORS 拦），
         所以本地预览会看到下面的说明而不是谱面。见 README「怎么打开」。 */
      var bundled = (global.SCORE_SVG || {})[svgPath];
      if (svgPath && bundled) {
        inject(bundled);
      } else if (svgPath) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', svgPath, true);
        xhr.onload = function () {
          if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) inject(xhr.responseText);
          else fallback();
        };
        xhr.onerror = fallback;
        try { xhr.send(); } catch (e) { fallback(); }
      } else fallback();

      function fallback() {
        if (pngPath) { host.innerHTML = '<img src="' + esc(pngPath) + '" alt="谱例">'; return; }
        host.innerHTML = '<div class="ph">谱面需要在 http 下打开<br><span class="sub">' +
          '浏览器不允许 <code>file://</code> 页面读取同目录的 SVG。在项目目录里跑一条静态服务即可：<br>' +
          '<code>python -m http.server 8000</code>　或　<code>npx serve</code><br>' +
          '然后访问 <code>http://localhost:8000/</code>。音频同理。<br>' +
          '（谱面源文件：<code>' + esc(s.mscz || '—') + '</code>）</span></div>';
      }
      if (s.mp3) {
        var row = el('div', 'playrow');
        var hint = el('span', 'sub');
        /* 走统一的 playButton（原来这里手写了一套状态，点"停止"后按钮永久卡住：
           Audio.stop() 会把 MP3 元素上的 onended 摘掉，那个复位回调再也不来）。
           回归测试见 tools/check-viz-sync.js 的 [6]。 */
        var b = SITE.playButton({
          label: '▶ 播放这段音乐',
          mp3: s.mp3,
          onStart: function () { hint.textContent = ''; },
          onEnd: function (failed) {
            if (failed) hint.textContent = '（音频还没导出：' + s.mp3 + '　跑一下 tools\\build-scores.ps1）';
          }
        });
        row.appendChild(b);
        row.appendChild(hint);
        if (s.mscz) {
          /* 公网上这个按钮只会**下载**源谱，不会唤起 MuseScore ——
             浏览器不把 .musicxml 交给本地应用，这是安全模型决定的。
             所以文案写成"下载"，别让人以为点了会打开软件。 */
          var o = el('button', 'btn ghost', '下载源谱（.musicxml）');
          o.title = '在 MuseScore 里打开这个文件，可以自己改谱';
          o.onclick = function () { global.open(s.mscz, '_blank'); };
          row.appendChild(o);
        }
        d.appendChild(row);
      }
      return d;
    },
    listen: function (s) {
      var d = el('div', 'card');
      d.appendChild(el('h3', null, '听辨'));
      if (s.title) d.appendChild(el('div', 'q', esc(s.title)));
      var row = el('div', 'playrow');
      var b = SITE.playButton({
        label: '▶ 播放', notes: s.notes, tempo: s.tempo || 72,
        volume: s.volume
      });
      row.appendChild(b);
      if (s.replay) {
        row.appendChild(SITE.playButton({
          label: '↻ 再放一次', notes: s.notes, tempo: s.tempo || 72, cls: 'btn ghost'
        }));
      }
      d.appendChild(row);
      if (s.html) d.appendChild(el('div', null, s.html));
      return d;
    },
    checklist: function (s, unit) {
      var d = el('div', 'card');
      d.appendChild(el('h3', null, s.title || '本单元完成清单'));
      var ul = el('ul', 'checklist');
      (s.items || []).forEach(function (txt, i) {
        var li = el('li');
        var cb = el('input');
        cb.type = 'checkbox';
        var k = unit.id + '/ck/' + i;
        cb.checked = !!Store.get(k);
        cb.onchange = function () { Store.set(k, cb.checked); refreshProgress(); };
        var id = 'ck-' + unit.id + '-' + i;
        cb.id = id;
        var lb = el('label', null, txt);
        lb.setAttribute('for', id);
        li.appendChild(cb); li.appendChild(lb);
        ul.appendChild(li);
      });
      d.appendChild(ul);
      return d;
    },
    repertoire: function (s) {
      var d = el('div', 'card');
      d.appendChild(el('h3', null, s.title || '真实文献任务'));
      if (s.intro) d.appendChild(el('div', null, s.intro));
      var box = el('div', 'rep');
      (s.items || []).forEach(function (it) {
        var c = el('div', 'item');
        var head = el('div');
        head.innerHTML = '<span class="work">' + esc(it.work) + '</span> ' +
          (it.bars ? '<span class="bars">' + esc(it.bars) + '</span>' : '');
        c.appendChild(head);
        if (it.task) c.appendChild(el('div', 'task', it.task));
        if (it.link) {
          var a = el('a', null, it.linkText || '打开权威谱面（IMSLP）');
          a.href = it.link; a.target = '_blank'; a.rel = 'noopener';
          c.appendChild(el('div', 'task', ''));
          c.lastChild.appendChild(a);
        }
        box.appendChild(c);
      });
      d.appendChild(box);
      return d;
    },
    drill: function (s, unit, idx) {
      return global.DRILLS.build(s, unit.id + '#' + idx);
    },
    html: function (s) { return el('div', 'card', s.html || ''); }
  };
  SITE.renderSection = function (s, unit, idx) {
    var fn = RENDER[s.type] || (SITE.sectionTypes && SITE.sectionTypes[s.type]) || RENDER.prose;
    return fn(s, unit, idx);
  };

  /* 可视化模块（viz.js）等外部文件用这个注册自己的区块类型，
     这样加新图不用改 site.js */
  SITE.sectionTypes = {};
  SITE.addSectionType = function (name, fn) { SITE.sectionTypes[name] = fn; };

  /* -------------------------------------------------------------- 路由 */

  var VIEW = null, TRACKNAV = null;

  function refreshProgress() {
    var all = SITE.units();
    var done = all.filter(function (u) { return Store.done(u.id); }).length;
    var chip = document.getElementById('progressChip');
    if (chip) chip.textContent = done + ' / ' + all.length + ' 单元';
  }
  SITE.refreshProgress = refreshProgress;

  function go(hash) { global.location.hash = hash; }

  function renderTrackNav(active) {
    TRACKNAV.innerHTML = '';
    var home = el('button', null, '总览');
    home.className = active === '' ? 'on' : '';
    home.onclick = function () { go('#/'); };
    TRACKNAV.appendChild(home);
    Object.keys(SITE.tracks || {}).forEach(function (k) {
      var t = SITE.tracks[k];
      var b = el('button', null, t.short || t.title);
      b.className = active === k ? 'on' : '';
      b.onclick = function () { go('#/t/' + k); };
      TRACKNAV.appendChild(b);
    });
    var all = el('button', null, '全部单元');
    all.className = active === 'all' ? 'on' : '';
    all.onclick = function () { go('#/t/all'); };
    TRACKNAV.appendChild(all);
  }

  /* ------------------------------------------------------------ 页面 */

  function pageHome() {
    renderTrackNav('');
    VIEW.innerHTML = '';
    VIEW.appendChild(el('h1', null, '复调 · 曲式 · 标注'));
    VIEW.appendChild(el('p', 'sub', '按周末 3–4 小时的自足单元组织。谱面与声音来自 MuseScore，练习由规则检查器当场批改。'));

    /* 快速学习流：直接跳到你该做的那一个 */
    var all = SITE.units();
    var next = null;
    for (var i = 0; i < all.length; i++) if (!Store.done(all[i].id)) { next = all[i]; break; }
    var flow = el('div', 'card');
    if (next) {
      flow.innerHTML = '<h3>接着做这个</h3>';
      flow.appendChild(el('p', null, '<b>' + esc(next.code || '') + '　' + esc(next.title) + '</b><br>' +
        '<span class="sub">' + esc(next.goal || '') + '</span>'));
      var b = el('button', 'btn', '进入单元 →');
      b.onclick = function () { go('#/u/' + next.id); };
      flow.appendChild(b);
    } else {
      flow.innerHTML = '<h3>全部单元已完成</h3><p class="sub">可以去「全部单元」里回头复习，或者新增单元。</p>';
    }
    VIEW.appendChild(flow);

    /* 首页第一屏就把"这是什么、可信到什么程度"说清楚。
       放在首页而不是只写在 README 里 —— 公网上没人会去翻仓库。 */
    var about = el('div', 'note');
    about.innerHTML =
      '<b>这是个人学习笔记，不是教程。</b>' +
      '<p class="sub" style="margin:6px 0 0">内容按三档可靠性区分：' +
      '<b>对位硬规则判定</b>是机器可验的（21 条规则，<code>node tools\\verify.js</code> 的结果就是结论）；' +
      '<b>DCML 标签语法</b>用的是官方正则；' +
      '而<b>讲解文字与文献分析结论属草稿，可能有错</b>，请以原教材和原谱为准。' +
      '规则合规也不等于音乐好听。</p>' +
      '<p class="sub" style="margin:6px 0 0">' +
      '<a href="docs/关于本站.html">关于本站 · 数据来源与授权 · 免责声明 →</a></p>';
    VIEW.appendChild(about);

    Object.keys(SITE.tracks || {}).forEach(function (k) {
      var t = SITE.tracks[k];
      var us = SITE.units(k);
      VIEW.appendChild(el('h2', null, esc(t.title) + ' <span class="en">' + esc(t.en || '') + '</span>'));
      if (t.intro) VIEW.appendChild(el('p', 'sub', t.intro));
      var box = el('div', 'units');
      us.forEach(function (u) { box.appendChild(unitRow(u)); });
      VIEW.appendChild(box);
    });
    refreshProgress();
  }

  function unitRow(u) {
    var done = Store.done(u.id);
    /* 用 <button> 而不是带 onclick 的 <div>：这个列表是首页和模块页的主入口，
       <div> 既不可 Tab 到达、也不能回车激活，键盘用户根本进不去单元。
       外观由 .unitrow 的样式接管（见 site.css 里对 button.unitrow 的重置）。 */
    var r = el('button', 'unitrow' + (done ? ' done' : ''));
    r.type = 'button';
    r.innerHTML = '<span class="code">' + esc(u.code || '') + '</span>' +
      '<span class="t">' + (done ? '<span class="done-tick">✓ </span>' : '') + esc(u.title) + '</span>' +
      '<span class="m">' + esc(u.minutes ? u.minutes + ' 分钟' : '') + '</span>';
    r.onclick = function () { go('#/u/' + u.id); };
    return r;
  }

  function pageTrack(trackId) {
    renderTrackNav(trackId);
    VIEW.innerHTML = '';
    var us = SITE.units(trackId === 'all' ? null : trackId);
    var t = trackId === 'all' ? { title: '全部单元' } : (SITE.tracks[trackId] || { title: trackId });
    VIEW.appendChild(el('h1', null, esc(t.title) + ' <span class="en">' + esc(t.en || '') + '</span>'));
    if (t.intro) VIEW.appendChild(el('p', 'sub', t.intro));
    var box = el('div', 'units');
    us.forEach(function (u) { box.appendChild(unitRow(u)); });
    VIEW.appendChild(box);
    refreshProgress();
  }

  function pageUnit(id) {
    var u = SITE.byId(id);
    if (!u) { pageHome(); return; }
    renderTrackNav(u.track);
    VIEW.innerHTML = '';

    var back = el('div', 'sub');
    back.innerHTML = '<a href="#/t/' + u.track + '">← ' + esc((SITE.tracks[u.track] || {}).title || '返回') + '</a>';
    VIEW.appendChild(back);

    /* 位置条：你在整条线的哪里，以及前后承接什么。
       "上下文连接"不能只靠读者自己回想，得摆在眼前。 */
    var inTrack = SITE.units(u.track);
    var ti = inTrack.indexOf(u);
    var strip = el('div', 'unitpos');
    strip.innerHTML =
      '<span class="up-track">' + esc((SITE.tracks[u.track] || {}).title || '') + '</span>' +
      '<span class="up-sep">·</span>' +
      '<span class="up-idx">第 ' + (ti + 1) + ' / ' + inTrack.length + ' 单元</span>' +
      (u.flow && u.flow.from
        ? '<span class="up-sep">·</span><span class="up-from">承接：' + esc(u.flow.from) + '</span>'
        : '');
    VIEW.appendChild(strip);

    VIEW.appendChild(el('h1', null, '<span class="code sub">' + esc(u.code || '') + '</span> ' + esc(u.title)));
    VIEW.appendChild(el('p', 'sub', esc(u.en || '') +
      (u.minutes ? ' · 约 ' + u.minutes + ' 分钟' : '')));

    if (u.goal) {
      VIEW.appendChild(el('div', 'goal', '<b>这个单元结束时你应该能：</b><br>' + u.goal));
    }
    if (u.flow && u.flow.why) {
      VIEW.appendChild(el('div', 'flowbox', '<b>为什么现在学这个：</b>' + u.flow.why));
    }

    /* 区块逐个渲染，【一个坏了不牵连全页】。
       渲染器是同步的，任何一处抛异常原先都会让整个单元停在半截
       （页面还在、内容只有前面几块，且没有任何提示）。
       最现实的一种触发：drill 引擎会直接对 s.cf 调 .replace()，
       某个 spot 区块漏写 cf 就是整单元白屏。
       工具侧已由 check-content.js 校验区块字段，这里是运行时的兜底。 */
    (u.sections || []).forEach(function (s, i) {
      try {
        VIEW.appendChild(SITE.renderSection(s, u, i));
      } catch (err) {
        if (global.console) console.error('[render] 第 ' + (i + 1) + ' 个区块渲染失败：', s && s.type, err);
        var box = el('div', 'note bad');
        box.innerHTML = '<b>这一块没能显示</b><br><span class="sub">' +
          '区块类型 ' + esc((s && s.type) || '?') + '（第 ' + (i + 1) + ' 个）渲染出错：' +
          esc(err && err.message ? err.message : String(err)) +
          '<br>其余内容不受影响，可以继续往下读。</span>';
        VIEW.appendChild(box);
      }
    });

    /* 完成勾选 */
    var bar = el('div', 'card');
    var lab = el('label');
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = Store.done(u.id);
    cb.style.marginRight = '8px';
    cb.onchange = function () { Store.markDone(u.id, cb.checked); refreshProgress(); };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode('标记本单元已完成'));
    bar.appendChild(lab);
    VIEW.appendChild(bar);

    /* 前后导航：只在【本模块内】走，不跨模块串线。
       跨模块的去向单独给一句说明，由 u.flow.to 提供。 */
    var nav = el('div', 'unitnav');
    if (ti > 0) {
      var p = inTrack[ti - 1];
      var pb = el('button', 'btn ghost', '← ' + esc(p.code ? p.code + ' ' : '') + esc(p.title));
      pb.onclick = function () { go('#/u/' + p.id); };
      nav.appendChild(pb);
    } else nav.appendChild(el('span'));
    if (ti < inTrack.length - 1) {
      var n = inTrack[ti + 1];
      var nb = el('button', 'btn', esc(n.code ? n.code + ' ' : '') + esc(n.title) + ' →');
      nb.onclick = function () { go('#/u/' + n.id); };
      nav.appendChild(nb);
    }
    VIEW.appendChild(nav);

    /* 本模块走完之后去哪 */
    if (u.flow && u.flow.to) {
      var nextTrack = el('div', 'flowbox next');
      nextTrack.innerHTML = '<b>' + (ti === inTrack.length - 1 ? '本模块结束了，下一步：' : '学完之后：') +
        '</b>' + u.flow.to;
      VIEW.appendChild(nextTrack);
    }
    global.scrollTo(0, 0);
    refreshProgress();
  }

  function route() {
    Audio.stop();      // 换页时掐掉正在播放的声音，否则会一直响
    var h = (global.location.hash || '#/').replace(/^#/, '');
    var m;
    if ((m = /^\/u\/(.+)$/.exec(h))) pageUnit(safeDecode(m[1]));
    else if ((m = /^\/t\/(.+)$/.exec(h))) pageTrack(safeDecode(m[1]));
    else pageHome();
  }

  SITE.start = function () {
    VIEW = document.getElementById('view');
    TRACKNAV = document.getElementById('tracknav');
    document.getElementById('brand').onclick = function () { go('#/'); };

    /* 地址栏配色跟着主题走。index.html 里给了浅/深两套 theme-color，
       手动切换后要一并覆盖 —— 这段逻辑放在 scoremeta.js 里，
       以免两处各写一份、改一处忘一处。 */
    function syncThemeColor(t) {
      if (global.SCORE_META && global.SCORE_META.syncThemeColor) global.SCORE_META.syncThemeColor(t);
    }

    var theme = Store.get('theme', 'light');
    document.documentElement.setAttribute('data-theme', theme);
    syncThemeColor(theme);
    document.getElementById('themeBtn').onclick = function () {
      theme = theme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      syncThemeColor(theme);
      Store.set('theme', theme);
    };

    document.getElementById('footLinks').innerHTML = (function () {
      /* 页脚链接来自 site.config.js 的 footerLinks，改配置即可增删，
         不需要动这个文件。href 以 # 开头的走站内路由，其余当普通链接。 */
      var cfg = global.SITE_CONFIG || {};
      var links = cfg.footerLinks || [
        { text: '关于本站 · 免责声明', href: 'docs/关于本站.html' },
        { text: '全部单元', href: '#/t/all' }
      ];
      return links.map(function (l) {
        if (!l || !l.href) return '';
        var isRoute = String(l.href).charAt(0) === '#';
        var href = isRoute ? l.href : encodeURI(l.href);
        return '<a href="' + esc(href) + '">' + esc(l.text || l.href) + '</a>';
      }).join('');
    })();
    var footNote = document.getElementById('footNote');
    if (footNote && (global.SITE_CONFIG || {}).footerNote) {
      footNote.textContent = global.SITE_CONFIG.footerNote;
    }

    global.addEventListener('hashchange', route);
    route();
  };

  global.SITE = SITE;
})(typeof window !== 'undefined' ? window : globalThis);
