/* ==========================================================================
 * assets/js/scoremeta.js — 站点身份与分享卡片的运行时应用
 * --------------------------------------------------------------------------
 * 读 site.config.js（window.SITE_CONFIG），然后做两件事：
 *   1. 把标题、描述、og:/twitter: 卡片、canonical、theme-color 之类
 *      的标签**在运行时补齐/覆盖**；
 *   2. 暴露 SITE.basePath() 与 SITE.abs()，让别的代码也能拿到正确的绝对地址。
 *
 * 为什么要在运行时做，而不是写死在 index.html 里？
 *   因为"上线地址"这种值会变（先本地、再测试域名、再正式域名），
 *   而它同时出现在 canonical / og:url / og:image / sitemap / robots 里。
 *   写死就意味着每次换域名要改五六个文件、还容易漏。
 *   现在只要改 site.config.js 一处。
 *
 * index.html 里仍然保留一份**静态的** description / og 标签：
 * 那是给不执行 JS 的爬虫和 noscript 场景兜底的。
 * tools/check-site-config.js 会核对静态那份与配置是否一致。
 *
 * 加载顺序：必须在 theory/core.js 之前（见 index.html 底部）。
 * 无依赖，可 file:// 直接打开。
 * ========================================================================== */
(function (global) {
  'use strict';

  var CFG = global.SITE_CONFIG || {};

  function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

  /** 站点根路径：'https://x.com/a' → '/a'；根域名 → '' */
  function basePath() {
    if (CFG.basePath) return '/' + String(CFG.basePath).replace(/^\/+|\/+$/g, '');
    if (!CFG.siteUrl) return '';
    try {
      var u = new URL(CFG.siteUrl);
      return trimSlash(u.pathname);
    } catch (e) { return ''; }
  }

  /** 站点绝对前缀：'https://x.com/a'；siteUrl 为空时返回 null */
  function siteOrigin() {
    if (!CFG.siteUrl) return null;
    try { return trimSlash(new URL(CFG.siteUrl).href); } catch (e) { return null; }
  }

  /** 把项目相对路径变成绝对 URL；没有 siteUrl 或路径为空时返回 null */
  function abs(relPath) {
    var o = siteOrigin();
    var rel = String(relPath || '').replace(/^\/+/, '');
    if (!o || !rel) return null;   /* 空路径不能拼成 origin —— 那会得到一个假的图片地址 */
    return o + '/' + rel;
  }

  /* ------------------------------------------------------------ DOM 工具 */

  function upsert(sel, tag, attrs) {
    var el = document.head.querySelector(sel);
    if (!el) {
      el = document.createElement(tag);
      document.head.appendChild(el);
    }
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function metaName(name, content) {
    if (content === null || content === undefined || content === '') return;
    upsert('meta[name="' + name + '"]', 'meta', { name: name, content: String(content) });
  }
  function metaProp(prop, content) {
    if (content === null || content === undefined || content === '') return;
    upsert('meta[property="' + prop + '"]', 'meta', { property: prop, content: String(content) });
  }
  function linkRel(rel, href) {
    if (!href) return;
    upsert('link[rel="' + rel + '"]', 'link', { rel: rel, href: href });
  }

  /* 地址栏配色。index.html 里给了浅/深两套（靠 prefers-color-scheme 区分），
     用户手动切换主题时所有 theme-color 一并覆盖成当前主题，避免地址栏不跟手。 */
  var THEME_COLORS = { light: '#faf8f4', dark: '#17181a' };
  function syncThemeColor(theme) {
    var list = document.head.querySelectorAll('meta[name="theme-color"]');
    var c = THEME_COLORS[theme] || THEME_COLORS.light;
    if (!list || !list.length) { metaName('theme-color', c); return; }
    Array.prototype.forEach.call(list, function (m) { m.setAttribute('content', c); });
  }

  /* --------------------------------------------------------- 应用配置 */

  function apply() {
    var title = CFG.name || document.title;
    if (CFG.tagline) title = title + ' — ' + CFG.tagline;

    if (CFG.name) document.title = title;
    if (CFG.lang) document.documentElement.setAttribute('lang', CFG.lang);

    var desc = CFG.description || '';
    metaName('description', desc);
    metaName('author', CFG.author);
    metaName('robots', CFG.allowIndexing === false ? 'noindex, nofollow' : 'index, follow');

    /* 分享卡片 */
    metaProp('og:type', 'website');
    metaProp('og:site_name', CFG.name);
    metaProp('og:title', title);
    metaProp('og:description', desc);
    metaProp('og:locale', CFG.lang === 'zh-CN' ? 'zh_CN' : CFG.lang);
    metaName('twitter:title', title);
    metaName('twitter:description', desc);

    var origin = siteOrigin();
    if (origin) {
      /* 只有知道正式地址时才写 canonical / og:url —— 写错比不写更糟，
         一个指向 localhost 的 canonical 会让搜索引擎直接不收录。 */
      var page = origin + '/';
      linkRel('canonical', page);
      metaProp('og:url', page);
    }
    var img = abs(CFG.shareImage);
    if (img) {
      metaProp('og:image', img);
      metaProp('og:image:alt', CFG.shareImageAlt || CFG.name);
      metaName('twitter:card', 'summary_large_image');
    } else {
      metaName('twitter:card', 'summary');
    }
  }

  /* ------------------------------------------------------- 按需加载统计 */

  function analytics() {
    if (!CFG.analyticsScript) return;
    try {
      var s = document.createElement('script');
      s.defer = true;
      s.src = CFG.analyticsScript;
      Object.keys(CFG.analyticsAttrs || {}).forEach(function (k) {
        s.setAttribute(k, CFG.analyticsAttrs[k]);
      });
      document.head.appendChild(s);
    } catch (e) {
      if (global.console) console.warn('[config] 统计脚本没能加载：', e.message);
    }
  }

  global.SCORE_META = {
    config: CFG,
    basePath: basePath,
    siteOrigin: siteOrigin,
    abs: abs,
    apply: apply,
    analytics: analytics,
    syncThemeColor: syncThemeColor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SCORE_META;

})(typeof window !== 'undefined' ? window : globalThis);
