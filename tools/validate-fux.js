#!/usr/bin/env node
/* ==========================================================================
 * tools/validate-fux.js — 用 Fux 本人的解答检验规则检查器
 * --------------------------------------------------------------------------
 * 这是整个项目里最重要的一次交叉验证。
 *
 * 逻辑：
 *   语料来自 github.com/MarkGotham/species —— Fux《Gradus ad Parnassum》
 *   全部对位练习的 .krn 纯文本（CC0 公有领域）。
 *   这些是 Fux 本人的解答，不是后人重写的，也不是我生成的。
 *
 *   于是可以反过来问：我的规则检查器，认不认 Fux 写的东西？
 *     · 如果 Fux 的解答被我的检查器判为违规 —— 几乎一定是我的规则错了。
 *     · 如果我的检查器放过了明显的问题 —— 那是漏检。
 *   两条都能立刻暴露。
 *
 * 同时它还验证语料本身：每个文件里被识别为固定旋律的那个声部，
 * 必须与 Fux 为该调式规定的固定旋律逐音吻合（允许八度移位）。
 * 对不上就说明文件解析错了或文件本身有问题。
 *
 * 用法：node tools/validate-fux.js [--verbose]
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'counterpoint.js'));
require(path.join(root, 'theory', 'kern.js'));
require(path.join(root, 'theory', 'fux.js'));
const TH = globalThis.TH, CP = globalThis.CP, K = TH.kern;

const VERBOSE = process.argv.indexOf('--verbose') > -1;

/* Fux 规定的固定旋律表与"哪个声部是 CF"的判据，
   现在放在 theory/fux.js —— 导出五线谱的 tools/kern-to-musicxml.js 用的是同一份。 */
const matchCF = TH.fux.matchCF;

/* ------------------------------------------------------------------ 主流程 */

const dir = path.join(root, 'scores', 'fux');
if (!fs.existsSync(dir)) {
  console.error('找不到 scores/fux/。先把 .krn 语料放进去。');
  process.exit(1);
}
const files = fs.readdirSync(dir).filter(f => f.endsWith('.krn')).sort();
if (!files.length) { console.error('scores/fux/ 里没有 .krn 文件。'); process.exit(1); }

console.log('用 Fux 本人的解答检验规则检查器');
console.log('语料：github.com/MarkGotham/species（CC0 公有领域，Fux《Gradus ad Parnassum》）');
console.log('文件：' + files.length + ' 个\n');

let cfVerified = 0, cfFailed = 0;
let passed = 0, failed = 0;
const failures = [];

files.forEach(f => {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const sc = K.parse(text);
  const meta = sc.meta;
  console.log('─'.repeat(74));
  console.log(`【图 ${meta.figure || '?'}】 第 ${meta.species || '?'} 类对位　调式终止音 ${meta.modalFinal || '?'}` +
    `　CF 位置 ${meta.cfPosition || '?'}　拍号 ${sc.meter}　${f}`);

  if (sc.spines !== 2) {
    console.log('  （本项目目前只检验二声部，跳过）');
    return;
  }

  /* 1) 认出哪个声部是固定旋律，并核对它是否与 Fux 的规定一致 */
  let cfIdx = -1, cpIdx = -1, verify = null;
  for (let i = 0; i < 2; i++) {
    const m = matchCF(sc.voices[i], meta.modalFinal);
    if (m.ok) { cfIdx = i; verify = m; cpIdx = 1 - i; break; }
  }
  if (cfIdx < 0) {
    cfFailed++;
    console.log('  ✗ 语料核对失败：两个声部都不是已知的 ' + meta.modalFinal +
      ' 调式固定旋律');
    console.log('     声部0: ' + sc.voices[0].notes.map(n => n.name).join(' '));
    console.log('     声部1: ' + sc.voices[1].notes.map(n => n.name).join(' '));
    return;
  }
  cfVerified++;
  console.log('  ✓ 语料核对：固定旋律与 Fux 规定一致（' +
    sc.voices[cfIdx].notes.map(n => n.name).join(' ') + '）');

  /* 2) 交给规则检查器 */
  const cfStr = K.toNoteString(sc.voices[cfIdx], sc.meter);
  const cpStr = K.toNoteString(sc.voices[cpIdx], sc.meter);
  if (VERBOSE) {
    console.log('     CF: ' + cfStr);
    console.log('     CP: ' + cpStr);
  }
  let res;
  try {
    res = CP.check(TH.makeScore({
      cf: cfStr, cp: cpStr, species: meta.species || 1,
      key: meta.modalFinal === 'd' ? 'C' : 'C', meter: sc.meter
    }));
  } catch (e) {
    failed++;
    console.log('  ✗ 检查器抛异常：' + e.message);
    failures.push({ fig: meta.figure, why: '异常 ' + e.message });
    return;
  }

  const errs = res.messages.filter(m => m.level === 'error');
  if (res.ok) {
    passed++;
    console.log(`  ✓ 检查器通过（0 错误，${res.warnCount} 条提示）`);
  } else {
    failed++;
    console.log(`  ✗ 检查器判 Fux 违规 ${errs.length} 项 —— 这更可能是检查器的错：`);
    errs.forEach(m => {
      const loc = m.at ? `第${m.at.bar}小节第${m.at.beat}拍` : '';
      console.log(`       [${m.id} ${m.zh}] ${loc} ${m.detail || ''}`);
    });
    failures.push({ fig: meta.figure, why: errs.map(m => m.id).join(',') });
  }
  if (res.warnCount) {
    res.messages.filter(m => m.level === 'warn').forEach(m =>
      console.log(`       ⚠ [${m.id} ${m.zh}] ${m.detail || ''}`));
  }
});

console.log('\n' + '='.repeat(74));
console.log(`语料核对：${cfVerified} 个文件的固定旋律与 Fux 规定一致，${cfFailed} 个对不上`);
console.log(`规则检查：Fux 的解答中 ${passed} 条通过、${failed} 条被判违规`);
if (failures.length) {
  console.log('\n被判违规的条目（需要逐条判断是检查器错还是约定不同）：');
  failures.forEach(f => console.log('  图 ' + f.fig + '：' + f.why));
}
console.log('\n注意：这里的"通过"只说明检查器与 Fux 在该条上不冲突；');
console.log('      "被判违规"才是信息量最大的地方 —— 每一条都值得查。');
process.exit(0);
