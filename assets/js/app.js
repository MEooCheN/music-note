/* 启动。所有内容脚本都在这之前加载完毕（见 index.html 底部的顺序）。 */
(function () {
  'use strict';
  function boot() {
    try {
      /* 先把站点身份写进 head（标题 / 描述 / 分享卡片 / canonical），
         再启动界面。配置见 site.config.js，应用逻辑见 scoremeta.js。 */
      if (window.SCORE_META) {
        window.SCORE_META.apply();
        window.SCORE_META.analytics();
      }
      window.SITE.start();
    } catch (e) {
      var v = document.getElementById('view');
      if (v) v.innerHTML = '<div class="note"><b>启动失败：</b>' + e.message +
        '<br><span class="sub">' + (e.stack || '').split('\n').slice(0, 4).join('<br>') + '</span></div>';
      throw e;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
