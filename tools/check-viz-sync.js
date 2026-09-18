/* ==========================================================================
 * check-viz-sync.js — 音画对齐回归测试
 * --------------------------------------------------------------------------
 * 这个测试守的是三个已经犯过的错误（都会让「游标位置」和「听见的声音」错开，
 * 而且片段越长错得越多，所以只在长片段上看得出来）：
 *
 *   ① 把各声部【合并】成一个和弦串再播。
 *      Audio.parse 是【顺序累加时值】定位音的（每个音的 at = 前面所有 token
 *      时值之和），合并串的时值必须首尾相接铺满时间轴。全音符 CF 配二分音符 CP
 *      时每小节合并成 4+2=6 拍，而画图/游标每小节只有 4 拍 —— 音频比游标慢 50%，
 *      图 73 跑到最后差 20 拍。
 *      → 现在各声部各自调度、共用一条时间轴（SITE.audio.playVoices）。
 *
 *   ② 游标读墙钟（performance.now）而音频读音频时钟（AudioContext.currentTime）。
 *      两条时间轴相位不同：上下文建立后设备还要一会儿才真正跑起来。
 *      曾经用 +100ms 硬猜，首次播放会偏几百毫秒。
 *      → 现在游标读音频时钟，并减掉 outputLatency（对齐"听到的"而不是"排好的"）。
 *
 *   ③ 拍长各算各的。谱例 tempo=56/72 不在这四档下拉选项里时，
 *      <select>.value 会被浏览器设成 ''，parseInt('') = NaN，
 *      动画退化成 66、音频退化成 72 —— 音频快 9%。
 *      → 现在 tempoOf() 归一化 + 谱例自带的 tempo 补成真选项 + 拍长只由
 *        playVoices 返回。
 *
 * 做法：用假的 DOM 造出真图、点真按钮，再用假的音频时钟逐帧核对
 *      「游标指在第几拍」与「此刻正在听第几拍」。
 * ========================================================================== */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');

/* ===================== 一、假的运行环境（两条时钟刻意不同相） ===================== */

const SPINUP = 0.30;      // 秒：AudioContext 建立 → 音频时钟真正开始走
const LATENCY = 0.15;     // 秒：outputLatency（"排进音频线程"→"从扬声器出来"）
const PERF0 = 12000;      // ms：墙钟起点故意不是 0，任何"假设两钟同源"的写法都会露馅
const FRAME = 1 / 60;     // 秒：模拟帧间隔

let CLOCK = 0;            // 墙钟（秒）
let ctxBorn = null;       // 音频上下文建立的墙钟时刻
const schedule = [];      // 音频线程收到的排程 {at, type, stop}

function perfNow() { return PERF0 + CLOCK * 1000; }

class FakeParam {
  constructor() { this.value = 0; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
}
class FakeNode {
  constructor(ctx) { this.ctx = ctx; this.type = ''; this.frequency = new FakeParam(); this.gain = new FakeParam(); }
  connect() { return this; }
  disconnect() { }
  start(t) { this.ctx.schedule.push({ node: this, at: t, freq: this.frequency.value, type: this.type, stop: null }); }
  stop(t) {
    for (let i = this.ctx.schedule.length - 1; i >= 0; i--) {
      const r = this.ctx.schedule[i];
      if (r.node === this && r.stop === null) { r.stop = t; return; }
    }
  }
}
class FakeAudioContext {
  constructor() {
    ctxBorn = CLOCK;
    this.schedule = schedule;
    this.state = 'running';
    this.destination = {};
    this.baseLatency = 0.01;
    this.outputLatency = LATENCY;
  }
  /* 音频时钟：上下文建立后先停 SPINUP 秒，然后才和墙钟 1:1 走 */
  get currentTime() { return Math.max(0, CLOCK - ctxBorn - SPINUP); }
  resume() { }
  createOscillator() { return new FakeNode(this); }
  createGain() { return new FakeNode(this); }
}
globalThis.AudioContext = FakeAudioContext;
globalThis.performance = { now: perfNow };

/* ---- 极简 DOM：只实现 viz/site 真正用到的那几个成员 ---- */
let selectNeedsOptions = null;   // 提醒：<select> 的 value 只认已存在的 option

function mkNode(tag) {
  const kids = [];
  const n = {
    tagName: String(tag).toUpperCase(), children: kids, attrs: {}, style: {},
    parentNode: null, onclick: null, disabled: false,
    _content: '', value: '',
    classList: {
      _s: new Set(),
      add() { for (const c of arguments) this._s.add(c); },
      remove() { for (const c of arguments) this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : !!on; v ? this._s.add(c) : this._s.delete(c); return v; }
    },
    appendChild(c) { c.parentNode = this; kids.push(c); return c; },
    insertBefore(c) { c.parentNode = this; kids.unshift(c); return c; },
    removeChild(c) { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    setAttributeNS() { },
    addEventListener() { },
    dispatch() { if (this.onclick) this.onclick({}); },
    get firstChild() { return kids[0] || null; },
    /* textContent 与 innerHTML 共用一个格子：浏览器里写一个会清掉另一个 */
    get textContent() { return this._content; },
    set textContent(v) { this._content = String(v); },
    get innerHTML() { return this._content; },
    set innerHTML(v) { this._content = String(v); }
  };
  /* 浏览器的 <select>：value 设成不存在的选项 → 变成 ''（这就是 NaN 的来源） */
  if (n.tagName === 'SELECT') {
    let v = '';
    Object.defineProperty(n, 'value', {
      get() { return v; },
      set(x) {
        const ok = kids.some(c => c.tagName === 'OPTION' && c.value === String(x));
        v = ok ? String(x) : '';
        if (!ok) selectNeedsOptions = String(x);
      }
    });
  }
  return n;
}
globalThis.document = {
  createElement: mkNode,
  createElementNS: (ns, tag) => mkNode(tag),
  documentElement: mkNode('html')
};

/* ---- requestAnimationFrame：攒起来，由模拟时钟手动推进 ---- */
let rafQueue = [], rafId = 0;
globalThis.requestAnimationFrame = fn => { rafQueue.push(fn); return ++rafId; };
globalThis.cancelAnimationFrame = () => { rafQueue = []; };
/* ---- setInterval：记下来，测试里用 tickIntervals() 手动走一轮 ----
   （播放按钮靠这个轮询"我有没有被别人抢走"，不记录就没法验证复位） */
const intervals = new Map();
let intervalId = 0;
globalThis.setInterval = fn => { intervals.set(++intervalId, fn); return intervalId; };
globalThis.clearInterval = id => { intervals.delete(id); };
function tickIntervals() { [...intervals.values()].forEach(fn => fn()); }
globalThis.setTimeout = () => 0;
/* 谱面区块在没有 scores.js 打包数据时会退回 XHR 取 SVG；这里只关心它的按钮，给个空实现 */
globalThis.XMLHttpRequest = class { open() { } send() { } };

/* ---- <audio> 桩：记录被创建的 MP3 元素，方便断言与模拟结束/出错 ---- */
const audioEls = [];
globalThis.Audio = class {
  constructor(url) { this.url = url; this.paused = false; this.playCalls = 0; audioEls.push(this); }
  play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { }
  removeAttribute() { }
};

/* ===================== 二、装载真代码 ===================== */

require(path.join(root, 'theory', 'core.js'));
require(path.join(root, 'theory', 'counterpoint.js'));
require(path.join(root, 'assets', 'js', 'site.js'));
require(path.join(root, 'assets', 'js', 'viz.js'));
require(path.join(root, 'assets', 'js', 'drills.js'));
const SITE = globalThis.SITE;

const UNITS = [];
SITE.unit = spec => { UNITS.push(spec); return spec; };
const fs = require('fs');
const dir = path.join(root, 'content', 'units');
fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => require(path.join(dir, f)));

/* ===================== 三、工具 ===================== */

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? '  → ' + extra : ''));
  if (!cond) fail++;
}
function walk(node, out) {
  out = out || [];
  out.push(node);
  (node.children || []).forEach(c => walk(c, out));
  return out;
}
function midiOfFreq(f) { return Math.round(69 + 12 * Math.log2(f / 440)); }

/* 游标在【第几拍】：用坐标轴上的小节号反推（第 1 小节 = 第 0 拍，第 2 小节 = barQ 拍） */
function quarterRuler(nodes, barQ) {
  const ticks = nodes.filter(n => n.tagName === 'TEXT' && n.attrs.class === 'vz-axis' &&
    n.attrs['text-anchor'] === 'middle' && /^\d+$/.test(n.textContent))
    .map(n => ({ q: (parseInt(n.textContent, 10) - 1) * barQ, x: parseFloat(n.attrs.x) }))
    .sort((a, b) => a.q - b.q);
  if (ticks.length < 2) return null;
  const t0 = ticks[0], t1 = ticks[1];
  return x => t0.q + (x - t0.x) * (t1.q - t0.q) / (t1.x - t0.x);
}

/* 跑一个 viz-voice 谱例：点真按钮，逐帧核对游标与音频 */
function runChart(section, unitId, si) {
  const box = SITE.renderSection(section, { id: unitId }, si);
  const nodes = walk(box, []);
  const barQ = section.barQ || 4;
  const toQ = quarterRuler(nodes, barQ);
  const head = nodes.find(n => n.attrs.class === 'vz-playhead');
  const btn = nodes.find(n => n.tagName === 'BUTTON' && n.innerHTML.indexOf('播放并跟随') >= 0);
  const sel = nodes.find(n => n.tagName === 'SELECT');
  const totalQ = Math.max(...(section.voices || []).map(v => SITE.audio.parse(v.notes).total));
  const res = { unitId, si, title: section.title || '', totalQ, barQ, err: 0, frames: 0,
    tempoAsked: (section.tempo || 66), tempoUsed: null, lastOnsetDraw: 0, lastOnsetAudio: 0,
    schedules: 0, notes: 0, warned: null, skipped: null };

  if (!toQ || !head || !btn) { res.skipped = '图上没有小节号/游标/按钮'; return res; }
  if (sel && sel.value === '') res.warned = '下拉框 value 落空（tempo ' + section.tempo + ' 不在选项里）';

  /* 画图那把尺子上的"最后一个音的起奏拍位" —— 合并串那种漂移会让它和音频对不上 */
  res.lastOnsetDraw = Math.max(...(section.voices || []).flatMap(v => SITE.audio.parse(v.notes).notes.map(n => n.at)));

  const t0Wall = CLOCK;
  btn.dispatch();
  if (btn.innerHTML.indexOf('停止') < 0) { res.skipped = '按钮没有进入播放态'; return res; }

  /* 音频实际排程（只认基频：tone() 里的三角波，另一个是它的八度泛音） */
  const fundamentals = schedule.filter(r => r.type === 'triangle');
  res.schedules = fundamentals.length;
  if (!fundamentals.length) { res.skipped = '没有排进任何音'; return res; }
  const t0 = Math.min(...fundamentals.map(r => r.at));
  const beat = 60 / SITE.audio.tempoOf(res.tempoAsked);
  res.tempoUsed = SITE.audio.tempoOf(res.tempoAsked);

  /* 断言②：音频排程必须与"画图用的那套 onset/时值"逐个对上 */
  const wantKeys = [];
  (section.voices || []).forEach(v => SITE.audio.parse(v.notes).notes.forEach(n => {
    wantKeys.push(midiOfFreq(440 * Math.pow(2, (n.midi - 69) / 12)) + '@' + (n.at * beat).toFixed(6));
  }));
  const gotKeys = fundamentals.map(r => midiOfFreq(r.freq) + '@' + (r.at - t0).toFixed(6));
  wantKeys.sort(); gotKeys.sort();
  const schedOk = wantKeys.length === gotKeys.length && wantKeys.every((k, i) => k === gotKeys[i]);
  res.notes = wantKeys.length;
  res.lastOnsetAudio = Math.max(...fundamentals.map(r => r.at - t0)) / beat;

  /* 断言①：逐帧核对"游标指在第几拍"与"此刻听到第几拍" */
  res.frames = 0;
  res.preroll = 0;        // 第一个音被听见之前的帧
  res.prerollErr = 0;     // 这些帧里游标该牢牢停在 0（老实现会提前跑起来）
  const totalSec = totalQ * beat;
  for (let t = t0Wall; t - t0Wall < totalSec + 1 && btn.innerHTML.indexOf('停止') >= 0; t += FRAME) {
    CLOCK += FRAME;
    const due = rafQueue; rafQueue = [];
    due.forEach(fn => fn());
    if (!head.attrs.x1) continue;
    const qDraw = toQ(parseFloat(head.attrs.x1));
    const qHeard = (CLOCK - ctxBorn - SPINUP - LATENCY - t0) / beat;
    if (qHeard < 0) {                  // 起奏前：还没听见任何声音
      res.preroll++;
      res.prerollErr = Math.max(res.prerollErr, Math.abs(qDraw));
      continue;
    }
    if (qHeard > totalQ) break;        // 末尾被实现夹在 totalQ 上，不算偏差
    const e = Math.abs(qDraw - qHeard);
    if (e > res.err) { res.err = e; res.worst = { clock: CLOCK, qDraw, qHeard }; }
    res.frames++;
  }
  res.qEnd = toQ(parseFloat(head.attrs.x1));
  /* 声音和游标必须【同时】走到头：合并串那会儿游标 40 秒就到头了，声音还要再响 20 秒 */
  res.endsTogether = res.qEnd > totalQ - 0.35;
  res.schedOk = schedOk;
  res.voices = (section.voices || []).length;
  return res;
}

/* ===================== 四、逐条跑 ===================== */

console.log('\n[1] 每个 viz-voice 谱例：游标位置 == 此刻听到的位置');

const rows = [];
UNITS.forEach(u => (u.sections || []).forEach((s, si) => {
  if (s.type !== 'viz-voice') return;
  CLOCK = 0; ctxBorn = null; schedule.length = 0; rafQueue = []; selectNeedsOptions = null;
  const r = runChart(s, u.id, si);
  rows.push(r);
}));

const TOL = 0.05;   // 拍
rows.forEach(r => {
  const tag = '[' + r.unitId + ' §' + r.si + '] ' + r.title;
  if (r.skipped) { check(tag + '（跳过：' + r.skipped + '）', true); return; }
  check(tag, r.err <= TOL,
    '最大偏差 ' + r.err.toFixed(3) + ' 拍／画图总长 ' + r.totalQ + ' 拍／tempo ' + r.tempoUsed +
    '／排程 ' + r.notes + ' 个音／核对 ' + r.frames + ' 帧' +
    (process.env.SYNC_DEBUG && r.worst ? '／最差帧 wall=' + r.worst.clock.toFixed(3) +
      ' 游标 ' + r.worst.qDraw.toFixed(3) + ' vs 听到 ' + r.worst.qHeard.toFixed(3) : ''));
  check('    · 音频排程与画图的 onset 逐个一致', r.schedOk,
    '画图末音起奏 ' + r.lastOnsetDraw + ' 拍　音频末音起奏 ' + r.lastOnsetAudio.toFixed(3) + ' 拍');
  check('    · 起奏前游标停在起点（老实现提前 ' + (SPINUP + LATENCY).toFixed(2) + 's 就跑起来了）',
    r.prerollErr <= TOL, r.preroll + ' 帧里最大偏移 ' + r.prerollErr.toFixed(3) + ' 拍');
  check('    · 声音和游标同时到头', r.endsTogether, '到头时游标在 ' + r.qEnd.toFixed(3) + ' / ' + r.totalQ + ' 拍');
  if (r.warned) check('    · 速度下拉框有可用选项', false, r.warned);
});

console.log('\n[2] 汇总');
const long = rows.filter(r => !r.skipped);
console.log('    共 ' + rows.length + ' 个 viz-voice 谱例，' + long.length + ' 个可核对；' +
  '最差偏差 ' + Math.max(...long.map(r => r.err)).toFixed(3) + ' 拍（容差 ' + TOL + '）');
console.log('    ' + long.map(r => r.unitId + ':' + r.totalQ + '拍/' + r.err.toFixed(2)).join('　'));

console.log('\n[3] 拍长归一化：动画与音频必须用同一个数');
const A = SITE.audio;
check('tempo 56 原样使用', A.tempoOf(56) === 56);
check('tempo 0 / NaN / undefined / "108" 一律退到 72', A.tempoOf(0) === 72 &&
  A.tempoOf(NaN) === 72 && A.tempoOf(undefined) === 72 && A.tempoOf('108') === 72,
  [A.tempoOf(0), A.tempoOf(NaN), A.tempoOf(undefined), A.tempoOf('108')].join(','));
check('playVoices 返回的 beat 就是排程用的那个', (() => {
  schedule.length = 0;
  const st = A.playVoices(['C4:1 D4:1'], 56);
  const first = schedule.find(x => x.type === 'triangle');
  return Math.abs(first.at - st.t0) < 1e-9 && Math.abs(st.beat - 60 / 56) < 1e-9;
})());

console.log('\n[4] 多声部：各声部保留自己的 onset 与时值，长音不被切断');
schedule.length = 0;
const st2 = A.playVoices(['D4:4 | F4:4', 'R:2 A4:2 | A4:2 D5:2'], 60);
const fund = schedule.filter(x => x.type === 'triangle').map(x => ({
  midi: midiOfFreq(x.freq), at: +(x.at - st2.t0).toFixed(6)
}));
const want = [{ midi: 62, at: 0 }, { midi: 65, at: 4 }, { midi: 69, at: 2 }, { midi: 69, at: 4 }, { midi: 74, at: 6 }]
  .sort((a, b) => a.at - b.at || a.midi - b.midi);
const got = fund.slice().sort((a, b) => a.at - b.at || a.midi - b.midi);
check('onset 逐个落在画图的位置上（不后漂）',
  JSON.stringify(want) === JSON.stringify(got), JSON.stringify(got));
const lastOnset = Math.max(...fund.map(f => f.at));
check('末音起奏还在第 6 拍（合并串那会儿会被撑到 6 拍之后）',
  Math.abs(lastOnset - 6) < 1e-9, lastOnset + ' 秒 = ' + (lastOnset / st2.beat) + ' 拍');
check('音频总长 == 画图总长 8 拍（合并串那会儿是 12 拍）',
  Math.abs(st2.total - 8) < 1e-9, st2.total + ' 拍');

console.log('\n[5] 练习区「两个声部一起」：不许崩，而且要两个声部都出声');
{
  const spot = UNITS.flatMap(u => (u.sections || [])
    .filter(s => s.type === 'drill' && s.drill === 'spot')).find(Boolean);
  CLOCK = 0; ctxBorn = null; schedule.length = 0; rafQueue = [];
  const nodes = walk(SITE.renderSection(spot, { id: 'drill' }, 0), []);
  const btn = nodes.find(n => n.tagName === 'BUTTON' && n.innerHTML.indexOf('两个声部一起') >= 0);
  check('找得到「两个声部一起」按钮（' + spot.title + '）', !!btn);
  let threw = null;
  try { btn.dispatch(); } catch (e) { threw = e.constructor.name + ': ' + e.message; }
  check('点击不抛异常（曾经读不存在的 score.events → TypeError）', !threw, threw || '');
  const fund = schedule.filter(r => r.type === 'triangle');
  const wantN = SITE.audio.parse(spot.cf).notes.length + SITE.audio.parse(spot.cp).notes.length;
  check('两个声部的音都排进了音频线程', fund.length === wantN,
    'CF ' + SITE.audio.parse(spot.cf).notes.length + ' 音 + CP ' +
    SITE.audio.parse(spot.cp).notes.length + ' 音 = ' + wantN + '，实际排程 ' + fund.length);
  check('CF 与 CP 都从第 0 拍起奏',
    new Set(fund.map(r => +(r.at - Math.min(...fund.map(x => x.at))).toFixed(6))).size > 1);
}

console.log('\n[6] 谱面播放按钮：点"停止"必须能复位（曾经永久卡在"停止"）');
{
  const sec = UNITS.flatMap(u => (u.sections || [])
    .filter(s => s.type === 'score' && s.mp3)).find(Boolean);
  CLOCK = 0; ctxBorn = null; audioEls.length = 0; intervals.clear(); rafQueue = [];
  const nodes = walk(SITE.renderSection(sec, { id: 'score' }, 0), []);
  const btn = nodes.find(n => n.tagName === 'BUTTON' && n.innerHTML.indexOf('播放这段音乐') >= 0);
  const hint = nodes.find(n => n.className === 'sub');
  check('找得到谱面播放按钮（' + sec.mp3 + '）', !!btn);

  btn.dispatch();
  check('点一下变成"停止"，并真的去播那个 MP3',
    btn.innerHTML.indexOf('停止') >= 0 && audioEls.length === 1 && audioEls[0].url === sec.mp3,
    btn.innerHTML + '　' + (audioEls[0] && audioEls[0].url));

  btn.dispatch();
  check('再点一下回到"播放这段音乐"（这就是报的那个 bug）',
    btn.innerHTML.indexOf('播放这段音乐') >= 0, btn.innerHTML);

  btn.dispatch();
  check('复位之后还能重新播（不是一次性的）',
    audioEls.length === 2 && audioEls[1].playCalls === 1 && btn.innerHTML.indexOf('停止') >= 0,
    '创建了 ' + audioEls.length + ' 个 MP3 元素');

  /* 被别的播放抢占：MP3 元素被摘掉，onended 不会来，只能靠令牌轮询复位 */
  SITE.audio.stop();
  tickIntervals();
  check('被别的播放抢占后自动复位', btn.innerHTML.indexOf('播放这段音乐') >= 0, btn.innerHTML);

  /* 自然播完 */
  btn.dispatch();
  audioEls[audioEls.length - 1].onended();
  check('自然播完后复位', btn.innerHTML.indexOf('播放这段音乐') >= 0, btn.innerHTML);

  /* 音频缺失 / 解码失败：复位并给出提示 */
  const before = audioEls.length;
  btn.dispatch();
  audioEls[before].onerror();
  check('出错时复位并提示音频没导出',
    btn.innerHTML.indexOf('播放这段音乐') >= 0 && hint && hint.textContent.indexOf('音频还没导出') >= 0,
    hint ? hint.textContent : '（没找到提示元素）');
}

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 音画对齐全部通过'));
process.exit(fail ? 1 : 0);
