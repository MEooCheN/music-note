#!/usr/bin/env node
/* ==========================================================================
 * tools/check-page-load.js — 页面加载顺序自检
 * --------------------------------------------------------------------------
 * index.html 是按固定顺序引一堆 <script> 的（core → counterpoint → site →
 * drills → viz → scores → 各单元 → app），全部靠全局变量通信，
 * 没有模块系统帮忙兜底。
 *
 * 这个脚本按【index.html 里真实的顺序】把这些文件在一个空全局里加载一遍，
 * 用来接住这类问题：
 *   · 某个文件语法坏了（浏览器里表现为整站白屏）
 *   · 某个文件依赖了尚未定义的东西（加载顺序被调错）
 *   · 新增文件忘了加进 index.html，或加了但被上面的报错挡住
 *
 * 它不检查渲染，只检查"能不能干净地加载完"。
 * 环境里 Chrome 无头模式不可用时（本机就是），这是唯一能自动跑的一层。
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

/* 从 index.html 里【读出】真实顺序，而不是在脚本里再抄一份 —— 抄一份就会漂移。
   先把注释去掉：index.html 里有个被注释掉的示例
   <script src="content/units/你的文件.js"></script>，那不是真的要加载。 */
const htmlRaw = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const html = htmlRaw.replace(/<!--[\s\S]*?-->/g, '');
const srcs = [];
const re = /<script\s+src="([^"]+)"><\/script>/g;
let m;
while ((m = re.exec(html))) srcs.push(m[1]);

if (!srcs.length) {
  console.error('index.html 里没找到任何 <script src="...">。');
  process.exit(1);
}

console.log(`按 index.html 的顺序加载 ${srcs.length} 个脚本：\n`);

/* 一个尽量干净的全局：只给浏览器里确实存在的那些东西。
   document 用最小桩件——app.js 会真的调 SITE.start()，
   而 SITE.start() 要拿到 #view / #tracknav / #brand / #themeBtn / #footLinks。
   这些桩件只提供"能被赋值、能被写 innerHTML"的表面，
   目的是让启动路径**真的执行一遍**，把语法与顺序问题暴露出来；
   它不验证渲染结果（那需要真浏览器）。 */
function stubEl(id) {
  return {
    id: id, innerHTML: '', onclick: null, className: '',
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, appendChild() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, classList: { add() {}, remove() {}, toggle() {} }
  };
}
const els = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error,
  parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent
};
sandbox.document = {
  readyState: 'complete',
  documentElement: stubEl('html'),
  /* head 是必需的：assets/js/scoremeta.js 会往 head 里补/改 meta 标签
     （标题、描述、分享卡片、canonical）。少了它会在这里报
     "Cannot read properties of undefined"，而那不是页面本身的问题。 */
  head: stubEl('head'),
  getElementById(id) { return (els[id] = els[id] || stubEl(id)); },
  addEventListener() {}, createElement(tag) { return stubEl(tag); },
  querySelector() { return null; }, querySelectorAll() { return []; },
  body: stubEl('body')
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = function () {};
sandbox.location = { hash: '' };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};
const ctx = vm.createContext(sandbox);

let failed = 0;
srcs.forEach(src => {
  const file = path.join(root, src.replace(/\//g, path.sep));
  if (!fs.existsSync(file)) {
    console.log(`✗ ${src}  —— 文件不存在`);
    failed++;
    return;
  }
  const code = fs.readFileSync(file, 'utf8');
  try {
    vm.runInContext(code, ctx, { filename: src });
    console.log(`✓ ${src}`);
  } catch (e) {
    console.log(`✗ ${src}  —— ${e.message}`);
    failed++;
  }
});

/* 页面真正依赖的全局，逐个点名确认它们真的挂上去了。
   EXAMPLES（theory/examples.js）不在这里：它是 tools/ 用的谱例库，
   index.html 并不加载它，也不是页面依赖。 */
const REQUIRED = ['SITE_CONFIG', 'SCORE_META', 'TH', 'CP', 'SITE'];
console.log('\n页面依赖的全局对象：');
REQUIRED.forEach(name => {
  const ok = sandbox[name] !== undefined;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
});

/* 单元是否都注册进来了：SITE.units() 才是页面的真实入口 */
let unitCount = 0;
try {
  const us = sandbox.SITE && sandbox.SITE.units ? sandbox.SITE.units() : null;
  unitCount = us && us.length ? us.length : 0;
} catch (e) {
  console.log('  ✗ SITE.units() 抛异常：' + e.message);
  failed++;
}
console.log(`  注册单元数：${unitCount}`);
if (!unitCount) { console.log('  ✗ 一个单元都没注册'); failed++; }

console.log('\n' + '='.repeat(70));
if (failed) {
  console.log(`✗ 有 ${failed} 处问题：页面在这台机器上可能白屏。`);
  process.exit(1);
}
console.log('✓ 全部按顺序加载成功，页面依赖的全局都在。');
process.exit(0);
