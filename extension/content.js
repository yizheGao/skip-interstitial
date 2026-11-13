// 腾讯安全检测中间页自动跳过 —— 隔离世界（ISOLATED world）content script
// 兜底：从 DOM 文本 / 脚本中提取目标 URL（含编码形式），自动点击“继续访问”
(function () {
  'use strict';

  var MIDDLE_HOSTS = [
    // 腾讯系（QQ/微信）
    /(^|\.)c\.pc\.qq\.com$/i,
    /(^|\.)c\.q\.qq\.com$/i,
    /(^|\.)pingtas\.qq\.com$/i,
    /(^|\.)cgi\.connect\.qq\.com$/i,
    /(^|\.)weixin110\.qq\.com$/i,
    /(^|\.)weixin\.qq\.com$/i,
    /(^|\.)mp\.weixin\.qq\.com$/i,
    // 字节系（豆包/抖音/头条）安全链接页
    /(^|\.)wtturl\.cn$/i
  ];

  // 官方功能/帮助页：永远不是目标（避免停止页上误跳客服页）
  var FUNCTION_HOSTS = [
    /(^|\.)kf\.qq\.com$/i,
    /(^|\.)urlsec\.qq\.com$/i
  ];

  var PARAM_NAMES = [
    'pfurl', 'pfUrl', 'url', 'target', 'targetUrl', 'target_url',
    'to', 'redirect', 'redirect_uri', 'redirect_url', 'redirectUrl',
    'next', 'link', 'dest', 'destination', 'continue', 'continueUrl',
    'u', 'gourl', 'go'
  ];

  function isHttpUrl(s) {
    return typeof s === 'string' && /^https?:\/\//i.test(s);
  }

  function isMiddleUrl(u) {
    try {
      var host = new URL(u).hostname;
      return MIDDLE_HOSTS.some(function (re) { return re.test(host); });
    } catch (e) {
      return false;
    }
  }

  function isFunctionUrl(u) {
    try {
      var host = new URL(u).hostname;
      return FUNCTION_HOSTS.some(function (re) { return re.test(host); });
    } catch (e) {
      return false;
    }
  }

  // 真实页面把 "/" 写成 &#x2f;、把链参数分隔符写成 &amp;，正则前必须先还原
  var NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(s) {
    if (typeof s !== 'string' || s.indexOf('&') === -1) return typeof s === 'string' ? s : '';
    return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (m, e) {
      if (e.charAt(0) === '#') {
        var code = e.charAt(1) === 'x' || e.charAt(1) === 'X'
          ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 1114111 ? String.fromCodePoint(code) : m;
      }
      return NAMED_ENTITIES.hasOwnProperty(e) ? NAMED_ENTITIES[e] : m;
    });
  }

  function isStatic(u) {
    return /\.(css|js|png|jpe?g|gif|ico|woff2?|ttf|svg|webp|mp4|map)(\?|#|$)/i.test(u);
  }

  function normalize(raw) {
    if (isHttpUrl(raw)) return raw;
    try {
      var once = decodeURIComponent(raw);
      if (isHttpUrl(once)) return once;
    } catch (e) {}
    return null;
  }

  function extractTarget(href) {
    var current = href;
    for (var d = 0; d < 5; d++) {
      var p;
      try { p = new URL(current); } catch (e) { return null; }
      var found = null;
      for (var i = 0; i < PARAM_NAMES.length; i++) {
        var raw = p.searchParams.get(PARAM_NAMES[i]);
        if (raw) {
          var v = normalize(raw);
          if (v) { found = v; break; }
        }
      }
      if (!found) return null;
      if (!isMiddleUrl(found)) return found;
      current = found;
    }
    return null;
  }

  var done = false;
  function fire(u) {
    if (done) return;
    if (isHttpUrl(u) && !isMiddleUrl(u) && !isFunctionUrl(u) && !isStatic(u)) {
      done = true;
      window.location.replace(u);
    }
  }

  // 对页面上的 URL 做完整解析：中间页则向内解析（套娃警告页），功能页忽略，最终目标返回
  function resolveDeep(u) {
    if (isStatic(u) || isFunctionUrl(u)) return null;
    if (isMiddleUrl(u)) return extractTarget(u);
    return u;
  }

  // 从整段 HTML/文本中提取第一个外部目标 URL（含套娃中间页）
  function scanText(text) {
    if (!text) return null;
    var rePlain = /https?:\/\/[^\s"'<>\\)\]}]+/g;
    var reEncoded = /https?%3[aA]%2[fF]%2[fF][^\s"'<>]+/g;
    var m;
    var cands = [];
    while ((m = rePlain.exec(text)) !== null) cands.push(m[0]);
    while ((m = reEncoded.exec(text)) !== null) {
      try { cands.push(decodeURIComponent(m[0])); } catch (e) {}
    }
    for (var i = 0; i < cands.length; i++) {
      var cand = cands[i].replace(/[.,;!?)]+$/, '');
      if (!isHttpUrl(cand)) continue;
      var fin = resolveDeep(cand);
      if (fin && isHttpUrl(fin) && !isMiddleUrl(fin) && !isFunctionUrl(fin) && !isStatic(fin)) {
        return fin;
      }
    }
    return null;
  }

  // base64 解码为 UTF-8 文本
  function b64ToUtf8(b64) {
    try {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (e) { return null; }
  }

  // 完全拉黑（type=block）：渲染出的 <a> 没有 href，目标在初始 HTML 的
  // cgiData 文本里（verifywebmaster 链接，url 参数为 base64）
  function extractAppealFromText(text) {
    if (!text) return null;
    var re = /https?:\/\/[^\s"'<>]*verifywebmaster[^\s"'<>]*/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      try {
        var b64 = new URL(m[0]).searchParams.get('url');
        if (b64) {
          var dec = b64ToUtf8(b64);
          if (isHttpUrl(dec)) return dec;
        }
      } catch (e) {}
    }
    return null;
  }

  // 兜底：部分页面可能渲染成带 href 的 <a>
  function extractAppealFromAnchors(root) {
    var anchors = root.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href');
      if (href && /verifywebmaster/i.test(href)) {
        try {
          var b64 = new URL(href, location.href).searchParams.get('url');
          if (b64) {
            var dec = b64ToUtf8(b64);
            if (isHttpUrl(dec)) return dec;
          }
        } catch (e) {}
      }
    }
    return null;
  }

  function extractAppeal(root) {
    // outerHTML 里 &amp; / &#x2f; 未还原，不先解码则 new URL 取不到 url 参数
    return extractAppealFromText(decodeEntities(root.outerHTML)) || extractAppealFromAnchors(root);
  }


  function diagContent() {
    try {
      if (typeof console === 'undefined' || !console.debug) return;
      var body = document.body ? String(document.body.textContent || '') : '';
      console.debug('[skip-interstitial] no-target ' + String(location.href || '').split('?')[0] +
        ' bodyLen=' + body.length +
        ' bodyHasUrl=' + (scanText(body) ? 'yes' : 'no') +
        ' anchors=' + document.querySelectorAll('a[href]').length);
    } catch (e) {}
  }

  function scanDom() {
    var root = document.documentElement;
    if (root) {
      // 先按“申请恢复”的 base64 还原（唯一可靠的目标来源），再退回正文扫描；
      // 正文扫描必须同时覆盖 outerHTML（脚本内文本）与 textContent（实体已解码）
      var u = extractAppeal(root) ||
        scanText(decodeEntities(root.outerHTML)) ||
        scanText(document.body ? document.body.textContent : '');
      if (u) { fire(u); return true; }
    }
    return false;
  }

  // 1) 地址栏参数
  var t = extractTarget(location.href);
  if (t) { fire(t); return; }

  // 2) 立即扫描一次 + 监听 DOM 变化（目标 URL 常异步渲染）
  if (scanDom()) return;

  var observer = new MutationObserver(function () {
    if (scanDom()) observer.disconnect();
  });

  function start() {
    observer.observe(document.documentElement || document, {
      childList: true, subtree: true, characterData: true
    });
    // 自动点击“继续访问”按钮（不点击“申请恢复”类）
    function clickContinue() {
      if (done) return;
      var nodes = document.querySelectorAll('button, a, div[role="button"]');
      for (var i = 0; i < nodes.length; i++) {
        var text = (nodes[i].textContent || '').trim();
        if (/^(继续访问|继续前往|仍然访问|继续打开|继续|确定)$/.test(text)) {
          nodes[i].click();
          return;
        }
      }
    }
    clickContinue();
    var iv = setInterval(clickContinue, 300);
    setTimeout(function () {
      clearInterval(iv);
      observer.disconnect();
      if (!done) diagContent();
    }, 8000);
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
