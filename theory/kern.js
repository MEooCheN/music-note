/* ==========================================================================
 * theory/kern.js — Humdrum **kern 解析器（只解析我们需要的部分）
 * --------------------------------------------------------------------------
 * 为什么要它：Fux《Gradus ad Parnassum》的全部对位练习在
 * github.com/MarkGotham/species 上有 .krn 纯文本版本（CC0 公有领域）。
 * 有了它，范例就不必由我生成，而是可以直接用 Fux 本人的解答。
 *
 * 支持的 kern 语法（够用即可，不是完整实现）：
 *   时值   0=倍全 1=全 2=二分 4=四分 8=八分 6=十六分 3=三十二分；后缀 . 为附点
 *   音高   小写 c=中央C 所在八度(4)，每多一个小写字母升八度：cc = C5
 *          大写 C=低八度(3)，每多一个大写字母再降八度：CC = C2
 *          变音  # 升、- 降、n 还原（可重复：## 重升）
 *   记号   / \ 符干方向；X 编辑性临时记号（musica ficta）；[ ] _ 连线相关
 *          —— 这些后缀对音高与时值没有影响，解析时剥掉
 *   .      延音（前一个音继续发声）
 *   r      休止
 *   =n     小节线    *= 与 ! 开头的是解释行/注释
 * ========================================================================== */
(function (global) {
  'use strict';

  var DUR_BY_RECIP = { '0': 8, '1': 4, '2': 2, '4': 1, '8': 0.5, '6': 0.25, '3': 0.125 };
  var SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var TOKEN_RE = /^(\d+)(\.*)([A-Ga-g]+)(n|#+|-+)?(.*)$/;

  /** kern 音名 → MIDI。c=中央C(60 附近的 C4)，大写低一个八度。 */
  function kernPitchToMidi(letters, acc) {
    var letter = letters[0].toUpperCase();
    var n = letters.length;
    var octave = letters[0] === letters[0].toUpperCase() && letters[0] !== letters[0].toLowerCase()
      ? 4 - n        // 大写：C = 3，CC = 2
      : 3 + n;       // 小写：c = 4，cc = 5
    var a = 0;
    if (acc) {
      if (acc[0] === '#') a = acc.length;
      else if (acc[0] === '-') a = -acc.length;
      else if (acc[0] === 'n') a = 0;
    }
    return { midi: (octave + 1) * 12 + SEMI[letter] + a, octave: octave, letter: letter, acc: a };
  }

  function midiName(m) {
    var names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  /**
   * 解析一份 .krn 文本。
   * @returns {{meta:Object, spines:number, meter:string, voices:Array}}
   *   voices[i] = { index, kern: 'partN', notes: [{midi,durQ,kern,bar,rest}] }
   */
  function parse(text) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var meta = {};
    var meter = '4/4';
    var voiceNames = [];
    var voices = [];
    var bar = 0;
    var needNew = null;      // 每个声部"上一个音是否仍在小节内延续"
    var lastDur = null;

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line) return;

      /* 元数据：图号/类别/调式/CF 位置藏在一行 LO:TX 注释里。
         两个坑：(1) 这行以单个 ! 开头，且内容在制表符分隔的第二列；
         (2) 原文件里冒号写成 HTML 实体 &colon;。 */
      var norm = line.replace(/&colon;/g, ':');
      var t = /Species:\s*(\d+)/.exec(norm);
      if (t) meta.species = parseInt(t[1], 10);
      var f = /Fig\.\s*([0-9]+[ab]?)/.exec(norm);
      if (f) meta.figure = f[1];
      var mf = /Modal final:\s*([a-gA-G])/.exec(norm);
      if (mf) meta.modalFinal = mf[1].toLowerCase();
      var cf = /Cantus firmus:\s*(Lower|Upper)/i.exec(norm);
      if (cf) meta.cfPosition = cf[1].toLowerCase();

      if (line.indexOf('!!!') === 0 || line.indexOf('!!') === 0) return;
      if (line.indexOf('**') === 0) {
        voiceNames = line.split('\t').map(function (s, i) { return s.replace(/^\*\*/, '') || ('spine' + i); });
        voices = voiceNames.map(function (n, i) { return { index: i, kern: n, notes: [] }; });
        needNew = voices.map(function () { return true; });
        return;
      }
      if (line.indexOf('*') === 0) {
        var mm = /^\*M\s*(\d+)\s*\/\s*(\d+)/.exec(line);
        if (mm) meter = mm[1] + '/' + mm[2];
        /* 谱号会改变【实际音高】，不只是排版：
             *clefGv2 = 声乐次中音谱号，实际发音比记谱低八度
             *clefF4  = 低音谱号（不移位）
             *clefG2  = 高音谱号（不移位）
           曾经忽略了这个 v，于是三声部谱例里的低音声部整体读高了一个八度，
           连带把 Fux 的正常写法误判成声部交错。 */
        line.split('\t').forEach(function (tok, i) {
          if (!voices[i]) return;
          var cm = /^\*clef([A-Ga-g])(v?)(\d)/.exec(tok.trim());
          if (!cm) return;
          voices[i].octaveShift = cm[2] === 'v' ? -12 : 0;
          /* 谱号本身也记下来：要把语料导出成五线谱（tools/kern-to-musicxml.js）
             就得知道每个声部用什么谱号，靠音域猜会在中音区出错。 */
          voices[i].clef = {
            sign: cm[1].toUpperCase(), line: parseInt(cm[3], 10),
            octaveShift: cm[2] === 'v' ? -12 : 0
          };
        });
        return;
      }
      if (line.indexOf('=') === 0) { bar++; return; }
      if (line.indexOf('!') === 0) return;

      var toks = line.split('\t');
      toks.forEach(function (tok, i) {
        if (!voices[i]) return;
        tok = tok.trim();
        if (!tok) return;
        if (tok === '.') return;                       // 延音，不产生新音
        var tokClean = tok.replace(/[\/\\X\[\]_<>]+/g, '').replace(/[LJ]+$/, '');   // 剥掉与音高时值无关的后缀

        /* 休止符：kern 写作 <时值>r，例如 2r = 二分休止、4r = 四分休止。
           曾经这里写成 /^r+$/，凡是带时值前缀的休止全被静默丢弃，
           于是小节时长错位——第一、二、三类没有休止符所以看不出来，
           第四、五类开头都有休止，整条练习就被错位了。 */
        var rm = /^(\d+)(\.*)r+$/.exec(tokClean);
        if (rm) {
          var rd = DUR_BY_RECIP[rm[1]];
          if (rd === undefined) return;
          for (var q = 0; q < rm[2].length; q++) rd *= 1.5;
          voices[i].notes.push({ rest: true, durQ: rd, bar: bar });
          return;
        }

        var m = TOKEN_RE.exec(tokClean);
        if (!m) return;
        var base = DUR_BY_RECIP[m[1]];
        if (base === undefined) return;
        var dur = base;
        for (var d = 0; d < m[2].length; d++) dur *= 1.5;   // 附点
        var p = kernPitchToMidi(m[3], m[4]);
        var shift = voices[i].octaveShift || 0;
        voices[i].notes.push({
          midi: p.midi + shift, name: midiName(p.midi + shift), durQ: dur, bar: bar
        });
      });
    });

    return { meta: meta, spines: voices.length, meter: meter, voices: voices, barCount: bar };
  }

  /** 把某个声部转成本站通用的文字记谱（'C4:4 | D4:4'），便于接检查器 */
  function toNoteString(voice, meter) {
    var m = /^(\d+)\/(\d+)$/.exec(meter || '4/4');
    var barQ = m ? parseInt(m[1], 10) * (4 / parseInt(m[2], 10)) : 4;
    var out = [], acc = 0;
    voice.notes.forEach(function (n) {
      if (n.rest) { out.push('R:' + n.durQ); acc += n.durQ; return; }
      out.push(n.name + ':' + n.durQ);
      acc += n.durQ;
      while (acc >= barQ - 1e-9) { out.push('|'); acc -= barQ; }
    });
    var s = out.join(' ');
    return s.replace(/\s*\|(\s*\|)+\s*/g, ' | ').replace(/\|\s*$/, '').trim();
  }

  /** 判断一个声部是否全是全音符（Fux 的固定旋律一律是全音符） */
  function isAllWhole(voice) {
    return voice.notes.length > 0 && voice.notes.every(function (n) { return Math.abs(n.durQ - 4) < 1e-9; });
  }

  global.TH = global.TH || {};
  global.TH.kern = {
    parse: parse, toNoteString: toNoteString, isAllWhole: isAllWhole,
    midiName: midiName, kernPitchToMidi: kernPitchToMidi
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.TH.kern;

})(typeof window !== 'undefined' ? window : globalThis);
