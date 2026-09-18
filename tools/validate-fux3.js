#!/usr/bin/env node
/* ==========================================================================
 * tools/validate-fux3.js — 用 Fux 的三声部解答检验声部对检查
 * --------------------------------------------------------------------------
 * 与 validate-fux.js 同一个思路，但针对三声部。
 * 三声部新增的核心规则有两条（见 counterpoint.js 的 pairsCheck 注释）：
 *   1. 平行五/八度要在【三对声部】之间都查，不只看外声部；
 *   2. 纯四度在低音上方算协和，但在两个【上方声部之间】仍是不协和。
 *
 * 用法：node tools/validate-fux3.js [--verbose]
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'counterpoint.js'));
require(path.join(root, 'theory', 'kern.js'));
const TH = globalThis.TH, CP = globalThis.CP, K = TH.kern;

const VERBOSE = process.argv.indexOf('--verbose') > -1;
const dir = path.join(root, 'scores', 'fux');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.krn')).sort();

let done = 0, clean = 0;

files.forEach(f => {
  const sc = K.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (sc.spines < 3) return;                 // 只处理三声部及以上
  done++;

  const meter = sc.meter;
  const m = /^(\d+)\/(\d+)$/.exec(meter);
  const barQ = m ? parseInt(m[1], 10) * (4 / parseInt(m[2], 10)) : 4;

  /* 每个声部单独解析成事件序列 */
  const voices = sc.voices.map((v, i) => {
    const s = TH.makeScore({ cf: K.toNoteString(v, meter), cp: '', meter: meter });
    return { name: '声部' + (i + 1) + (i === 0 ? '(低)' : ''), events: s.cfE };
  });

  const r = CP.pairsCheck(voices, { barQ: barQ });

  console.log('─'.repeat(74));
  console.log(`【图 ${sc.meta.figure}】 第 ${sc.meta.species} 类对位　${meter}　` +
    `${sc.spines} 个声部　CF 在第 ${sc.meta.cfPosition || '?'} 声部　${f}`);

  if (VERBOSE) {
    r.pairs.forEach(p => console.log('   ' + p.name + '：' + p.intervals.join(' ')));
  }

  if (r.ok) {
    clean++;
    console.log(`  ✓ ${r.pairs.length} 对声部均无平行五度、平行八度、声部交错`);
  } else {
    console.log(`  ✗ 判出 ${r.errorCount} 项错误 —— 需逐条判断是检查器错还是约定不同：`);
    r.messages.filter(x => x.level === 'error').forEach(x =>
      console.log(`       [${x.id} ${x.zh}] ${x.detail}`));
  }
  r.messages.filter(x => x.level === 'warn').forEach(x =>
    console.log(`       ⚠ [${x.id} ${x.zh}] ${x.detail}`));
});

console.log('\n' + '='.repeat(74));
console.log(`共检验 ${done} 条三声部练习，其中 ${clean} 条完全干净。`);
console.log('');
console.log('本脚本【只查这一层】：三对声部之间的平行五/八度、声部交错。');
console.log('明确不查（原因见 counterpoint.js 的注释）：');
console.log('  · 纯四度 —— "两个上方声部之间的四度不协和"这句规则不能机械套用。');
console.log('    Fux 图 101 第 4 小节的 F3–A3–D4 就含一个上方声部间的纯四度（A3–D4），');
console.log('    而两个上方声部各自与低音协和，属于正常排列。自动判定会假阳性。');
console.log('  · 音型层面（经过音 / 辅助音 / cambiata / 挂留）——三声部尚未实现。');
