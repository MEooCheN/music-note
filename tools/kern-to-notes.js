#!/usr/bin/env node
/* ==========================================================================
 * tools/kern-to-notes.js — 把 .krn 语料转成本站通用的文字记谱
 * --------------------------------------------------------------------------
 * 用途：往学习单元里贴谱例时，不必手抄音符，直接从这里复制。
 *
 * 用法：
 *   node tools/kern-to-notes.js                    列出 scores/fux 全部
 *   node tools/kern-to-notes.js gap_073            只看某一个
 *   node tools/kern-to-notes.js gap_073 --species 4
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'counterpoint.js'));
require(path.join(root, 'theory', 'kern.js'));
const TH = globalThis.TH, CP = globalThis.CP, K = TH.kern;

const filter = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const si = process.argv.indexOf('--species');
const forceSpecies = si > -1 ? parseInt(process.argv[si + 1], 10) : null;

const dir = path.join(root, 'scores', 'fux');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.krn'))
  .filter(f => !filter || f.indexOf(filter) > -1).sort();
if (!files.length) { console.error('没有匹配的 .krn 文件。'); process.exit(1); }

files.forEach(f => {
  const sc = K.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const sp = forceSpecies || sc.meta.species || 1;
  console.log('\n' + '='.repeat(74));
  console.log(`【图 ${sc.meta.figure}】 第 ${sp} 类对位　调式终止音 ${sc.meta.modalFinal}` +
    `　CF 在${sc.meta.cfPosition === 'lower' ? '下' : '上'}方　${f}`);
  console.log('='.repeat(74));

  /* 固定旋律 = 全音符那个声部 */
  let cfIdx = -1;
  for (let i = 0; i < sc.voices.length; i++) if (K.isAllWhole(sc.voices[i])) { cfIdx = i; break; }
  if (cfIdx < 0) cfIdx = 0;

  sc.voices.forEach((v, i) => {
    const tag = i === cfIdx ? 'CF' : 'CP';
    const str = K.toNoteString(v, sc.meter);
    console.log(`\n${tag} (声部${i}):`);
    console.log(`  '${str}'`);
  });

  /* 顺带跑一遍检查器，看 Fux 的写法在当前规则下如何 */
  if (sc.voices.length === 2) {
    const cpIdx = 1 - cfIdx;
    const res = CP.check(TH.makeScore({
      cf: K.toNoteString(sc.voices[cfIdx], sc.meter),
      cp: K.toNoteString(sc.voices[cpIdx], sc.meter),
      species: sp, key: 'C', meter: sc.meter
    }));
    console.log(`\n检查器：错误 ${res.errorCount}，提示 ${res.warnCount}，检查点 ${res.columns.length}`);
    res.messages.forEach(m => {
      const loc = m.at && m.at.bar ? `第${m.at.bar}小节` : '';
      console.log(`   ${m.level === 'error' ? '✗' : '⚠'} [${m.id} ${m.zh}] ${loc} ${m.detail || ''}`);
    });
  }
});
