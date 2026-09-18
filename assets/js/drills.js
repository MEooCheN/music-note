/* ==========================================================================
 * drills.js — 练习引擎
 * --------------------------------------------------------------------------
 * 三种练习：
 *   quiz  选择题（讲解固定）
 *   spot  找错：播放一段二声部，你判断违反了哪条规则
 *         —— 判定不看预设答案，而是现场跑规则检查器，答案由检查器给出
 *   label DCML 和声标签填空：用 DCML 官方正则校验语法
 * ========================================================================== */
(function (global) {
  'use strict';

  var SITE = global.SITE, esc = SITE.esc, el = SITE.el;

  /* ---- DCML 官方和声标签语法（v2.3.0，文档版） ----
     注意版本：仓库发布的 harmony.py 与文档版不一致，已实测确认两处缺陷 ——
       ① 终止式组漏了 PC（只有 HC|PAC|IAC|DC|EC）；
       ② 终止式的竖线漏了转义（VERBOSE 模式下被当成"空分支"分隔符），
          导致连 V|HC} 都匹配不上，而 VHC} 反而能过。
     本站采用【文档版】（含 PC + 转义竖线），因为那是能工作的那一版。
     结构： (调号.)?(局部调.)?(持续音[)? 和弦 (|终止式)? (乐句标记)?
     例： Ab.vi.i   V7/V   I(^2)   V|HC}   .G.I6   Fr43   Ger65        */
  var NUM = 'VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i';
  var ACC = '(b*|#*)';
  var DCML_RE = new RegExp(
    '^(\\.?' +
      '(([a-gA-G](b*|#*))\\.)?' +                                   // 全局调
      '(' + ACC + '(' + NUM + ')\\.)?' +                            // 局部调
      '(' + ACC + '(' + NUM + ')\\[)?' +                            // 持续音开始
      '(' + ACC + '(' + NUM + '|Ger|It|Fr|@none))' +                // 罗马数字
      '(%|o|\\+|M|\\+M)?' +                                         // 和弦形态
      '(7|65|43|42|2|64|6)?' +                                      // 数字低音
      '(\\(((\\+|-|\\^|v)?' + ACC + '\\d)+\\))?' +                  // 变化音
      '(/((b*|#*)(' + NUM + ')/?)*)?' +                             // 副属/离调
      '(\\])?' +
    ')?' +
    '(\\|((HC|PAC|IAC|DC|EC|PC)(\\..+?)?))?' +                      // 终止式
    '(\\\\|\\{|\\}|\\}\\{)?$'                                       // 乐句标记
  );

  var NUM_ZH = {
    I: '主', II: '上主', III: '中', IV: '下属', V: '属', VI: '下中', VII: '导',
    i: '主', ii: '上主', iii: '中', iv: '下属', v: '属', vi: '下中', vii: '导'
  };

  /* 把标签拆成可读的中文说明——这本身就是最好的教学 */
  function explainLabel(lab) {
    var m = DCML_RE.exec(lab);
    if (!m) return null;
    var out = [];
    if (m[3]) out.push('全局调 ' + m[3]);
    if (m[7]) out.push('局部调 ' + m[7]);
    if (m[11]) out.push('持续音 ' + m[11]);
    if (m[14]) {
      var s = '和弦：' + m[14] + ' 级（' + (NUM_ZH[m[14]] || m[14]) + '）';
      if (m[17]) s += '，形态 ' + m[17];
      if (m[18]) s += '，数字低音 ' + m[18];
      if (m[20]) s += '，变化音 ' + m[20];
      if (m[25]) s += '，相对根 ' + m[25];
      out.push(s);
    }
    if (m[28]) {
      var CAD = { PAC: '完全正格终止', IAC: '不完全正格终止', HC: '半终止',
        DC: '欺骗终止', EC: ' evasion 终止', PC: ' plagal 终止' };
      out.push('终止式 ' + m[28] + (CAD[m[28]] ? '（' + CAD[m[28]] + '）' : ''));
    }
    if (m[30]) {
      var PH = { '{': '乐句开始', '}': '乐句结构结束', '}{': '乐句交叠', '\\\\': '乐句结束（旧写法）' };
      out.push('乐句标记 ' + m[30] + '（' + (PH[m[30]] || '') + '）');
    }
    return out;
  }

  /* ------------------------------------------------------------ quiz */

  function buildQuiz(s, key) {
    var box = el('div', 'drill');
    if (s.title) box.appendChild(el('div', 'q', esc(s.title)));
    var opts = el('div', 'opts');
    var fb = el('div');
    var answered = false;
    (s.options || []).forEach(function (o, i) {
      var b = el('button', 'opt', esc(o.t || o));
      b.onclick = function () {
        if (answered) return;
        answered = true;
        var right = (o.ok === true) || (typeof s.answer === 'number' && i === s.answer);
        Array.prototype.forEach.call(opts.children, function (c, j) {
          c.disabled = true;
          var cright = (s.options[j].ok === true) || (typeof s.answer === 'number' && j === s.answer);
          if (cright) c.classList.add('right');
          else if (j === i) c.classList.add('wrong');
        });
        fb.className = 'feedback ' + (right ? 'ok' : 'bad');
        fb.innerHTML = (right ? '✓ 对。' : '✗ 不对。') +
          (o.why ? '<span class="why">' + o.why + '</span>' : '') +
          (s.why && !o.why ? '<span class="why">' + s.why + '</span>' : '');
        if (right) SITE.store.drillOk(key);
      };
      opts.appendChild(b);
    });
    box.appendChild(opts);
    box.appendChild(fb);
    return box;
  }

  /* ------------------------------------------------------------ spot */

  /* 找错：答案由 counterpoint.js 现场判定，不依赖预设 */
  function buildSpot(s, key) {
    var box = el('div', 'drill');
    box.appendChild(el('div', 'q', esc(s.title || '听辨并找出问题')));

    var TH = global.TH, CP = global.CP;
    var score = TH.makeScore({
      cf: s.cf, cp: s.cp, species: s.species || 1, key: s.key || 'C',
      meter: s.meter || '4/4', cfClef: s.cfClef || 'treble', cpClef: s.cpClef || 'bass'
    });
    var res = CP.check(score);
    var errIds = res.messages.filter(function (m) { return m.level === 'error'; }).map(function (m) { return m.id; });

    var row = el('div', 'playrow');
    row.appendChild(SITE.playButton({
      label: '▶ 只听固定旋律', notes: s.cf.replace(/\|/g, ' '), tempo: s.tempo || 66
    }));
    row.appendChild(SITE.playButton({
      label: '▶ 只听对位声部', notes: s.cp.replace(/\|/g, ' '), tempo: s.tempo || 66, cls: 'btn ghost'
    }));
    /* 两个声部一起 = 两个声部各按自己的 onset/时值调度，共用一条时间轴。
       曾经这里是把两声部合成一个和弦串再播，而 parse 是顺序累加时值定位音的，
       合并串时值不首尾相接就会整体后漂——现在走 SITE.audio.playVoices。 */
    row.appendChild(SITE.playButton({
      label: '▶ 两个声部一起', notes: function () { return [s.cf, s.cp]; },
      tempo: s.tempo || 66, cls: 'btn ghost'
    }));
    box.appendChild(row);

    if (s.showNotes) {
      box.appendChild(el('div', 'sub',
        '<b>固定旋律</b> <code>' + esc(s.cf) + '</code><br><b>对位声部</b> <code>' + esc(s.cp) + '</code>'));
    }

    var opts = el('div', 'opts');
    var fb = el('div');
    var answered = false;
    (s.options || []).forEach(function (o) {
      var b = el('button', 'opt', esc(o.t));
      b.onclick = function () {
        if (answered) return;
        answered = true;
        var want = o.rule || null;                       // null = 声称"没问题"
        var right;
        if (want === null) right = errIds.length === 0;
        else right = errIds.indexOf(want) > -1;
        Array.prototype.forEach.call(opts.children, function (c) { c.disabled = true; });
        b.classList.add(right ? 'right' : 'wrong');
        fb.className = 'feedback ' + (right ? 'ok' : 'bad');
        var verdict = errIds.length
          ? '检查器判定：<b>违反</b> ' + errIds.join('、')
          : '检查器判定：<b>没有规则错误</b>';
        fb.innerHTML = (right ? '✓ 对。' : '✗ 不对。') +
          '<span class="why">' + verdict + '</span>' +
          '<span class="why report">' + reportHTML(res) + '</span>';
        if (right) SITE.store.drillOk(key);
      };
      opts.appendChild(b);
    });
    box.appendChild(opts);
    box.appendChild(fb);

    var det = el('button', 'btn ghost', '查看逐条判定');
    det.style.marginTop = '10px';
    det.onclick = function () {
      fb.className = 'feedback';
      fb.innerHTML = '<span class="report">' + reportHTML(res) + '</span>';
      det.disabled = true;
    };
    box.appendChild(det);
    return box;
  }

  function reportHTML(res) {
    if (!res.messages.length) return '  ✓ 未发现任何规则问题';
    return res.messages.map(function (m) {
      var loc = m.at ? '第' + (m.at.bar || '?') + '小节第' + (m.at.beat || '?') + '拍' : '';
      var tag = m.level === 'error' ? '<span class="e">✗ 错误</span>' : '<span class="w">⚠ 提示</span>';
      return '  ' + tag + ' [' + m.id + ' ' + esc(m.zh) + '] ' + esc(loc) +
        (m.detail ? ' — ' + esc(m.detail) : '');
    }).join('\n');
  }

  /* ----------------------------------------------------------- label */

  function buildLabel(s, key) {
    var box = el('div', 'drill');
    box.appendChild(el('div', 'q', esc(s.title || '写出这个和弦的 DCML 标签')));

    if (s.notes) {
      var row = el('div', 'playrow');
      row.appendChild(SITE.playButton({ label: '▶ 听这个和弦', notes: s.notes, tempo: 60 }));
      row.appendChild(el('code', null, esc(s.notes)));
      box.appendChild(row);
    }
    if (s.context) box.appendChild(el('div', 'sub', s.context));

    var row2 = el('div', 'playrow');
    var inp = el('input', 'text');
    inp.placeholder = s.placeholder || '例如 V7/V  或  Ab.vi.i';
    inp.spellcheck = false;
    var go = el('button', 'btn', '检查');
    row2.appendChild(inp); row2.appendChild(go);
    var show = el('button', 'btn ghost', '看参考答案');
    row2.appendChild(show);
    box.appendChild(row2);

    var fb = el('div');
    box.appendChild(fb);

    function judge() {
      var v = inp.value.trim();
      if (!v) return;
      var okSyntax = DCML_RE.test(v);
      var exp = (s.answers || []).map(function (x) { return x.trim(); });
      var okMatch = exp.length === 0 ? okSyntax : exp.indexOf(v) > -1;
      var lines = [];
      lines.push(okSyntax
        ? '<span class="g">✓ 语法正确</span>（符合 DCML v2.3.0 官方正则）'
        : '<span class="e">✗ 语法不通过</span>：不符合 DCML v2.3.0 官方正则');
      if (okSyntax) {
        explainLabel(v).forEach(function (x) { lines.push('　· ' + esc(x)); });
      }
      if (exp.length) {
        lines.push(okMatch
          ? '<span class="g">✓ 与参考答案一致</span>'
          : '<span class="w">⚠ 与参考答案不同</span>（DCML 允许多种合理标注，看下面的判定依据）');
      }
      fb.className = 'feedback ' + (okSyntax && okMatch ? 'ok' : okSyntax ? 'warn' : 'bad');
      fb.innerHTML = '<span class="report">' + lines.join('\n') + '</span>' +
        (s.why ? '<span class="why">' + s.why + '</span>' : '');
      if (okSyntax && okMatch) SITE.store.drillOk(key);
    }
    go.onclick = judge;
    inp.onkeydown = function (e) { if (e.key === 'Enter') judge(); };
    show.onclick = function () {
      var a = (s.answers || []).join('　或　');
      fb.className = 'feedback';
      fb.innerHTML = '<span class="report">参考答案：' + esc(a) + '</span>' +
        (s.why ? '<span class="why">' + s.why + '</span>' : '');
    };
    return box;
  }

  /* ------------------------------------------------------------ 导出 */

  global.DRILLS = {
    build: function (s, key) {
      if (s.drill === 'spot') return buildSpot(s, key);
      if (s.drill === 'label') return buildLabel(s, key);
      return buildQuiz(s, key);
    },
    DCML_RE: DCML_RE,
    explainLabel: explainLabel
  };

})(typeof window !== 'undefined' ? window : globalThis);
