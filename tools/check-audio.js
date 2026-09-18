/* 音频解析回归测试
 *
 * 这个测试是为了防止一个已经犯过的错误再次发生：
 *   和弦写法是 <C4 E4 G4>:2（带冒号），但解析正则曾写成 >([\d.]*)，
 *   匹配失败后和弦被静默丢弃 —— 表现是"点了播放没声音"。
 *   静默丢弃是最糟的失败方式，所以现在解析器会把无法识别的音名收集到 bad 里并告警。
 */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'assets', 'js', 'site.js'));
const A = globalThis.SITE.audio;

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? '  → ' + extra : ''));
  if (!cond) fail++;
}
function midis(str) { return A.parse(str).notes.map(n => n.midi).join(','); }

console.log('\n[1] 单音');
check('C4 = 60', midis('C4') === '60', midis('C4'));
check('时值以四分音符计', A.parse('C4:2 D4:1').total === 3);
check('省略时值默认 1 拍', A.parse('C4 D4').total === 2);
check('小节线不计时值', A.parse('C4 | D4').total === 2);
check('休止计入时值但不发声', A.parse('C4:1 R:2 D4:1').total === 4 &&
  A.parse('C4:1 R:2 D4:1').notes.length === 2);

console.log('\n[2] 和弦（曾经坏掉的地方）');
check('<C4 E4 G4>:2 出 3 个音', A.parse('<C4 E4 G4>:2').notes.length === 3,
  midis('<C4 E4 G4>:2'));
check('和弦音高正确', midis('<C4 E4 G4>:2') === '60,64,67', midis('<C4 E4 G4>:2'));
check('和弦时值正确', A.parse('<C4 E4 G4>:2').total === 2);
check('不带冒号的 <C4 E4>:1 也能解析', A.parse('<C4 E4>:1').notes.length === 2);
check('不带时值的 <C4 E4> 默认 1 拍', A.parse('<C4 E4>').total === 1);
check('混排：和弦 + 休止 + 小节线',
  A.parse('C4:1 <E4 G4>:2 | R:1').notes.length === 3 &&
  A.parse('C4:1 <E4 G4>:2 | R:1').total === 4);

console.log('\n[3] 声部合并串（声部进行图的播放依赖它）');
const merged = '<C5 C4>:4 <E5 C4>:4 <D5 B3>:4';
check('合并串可解析出 6 个音', A.parse(merged).notes.length === 6,
  A.parse(merged).notes.length + ' 个');
check('合并串总长 = 12 拍', A.parse(merged).total === 12);

console.log('\n[4] 错误必须暴露，不能静默丢弃');
const bad = A.parse('C4 X9 <C4 Zzz>:2');
check('无法识别的音名被记进 bad', bad.bad.length === 2, JSON.stringify(bad.bad));
check('合法音仍然发声（C4 与和弦里的 C4）', bad.notes.length === 2, bad.notes.length + ' 个');

console.log('\n[5] 播放令牌（"停不掉"的根因）');
check('stop() 会让令牌失效', (() => {
  const t = A.token();
  A.stop();
  return A.alive(t) === false;
})());
check('alive() 对当前令牌为真', A.alive(A.token()));

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 音频解析全部通过'));
process.exit(fail ? 1 : 0);
