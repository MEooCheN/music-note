#!/usr/bin/env node
/* ==========================================================================
 * tools/check-rules.js — 规则覆盖闸门
 * --------------------------------------------------------------------------
 * 为什么需要这个文件：
 *
 *   原来只有 tools/verify.js 在守检查器，而它的判定是
 *   「反例有没有被检出」——只要**随便报一个**错误就算过。
 *   于是规则实现里的静默失效没人会发现。事实上已经发生：
 *
 *     · M05「超出声部音域」登记为 error，但它靠 opts.range_CF / range_CP 驱动，
 *       而全仓库没有任何调用方传过这两个选项 —— 这条硬规则从不生效。
 *     · M06「跳进后未填满音域」登记在规则表里、也写在交接文档的规则一览里，
 *       但整个文件里没有任何 add('M06') 调用 —— 它是条空规则。
 *     · H08 在第一类里用 class==='dissonant' 判定，而 core.js 把复音程一律
 *       归为 dissonant，于是纯十二度、大十度这些正常写法被当成不协和，
 *       真正的不协和（小七度）反而因为同属 dissonant 而蒙对。
 *
 *   共同的病根是：一条规则从没被真正跑过，而闸门是绿的。
 *   本文件对每条规则点名要一条能触发它的反例，没触发就失败。
 *
 * 用法：node tools/check-rules.js [--verbose]
 * 退出码：0 = 所有已登记反例都命中了目标规则；1 = 有规则没被触发。
 * ========================================================================== */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'counterpoint.js'));
const TH = globalThis.TH, CP = globalThis.CP;

const VERBOSE = process.argv.indexOf('--verbose') > -1;

/* ------------------------------------------------------------------ 反例库
 * 每条：{ rule, spec, note }
 *   rule = 这条反例【必须触发】的规则编号（按该规则自己的级别命中）
 *   spec = 交给 TH.makeScore 的谱例；opts 可选
 * 反例刻意不放进站内内容里 —— 它们只是检查器的测试夹具。
 * ------------------------------------------------------------------------ */
const U = (o) => Object.assign({ key: 'C', meter: '4/4', cfClef: 'treble', cpClef: 'bass' }, o);

const CASES = [
  { rule: 'E01', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'E4:4 | D4:4 | C4:4 | C4:4' }),
    note: '起始用小六度，不是完全协和' },
  { rule: 'E02', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | D5:4',
    cp: 'C4:4 | B3:4 | C4:4 | B3:4' }),
    note: '结束音程不是八度或同度' },
  { rule: 'E03', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'E4:4 | F4:4 | G4:4 | E4:4' }),
    note: '两声部同向级进，没有 6→8 的终止式' },
  { rule: 'H01', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | F5:4 | C5:4',
    cp: 'F3:4 | G3:4 | A3:4 | Bb3:4 | C4:4' }),
    note: '第 2→3 小节同向的纯五度接纯五度' },
  { rule: 'H02', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C4:4 | D4:4 | E4:4 | G4:4' }),
    note: '第 1→3 小节连续平行八度' },
  { rule: 'H03', spec: U({ species: 1, cf: 'D5:4 | G5:4 | A4:4 | C5:4',
    cp: 'G4:4 | A4:4 | D4:4 | C4:4' }),
    note: '上方声部跳进、同向到达纯五度' },
  { rule: 'H05', spec: U({ species: 1, cf: 'C5:4 | B4:4 | A4:4 | C5:4',
    cp: 'E4:4 | F4:4 | G4:4 | D5:4' }),
    note: '最后一列对位声部跑到固定旋律上方且不再回来 —— 上下次序反转' },
  { rule: 'H06', spec: U({ species: 1, cf: 'C5:4 | G4:4 | B4:4 | C5:4',
    cp: 'C4:4 | C4:4 | A4:4 | C4:4' }),
    note: '次序没有颠倒（不是交错），但对位声部越过了固定旋律前一列唱过的 G4' },
  { rule: 'H07', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | F5:4 | G5:4 | C5:4',
    cp: 'E4:4 | F4:4 | G4:4 | A4:4 | B4:4 | C4:4' }),
    note: '连续四个同向的三度/六度（超过三个）' },
  { rule: 'H08', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'D4:4 | E4:4 | F4:4 | C4:4' }),
    note: '第一类里全是小七度（不协和）' },
  { rule: 'H09', spec: U({ species: 2,
    cf: 'C5:4 | D5:4 | E5:4 | F5:4 | G5:4 | F5:4 | E5:4 | D5:4 | C5:4',
    cp: 'E4:2 F4:2 | C4:2 E4:2 | G4:2 A4:2 | D4:2 C4:2 | C4:2 A3:2 | A3:2 C4:2 | G3:2 E4:2 | G4:2 E4:2 | C4:4' }),
    note: '弱拍不协和音靠跳进进出，既不是经过音也不是辅助音' },
  { rule: 'H10', spec: U({ species: 4, cf: 'F4:4 | E4:4 | D4:4 | C4:4',
    cp: 'C5:2 B4:2 | B4:4 | A4:4 | C4:4' }),
    note: '强拍不协和，但对位声部上一刻不是协和音同音保持 —— 挂留结构不完整' },
  { rule: 'H11', spec: U({ species: 2, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'G4:2 A4:2 | A4:2 A4:2 | G4:2 C4:2 | C4:4' }),
    note: '挂留音保持到第 2 小节，但解决方向不是下行级进' },
  { rule: 'M01', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C4:4 | D4:4 | F4:4 | B4:4' }),
    note: '对位声部出现增四度 F4→B4' },
  { rule: 'M02', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C4:4 | C5:4 | F4:4 | C4:4' }),
    note: '八度上行大跳（C4→C5）后没有反向级进折返' },
  { rule: 'M03', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C4:4 | E4:4 | G4:4 | C5:4' }),
    note: '连续两个同向跳进' },
  { rule: 'M04', spec: U({ species: 2, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C4:2 C4:2 | C4:2 C4:2 | C4:2 C4:2 | C4:4' }),
    note: '连续三个以上同音反复' },
  { rule: 'M05', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C2:4 | D2:4 | E2:4 | C2:4',
    opts: { range_CF: 'soprano', range_CP: 'bass' } }),
    note: '对位声部低到 C2，远低于男低音下限。注意必须显式传 range_* 选项才会生效' },
  { rule: 'M06', spec: U({ species: 2, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C4:2 C4:2 | D4:2 D4:2 | E4:2 E4:2 | C4:4' }),
    note: '三度跳进所跨过的音域，后面始终没有音填进去' },
  { rule: 'M07', spec: U({ species: 1, cf: 'C5:4 | D5:4 | E5:4 | C5:4',
    cp: 'C3:4 | G3:4 | D4:4 | C4:4' }),
    note: '跳进占多数，级进偏少' }
];

/* ------------------------------------------------------------------ 无覆盖说明
 * 这几条目前拿不出能【单独】触发它的反例。写在这里而不是默默略过，
 * 是因为"没被检验"和"检验通过"是两件完全不同的事。
 * ------------------------------------------------------------------------ */
const NO_CASE = {
  H04: {
    level: 'warn',
    reason: 'H04「反向到达五度/八度」在二声部里构造不出与 H03 隔离的例子。' +
      '要反向到达完全协和，两声部必须反向；而每列音程又都得协和。' +
      '若上方声部靠跳进到达（跳进下限 3 个半音），它就同时构成 H03 的' +
      '「同向跳进到达完全协和」；若上方声部靠级进到达（≤2 个半音），' +
      '则下方声部反向移动后到达的不是五度就是减五度，越过不了 M01 那一关。' +
      'Fux 的 7 条语料里这条也从未被触发。' +
      '结论：这是一条【从未经过任何真实检验】的提示，不是"验证通过"。' +
      '若要保留它，需要先找到一条能单独证它的谱例，或把它并入 H03。'
  }
};

/* ------------------------------------------------------------------ 运行 */
const allRules = Object.keys(CP.RULES);
const covered = {};
const failed = [];

console.log('规则覆盖闸门：每条规则点名一条必须被它触发的反例');
console.log('规则表登记 ' + allRules.length + ' 条，反例库 ' + CASES.length + ' 条\n');

CASES.forEach(c => {
  const rule = CP.RULES[c.rule];
  if (!rule) { failed.push(`${c.rule}：规则表里没有这个编号`); return; }
  let res;
  try {
    res = CP.check(TH.makeScore(Object.assign({}, c.spec, { id: 'gate-' + c.rule })), c.spec.opts);
  } catch (e) {
    failed.push(`${c.rule}：检查器抛异常 ${e.message}`);
    console.log(`✗ ${c.rule}  抛异常：${e.message}`);
    return;
  }
  if (res.score.warnings.length) {
    console.log(`  ! ${c.rule} 解析告警：${res.score.warnings.join('；')}`);
  }
  /* 按该条规则自己的级别命中才算数 */
  const hit = res.messages.some(m => m.id === c.rule && m.level === rule.level);
  if (hit) covered[c.rule] = true;
  else { failed.push(`${c.rule}：反例没有触发它`); }
  const shown = res.messages
    .filter(m => m.level === 'error' || m.id === c.rule)
    .map(m => (m.level === 'error' ? 'E:' : 'W:') + m.id);
  console.log(`${hit ? '✓' : '✗'} ${c.rule.padEnd(4)}[${rule.level.padEnd(5)}] ` +
    `${c.note}${VERBOSE ? '' : ''}`);
  if (VERBOSE) {
    console.log(`     期望 ${c.rule}；实际消息 ${shown.join(' ') || '(无)'}`);
  }
});

/* ------------------------------------------------------------------ 汇总 */
const noCaseCovered = allRules.filter(r => !covered[r] && !NO_CASE[r]);
const missingDoc = allRules.filter(r => !covered[r] && !NO_CASE[r]);

console.log('\n' + '='.repeat(74));
console.log(`已有反例并通过：${Object.keys(covered).length} 条`);
console.log(`明确记录为「无覆盖」：${Object.keys(NO_CASE).length} 条 —— ${Object.keys(NO_CASE).join('、')}`);
if (missingDoc.length) {
  console.log(`\n既没有反例、也没有说明的规则（必须补上其一）：${missingDoc.join('、')}`);
  missingDoc.forEach(r => failed.push(`${r}：既无覆盖也无说明`));
}

if (VERBOSE) {
  console.log('\n各条「无覆盖」的原因：');
  Object.keys(NO_CASE).forEach(r => {
    console.log(`\n  ${r}（登记级别 ${NO_CASE[r].level}）`);
    console.log('    ' + NO_CASE[r].reason);
  });
}

console.log('\n' + '='.repeat(74));
if (failed.length) {
  console.log('✗ 闸门未通过：');
  failed.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('✓ 闸门通过：所有已登记反例都命中了目标规则，' +
  '其余规则已逐条说明为何没有覆盖。');
process.exit(0);
