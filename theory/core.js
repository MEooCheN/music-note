/* ==========================================================================
 * theory/core.js — 乐理基础层（零依赖，Node 与浏览器通用）
 * --------------------------------------------------------------------------
 * 只做三件事：音高换算、音程判定、把谱例文本解析成可计算模型。
 * 不含任何渲染代码——谱面渲染全部交给 MuseScore。
 * ========================================================================== */
(function (global) {
  'use strict';

  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var LETTER_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  var LETTER_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  /* 音名 → 音高对象。写法：C4 / C#4 / Db4 / Bb3 / F#5 */
  var PITCH_RE = /^([A-Ga-g])([#b]?)(-?\d)$/;

  function pitch(str) {
    var m = PITCH_RE.exec(String(str).trim());
    if (!m) throw new Error('无法识别的音名：' + str);
    var letter = m[1].toUpperCase();
    var acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    var octave = parseInt(m[3], 10);
    return {
      str: letter + (acc === 1 ? '#' : acc === -1 ? 'b' : '') + octave,
      letter: letter, acc: acc, octave: octave,
      midi: (octave + 1) * 12 + LETTER_SEMI[letter] + acc,
      diatonic: octave * 7 + LETTER_INDEX[letter]
    };
  }

  function midiToName(m) {
    var names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }
  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* ------------------------------------------------------------------ 音程 */

  /* 音程度数 → 大调音阶上的半音数（用来判断性质） */
  var MAJOR_SEMI = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
  var QUAL_ZH = {
    P: '纯', M: '大', m: '小', A: '增', d: '减', AA: '倍增', dd: '倍减'
  };

  /**
   * 音程判定：同时用「音名级数」和「半音数」定性质。
   * 这样 B–Eb（减四度）不会被误判成大三度——记谱写法会影响协和判定，
   * 这正是严格对位里必须区分的地方。
   * @param {Object} low  较低音的 pitch 对象
   * @param {Object} high 较高音的 pitch 对象
   */
  function intervalBetween(low, high) {
    var steps = high.diatonic - low.diatonic;      // 音名级数差
    var semi = high.midi - low.midi;               // 实际半音数
    var ascending = semi >= 0;
    var genericFull = Math.abs(steps) + 1;         // 真实度数：8 = 八度，12 = 十二度
    /* 归约到 1..7 只用于"判断性质与协和类别"；八度归约为 1，两者都是完全协和。
       但显示名称必须用真实度数，否则八度会被写成"纯1度"。 */
    var simpleNum = ((genericFull - 1) % 7) + 1;
    var octaves = Math.floor((genericFull - 1) / 7);
    var baseSemi = MAJOR_SEMI[simpleNum] + 12 * octaves;
    var signedSemi = Math.abs(semi);
    var diff = signedSemi - baseSemi;
    var quality;
    if (simpleNum === 1 || simpleNum === 4 || simpleNum === 5) {
      quality = diff === 0 ? 'P' : diff === 1 ? 'A' : diff === -1 ? 'd'
        : diff === 2 ? 'AA' : 'dd';
    } else {
      quality = diff === 0 ? 'M' : diff === -1 ? 'm' : diff === -2 ? 'd'
        : diff === 1 ? 'A' : diff === 2 ? 'AA' : 'dd';
    }
    var cls;
    if (quality === 'P' && (simpleNum === 1 || simpleNum === 5)) cls = 'perfect';
    else if ((quality === 'M' || quality === 'm') && (simpleNum === 3 || simpleNum === 6)) cls = 'imperfect';
    else cls = 'dissonant';

    return {
      semitones: signedSemi,
      steps: steps,
      ascending: ascending,
      generic: genericFull,
      displayNum: genericFull,
      simpleNum: simpleNum,
      compound: octaves > 0,
      quality: quality,
      perfectType: (simpleNum === 1 || simpleNum === 4 || simpleNum === 5),
      name: QUAL_ZH[quality] + genericFull + '度',
      zh: QUAL_ZH[quality] + genericFull + '度',
      class: cls
    };
  }

  /* 兼容：只知道 MIDI 时按等音近似判定（会丢失写法信息，仅作兜底） */
  function intervalOf(lowMidi, highMidi) {
    var names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    function toP(m) { return pitch(names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1)); }
    return intervalBetween(toP(lowMidi), toP(highMidi));
  }

  function isConsonant(iv) { return iv.class === 'perfect' || iv.class === 'imperfect'; }
  function isPerfectConsonance(iv) { return iv.class === 'perfect'; }

  /* ------------------------------------------------------- 谱例文本解析 */

  /*
   * notes 写法： "C5:2 B4:1 A4:1 | G4:2 A4:2"
   *   音名:时值（时值以四分音符为单位，省略 = 1）
   *   休止符写作 R，例 "R:2"
   *   "|" 是小节线；小节线只作校验，不影响计算
   */
  var TOKEN_RE = /\||[^\s|]+/g;

  function parseVoiceNotes(str, warnings, who) {
    var tokens = String(str).match(TOKEN_RE) || [];
    var out = [], bar = 1, accState = {}, lastOct = null;
    tokens.forEach(function (tok) {
      if (tok === '|') { bar++; accState = {}; return; }
      var parts = tok.split(':');
      var head = parts[0];
      var dur = parts.length > 1 ? parseFloat(parts[1]) : 1;
      if (head === 'R' || head === 'r') { out.push({ rest: true, dur: dur, bar: bar }); return; }

      var m = /^([A-Ga-g])([#b]?)(\d)?$/.exec(head);
      if (!m) { warnings.push(who + '：无法识别「' + tok + '」'); return; }
      var letter = m[1].toUpperCase();
      var accCh = m[2];
      var oct = m[3] ? parseInt(m[3], 10) : (lastOct === null ? 4 : lastOct);
      lastOct = oct;
      var p = pitch(letter + accCh + oct);
      out.push({ p: p, midi: p.midi, dur: dur, bar: bar, hasAcc: accCh !== '' });
    });
    return out;
  }

  /**
   * 造一个可计算的谱例模型。
   * spec = {
   *   id, title, species:1..5, key:'C', meter:'4/4', tempo,
   *   cf:  'C5:2 B4:1 A4:1 | ...',       // cantus firmus（固定旋律）
   *   cp:  'C4:2 D4:1 E4:1 | ...',       // counterpoint（对位声部）
   *   cfClef:'treble', cpClef:'bass',
   *   cfAbove:false                       // CF 是否在上方
   * }
   */
  function makeScore(spec) {
    var warnings = [];
    var cf = parseVoiceNotes(spec.cf || '', warnings, 'CF');
    var cp = parseVoiceNotes(spec.cp || '', warnings, 'CP');
    var cfSounding = cf.filter(function (n) { return !n.rest; });
    var cpSounding = cp.filter(function (n) { return !n.rest; });

    /* 时点对齐：把两个声部展开成 {onset, dur, midi} 序列 */
    function expand(list) {
      var t = 0;
      return list.map(function (n) {
        var e = { onset: t, dur: n.dur, midi: n.rest ? null : n.midi, bar: n.bar, src: n };
        t += n.dur;
        return e;
      });
    }
    var cfE = expand(cf), cpE = expand(cp);
    var total = Math.max(cfE.length ? cfE[cfE.length - 1].onset + cfE[cfE.length - 1].dur : 0,
      cpE.length ? cpE[cpE.length - 1].onset + cpE[cpE.length - 1].dur : 0);

    return {
      id: spec.id || '', title: spec.title || '', species: spec.species || 1,
      key: spec.key || 'C', meter: spec.meter || '4/4', tempo: spec.tempo || 66,
      cfClef: spec.cfClef || 'treble', cpClef: spec.cpClef || 'bass',
      cfAbove: !!spec.cfAbove,
      cf: cf, cp: cp, cfE: cfE, cpE: cpE,
      totalQ: total,
      warnings: warnings
    };
  }

  /** 取某一时点上正在发声的事件（用于纵向音程判定） */
  function soundingAt(events, onset) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.onset <= onset + 1e-9 && onset < e.onset + e.dur - 1e-9) return e;
    }
    return null;
  }

  /** 取所有"有音高变化"的时点（纵向检查点） */
  function onsetGrid(score) {
    var s = {};
    score.cfE.concat(score.cpE).forEach(function (e) { if (e.midi !== null) s[e.onset] = true; });
    return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  }

  global.TH = global.TH || {};
  global.TH.pitch = pitch;
  global.TH.midiToName = midiToName;
  global.TH.freq = freq;
  global.TH.intervalOf = intervalOf;
  global.TH.intervalBetween = intervalBetween;
  global.TH.isConsonant = isConsonant;
  global.TH.isPerfectConsonance = isPerfectConsonance;
  global.TH.makeScore = makeScore;
  global.TH.soundingAt = soundingAt;
  global.TH.onsetGrid = onsetGrid;
  global.TH.LETTERS = LETTERS;

})(typeof window !== 'undefined' ? window : globalThis);
