/* ==========================================================================
 * theory/musicxml.js — MusicXML 写出器（与 theory/kern.js 相对：那个读，这个写）
 * --------------------------------------------------------------------------
 * 为什么需要它：网站上的五线谱一律由 MuseScore 从 MusicXML 导出
 * （tools\build-scores.ps1）。站内有两类谱面来源，都要先变成 MusicXML：
 *   · Fux 语料（.krn）        → tools/kern-to-musicxml.js
 *   · 站内自己的文字记谱       → tools/notes-to-musicxml.js
 * 两边的时值切分、跨小节线连音线、小节补齐是同一套逻辑，所以放在这里写一次。
 *
 * 已经踩过的三个坑，都在下面处理掉了：
 *   ① 时值必须落在"可记谱"的位置上（基本时值 × 附点），
 *      所以切分点一律用 fit() 取"不超过它的最长可记谱时值"，而不是硬切。
 *   ② 跨小节线的音必须拆开并加延音线，否则谱面会写成两个音，挂留就读错了。
 *   ③ 各声部小节数必须一致，缺的地方用休止符补齐，否则各声部对不齐。
 *
 * 只做 4/4、2/2 这类"每小节拍数固定"的拍号；临时记号一律写在音上
 * （fifths 恒为 0），因为这正是 Fux 调式写法与站内文字记谱的表达方式。
 * ========================================================================== */
(function (global) {
  'use strict';

  var TH = global.TH;
  if (!TH) throw new Error('theory/musicxml.js 需要先加载 theory/core.js');

  var DIV = 4;                                  // 每个四分音符的 divisions（whole = 16）
  var TYPE_OF = { 4: 'whole', 2: 'half', 1: 'quarter', 0.5: 'eighth', 0.25: '16th', 0.125: '32nd' };
  var CANDS = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125];

  /** 时值 → { type, dots }；不是"基本时值 × 附点"就返回 null
   *  注意附点的算法：n 个附点把基本时值乘上 (2 − 2^-n)。
   *  曾经写成 base × 1.5^n，那只有【一个】附点是对的：
   *  双附点二分音符是 2×1.75 = 3.5 拍，不是 2×2.25 = 4.5 拍 ——
   *  于是 4.5 会被错标成"双附点二分"，MuseScore 照 type 画出来的时值就与 duration 不符。 */
  function notatable(d) {
    for (var b = 0; b < 6; b++) {
      var base = [4, 2, 1, 0.5, 0.25, 0.125][b];
      for (var dots = 0; dots <= 3; dots++) {
        var value = base * (2 - Math.pow(0.5, dots));
        if (Math.abs(value - d) < 1e-9) return { type: TYPE_OF[base], dots: dots };
      }
    }
    return null;
  }

  /** 不超过 d 的最长可记谱时值（保证每个切分点都是可记谱的） */
  function fit(d) {
    for (var i = 0; i < CANDS.length; i++) if (CANDS[i] <= d + 1e-9) return CANDS[i];
    return null;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * 把一串音符切成"每小节的音符事件"，跨小节线的拆开并加延音线，
   * 每小节末尾不足的用休止符补齐。
   * @param {Array} notes [{name, midi, durQ, rest}] （name 为 null 表示休止）
   * @param {number} barQ 每小节拍数
   * @param {number} measureCount 小节总数
   * @returns {Array<Array>} measures[i] = 事件数组
   */
  function toMeasures(notes, barQ, measureCount) {
    var measures = [], mi = 0, pos = 0;
    function ensure() { while (measures.length <= mi) measures.push([]); }

    notes.forEach(function (n) {
      if (!(n.durQ > 0)) return;
      var left = n.durQ, pieces = [];
      while (left > 1e-9) {
        var take = fit(Math.min(left, barQ - pos));
        if (take === null) break;
        pieces.push({ mi: mi, name: n.rest ? null : n.name, durQ: take });
        pos += take;
        left -= take;
        if (pos >= barQ - 1e-9) { mi++; pos = 0; }
      }
      var joined = pieces.length > 1 && !n.rest;
      pieces.forEach(function (p, i) {
        if (joined) { p.tieStop = i > 0; p.tieStart = i < pieces.length - 1; }
        ensure();
        measures[p.mi].push(p);
      });
    });

    for (var k = 0; k < measureCount; k++) {
      if (!measures[k]) measures[k] = [];
      var used = measures[k].reduce(function (s, e) { return s + e.durQ; }, 0);
      while (barQ - used > 1e-9) {
        var pad = fit(barQ - used);
        if (pad === null) break;
        measures[k].push({ name: null, durQ: pad });
        used += pad;
      }
    }
    return measures.slice(0, measureCount);
  }

  function noteXML(ev) {
    var nt = notatable(ev.durQ);
    if (!nt) throw new Error('无法记谱的时值：' + ev.durQ);
    var dur = Math.round(ev.durQ * DIV);
    var p = ev.name === null || ev.name === undefined ? null : TH.pitch(ev.name);
    var out = ['      <note>'];
    if (p === null) {
      out.push('        <rest/>');
    } else {
      out.push('        <pitch><step>' + p.letter + '</step>' +
        (p.acc !== 0 ? '<alter>' + p.acc + '</alter>' : '') +
        '<octave>' + p.octave + '</octave></pitch>');
      if (ev.tieStop) out.push('        <tie type="stop"/>');
      if (ev.tieStart) out.push('        <tie type="start"/>');
    }
    out.push('        <duration>' + dur + '</duration>');
    out.push('        <type>' + nt.type + '</type>');
    for (var i = 0; i < nt.dots; i++) out.push('        <dot/>');
    if (p !== null) {
      if (ev.tieStop) out.push('        <tied type="stop"/>');
      if (ev.tieStart) out.push('        <tied type="start"/>');
      if (p.acc !== 0) {
        out.push('        <accidental>' + (p.acc === 1 ? 'sharp' : p.acc === -1 ? 'flat' : 'natural') + '</accidental>');
      }
    }
    out.push('      </note>');
    return out.join('\n');
  }

  function partXML(id, measures, clef, meter) {
    var m = /^(\d+)\/(\d+)$/.exec(String(meter || '4/4')) || [null, '4', '4'];
    var lines = ['  <part id="' + id + '">'];
    measures.forEach(function (evs, i) {
      lines.push('    <measure number="' + (i + 1) + '">');
      if (i === 0) {
        lines.push('      <attributes>');
        lines.push('        <divisions>' + DIV + '</divisions><key><fifths>0</fifths></key>');
        lines.push('        <time><beats>' + m[1] + '</beats><beat-type>' + m[2] + '</beat-type></time>');
        lines.push('        <clef><sign>' + clef.sign + '</sign><line>' + clef.line + '</line>' +
          (clef.octaveShift ? '<clef-octave-change>' + (clef.octaveShift / 12) + '</clef-octave-change>' : '') +
          '</clef>');
        lines.push('      </attributes>');
      }
      evs.forEach(function (ev) { lines.push(noteXML(ev)); });
      lines.push('    </measure>');
    });
    lines.push('  </part>');
    return lines.join('\n');
  }

  /**
   * 写出一份完整的 MusicXML（score-partwise）。
   * @param {Object} spec
   *   { workTitle, movementTitle, composer, rights, meter, parts:[{name, clef, notes}] }
   *   parts 的顺序就是谱表从上到下的顺序 —— 调用方负责按音高排好。
   *   clef = { sign:'G'|'F'|'C', line:2|4|3, octaveShift:0|-12 }
   *   notes = [{ name, durQ, rest }]（跨小节线的音可以是一个长 durQ，这里会拆）
   */
  function build(spec) {
    var meter = spec.meter || '4/4';
    var mm = /^(\d+)\/(\d+)$/.exec(meter) || [null, '4', '4'];
    var barQ = parseInt(mm[1], 10) * (4 / parseInt(mm[2], 10));
    var measureCount = spec.measureCount || spec.parts.reduce(function (max, p) {
      return Math.max(max, Math.ceil(p.notes.reduce(function (s, n) { return s + n.durQ; }, 0) / barQ));
    }, 0);

    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
    if (spec.comment) out.push('<!-- ' + esc(spec.comment) + ' -->');
    out.push('<score-partwise version="4.0">');
    if (spec.workTitle) out.push('  <work><work-title>' + esc(spec.workTitle) + '</work-title></work>');
    if (spec.movementTitle) out.push('  <movement-title>' + esc(spec.movementTitle) + '</movement-title>');
    if (spec.composer || spec.rights) {
      out.push('  <identification>');
      if (spec.composer) out.push('    <creator type="composer">' + esc(spec.composer) + '</creator>');
      if (spec.rights) out.push('    <rights>' + esc(spec.rights) + '</rights>');
      if (spec.software) out.push('    <encoding><software>' + esc(spec.software) + '</software></encoding>');
      out.push('  </identification>');
    }
    out.push('  <part-list>');
    /* 显式声明这是"大谱表"（括号 + 贯通小节线）：不写的话 MuseScore 会把
       每个 part 当成独立的一行各自折行，两个声部的小节就对不齐。 */
    if (spec.parts.length > 1) {
      out.push('    <part-group type="start" number="1"><group-symbol>bracket</group-symbol>' +
        '<group-barline>yes</group-barline></part-group>');
    }
    spec.parts.forEach(function (p, k) {
      out.push('    <score-part id="P' + (k + 1) + '"><part-name>' + esc(p.name || ('声部' + (k + 1))) + '</part-name>' +
        '<score-instrument id="P' + (k + 1) + '-I1"><instrument-name>Voice</instrument-name></score-instrument>' +
        '<midi-instrument id="P' + (k + 1) + '-I1"><midi-channel>' + (k + 1) + '</midi-channel>' +
        '<midi-program>54</midi-program></midi-instrument></score-part>');
    });
    if (spec.parts.length > 1) out.push('    <part-group type="stop" number="1"/>');
    out.push('  </part-list>');
    spec.parts.forEach(function (p, k) {
      out.push(partXML('P' + (k + 1), toMeasures(p.notes, barQ, measureCount), p.clef, meter));
    });
    out.push('</score-partwise>');
    return { xml: out.join('\n') + '\n', measureCount: measureCount, barQ: barQ };
  }

  /** 按音高从高到低排序（谱表顺序必须按音高，不能照数据里的声部顺序） */
  function orderByPitch(items) {
    return items.map(function (it, i) {
      var sounded = (it.notes || []).filter(function (n) { return !n.rest && n.name; })
        .map(function (n) { return TH.pitch(n.name).midi; }).sort(function (a, b) { return a - b; });
      return { it: it, i: i, median: sounded.length ? sounded[Math.floor(sounded.length / 2)] : 0 };
    }).sort(function (a, b) { return b.median - a.median; });
  }

  global.TH.musicxml = {
    DIV: DIV, notatable: notatable, fit: fit, toMeasures: toMeasures,
    build: build, orderByPitch: orderByPitch
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.TH.musicxml;

})(typeof window !== 'undefined' ? window : globalThis);
