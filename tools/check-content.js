#!/usr/bin/env node
/* ==========================================================================
 * tools/check-content.js — 按《内容写作标准》验收全部单元
 * --------------------------------------------------------------------------
 * 为什么要有它：内容标准写在文档里只是"希望"，写成检查才是"要求"。
 * 用它来验收子代理的加深工作，也用它防止以后的单元退回薄内容。
 *
 * 检查项（对应 docs/内容写作标准.md）：
 *   flow      —— 每个单元必须有 from / why / to
 *   goal      —— 必须是可检验的（不许"了解/熟悉/掌握"这类不可验证的动词）
 *   terms     —— 每个条目应有第四项展开讲解（允许少量例外）
 *   prose     —— 标题必须是结论，不许"介绍/概述/说明/补充"这类空标题
 *   结构      —— 至少一个 drill 与一个 checklist
 *   深度      —— 单元的正文总字数（低于阈值给提示，不判失败）
 *
 * 用法：node tools/check-content.js [--verbose]
 * 退出码：0 = 硬性项全过；1 = 有硬性项不达标
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

/* ---- 用桩接住内容文件对 SITE 的调用 ---- */
const UNITS = [], TRACKS = {};
global.window = global;
global.SITE = {
  tracks: TRACKS,
  track: function (s) {
    if (!TRACKS[s.id]) (global.SITE.trackOrder = global.SITE.trackOrder || []).push(s.id);
    TRACKS[s.id] = s; return s;
  },
  trackIndex: function (id) {
    const i = (global.SITE.trackOrder || []).indexOf(id);
    return i < 0 ? 999 : i;
  },
  unit: function (s) { UNITS.push(s); return s; },
  units: function (t) { return UNITS.filter(u => !t || u.track === t); }
};

const dir = path.join(root, 'content', 'units');
fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().forEach(f => {
  require(path.join(dir, f));
});

/* ---- 谱例数据校验：单元的 viz-voice 与 spot 练习里内联的 cf/cp ----
 * tools/verify.js 只覆盖 theory/ 下的谱例，【不覆盖单元里内联的】，
 * 而那正是改内容时最容易顺手弄坏、又最不容易发现的地方。
 * 这里做两件事：
 *   1. viz-voice 里给了 cf/cp 的，展示用的谱例必须是干净的；
 *   2. spot 练习的选项与检查器判定必须自洽 ——
 *      有"没有问题"这个选项的，检查器就必须判通过；没有的，就必须判不通过。
 *      （运行时的练习引擎就是这么判分的，这里提前替它验一遍。） */
require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'counterpoint.js'));
const TH = globalThis.TH, CP = globalThis.CP;

const DATA_ISSUES = [];

/* ---- 区块字段契约 ----
 * 渲染器是同步的，区块少写一个必需字段就会把【整个单元】打崩
 * （site.js 现在有逐区块的 try/catch 兜底，但那只是别让页面白屏，
 * 不是"这样写没问题"）。这里在改内容的时候就拦下来。
 *
 * 最典型的一种：drill 引擎会直接对 s.cf 调 .replace()，
 * 一个 spot 区块漏写 cf 就是整单元白屏。 */
function checkShape(s, name, errs, notes) {
  switch (s.type) {
    case 'drill': {
      const kind = s.drill || 'quiz';
      /* 三种练习用的字段不一样：
         quiz / spot 用 options；label 用 answers（没有 options 是正常的）。 */
      if (kind === 'quiz' || kind === 'spot') {
        const opts = s.options || [];
        if (!opts.length) errs.push(name + '：' + kind + ' 没有 options（引擎会渲染成一个点不动也没反馈的空块）');
        else if (kind === 'quiz' && !opts.some(o => o && o.ok === true)) {
          errs.push(name + '：quiz 没有任何 o.ok === true 的正确选项，这题永远答不对');
        } else if (kind === 'spot' && !opts.some(o => o && o.rule)) {
          errs.push(name + '：spot 没有任何选项声明 rule，这题永远答不对');
        }
      }
      if (kind === 'spot') {
        if (!s.cf) errs.push(name + '：spot 缺 cf（引擎会直接 .replace 崩掉）');
        if (!s.cp) errs.push(name + '：spot 缺 cp（引擎会直接 .replace 崩掉）');
      }
      if (kind === 'label') {
        if (!(s.answers || []).length) errs.push(name + '：label 没有 answers，答对了也不会判对');
        if (!s.notes && !s.context) notes.push(name + '：label 既没有 notes 也没有 context，学习者看不到题目依据');
      }
      break;
    }
    case 'score': {
      if (!s.svg) errs.push(name + '：没有 svg，页面上只剩占位提示');
      if (!s.mp3) notes.push(name + '：没有 mp3，这一块不会有播放按钮');
      if (!s.mscz) notes.push(name + '：没有 mscz，这一块不会有「在 MuseScore 中打开」按钮');
      break;
    }
    case 'terms':
      if (!(s.items || []).length) errs.push(name + '：terms 没有 items');
      break;
    case 'checklist':
      if (!(s.items || []).length) errs.push(name + '：checklist 没有 items');
      break;
    case 'repertoire':
      if (!(s.items || []).length) errs.push(name + '：repertoire 没有 items');
      break;
    case 'listen':
      if (!s.notes) errs.push(name + '：listen 缺 notes，播放按钮没有可播的音');
      break;
    case 'note':
    case 'html':
      if (!s.html) errs.push(name + '：' + s.type + ' 没有 html');
      break;
    default:
      break;
  }
}

/* ---- 谱面引用：内容里写的 svg / mp3 / mscz 必须真的存在 ----
 * 渲染器对缺失文件都有兜底（占位提示 / 报错提示），
 * 所以"文件没了"不会报错，只会静默变丑 —— 正是要机器去看的那种。
 *
 * 顺带守住一条架构决定：**不要再把 SVG 内联打包回 scores.js**。
 * 那曾经占到首屏 981 KB / 1.72 MB，而 http(s) 下 XHR 本来就通，
 * 纯属重复传输。现在谱面按需读 assets/scores/*.svg。 */
const BUNDLE_PATH = path.join(root, 'assets', 'scores', 'scores.js');

function checkAssets(s, name, errs) {
  if (s.type !== 'score') return;
  [['svg', '谱面'], ['mp3', '音频'], ['mscz', '源谱']].forEach(([k, zh]) => {
    if (!s[k]) return;
    if (!fs.existsSync(path.join(root, s[k]))) errs.push(name + '：引用的' + zh + '不存在 ' + s[k]);
  });
}

function checkExample(where, sec, unitId) {
  if (!sec.cf || !sec.cp) return null;
  if (sec.drill && sec.drill !== 'spot') return null;
  let res;
  try {
    res = CP.check(TH.makeScore({
      cf: sec.cf, cp: sec.cp, species: sec.species || 1,
      key: sec.key || 'C', meter: sec.meter || '4/4'
    }));
  } catch (e) {
    DATA_ISSUES.push(unitId + ' · ' + where + '：检查器抛异常 ' + e.message);
    return null;
  }
  return res;
}

/* ------------------------------------------------------------ 检查规则 */

/* 空标题：这些词开头的 prose 标题基本都说明没想清楚要讲什么 */
const BAD_TITLE = /(^|^[^：]{0,6})(介绍|概述|说明|补充|简介|几个要点|基本概念|相关概念|其他)/;
/* 不可验证的 goal 动词 */
const BAD_GOAL = /(了解|熟悉一下|掌握|认识|知道一些)/;

/* 允许没有第四项的 terms 条目：纯查表性质，没有"为什么"可讲 */
const TERM_EXCEPTIONS = /^(中|英|数字|记号|拼写|缩写|符号)/;

function textLen(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
}

let hardFail = 0, softNote = 0;
const rows = [];

UNITS.forEach(u => {
  const errs = [], notes = [];

  /* flow */
  if (!u.flow) errs.push('缺 flow');
  else {
    ['from', 'why', 'to'].forEach(k => {
      if (!u.flow[k] || !String(u.flow[k]).trim()) errs.push('flow.' + k + ' 为空');
    });
    if (u.flow.why && textLen(u.flow.why) < 40) notes.push('flow.why 偏短（' + textLen(u.flow.why) + ' 字）');
  }

  /* goal */
  if (!u.goal) errs.push('缺 goal');
  else if (BAD_GOAL.test(u.goal)) errs.push('goal 用了不可检验的动词：' + u.goal.slice(0, 24));

  /* 区块统计 */
  const secs = u.sections || [];
  const byType = {};
  secs.forEach(s => { byType[s.type] = (byType[s.type] || 0) + 1; });

  if (!byType.drill) errs.push('没有练习区块');
  if (!byType.checklist) notes.push('没有 checklist');

  /* 区块字段契约 + 谱面引用（改内容时最容易顺手弄坏、又最不容易发现的地方） */
  secs.forEach((s, si) => {
    const name = '第' + (si + 1) + '块(' + s.type + ')';
    checkShape(s, name, errs, notes);
    checkAssets(s, name, errs);
  });

  /* 谱例数据：viz-voice 展示的例子必须干净；spot 练习的选项必须与检查器自洽 */
  secs.forEach((s, si) => {
    const r = checkExample(s.type + '#' + si, s, u.id);
    if (!r) return;

    if (s.drill === 'spot') {
      const opts = s.options || [];
      if (!opts.length) { errs.push('spot 练习没有选项'); return; }
      const errIds = r.messages.filter(m => m.level === 'error').map(m => m.id);
      /* 复刻练习引擎的判分逻辑：rule 为 null 表示"声称没问题" */
      const isRight = o => {
        const want = (o.rule === undefined) ? null : o.rule;
        return want === null ? errIds.length === 0 : errIds.indexOf(want) > -1;
      };
      const rights = opts.filter(isRight);
      /* 正确性要求是「至少有一个选项会判对」。
         注意：【不能】假设"有『没有问题』选项 ⇒ 谱例必须干净" ——
         "没有问题"完全可以作为错误选项出现（如 B3 练习 2，谱例是故意写错的）。
         这是本检查器第一版写错的地方。 */
      if (!rights.length) {
        errs.push('spot 练习没有任何选项会被判为正确（检查器判出：' +
          (errIds.join(',') || '无错误') + '）');
      } else if (rights.length > 1) {
        notes.push('spot 练习有 ' + rights.length + ' 个选项都会判对，可能是干扰项没设好');
      }
    } else if (!r.ok) {
      /* viz-voice 是展示用的，理应干净 */
      errs.push('可视化谱例有 ' + r.errorCount + ' 项规则错误（' +
        r.messages.filter(m => m.level === 'error').map(m => m.id).join(',') + '）');
    }
  });

  /* prose 标题 */
  secs.filter(s => s.type === 'prose').forEach(s => {
    if (s.title && BAD_TITLE.test(s.title)) errs.push('prose 空标题：「' + s.title + '」');
  });

  /* terms 第四项 */
  let termTotal = 0, termDetailed = 0;
  secs.filter(s => s.type === 'terms').forEach(s => {
    (s.items || []).forEach(row => {
      termTotal++;
      if (row[3] && textLen(row[3]) > 20) termDetailed++;
      else if (!TERM_EXCEPTIONS.test(row[0] || '')) {
        notes.push('术语「' + row[0] + '」没有展开讲解');
      }
    });
  });
  if (termTotal && termDetailed / termTotal < 0.7) {
    errs.push('术语展开率仅 ' + Math.round(100 * termDetailed / termTotal) + '%（' +
      termDetailed + '/' + termTotal + '）');
  }

  /* 深度：正文总字数 */
  let depth = 0;
  secs.forEach(s => {
    if (s.type === 'prose' || s.type === 'note') depth += textLen(s.html);
    if (s.type === 'terms') (s.items || []).forEach(r => {
      depth += textLen(r[2]) + textLen(r[3]);
    });
  });

  if (errs.length) hardFail++;
  if (notes.length) softNote++;

  rows.push({
    id: u.id || u.code, title: u.title, file: '', errs, notes,
    termTotal, termDetailed, depth, secs: secs.length, byType
  });
});

/* 标出每个单元来自哪个文件 */
const fileOf = {};
fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  UNITS.forEach(u => {
    if (u.id && src.indexOf("id: '" + u.id + "'") > -1) fileOf[u.id] = f;
  });
});

/* ------------------------------------------------------------ 输出 */

const VERBOSE = process.argv.indexOf('--verbose') > -1;

/* 架构决定要由机器守住，否则下次有人"顺手修好 file:// 显示"就把它加回来了 */
if (fs.existsSync(BUNDLE_PATH)) {
  const kb = (fs.statSync(BUNDLE_PATH).size / 1024).toFixed(0);
  hardFail++;
  console.log(`✗ assets/scores/scores.js 又出现了（${kb} KB）。`);
  console.log('  这个内联打包文件已按架构决定删除：http(s) 下谱面直接读 assets/scores/*.svg，');
  console.log('  内联只会让首屏多下载近 1 MB 的重复数据。若要恢复，请连同本条检查一起改，');
  console.log('  并说明为什么 file:// 的显示比首屏体积更重要。\n');
}

console.log('内容标准验收　（标准见 docs/内容写作标准.md）\n');
console.log('单元   术语展开      正文字数   状态  问题');
console.log('─'.repeat(84));

rows.forEach(r => {
  const ok = r.errs.length === 0;
  const rate = r.termTotal ? (r.termDetailed + '/' + r.termTotal) : '—';
  console.log(
    (r.id || '?').padEnd(6) +
    rate.padEnd(14) +
    String(r.depth).padEnd(11) +
    (ok ? '  ✓  ' : '  ✗  ') +
    (ok ? '' : r.errs.join('；'))
  );
  if (VERBOSE && r.notes.length) r.notes.forEach(n => console.log(' '.repeat(31) + '· ' + n));
});

const avgDepth = Math.round(rows.reduce((a, r) => a + r.depth, 0) / (rows.length || 1));
console.log('─'.repeat(84));
console.log(`共 ${rows.length} 个单元　硬性不达标 ${hardFail} 个　有提示 ${softNote} 个　平均正文 ${avgDepth} 字`);

/* 按模块汇总 */
const byTrack = {};
rows.forEach(r => {
  const u = UNITS.filter(x => (x.id || x.code) === r.id)[0];
  const t = u ? u.track : '?';
  (byTrack[t] = byTrack[t] || []).push(r);
});
console.log('');
Object.keys(byTrack).forEach(t => {
  const list = byTrack[t];
  const d = Math.round(list.reduce((a, r) => a + r.depth, 0) / list.length);
  const bad = list.filter(r => r.errs.length).length;
  console.log(`  ${(TRACKS[t] ? TRACKS[t].title : t).padEnd(18)} ${list.length} 个单元　平均 ${d} 字　不达标 ${bad}`);
});

console.log('');
if (hardFail) {
  console.log('✗ 有单元不达标准。加 --verbose 看提示详情。');
} else {
  console.log('✓ 全部单元达到内容标准的硬性要求。');
}
process.exit(hardFail ? 1 : 0);
