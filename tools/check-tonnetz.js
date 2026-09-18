/* 核对音网的三角形几何：每个和弦高亮出来的三个音，是否真是该和弦的三个音 */
'use strict';
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const pcOf = (i, j) => ((7 * i + 4 * j) % 12 + 12) % 12;
const posOf = (i, j) => ({ x: i + j * 0.5, y: -j * 0.866 });
const R = 4, LIMX = 4.15, LIMY = 2.75;
const vis = p => Math.abs(p.x) <= LIMX && Math.abs(p.y) <= LIMY;

function tri(root, q) {
  let best = null;
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
    if (pcOf(i, j) !== root) continue;
    const cells = q === 'm'
      ? [[i, j], [i + 1, j], [i + 1, j - 1]]
      : [[i, j], [i + 1, j], [i, j + 1]];
    const pts = cells.map(c => posOf(c[0], c[1]));
    if (!pts.every(vis)) continue;
    const cost = Math.abs(i) + Math.abs(j);
    if (!best || cost < best.cost) best = { cells, cost };
  }
  return best;
}

const EXPECT = {
  '0,M': 'C,E,G', '9,m': 'A,C,E', '5,M': 'F,A,C', '7,M': 'G,B,D',
  '2,m': 'D,F,A', '4,m': 'E,G,B', '11,M': 'B,Eb,F#', '10,M': 'Bb,D,F'
};

console.log('和弦        高亮出的三个音        是否正确');
console.log('─'.repeat(52));
let bad = 0;
[['I 大三', 0, 'M'], ['vi 小三', 9, 'm'], ['IV 大三', 5, 'M'], ['V 大三', 7, 'M'],
 ['ii 小三', 2, 'm'], ['iii 小三', 4, 'm'], ['B 大三', 11, 'M'], ['bVII 大三', 10, 'M']]
  .forEach(([lab, r, q]) => {
    const t = tri(r, q);
    if (!t) { console.log(lab.padEnd(12) + ' 超出音网范围'); return; }
    const ns = t.cells.map(c => NAMES[pcOf(c[0], c[1])]);
    const uniq = [...new Set(ns)];
    const exp = EXPECT[r + ',' + q];
    const expSet = exp.split(',').sort().join(',');
    const gotSet = uniq.slice().sort().join(',');
    const ok = expSet === gotSet;
    if (!ok) bad++;
    console.log(lab.padEnd(12) + ns.join(' - ').padEnd(20) + (ok ? '✓' : '✗ 期望 ' + exp));
  });
console.log('─'.repeat(52));
console.log(bad ? `✗ ${bad} 个和弦的三角形不对` : '✓ 全部正确：三角形顶点就是该和弦的三个音');
console.log();
console.log('注：音网只表示大三与小三和弦。减三和弦、增三和弦、七和弦没有三角形——');
console.log('    这是音网本身的局限（它是"三和弦之间的邻近关系图"），不是实现问题。');
