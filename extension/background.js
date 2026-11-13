// 腾讯安全检测中间页自动跳过 —— background service worker
// 兜底方案：在导航刚开始时就拦截，比 content script 更早，避免中间页闪烁
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

// 官方功能/帮助页：永远不是目标（避免误跳客服页）
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

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function isMiddleUrl(url) {
  try {
    var host = new URL(url).hostname;
    return MIDDLE_HOSTS.some(function (re) { return re.test(host); });
  } catch (e) {
    return false;
  }
}

function isFunctionUrl(url) {
  try {
    var host = new URL(url).hostname;
    return FUNCTION_HOSTS.some(function (re) { return re.test(host); });
  } catch (e) {
    return false;
  }
}

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
  for (var depth = 0; depth < 5; depth++) {
    var parsed;
    try {
      parsed = new URL(current);
    } catch (e) {
      return null;
    }

    var found = null;
    for (var i = 0; i < PARAM_NAMES.length; i++) {
      var raw = parsed.searchParams.get(PARAM_NAMES[i]);
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

// 记录最近处理过的目标，避免与 content script 重复跳转
var lastHandled = {};

function handle(details) {
  // 只处理顶层框架
  if (details.frameId !== 0) return;
  if (!isMiddleUrl(details.url)) return;

  var target = extractTarget(details.url);
  if (!target || isFunctionUrl(target)) return;

  var now = Date.now();
  // 顺手清理过期键：service worker 常驻时 lastHandled 否则只增不减
  for (var k in lastHandled) {
    if (now - lastHandled[k] > 10000) delete lastHandled[k];
  }
  var key = details.tabId + ':' + target;
  if (lastHandled[key] && now - lastHandled[key] < 3000) return;
  lastHandled[key] = now;

  chrome.tabs.update(details.tabId, { url: target });
}

chrome.webNavigation.onBeforeNavigate.addListener(handle);
chrome.webNavigation.onCommitted.addListener(handle);
