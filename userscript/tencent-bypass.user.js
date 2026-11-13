// ==UserScript==
// @name         安全检测中间页自动跳过（QQ/微信/豆包·抖音外链直达，含已停止访问）
// @namespace    https://github.com/yizheGao/skip-interstitial
// @version      1.0.0
// @description  自动跳过腾讯（QQ/微信）与字节（豆包/抖音/头条）外链安全检测中间页（含“已停止访问”），支持两家检测页互相套娃；完全拉黑时从“申请恢复”链接的 base64 还原目标，且不误跳客服页
// @author       arasaka
// @match        *://c.pc.qq.com/*
// @match        *://c.q.qq.com/*
// @match        *://pingtas.qq.com/*
// @match        *://cgi.connect.qq.com/*
// @match        *://weixin110.qq.com/*
// @match        *://weixin.qq.com/cgi-bin/readtemplate*
// @match        *://mp.weixin.qq.com/mp/redirect*
// @match        *://*.wtturl.cn/*
// @match        *://wtturl.cn/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // 跳板/检测页域名（这些域名下的页面只是中转，不是最终目标）
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

  // 中间页可能使用的目标地址参数名（按优先级）
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

  function trimTail(s) {
    var end = s.length;
    while (end > 0) {
      var c = s.charAt(end - 1);
      if (c === '.' || c === ',' || c === ';' || c === '!' || c === '?' || c === ')') end--;
      else break;
    }
    return s.slice(0, end);
  }

  // cgiData 的 desc/title 是纯文本，可能被实体编码后塞在字符串里
  function firstHttpUrl(text) {
    var s = decodeEntities(typeof text === 'string' ? text : '');
    var i = s.indexOf('http');
    while (i !== -1) {
      var rest = s.slice(i);
      if (rest.indexOf('https://') === 0 || rest.indexOf('http://') === 0) {
        var end = rest.length;
        for (var k = 0; k < rest.length; k++) {
          var c = rest.charAt(k);
          if (c === ' ' || c === '"' || c === "'" || c === '<' || c === '>' || c.charCodeAt(0) <= 32) {
            end = k;
            break;
          }
        }
        var cand = trimTail(rest.slice(0, end));
        if (isHttpUrl(cand)) return cand;
      }
      i = s.indexOf('http', i + 1);
    }
    return null;
  }

  function isStatic(u) {
    return /\.(css|js|png|jpe?g|gif|ico|woff2?|ttf|svg|webp|mp4|map)(\?|#|$)/i.test(u);
  }

  // searchParams 已解码一次；逐层解码到解出 http(s) 为止（兼容三重编码）
  function normalize(raw) {
    if (isHttpUrl(raw)) return raw;
    var cur = raw;
    for (var i = 0; i < 4; i++) {
      var next;
      try { next = decodeURIComponent(cur); } catch (e) { return null; }
      if (next === cur) return null;
      cur = next;
      if (isHttpUrl(cur)) return cur;
    }
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

  function scanText(text) {
    if (!text) return null;
    var rePlain = /https?:\/\/[^\s"'<>\\)\]}]+/g;
    var reEncoded = /https?%3[aA]%2[fF]%2[fF][^\s"'<>]+/g;
    var m, cands = [];
    while ((m = rePlain.exec(text)) !== null) cands.push(m[0]);
    while ((m = reEncoded.exec(text)) !== null) {
      try { cands.push(decodeURIComponent(m[0])); } catch (e) {}
    }
    for (var i = 0; i < cands.length; i++) {
      var cand = cands[i].replace(/[.,;!?)]+$/, '');
      if (!isHttpUrl(cand)) continue;
      var fin = resolveDeep(cand);
      if (fin && isHttpUrl(fin) && !isMiddleUrl(fin) && !isFunctionUrl(fin) && !isStatic(fin)) return fin;
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

  // 完全拉黑（type=block）：渲染出的 <a> 没有 href，目标在 cgiData.links 或
  // 初始 HTML 文本里（verifywebmaster 链接，url 参数为 base64）
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

  // 从全局 cgiData.links 提取（MAIN world 可读，最可靠）
  function extractAppealFromData(g) {
    if (!g || !g.links) return null;
    for (var i = 0; i < g.links.length; i++) {
      var u = g.links[i].url;
      if (u && /verifywebmaster/i.test(u)) {
        try {
          var b64 = new URL(u, location.href).searchParams.get('url');
          if (b64) {
            var dec = b64ToUtf8(b64);
            if (isHttpUrl(dec)) return dec;
          }
        } catch (e) {}
      }
    }
    return null;
  }

  function scanDom() {
    var root = document.documentElement;
    if (!root) return false;
    // 先按“申请恢复”的 base64 还原（唯一可靠的目标来源），再退回正文扫描；
    // 正文扫描必须同时覆盖 outerHTML（脚本内文本）与 textContent（实体已解码）
    var u = extractAppeal(root) ||
      scanText(decodeEntities(root.outerHTML)) ||
      scanText(document.body ? document.body.textContent : '');
    if (u) { fire(u); return true; }
    return false;
  }

  // cgiData 三种形态：url（确认页）、links（完全拉黑）、desc/title（type=empty，实体编码）
  // 递归收集对象里所有字符串值：字段改名（url -> targetUrl / btns[].link）时不至于全线失守
  function collectStrings(v, out, depth) {
    if (depth > 3 || v === null || v === undefined) return out;
    if (typeof v === 'string') { out.push(v); return out; }
    if (typeof v !== 'object') return out;
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) collectStrings(v[k], out, depth + 1);
    }
    return out;
  }

  function extractFromData(g) {
    if (!g) return null;
    if (isHttpUrl(g.url) && !isMiddleUrl(g.url) && !isFunctionUrl(g.url)) return g.url;
    var a = extractAppealFromData(g);
    if (a) return a;
    // 不挑字段名，整棵树里的明文 http(s) 都当候选；中间页/功能页/静态资源由 fire 过滤
    return firstHttpUrl(collectStrings(g, [], 0).join(' '));
  }


  // 失败时打一行诊断：只输出主机名/路径和字段概况，不打查询参数（里面有 bancode/bankey 票据）
  function diag() {
    try {
      if (typeof console === 'undefined' || !console.debug) return;
      var head = '[skip-interstitial] no-target ' + String(location.href || '').split('?')[0];
      var g = window.cgiData;
      if (!g) { console.debug(head + ' cgiData=undefined'); return; }
      var keys = [];
      for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) keys.push(k);
      var strings = collectStrings(g, [], 0);
      console.debug(head +
        ' type=' + (g.type || '-') +
        ' retcode=' + (g.retcode === undefined ? '-' : g.retcode) +
        ' keys=' + keys.join(',') +
        ' url=' + (g.url ? 'yes' : 'no') +
        ' links=' + (g.links ? g.links.length : 'no') +
        ' strings=' + strings.length);
    } catch (e) {}
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

  // 1) 地址栏参数（QQ 中间页）
  var t = extractTarget(location.href);
  if (t) { fire(t); return; }

  // 2) 轮询 window.cgiData：确认页用 g.url；block 时从 links 的 base64 还原
  var ticks = 0;
  var iv = setInterval(function () {
    ticks++;
    var g = window.cgiData;
    if (g) {
      var hit = extractFromData(g);
      if (hit) { fire(hit); clearInterval(iv); }
    }
    if (ticks > 1000) clearInterval(iv);
  }, 5);

  setTimeout(function () { if (!done) diag(); }, 6000);

  // 3) DOM 扫描 + 监听变化（目标 URL 异步渲染 / 纯文本“长按复制”）
  if (!scanDom()) {
    document.addEventListener('DOMContentLoaded', function () {
      scanDom();
      var observer = new MutationObserver(function () {
        if (scanDom()) observer.disconnect();
      });
      observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true
      });
      setTimeout(function () {
      observer.disconnect();
      if (!done) diagContent();
    }, 8000);
    });
  }

  // 4) 自动点击“继续访问”（不点击“申请恢复”）
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
  document.addEventListener('DOMContentLoaded', function () {
    clickContinue();
    var c = setInterval(clickContinue, 300);
    setTimeout(function () { clearInterval(c); }, 8000);
  });
})();
