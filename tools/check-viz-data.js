/* 验证即将接进可视化区块的谱例数据是否合规 */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'counterpoint.js'));
const TH = globalThis.TH, CP = globalThis.CP;

const cases = [
  ['A2 终止式楔形（不套规则，只看音程）', {
    cf: 'G4:4 | B4:4 | C5:4', cp: 'E4:4 | D4:4 | C4:4'
  }, false],
  ['B1 第一类合规范例', {
    cf: 'C5:4 | E5:4 | D5:4 | F5:4 | E5:4 | G5:4 | F5:4 | D5:4 | C5:4',
    cp: 'C4:4 | C4:4 | B3:4 | D4:4 | E4:4 | E4:4 | D4:4 | B3:4 | C4:4', species: 1
  }, true],
  ['B2 第二类合规范例', {
    cf: 'C5:4 | D5:4 | E5:4 | F5:4 | G5:4 | F5:4 | E5:4 | D5:4 | C5:4',
    cp: 'C4:2 A3:2 | B3:2 D4:2 | C4:2 E4:2 | D4:2 D4:2 | E4:2 E4:2 | D4:2 D4:2 | E4:2 C4:2 | B3:2 B3:2 | C4:4',
    species: 2
  }, true]
];

for (const [name, spec, useChecker] of cases) {
  const sc = TH.makeScore(spec);
  if (useChecker) {
    const cp = Object.assign({}, spec, { species: spec.species || 1 });
    const r = CP.check(sc);
    console.log(`${name}: 错误 ${r.errorCount}  提示 ${r.warnCount}  检查点 ${r.columns.length}`);
    if (r.messages.length) r.messages.forEach(m => console.log('    [' + m.id + '] ' + m.zh + ' — ' + (m.detail || '')));
  } else {
    console.log(`${name}: 总长 ${sc.totalQ} 拍`);
  }
}

/* 协和度序列（viz 的色带靠这个） */
const sc = TH.makeScore(cases[0][1]);
const grid = TH.onsetGrid(sc);
console.log('\nA2 终止式的纵向音程序列：');
grid.forEach(t => {
  const a = TH.soundingAt(sc.cfE, t), b = TH.soundingAt(sc.cpE, t);
  if (!a || !b) return;
  const lo = a.midi <= b.midi ? a : b, hi = a.midi <= b.midi ? b : a;
  const iv = TH.intervalBetween(lo.src.p, hi.src.p);
  console.log(`  第 ${Math.floor(t / 4) + 1} 小节  拍 ${t % 4 + 1}  ${iv.name}  [${iv.class}]`);
});
