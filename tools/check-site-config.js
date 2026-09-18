#!/usr/bin/env node
/* ==========================================================================
 * tools/check-site-config.js — 上线前自检
 * --------------------------------------------------------------------------
 * 检查 site.config.js 是否配好、是否和页面里静态写的那份一致、
 * 以及上线必需的东西有没有齐。
 *
 * 分级：
 *   错误（退出码 1）—— 上线会出问题，必须先修
 *   提醒           —— 不影响能跑，但会影响观感或被搜到的方式
 *
 * 用法：node tools/check-site-config.js [--online]
 *   --online  额外检查 robots.txt / sitemap.xml / site.webmanifest 是否最新
 *             并核对域名一致（需要先跑 tools/apply-site-config.js）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

require(path.join(root, 'site.config.js'));
const CFG = globalThis.SITE_CONFIG || {};

const ONLINE = process.argv.indexOf('--online') > -1;
let errors = 0, notes = 0;

const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); errors++; };
const note = (m) => { console.log('  · ' + m); notes++; };

console.log('上线前自检　（配置唯一来源：site.config.js）\n');

/* ---------------------------------------------------------------- 1. 必填 */
console.log('1. 必填项');
if (!CFG.name) bad('name 没填'); else ok('name：' + CFG.name);
if (!CFG.description) bad('description 没填（搜索结果与分享卡片都用它）');
else if (CFG.description.length > 160) bad('description 有 ' + CFG.description.length + ' 字，超过 160 会被截断');
else ok('description：' + CFG.description.length + ' 字');

if (!CFG.siteUrl) {
  bad('siteUrl 还没填 —— 这是上线前唯一必须改的一项');
  console.log('      填好之后跑：node tools\\apply-site-config.js');
} else {
  try {
    const u = new URL(CFG.siteUrl);
    if (!/^https?:$/.test(u.protocol)) bad('siteUrl 的协议应该是 http/https：' + u.protocol);
    else if (u.protocol !== 'https:') note('siteUrl 用的是 http，公网建议 https（托管平台一般免费提供）');
    else ok('siteUrl：' + CFG.siteUrl);
    if (/\/$/.test(CFG.siteUrl)) bad('siteUrl 末尾不要带斜杠（会拼出 //）');
  } catch (e) {
    bad('siteUrl 不是合法 URL：' + CFG.siteUrl);
  }
}

/* --------------------------------------------------- 2. 静态 meta 是否同步 */
console.log('\n2. index.html 里的静态 meta 与配置是否一致');
const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function attr(re) { const m = re.exec(idx); return m ? m[1] : null; }

const stat = {
  title: attr(/<title>([^<]*)<\/title>/),
  description: attr(/<meta name="description" content="([^"]*)"/),
  ogTitle: attr(/<meta property="og:title" content="([^"]*)"/),
  ogDesc: attr(/<meta property="og:description" content="([^"]*)"/)
};
const wantTitle = CFG.name + (CFG.tagline ? ' — ' + CFG.tagline : '');
stat.title === wantTitle ? ok('title 一致') : bad('title 不一致\n      index.html: ' + stat.title + '\n      config    : ' + wantTitle);
stat.description === CFG.description ? ok('description 一致')
  : bad('description 不一致（在 index.html 里，爬虫不执行 JS 时读的就是这份）');
stat.ogTitle === wantTitle ? ok('og:title 一致') : bad('og:title 不一致');
stat.ogDesc === CFG.description ? ok('og:description 一致') : bad('og:description 不一致');
note('静态那份是给不执行 JS 的爬虫兜底的；运行时由 scoremeta.js 用配置覆盖');

/* ------------------------------------------------------------ 3. 加载顺序 */
console.log('\n3. 配置脚本的加载顺序');
const cfgIdx = idx.indexOf('src="site.config.js"');
const metaIdx = idx.indexOf('src="assets/js/scoremeta.js"');
const coreIdx = idx.indexOf('src="theory/core.js"');
if (cfgIdx < 0) bad('index.html 没有引入 site.config.js');
else if (metaIdx < 0) bad('index.html 没有引入 assets/js/scoremeta.js');
else if (!(cfgIdx < metaIdx && metaIdx < coreIdx)) bad('加载顺序不对：应当 site.config.js → scoremeta.js → core.js');
else ok('site.config.js → scoremeta.js → core.js → 其余');

/* ---------------------------------------------------------- 4. 上线必备品 */
console.log('\n4. 上线必备文件');
const must = ['index.html', '404.html', 'LICENSE', 'docs/关于本站.html', 'site.config.js'];
must.forEach(f => fs.existsSync(path.join(root, f)) ? ok(f) : bad('缺 ' + f));
fs.existsSync(path.join(root, '.nojekyll'))
  ? ok('.nojekyll（GitHub Pages 上防止 Jekyll 处理）')
  : note('.nojekyll 不存在：只要用 GitHub Pages 就建议加一个空文件');

/* --------------------------------------------------------------- 5. 可选 */
console.log('\n5. 可选但影响观感');
if (!CFG.shareImage) {
  note('shareImage 为空 —— 分享出去只有纯文字卡片，建议做一张 1200×630 的图');
} else if (!fs.existsSync(path.join(root, CFG.shareImage))) {
  bad('shareImage 指向的文件不存在：' + CFG.shareImage);
} else {
  const px = fs.statSync(path.join(root, CFG.shareImage)).size;
  ok('shareImage：' + CFG.shareImage + '（' + (px / 1024).toFixed(1) + ' KB）');
}
if (CFG.analyticsScript) note('启用了访问统计（' + CFG.analyticsScript + '）—— 访客数据会发给第三方');
else ok('没有启用任何第三方脚本');
if (CFG.allowIndexing === false) note('allowIndexing=false —— 站点会告诉搜索引擎不要收录');

/* ------------------------------------------------------ 6. --online 附加 */
if (ONLINE) {
  console.log('\n6. 生成文件与域名一致（--online）');
  const files = ['robots.txt', 'sitemap.xml', 'site.webmanifest'];
  const vals = files.map(f => {
    const p = path.join(root, f);
    return { f, exists: fs.existsSync(p), text: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' };
  });
  if (!CFG.siteUrl) {
    vals.forEach(v => v.exists ? note(v.f + ' 已生成，但 siteUrl 还空着，里面可能是旧域名') : null);
  } else {
    vals.forEach(v => {
      if (!v.exists) { bad(v.f + ' 不存在，跑一下 node tools\\apply-site-config.js'); return; }
      v.text.indexOf(CFG.siteUrl) > -1 || v.f === 'site.webmanifest'
        ? ok(v.f + ' 与配置一致')
        : bad(v.f + ' 里的域名和 siteUrl 不一致（重新生成）');
    });
  }
}

/* ------------------------------------------------------------------ 汇总 */
console.log('\n' + '='.repeat(62));
console.log(`错误 ${errors} 项　提醒 ${notes} 项`);
if (errors) {
  console.log('\n✗ 还有必须修的问题。');
  process.exit(1);
}
console.log(notes
  ? '\n✓ 没有阻塞上线的问题（上面 ' + notes + ' 条提醒可以上线后慢慢补）。'
  : '\n✓ 全部就绪，可以上线。');
