#!/usr/bin/env node
/* ==========================================================================
 * tools/check-musicxml.js — 核对"生成的 MusicXML"有没有忠实写出源谱
 * --------------------------------------------------------------------------
 * 这个脚本守的是两个转换器（tools/kern-to-musicxml.js、tools/notes-to-musicxml.js）。
 * 它们写出来的 MusicXML 不是给人看的，是要喂给 MuseScore 出谱面的；
 * 一旦音高或时值写错，谱面上不会报错，只会静静地画错。
 *
 * 逐条核对三件事（都能从源数据算出来，不需要人眼）：
 *   ① 每个小节的总时值必须正好等于一小节的拍数 —— 说明没有漏音、也没有多补休止；
 *   ② 每个声部的音（音名写法 + 八度）必须与源谱逐个对上 —— 说明没有移调或等音改写；
 *   ③ 每个声部的总时值必须与源谱一致 —— 说明连音线合并/拆分没有吞掉或重复时值。
 *
 * 用法：node tools/check-musicxml.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'kern.js'));
require(path.join(root, 'theory', 'fux.js'));
require(path.join(root, 'theory', 'musicxml.js'));
const TH = globalThis.TH, K = TH.kern, MX = TH.musicxml;

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? '  → ' + extra : ''));
  if (!cond) fail++;
}

/* ------------------------------------------------------ 极简 MusicXML 读回 */

function readMusicXML(xml) {
  const mp = [...xml.matchAll(/<part id="(P\d+)">([\s\S]*?)<\/part>/g)].map(function (m) {
    const measures = [...m[2].matchAll(/<measure number="(\d+)">([\s\S]*?)<\/measure>/g)].map(function (mm) {
      const notes = [...mm[2].matchAll(/<note>([\s\S]*?)<\/note>/g)].map(function (nn) {
        const body = nn[1];
        const step = (/<step>([A-G])<\/step>/.exec(body) || [])[1] || null;
        const alter = (/<alter>(-?\d+)<\/alter>/.exec(body) || [])[1];
        const octave = (/<octave>(-?\d+)<\/octave>/.exec(body) || [])[1];
        return {
          rest: /<rest\/>/.test(body),
          name: step === null ? null : step + (alter ? (Number(alter) === -1 ? 'b' : Number(alter) === 1 ? '#' : '?') : '') + octave,
          durQ: Number((/<duration>(\d+)<\/duration>/.exec(body) || [])[1]) / MX.DIV,
          tieStart: /<tie type="start"\/>/.test(body),
          tieStop: /<tie type="stop"\/>/.test(body)
        };
      });
      const beats = (/<beats>(\d+)<\/beats>/.exec(mm[2]) || [])[1];
      const beatType = (/<beat-type>(\d+)<\/beat-type>/.exec(mm[2]) || [])[1];
      return { number: Number(mm[1]), notes: notes, declaredBarQ: beats ? Number(beats) * (4 / Number(beatType)) : null };
    });
    return { id: m[1], measures: measures };
  });
  return mp;
}

/* ------------------------------------------------------------- 源数据核对 */

console.log('\n[1] Fux 语料 → MusicXML（scores/fux-fig-*.musicxml）');
const kernXml = fs.readdirSync(path.join(root, 'scores')).filter(function (f) { return /^fux-fig-\d+\.musicxml$/.test(f); }).sort();
check('找得到生成的 Fux 谱面文件', kernXml.length === 7, kernXml.length + ' 个');

kernXml.forEach(function (f) {
  const fig = /fig-(\d+)/.exec(f)[1];
  const krnFile = fs.readdirSync(path.join(root, 'scores', 'fux')).filter(function (k) { return k.indexOf(('00' + fig).slice(-3)) > -1; })[0];
  const krnText = fs.readFileSync(path.join(root, 'scores', 'fux', krnFile), 'utf8');
  const sc = K.parse(krnText);
  const parts = readMusicXML(fs.readFileSync(path.join(root, 'scores', f), 'utf8'));

  /* 源：合并连音线之后的音高序列与总时值 */
  const conv = require('./kern-to-musicxml.js');
  const flags = conv.tieFlags(krnText, sc.voices.length);
  const want = sc.voices.map(function (v, i) { return conv.mergeTies(v.notes, flags[i]); });

  /* ① 每小节时值 */
  const badBar = [];
  parts.forEach(function (p, pi) {
    p.measures.forEach(function (m) {
      const total = m.notes.reduce(function (s, n) { return s + n.durQ; }, 0);
      const barQ = m.declaredBarQ || 4;
      if (Math.abs(total - barQ) > 1e-9) badBar.push('P' + (pi + 1) + ' 第' + m.number + '小节 ' + total + '/' + barQ);
    });
  });
  check('图 ' + fig + ' 每个小节都填满', badBar.length === 0, badBar.slice(0, 4).join('　'));

  /* ② 音高写法逐个对上（按声部聚合，忽略声部顺序）。
     XML 里跨小节线的音会被拆成"连音线连接的两个音"，源数据里是一条合并过的长音 ——
     所以比音名之前先把 XML 里的连音线后半（<tied type="stop">）丢掉，
     只在"每个音头"这个粒度上比。附点的时值由 ③ 单独核对。 */
  const gotAll = parts.map(function (p) {
    return p.measures.reduce(function (a, m) {
      return a.concat(m.notes.filter(function (n) { return !n.rest && !n.tieStop; }).map(function (n) { return n.name; }));
    }, []).join(',');
  }).sort();
  const wantAll = want.map(function (notes) {
    return notes.filter(function (n) { return !n.rest; }).map(function (n) { return n.name; }).join(',');
  }).sort();
  check('图 ' + fig + ' 音名与语料逐个一致', JSON.stringify(gotAll) === JSON.stringify(wantAll),
    JSON.stringify(gotAll) === JSON.stringify(wantAll) ? '' :
      gotAll.map(function (g) { return g.split(',').length; }).join('/') + ' 个 vs ' +
      wantAll.map(function (g) { return g.split(',').length; }).join('/') + ' 个');

  /* ③ 每个声部总时值一致 */
  const gotDur = parts.map(function (p) {
    return p.measures.reduce(function (s, m) { return s + m.notes.reduce(function (a, n) { return a + n.durQ; }, 0); }, 0);
  }).sort(function (a, b) { return a - b; });
  const wantDur = want.map(function (notes) { return notes.reduce(function (s, n) { return s + n.durQ; }, 0); }).sort(function (a, b) { return a - b; });
  check('图 ' + fig + ' 每声部总时值一致', JSON.stringify(gotDur) === JSON.stringify(wantDur),
    gotDur.join('/') + ' vs ' + wantDur.join('/'));
});

console.log('\n[2] 站内文字记谱 → MusicXML（练习谱面等）');
const spot = path.join(root, 'scores', 'b1-spot-1.musicxml');
if (!fs.existsSync(spot)) {
  check('找得到 scores/b1-spot-1.musicxml', false, '（还没生成）');
} else {
  const parts = readMusicXML(fs.readFileSync(spot, 'utf8'));
  const CF = 'C5:4 | D5:4 | E5:4 | F5:4 | C5:4';
  const CP = 'F3:4 | G3:4 | A3:4 | Bb3:4 | C4:4';
  const wantNames = [TH.makeScore({ cf: CF, cp: '' }), TH.makeScore({ cf: CP, cp: '' })];
  const gotAll = parts.map(function (p) {
    return p.measures.reduce(function (a, m) {
      return a.concat(m.notes.filter(function (n) { return !n.rest; }).map(function (n) { return n.name; }));
    }, []).join(',');
  }).sort();
  const wantAll = [
    wantNames[0].cfE.map(function (e) { return e.src.p.str; }).join(','),
    wantNames[1].cfE.map(function (e) { return e.src.p.str; }).join(',')
  ].sort();
  check('b1-spot-1 音名与文字记谱逐个一致（含 Bb3 的降号写法）',
    JSON.stringify(gotAll) === JSON.stringify(wantAll), gotAll.join(' | ') + '  vs  ' + wantAll.join(' | '));
  const bars = parts[0].measures.length;
  check('b1-spot-1 是 5 小节', bars === 5, bars + ' 小节');
  check('b1-spot-1 每小节 4 拍',
    parts.every(function (p) { return p.measures.every(function (m) {
      return Math.abs(m.notes.reduce(function (s, n) { return s + n.durQ; }, 0) - 4) < 1e-9;
    }); }));
}

console.log('\n[3] 时值与切分的基本功（theory/musicxml.js）');
check('可记谱时值判定', MX.notatable(4) && MX.notatable(3) && MX.notatable(0.75) &&
  MX.notatable(4.5) === null && MX.notatable(2.5) === null);
check('附点数正确', MX.notatable(3).dots === 1 && MX.notatable(1.5).type === 'quarter');
check('fit() 永远返回不超过它的最长可记谱时值', [[4, 4], [3.7, 3], [2.6, 2], [1.2, 1], [0.6, 0.5]]
  .every(function (p) { return MX.fit(p[0]) === p[1]; }));
{
  /* 跨小节线的长音要拆成连音线，且拆完每小节都满 */
  const ms = MX.toMeasures([{ name: 'C4', durQ: 6 }], 4, 2);
  check('跨小节线的音被拆开并加延音线',
    ms[0].length === 1 && Math.abs(ms[0][0].durQ - 4) < 1e-9 && ms[0][0].tieStart === true &&
    Math.abs(ms[1][0].durQ - 2) < 1e-9 && ms[1][0].tieStop === true,
    '第1小节 ' + ms[0].map(function (e) { return e.durQ + (e.tieStart ? '~' : ''); }).join(',') +
    '　第2小节 ' + ms[1].map(function (e) { return (e.name || 'R') + e.durQ + (e.tieStop ? '~end' : ''); }).join(','));
  const padded = MX.toMeasures([{ name: 'C4', durQ: 2 }], 4, 1);
  check('不足的小节用休止符补齐', padded[0].length === 2 && padded[0][1].name === null &&
    Math.abs(padded[0][1].durQ - 2) < 1e-9);
}

console.log('\n[4] 内容里引用的谱面文件是否都在（"谱面被移走"就是这个症状）');
{
  /* 用桩接住内容文件对 SITE 的调用，把全部单元读进来 */
  const UNITS = [], TRACKS = {};
  global.window = global;
  global.SITE = {
    tracks: TRACKS,
    track: function (s) { TRACKS[s.id] = s; return s; },
    trackIndex: function () { return 0; },
    unit: function (s) { UNITS.push(s); return s; },
    units: function () { return UNITS; }
  };
  const dir = path.join(root, 'content', 'units');
  fs.readdirSync(dir).filter(function (f) { return f.endsWith('.js'); }).sort()
    .forEach(function (f) { require(path.join(dir, f)); });

  const bundledGone = !fs.existsSync(path.join(root, 'assets', 'scores', 'scores.js'));
  const missing = [];
  let scoreSections = 0;
  UNITS.forEach(function (u) {
    (u.sections || []).forEach(function (s, i) {
      if (s.type !== 'score') return;
      scoreSections++;
      ['svg', 'mp3', 'mscz'].forEach(function (k) {
        if (!s[k]) return;
        if (!fs.existsSync(path.join(root, s[k].split('/').join(path.sep)))) {
          missing.push(u.id + ' §' + i + ' ' + k + '=' + s[k]);
        }
      });
    });
  });
  check('内容里的谱面区块都找得到文件', missing.length === 0, missing.slice(0, 6).join('　'));
  /* 这里原来查的是"每个 SVG 都已打进 scores.js"。那个内联打包文件已删除：
     http(s) 下谱面直接按需读 assets/scores/*.svg，内联等于首屏多下近 1 MB 的重复数据。
     现在反过来守住这条决定 —— 打包文件不该再出现。 */
  check('没有回退到内联打包 scores.js（架构决定）', bundledGone,
    bundledGone ? '' : 'assets/scores/scores.js 又出现了，首屏会多下载近 1 MB 重复数据');
  console.log('        （共 ' + scoreSections + ' 个谱面区块，' + UNITS.length + ' 个单元）');
}

console.log('\n[5] 深色模式下谱面还能不能看（site.js 只改纯黑，这是它的前提）');
{
  /* site.js 的 inject() 只把 fill/stroke 为 #000000 / #000 / black 的元素换成
     currentColor，其余颜色原样保留。所以"谱面在深色模式下可读"这件事，
     完全依赖一个前提：MuseScore 导出的 SVG【只用纯黑描边/填充】。
     README 里也承认"若导出的 SVG 用了别的颜色，可能不完美"——
     本段就是替那句话做机器核对，换成新版 MuseScore 或改了主题样式后能立刻发现。 */
  const svgDir = path.join(root, 'assets', 'scores');
  const svgs = fs.existsSync(svgDir)
    ? fs.readdirSync(svgDir).filter(function (f) { return f.endsWith('.svg'); }).sort()
    : [];

  const FIXABLE = /^(#000000|#000|black)$/i;      // site.js 会替换掉的
  const IGNORE = /^(none|currentColor|transparent|)$/i;
  const hard = [], paper = {};
  let paperFiles = 0;

  svgs.forEach(function (f) {
    const text = fs.readFileSync(path.join(svgDir, f), 'utf8');
    const vals = {};
    let sawPaper = false;
    /* 只认内联属性。若颜色改到了 <style> 里，下面的选择器一个都命中不了 */
    const re = /(?:fill|stroke)="([^"]*)"/g;
    let m;
    while ((m = re.exec(text))) {
      const v = m[1].trim();
      if (IGNORE.test(v) || FIXABLE.test(v)) continue;
      vals[v] = (vals[v] || 0) + 1;
    }
    if (/<style[\s>]/.test(text)) {
      hard.push(f + '：颜色写在 <style> 块里，site.js 的 [fill="#000000"] 选择器命中不了它');
    }
    Object.keys(vals).forEach(function (v) {
      /* #ffffff / white 是 MuseScore 导出的纸张底色，铺在最底下；深色模式下会露出
         一块白，但不影响读谱，只记一笔，不当失败。 */
      if (/^#f{6}$/i.test(v) || /^white$/i.test(v)) {
        paper[v] = (paper[v] || 0) + vals[v];
        sawPaper = true;
      } else hard.push(f + '：出现无法适配深色的颜色 ' + v + '（' + vals[v] + ' 处）');
    });
    if (sawPaper) paperFiles++;
  });

  check('谱面 SVG 的颜色都能适配深色模式', hard.length === 0, hard.slice(0, 5).join('　'));
  console.log('        （扫了 ' + svgs.length + ' 个 SVG）');
  Object.keys(paper).forEach(function (v) {
    console.log('        · ' + paperFiles + ' 个 SVG 含纸底色 ' + v + '（共 ' + paper[v] +
      ' 处）：深色模式下会露出一块白，不影响读谱');
  });
}

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 生成的谱面与源谱一致'));
process.exit(fail ? 1 : 0);
