/* ==========================================================================
 * theory/examples.js — 谱例库
 * --------------------------------------------------------------------------
 * 每条谱例都必须先通过 tools/verify.js 的规则检查，才能进入课程。
 * deliberate: true 表示这是「故意写错」的教学反例，用来展示规则；
 * 反例必须同时写 expect: 'H01'，声明【要证哪一条规则】——
 * verify.js 会要求那条规则真的报出来，而不是"随便报了个错"就算过。
 * 每条规则各自的覆盖率由 tools/check-rules.js 守。
 * ========================================================================== */
(function (global) {
  'use strict';

  var EXAMPLES = [];

  function add(spec) { EXAMPLES.push(spec); return spec; }

  /* ---------------------------------------------------------------- 第一类 */

  /* 范例：C 大调，CF 在上（高音谱号），CP 在下（低音谱号），一音对一音 */
  add({
    id: 'sp1-good',
    title: '第一类对位（一音对一音）· 合规范例',
    species: 1, key: 'C', meter: '4/4', tempo: 60,
    cfClef: 'treble', cpClef: 'bass',
    cf: 'C5:4 | D5:4 | E5:4 | F5:4 | G5:4 | F5:4 | E5:4 | D5:4 | C5:4',
    cp: 'C4:4 | B3:4 | C4:4 | D4:4 | E4:4 | F4:4 | C4:4 | B3:4 | C4:4',
    note: '全部音程均为协和音程；以八度起、八度止；倒数第二个强拍是小三度，两声部反向级进进入八度终止。'
  });

  /* 反例 1：平行五度 + 隐伏八度 */
  add({
    id: 'sp1-bad-parallel',
    title: '反例 A：平行五度',
    species: 1, key: 'C', meter: '4/4', tempo: 60,
    deliberate: true, expect: 'H01',
    cfClef: 'treble', cpClef: 'bass',
    cf: 'C5:4 | D5:4 | E5:4 | F5:4 | C5:4',
    cp: 'F3:4 | G3:4 | A3:4 | Bb3:4 | C4:4',
    note: '第 2→3 小节两声部同向，纯五度接纯五度 = 平行五度；第 4 小节还出现增四度与错误的终止式。'
  });

  /* 反例 2：平行八度 + 声部交错 */
  add({
    id: 'sp1-bad-octave',
    title: '反例 B：平行八度与声部交错',
    species: 1, key: 'C', meter: '4/4', tempo: 60,
    deliberate: true, expect: 'H02',
    cfClef: 'treble', cpClef: 'bass',
    cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C4:4 | D4:4 | E4:4 | G4:4',
    note: '第 1→3 小节是连续平行八度；最后一小节 CP 高于 CF 造成声部交错。'
  });

  /* 反例 3：全部用不完全协和，但终止式不成立 */
  add({
    id: 'sp1-bad-cadence',
    title: '反例 C：终止式不成立',
    species: 1, key: 'C', meter: '4/4', tempo: 60,
    deliberate: true, expect: 'E03',
    cfClef: 'treble', cpClef: 'bass',
    cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'E4:4 | F4:4 | G4:4 | E4:4',
    note: '结束不是八度；两声部同向级进，完全没有终止式。'
  });

  /* ---------------------------------------------------------------- 第二类 */

  add({
    id: 'sp2-basic',
    title: '第二类对位（二音对一音）· 合规范例',
    species: 2, key: 'C', meter: '4/4', tempo: 60,
    cfClef: 'treble', cpClef: 'bass',
    cf: 'C5:4 | D5:4 | E5:4 | F5:4 | G5:4 | F5:4 | E5:4 | D5:4 | C5:4',
    cp: 'C4:2 A3:2 | B3:2 D4:2 | C4:2 E4:2 | D4:2 D4:2 | E4:2 E4:2 | D4:2 D4:2 | E4:2 C4:2 | B3:2 B3:2 | C4:4',
    note: '由 tools/generate.js 求解、经检查器验证（0 错误 0 提示）。强拍一律协和；第 1 小节弱拍 A3 对 C5 是小三度协和，第 2 小节弱拍 D4 对 D5 是八度。'
  });

  global.EXAMPLES = EXAMPLES;
  if (typeof module !== 'undefined' && module.exports) module.exports = EXAMPLES;

})(typeof window !== 'undefined' ? window : globalThis);
