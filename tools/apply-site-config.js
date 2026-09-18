#!/usr/bin/env node
/* ==========================================================================
 * tools/apply-site-config.js — 按 site.config.js 生成上线用的机器可读文件
 * --------------------------------------------------------------------------
 * 生成/更新：
 *   robots.txt      —— 由 config.allowIndexing 决定收录策略，并写上 sitemap 位置
 *   sitemap.xml     —— 只有一个首页；站内是 hash 路由，单元没有独立 URL
 *   site.webmanifest—— 让"添加到主屏幕"有名字和配色
 *
 * 为什么要生成而不是手写：这些文件里的域名必须和 canonical / og:url 一致，
 * 手写就会漂移。改完 site.config.js 跑一次这个脚本即可。
 *
 * 用法：node tools/apply-site-config.js [--check]
 *   --check  只报告会不会有变化，不写文件，也不产生退出码 1（供体检用）
 * 退出码：0 正常；1 = siteUrl 还没填（上线前必须先填）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

require(path.join(root, 'site.config.js'));
const CFG = globalThis.SITE_CONFIG || {};

const CHECK_ONLY = process.argv.indexOf('--check') > -1;

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

/** 站点绝对前缀，例如 https://user.github.io/repo；未配置返回 null */
function origin() {
  if (!CFG.siteUrl) return null;
  try { return trimSlash(new URL(CFG.siteUrl).href); } catch (e) { return null; }
}

const o = origin();
let problems = 0;

if (!o) {
  console.log('✗ site.config.js 里的 siteUrl 还没填。');
  console.log('  它是 canonical / og:url / og:image / sitemap / robots 的唯一来源。');
  console.log('  本地预览与离线使用不受影响，但**上线前必须填**，否则：');
  console.log('    · 分享卡片没有缩略图（og:image 需要绝对地址）');
  console.log('    · 搜索引擎无法确认哪个地址是正本（没有 canonical）');
  problems++;
  if (!CHECK_ONLY) process.exit(1);
}

/* ---------------------------------------------------------------- robots */
const robots = o
  ? [
    'User-agent: *',
    CFG.allowIndexing === false ? 'Disallow: /' : 'Allow: /',
    '',
    '# 站内是 hash 路由（/#/u/B1），单元没有独立 URL，所以 sitemap 只有首页',
    'Sitemap: ' + o + '/sitemap.xml',
    ''
  ].join('\n')
  : null;

/* --------------------------------------------------------------- sitemap */
const today = new Date().toISOString().slice(0, 10);
const sitemap = o
  ? [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    '    <loc>' + o + '/</loc>',
    '    <lastmod>' + today + '</lastmod>',
    '    <changefreq>monthly</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
    '  <url>',
    '    <loc>' + o + '/docs/%E5%85%B3%E4%BA%8E%E6%9C%AC%E7%AB%99.html</loc>',
    '    <lastmod>' + today + '</lastmod>',
    '    <changefreq>yearly</changefreq>',
    '    <priority>0.3</priority>',
    '  </url>',
    '</urlset>',
    ''
  ].join('\n')
  : null;

/* ------------------------------------------------------------- manifest */
const manifest = JSON.stringify({
  name: CFG.name || '音乐学习笔记',
  short_name: (CFG.name || '音乐笔记').slice(0, 12),
  description: CFG.description || '',
  lang: CFG.lang || 'zh-CN',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#faf8f4',
  theme_color: '#a3401f'
}, null, 2) + '\n';

/* ------------------------------------------------------------------ 写入 */
const outputs = [
  ['robots.txt', robots],
  ['sitemap.xml', sitemap],
  ['site.webmanifest', manifest]
].filter(function (x) { return x[1] !== null; });

let changed = 0;
outputs.forEach(function (pair) {
  const file = path.join(root, pair[0]);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (before === pair[1]) { console.log('  = ' + pair[0] + '（无变化）'); return; }
  changed++;
  if (CHECK_ONLY) { console.log('  ! ' + pair[0] + '（内容已过期，需要重新生成）'); return; }
  fs.writeFileSync(file, pair[1], 'utf8');
  console.log('  ' + (before === null ? '＋' : '↻') + ' ' + pair[0]);
});

console.log('');
if (o) console.log('站点地址：' + o);
console.log(changed ? (CHECK_ONLY ? changed + ' 个文件需要重新生成' : changed + ' 个文件已更新') : '所有生成文件都是最新的');
if (problems && !CHECK_ONLY) process.exit(1);
