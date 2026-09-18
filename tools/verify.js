#!/usr/bin/env node
/* ==========================================================================
 * tools/verify.js — 谱例质量闸门
 * 用法： node tools/verify.js            检查全部谱例
 *        node tools/verify.js sp1-good   只检查这一条
 * 退出码：0 = 全部合规；1 = 有不合规的谱例
 *
 * 两类谱例、两种判据：
 *   · 范例（没写 deliberate）：必须 0 错误。提示不拦。
 *   · 反例（deliberate: true）：必须**报出它声称的那条规则**，而不仅仅是"报了个错"。
 *
 * 第二点是被修掉的一个真问题。原先的判定是：
 *     if (!res.ok) intentionalCaught++;      // 只要随便报一个错就算过
 * 于是三条反例合计报了 9 个不同的错误编号，
 * 却没有任何断言保证"平行五度"那条反例真的是被 H01 抓到的。
 * 规则一旦静默失效（检查器里确实发生过，见 tools/check-rules.js 的文件头），
 * 只要还有别的规则在报错，闸门照样是绿的。
 *
 * 所以反例现在必须声明 expect: 'H01' 这样的编号，报不出该编号就算失败。
 * 逐条规则的覆盖情况由 tools/check-rules.js 单独守。
 * ========================================================================== */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'counterpoint.js'));
const EXAMPLES = require(path.join(root, 'theory', 'examples.js'));
let GENERATED = [];
try { GENERATED = require(path.join(root, 'theory', 'generated.js')); } catch (e) { /* 还没生成过 */ }
const ALL = EXAMPLES.concat(GENERATED);

const TH = globalThis.TH, CP = globalThis.CP;
const filter = process.argv[2];
const list = filter ? ALL.filter(e => e.id === filter) : ALL;

if (!list.length) { console.error('找不到谱例：' + filter); process.exit(1); }

let bad = 0, intentionalCaught = 0, exampleBad = 0;
const problems = [];

list.forEach(ex => {
  const score = TH.makeScore(ex);
  const res = CP.check(score);
  const intentional = !!ex.deliberate;

  console.log('\n' + '─'.repeat(78));
  console.log((intentional ? '【故意写错的反例】' : '【应通过的范例】') + ' ' + (ex.title || ex.id));
  console.log('─'.repeat(78));
  if (score.warnings.length) {
    score.warnings.forEach(w => console.log('  ! 解析告警: ' + w));
  }
  console.log(CP.formatReport(res));
  if (ex.note) console.log('  说明：' + ex.note);

  if (intentional) {
    if (!ex.expect) {
      problems.push(`${ex.id}：反例没有声明 expect（要证哪条规则），无法判定它是否被正确检出`);
      console.log('  ✗ 这条反例没有声明 expect —— 只能证明"报了个错"，不能证明报对了');
      bad++;
      return;
    }
    const want = CP.RULES[ex.expect];
    if (!want) {
      problems.push(`${ex.id}：expect 写的 ${ex.expect} 不在规则表里`);
      console.log(`  ✗ expect 写的 ${ex.expect} 不在规则表里`);
      bad++;
      return;
    }
    const hit = res.messages.some(m => m.id === ex.expect && m.level === want.level);
    if (hit) {
      intentionalCaught++;
      console.log(`  ✓ 已按期望被 [${ex.expect} ${want.zh}] 检出（${want.level}）`);
    } else {
      const got = [...new Set(res.messages.map(m => m.id))].sort();
      problems.push(`${ex.id}：期望 ${ex.expect}，实际只报了 ${got.join(',') || '（没有报错）'}`);
      console.log(`  ✗ 期望被 [${ex.expect} ${want.zh}] 检出，但实际消息是：${got.join(',') || '（没有报错）'}`);
      bad++;
    }
  } else {
    if (!res.ok) { bad++; exampleBad++; problems.push(`${ex.id}：范例出现硬性错误`); }
  }
});

console.log('\n' + '='.repeat(78));
console.log(`共 ${list.length} 条谱例`);
console.log(`  范例不合规：${exampleBad} 条`);
const intents = list.filter(e => e.deliberate).length;
if (intents) console.log(`  反例被期望规则检出：${intentionalCaught}/${intents} 条`);
if (problems.length) {
  console.log('\n问题：');
  problems.forEach(p => console.log('  · ' + p));
}
console.log(bad === 0
  ? '\n✓ 闸门通过：范例无硬性错误，反例都被它们声称的那条规则检出'
  : '\n✗ 闸门未通过');
process.exit(bad === 0 ? 0 : 1);
