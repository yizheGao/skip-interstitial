// 腾讯安全检测中间页自动跳过 —— 页面主世界（MAIN world）脚本
// 直接访问页面的 window.cgiData，document_start 最早执行
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

  // 从一段文本里取第一个 http(s) 地址（用于 cgiData.desc 这类纯文本字段）
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

  var STATIC_EXT = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.ico',
    '.woff', '.woff2', '.ttf', '.svg', '.webp', '.mp4', '.map'];
  // 扩展里 inject 与 content 必须用同一套过滤，否则 inject 会把静态资源当目标
  function isStatic(u) {
    var s = String(u).toLowerCase();
    var q = s.indexOf('?');
    if (q !== -1) s = s.slice(0, q);
    var h = s.indexOf('#');
    if (h !== -1) s = s.slice(0, h);
    for (var i = 0; i < STATIC_EXT.length; i++) {
      var ext = STATIC_EXT[i];
      if (s.length > ext.length && s.slice(-ext.length) === ext) return true;
    }
    return false;
  }

  // searchParams 已解码一次；逐层解码到解出 http(s) 为止（兼容三重编码），
  // 一旦解出就停，避免把目标自身的查询参数再解一次
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

  // 从中间页 URL 中解析出真正的目标地址（兼容嵌套/双重编码）
  function extractTarget(href) {
    var current = href;
    for (var d = 0; d < 5; d++) {
      var p;
      try {
        p = new URL(current);
      } catch (e) {
        return null;
      }

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
      current = found; // 目标仍是中间页，继续向内解析
    }
    return null;
  }

  var done = false;
  function fire(u) {
    if (done) return;
    if (isHttpUrl(u) && !isMiddleUrl(u) && !isFunctionUrl(u) && !isStatic(u)) {
      done = true;
      // replace 不留下中间页历史记录
      location.replace(u);
    }
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

  // 完全拉黑（type=block）：渲染出的 <a> 没有 href，目标在 cgiData.links 的
  // “申请恢复访问”链接里（verifywebmaster，url 参数为 base64）
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

  // 1) 地址栏参数（QQ 中间页：middlem/middlect/index/ios.html）
  var t = extractTarget(location.href);
  if (t) { fire(t); return; }

  // 2) 等待 window.cgiData：确认页用 cgiData.url；block 时从 links 的 base64 还原
  var ticks = 0;
  var iv = setInterval(function () {
    ticks++;
    var g = window.cgiData;
    if (g) {
      var hit = extractFromData(g);
      if (hit) { fire(hit); clearInterval(iv); }
    }
    // 约 5 秒后停止轮询
    if (ticks > 1000) clearInterval(iv);
  }, 5);

  // 轮询收了还没跳成，6 秒时记一行现场，方便下次改版定位卡在哪一层
  setTimeout(function () { if (!done) diag(); }, 6000);
})();
