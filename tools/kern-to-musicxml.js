#!/usr/bin/env node
/* ==========================================================================
 * tools/kern-to-musicxml.js — 把 Fux 语料（.krn）转成 MusicXML
 * --------------------------------------------------------------------------
 * 为什么需要它：
 *   网站上的五线谱是 build-scores.ps1 用 MuseScore 从 scores\ 里的
 *   .mscz / .musicxml 导出的。而 Fux 语料只有 .krn（Humdrum 纯文本），
 *   所以中间缺一步「.krn → MusicXML」，这个脚本补的就是这一步。
 *
 * 语料来源：github.com/MarkGotham/species —— Fux《Gradus ad Parnassum》
 *   全部对位练习与 Fux 本人的解答，CC0 公有领域。
 *
 * 这个脚本只负责"语料 → 该长什么样的谱"这三件事，其余交给 theory/musicxml.js：
 *   ① 哪个声部是固定旋律 —— 用 theory/fux.js 的逐音比对（不能靠音区猜，
 *      图 101 三个声部全是全音符而 CF 在最高声部）；
 *   ② 谱表顺序 —— 按音高排（语料的 spine 顺序不是谱表顺序：
 *      图 73 的 CF 是低声部却写在第一个 spine，照搬就会两行谱表交叉）；
 *   ③ 连音线 —— .krn 里 `[2a` / `2a]` 是挂留的写法，必须合并成长音，
 *      否则第四、五类的挂留在谱面上会变成"同音反复"，意思正好相反。
 *
 * 用法：
 *   node tools/kern-to-musicxml.js                    # 转换 scores/fux/*.krn 全部
 *   node tools/kern-to-musicxml.js gap_073            # 只转一条
 *   node tools/kern-to-musicxml.js --stdout gap_073   # 打到标准输出（不写文件）
 *
 * 输出：scores/fux-fig-073.musicxml
 *       然后跑 tools\build-scores.ps1 得到 assets/scores/fux-fig-073.svg + .mp3
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

const SPECIES_ZH = { 1: '第一类', 2: '第二类', 3: '第三类', 4: '第四类', 5: '第五类' };
const MODE_ZH = { c: '伊奥尼亚', d: '多利亚', e: '弗里吉亚', f: '利底亚', g: '混合利底亚', a: '爱奥利亚' };

/**
 * 从 .krn 原文里取出连音线标记，与解析出来的音符流一一对应。
 * theory/kern.js 是【检查器用的模型】，它把连音线剥掉（每个发声点各算一个音），
 * 那是对的；但谱面必须把成对的音写成一条延音线。这里按同样的顺序再扫一遍原文，
 * 把 [ 和 ] 捡回来；槽位数与解析结果不一致就整体放弃（宁可没有连音线，也不要错位）。
 */
function tieFlags(krnText, spineCount) {
  const flags = [];
  for (let i = 0; i < spineCount; i++) flags.push([]);
  String(krnText).replace(/\r/g, '').split('\n').forEach(function (raw) {
    const line = raw.replace(/\s+$/, '');
    if (!line) return;
    const c = line[0];
    if (c === '!' || c === '*' || c === '=') return;      // 注释 / 解释行 / 小节线
    const toks = line.split('\t');
    for (let i = 0; i < spineCount; i++) {
      const tok = (toks[i] || '').trim();
      if (!tok || tok === '.') continue;                  // 延音点不占音符槽位
      flags[i].push({ start: tok.indexOf('[') > -1, stop: tok.indexOf(']') > -1 });
    }
  });
  return flags;
}

/** 把成对的连音线合成一个长音（同音、前一个开着、当前带 ]） */
function mergeTies(notes, flags, warn) {
  if (!flags || flags.length !== notes.length) {
    if (warn) warn(flags ? flags.length : 0, notes.length);
    return notes;
  }
  const out = [];
  notes.forEach(function (n, i) {
    const f = flags[i];
    const prev = out[out.length - 1];
    if (prev && prev.open && f.stop && !prev.rest && !n.rest && prev.name === n.name) {
      prev.durQ += n.durQ;
      prev.open = f.start;
      return;
    }
    out.push({ name: n.name, durQ: n.durQ, rest: n.rest, open: f.start && !n.rest });
  });
  return out;
}

/** 谱号：语料里写了就用它的，没写就按音域兜底（低音谱号的下界取 A3） */
function clefOf(voice) {
  if (voice.clef) return voice.clef;
  const sounded = voice.notes.filter(function (n) { return !n.rest; }).map(function (n) { return n.midi; });
  const avg = sounded.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, sounded.length);
  return avg < 57 ? { sign: 'F', line: 4, octaveShift: 0 } : { sign: 'G', line: 2, octaveShift: 0 };
}

function convert(krnText, opts) {
  opts = opts || {};
  const sc = K.parse(krnText);
  const meta = sc.meta;

  /* ① 哪个声部是固定旋律 */
  let cfIdx = TH.fux.findCFVoice(sc.voices, meta.modalFinal);
  let cfVerified = cfIdx >= 0;
  if (cfIdx < 0) {                                   // 兜底：不在已核对的调式表里
    cfIdx = 0;
    for (let i = 0; i < sc.voices.length; i++) if (K.isAllWhole(sc.voices[i])) { cfIdx = i; break; }
  }

  /* ③ 连音线（在 ① 之后做：判 CF 要看"这个声部是不是全音符"） */
  const flags = tieFlags(krnText, sc.voices.length);
  const warnings = [];
  const voices = sc.voices.map(function (v, i) {
    return {
      notes: mergeTies(v.notes, flags[i], function (got, want) {
        warnings.push('声部' + (i + 1) + ' 的连音线标记数（' + got + '）与音符数（' + want +
          '）不一致，该声部按无连音线处理');
      }),
      clef: clefOf(v)
    };
  });

  /* ② 谱表顺序按音高，并据此给出 CF 在哪一行 */
  const ordered = MX.orderByPitch(voices.map(function (v, i) { return { notes: v.notes, clef: v.clef, src: i }; }));
  const cfPos = ordered.findIndex(function (o) { return o.i === cfIdx; });

  const speciesZh = SPECIES_ZH[meta.species] || ('第 ' + (meta.species || '?') + ' 类');
  const modeZh = MODE_ZH[meta.modalFinal] ? (meta.modalFinal.toUpperCase() + ' ' + MODE_ZH[meta.modalFinal] + '调式') : '';
  const movement = '图 ' + (meta.figure || '?') + ' · ' + speciesZh + (modeZh ? ' · ' + modeZh : '') + ' · ' +
    (cfPos === 0 ? '固定旋律在上方声部' : cfPos === ordered.length - 1 ? '固定旋律在下方声部' : '固定旋律在中间声部');

  const parts = ordered.map(function (o, k) {
    let name;
    if (o.i === cfIdx) name = 'CF';
    else if (ordered.length === 2) name = 'CP';
    else name = ['上声部', '中声部', '下声部'][k];
    return { name: name, clef: o.it.clef, notes: o.it.notes };
  });

  const built = MX.build({
    workTitle: 'Fux《Gradus ad Parnassum》',
    movementTitle: movement,
    composer: 'Johann Joseph Fux',
    rights: '语料 CC0 · github.com/MarkGotham/species',
    software: 'tools/kern-to-musicxml.js',
    comment: 'Generated by tools/kern-to-musicxml.js' +
      (opts.file ? ' from ' + opts.file : '') + ' — 语料 github.com/MarkGotham/species（CC0）',
    meter: sc.meter,
    parts: parts
  });

  return {
    xml: built.xml, meta: meta, measureCount: built.measureCount, barQ: built.barQ,
    voices: sc.voices.length, cfPos: cfPos, cfVerified: cfVerified, warnings: warnings
  };
}

function main() {
  const args = process.argv.slice(2);
  const stdout = args.indexOf('--stdout') > -1;
  const filter = args.filter(function (a) { return a.indexOf('--') !== 0; })[0] || null;
  const dir = path.join(root, 'scores', 'fux');
  if (!fs.existsSync(dir)) { console.error('找不到 scores/fux/。先把 .krn 语料放进去。'); process.exit(1); }
  const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.krn'); })
    .filter(function (f) { return !filter || f.indexOf(filter) > -1; }).sort();
  if (!files.length) { console.error('没有匹配的 .krn 文件。'); process.exit(1); }

  files.forEach(function (f) {
    const r = convert(fs.readFileSync(path.join(dir, f), 'utf8'), { file: 'scores/fux/' + f });
    if (stdout) { process.stdout.write(r.xml); return; }
    const outFile = path.join(root, 'scores', 'fux-fig-' + String(r.meta.figure || 'x').padStart(3, '0') + '.musicxml');
    fs.writeFileSync(outFile, r.xml, 'utf8');
    console.log('图 ' + String(r.meta.figure).padEnd(4) + ' ' + (SPECIES_ZH[r.meta.species] || '?') +
      '  ' + r.voices + ' 声部  ' + r.measureCount + ' 小节  ' + r.meta.meter0 +
      '  CF ' + (r.cfPos === 0 ? '在上' : r.cfPos === r.voices - 1 ? '在下' : '在中') +
      (r.cfVerified ? '' : '（未在调式表中核对到，按全音符兜底）') +
      '  →  ' + path.relative(root, outFile));
    r.warnings.forEach(function (w) { console.log('    ⚠ ' + w); });
  });
  if (!stdout) console.log('\n下一步：powershell -ExecutionPolicy Bypass -File tools\\build-scores.ps1');
}

if (require.main === module) main();
module.exports = { convert: convert, tieFlags: tieFlags, mergeTies: mergeTies };
