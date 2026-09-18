/* ==========================================================================
 * theory/fux.js — Fux 语料的共享知识（只在 tools/ 里用，页面不加载）
 * --------------------------------------------------------------------------
 * 这个文件只做一件事：认出一份 .krn 里哪个声部是固定旋律（CF）。
 *
 * 为什么不能靠"音区"或"全音符"猜：
 *   · 图 101 的三个声部【全是全音符】，按"全音符那个声部"猜会认成最低声部，
 *     而 Fux 的图 101 固定旋律在【最高】声部；
 *   · 图 154 的固定旋律在【中间】声部。
 * 唯一可靠的判据是：这个声部与 Fux 为该调式规定的固定旋律逐音吻合
 * （音级相同即可，允许整体八度移位；也允许开头缺一两个音 —— 图 42 就缺第一个音）。
 *
 * 这张表取自语料仓库 README 的表格并逐音核对过，
 * 原先写在 tools/validate-fux.js 里；导出五线谱（tools/kern-to-musicxml.js）
 * 也要用同一张表，所以提到这里，避免两处各写一份、改一处忘一处。
 * ========================================================================== */
(function (global) {
  'use strict';

  var TH = global.TH;
  if (!TH) throw new Error('theory/fux.js 需要先加载 theory/core.js');

  /* Fux 为每个调式规定的固定旋律（按调式终止音索引） */
  var FUX_CF = {
    d: [['D4', 'F4', 'E4', 'D4', 'G4', 'F4', 'A4', 'G4', 'F4', 'E4', 'D4']],
    e: [['E4', 'C4', 'D4', 'C4', 'A3', 'A4', 'G4', 'E4', 'F4', 'E4']],
    f: [['F3', 'G3', 'A3', 'F3', 'D3', 'E3', 'F3', 'C4', 'A3', 'F3', 'G3', 'F3']],
    g: [['G3', 'C4', 'B3', 'G3', 'C4', 'E4', 'D4', 'G4', 'E4', 'C4', 'D4', 'B3', 'A3', 'G3']],
    a: [['A3', 'C4', 'B3', 'D4', 'C4', 'E4', 'F4', 'E4', 'D4', 'C4', 'B3', 'A3']],
    c: [
      ['C4', 'E4', 'F4', 'G4', 'E4', 'A4', 'G4', 'E4', 'F4', 'E4', 'D4', 'C4'],
      ['C4', 'D4', 'F4', 'E4', 'G4', 'E4', 'F4', 'E4', 'D4', 'C4']
    ]
  };

  function pcOfName(name) { return ((TH.pitch(name).midi % 12) + 12) % 12; }

  /**
   * 这个声部是不是给定调式的固定旋律？
   * @returns {{ok:boolean, skip:number, got?:string, expected?:string}}
   *   skip = 开头被跳过的音数（Fux 有些练习的 CF 缺开头一两个音）
   */
  function matchCF(voice, finalLetter) {
    var cands = FUX_CF[finalLetter] || [];
    var got = voice.notes.map(function (n) { return n.rest ? -1 : pcOfName(n.name); });
    if (got.indexOf(-1) >= 0) return { ok: false, skip: 0 };
    for (var c = 0; c < cands.length; c++) {
      var want = cands[c].map(pcOfName);
      for (var skip = 0; skip <= 2; skip++) {
        var g = got.slice(skip);
        if (g.length !== want.length) continue;
        var same = true;
        for (var i = 0; i < g.length; i++) if (g[i] !== want[i]) { same = false; break; }
        if (same) return { ok: true, skip: skip };
      }
    }
    return {
      ok: false, skip: 0,
      got: got.join(','),
      expected: cands.map(function (x) { return x.join(','); }).join(' / ')
    };
  }

  /** 在多个声部里找固定旋律，返回下标；找不到返回 -1 */
  function findCFVoice(voices, finalLetter) {
    for (var i = 0; i < voices.length; i++) if (matchCF(voices[i], finalLetter).ok) return i;
    return -1;
  }

  global.TH.fux = {
    FUX_CF: FUX_CF, matchCF: matchCF, findCFVoice: findCFVoice, pcOfName: pcOfName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.TH.fux;

})(typeof window !== 'undefined' ? window : globalThis);
