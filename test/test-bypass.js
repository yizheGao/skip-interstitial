// 验证扩展 inject.js / content.js / background.js 与油猴脚本的跳转逻辑
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..');
const F = {
  inject: path.join(base, 'extension', 'inject.js'),
  content: path.join(base, 'extension', 'content.js'),
  background: path.join(base, 'extension', 'background.js'),
  userscript: path.join(base, 'userscript', 'tencent-bypass.user.js')
};

// 可控的 mock 定时器
function makeTimers() {
  const intervals = new Map(), timeouts = new Map();
  let id = 100;
  return {
    setInterval: (fn) => { const i = ++id; intervals.set(i, fn); return i; },
    clearInterval: (i) => { intervals.delete(i); },
    setTimeout: (fn) => { const i = ++id; timeouts.set(i, fn); return i; },
    clearTimeout: (i) => { timeouts.delete(i); },
    tick: (n = 1) => {
      for (let k = 0; k < n; k++)
        [...intervals.values()].forEach(fn => fn());
    }
  };
}

class MockMO {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
  trigger() { this.cb(); }
}

// 从 HTML 中解析 <a href> 链接
function parseAnchors(html) {
  const anchors = [];
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    anchors.push({ getAttribute: (n) => (n === 'href' ? href : null) });
  }
  return anchors;
}

// 运行一个页面世界/隔离世界脚本
function run(file, opts) {
  const timers = makeTimers();
  let replaced = null;
  let cgiData = opts.cgiData;
  const state = { html: opts.html || '' };
  const docEl = {
    get outerHTML() { return state.html; },
    querySelectorAll: (sel) => (sel && sel.indexOf('a') !== -1 ? parseAnchors(state.html) : [])
  };
  const doc = {
    readyState: 'complete',
    documentElement: docEl,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, addEventListener: () => {} })
  };
  const sb = {
    URL, console,
    atob, btoa, Uint8Array, TextDecoder,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    MutationObserver: MockMO,
    document: doc,
    navigator: { userAgent: 'Mozilla/5.0 MicroMessenger' }
  };
  sb.window = sb;
  sb.location = { href: opts.href, replace: (u) => { replaced = u; } };
  Object.defineProperty(sb, 'cgiData', {
    get: () => cgiData,
    set: (v) => { cgiData = v; },
    configurable: true
  });
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sb);
  return {
    replaced: () => replaced,
    timers,
    setCgiData: (v) => { cgiData = v; },
    setHtml: (h) => { state.html = h; }
  };
}

// background.js 事件驱动
function runBackground(href) {
  const listeners = {};
  let updated = null;
  const sb = {
    URL, console, Date,
    chrome: {
      webNavigation: {
        onBeforeNavigate: { addListener: fn => { listeners.before = fn; } },
        onCommitted: { addListener: fn => { listeners.committed = fn; } }
      },
      tabs: { update: (id, o) => { updated = o.url; } }
    }
  };
  vm.runInNewContext(fs.readFileSync(F.background, 'utf8'), sb);
  listeners.before({ frameId: 0, tabId: 1, url: href });
  return updated;
}

// A 组：地址栏参数（同步）
const A = [
  ['用户提供的真实链接',
   'https://c.pc.qq.com/middlect.html?iscontinue=1&pfurl=https%3A%2F%2Fchatgpt.com&pfuin=835144566&pfto=qq_builtin&type=0&gjlevel=15&gjsublevel=2810',
   'https://chatgpt.com'],
  ['目标URL带查询参数',
   'https://c.pc.qq.com/middlem.html?pfurl=' + encodeURIComponent('https://example.com/path?a=1&b=2'),
   'https://example.com/path?a=1&b=2'],
  ['双重编码',
   'https://c.pc.qq.com/index.html?pfurl=' + encodeURIComponent(encodeURIComponent('https://example.org/')),
   'https://example.org/'],
  ['嵌套中间页',
   'https://c.pc.qq.com/middlect.html?pfurl=' + encodeURIComponent('https://weixin110.qq.com/cgi-bin/x?url=' + encodeURIComponent('https://target.net/home')),
   'https://target.net/home'],
  ['微信确认页 url 参数',
   'https://weixin110.qq.com/cgi-bin/mmspamsupport-bin/newredirectconfirmcgi?url=' + encodeURIComponent('https://foo.cn/'),
   'https://foo.cn/'],
  ['iOS 页 url 参数',
   'https://c.pc.qq.com/ios.html?url=' + encodeURIComponent('https://ios.cn/') + '&level=1',
   'https://ios.cn/'],
  ['无目标参数（不应跳转）',
   'https://c.pc.qq.com/middlect.html?iscontinue=1', null],
  ['javascript 伪协议（不应跳转）',
   'https://c.pc.qq.com/middlect.html?pfurl=javascript:alert(1)', null],
  // —— 字节系（豆包/抖音/头条）安全链接页 ——
  ['字节单层 target',
   'https://link.wtturl.cn/?target=' + encodeURIComponent('https://www.bing.com'),
   'https://www.bing.com'],
  ['字节套腾讯（真实套娃，目标bing）',
   'https://link.wtturl.cn/?target=' + encodeURIComponent('https://c.pc.qq.com/middlect.html?pfurl=' + encodeURIComponent('https://www.bing.com')),
   'https://www.bing.com'],
  ['腾讯套字节（反向套娃，目标bing）',
   'https://c.pc.qq.com/middlect.html?pfurl=' + encodeURIComponent('https://link.wtturl.cn/?target=' + encodeURIComponent('https://www.bing.com')),
   'https://www.bing.com'],
  ['字节页无目标（不跳）',
   'https://link.wtturl.cn/?scene=im&aid=1', null]
];

let pass = 0, fail = 0;
function check(name, got, expect) {
  const ok = got === expect;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' => ' + got);
  if (!ok) { console.log('       expected: ' + expect); fail++; } else pass++;
}

for (const key of ['inject', 'content', 'userscript']) {
  console.log('\n=== ' + path.basename(F[key]) + ' ===');
  for (const [name, href, expect] of A) {
    check(name, run(F[key], { href }).replaced(), expect);
  }
}
console.log('\n=== background.js ===');
for (const [name, href, expect] of A) {
  check(name, runBackground(href), expect);
}

// B 组：cgiData 异步注入（inject + userscript）
console.log('\n=== cgiData 场景 ===');
for (const key of ['inject', 'userscript']) {
  const r = run(F[key], { href: 'https://weixin110.qq.com/cgi-bin/x?bancode=abc' });
  r.setCgiData({ url: 'https://target.com/' });
  r.timers.tick();
  check('[' + key + '] cgiData.url 出现后跳转', r.replaced(), 'https://target.com/');
}
for (const key of ['inject', 'userscript']) {
  const r = run(F[key], { href: 'https://weixin110.qq.com/cgi-bin/x?bancode=abc' });
  r.setCgiData({ url: 'https://c.pc.qq.com/inner' });
  r.timers.tick();
  check('[' + key + '] cgiData.url 仍是腾讯域名（不跳）', r.replaced(), null);
}

// C 组：DOM 文本（content + userscript）
console.log('\n=== DOM 文本场景 ===');
for (const key of ['content', 'userscript']) {
  const r = run(F[key], {
    href: 'https://weixin110.qq.com/cgi-bin/x?bancode=abc',
    html: '<html><body><div>如需浏览，请长按网址复制后使用浏览器访问 https://www.ixigua.com/7110771305548349988</div></body></html>'
  });
  check('[' + key + '] 纯文本中的目标URL', r.replaced(), 'https://www.ixigua.com/7110771305548349988');
}
for (const key of ['content', 'userscript']) {
  const r = run(F[key], {
    href: 'https://weixin110.qq.com/cgi-bin/x?bancode=abc',
    html: '<html><body><script>var u="https%3A%2F%2Fencoded.cn%2Fp";</script></body></html>'
  });
  check('[' + key + '] 编码形式的目标URL', r.replaced(), 'https://encoded.cn/p');
}
for (const key of ['content', 'userscript']) {
  const r = run(F[key], {
    href: 'https://weixin110.qq.com/cgi-bin/x?bancode=abc',
    html: '<html><body><script src="https://res.wxqcloud.qq.com.cn/x.js"></script></body></html>'
  });
  check('[' + key + '] 只有静态资源（不跳）', r.replaced(), null);
}
// 警告页正文显示的是“中间页”（腾讯->字节->腾讯->bing），应向内解析直达
{
  const innerT = 'https://c.pc.qq.com/middlect.html?pfurl=' + encodeURIComponent('https://www.bing.com');
  const midB = 'https://link.wtturl.cn/?target=' + encodeURIComponent(innerT);
  const warnHtml = '<html><body><p>该网页所属平台可能存在被他人恶意利用，建议谨慎识别及访问。</p><div>' + midB + '</div></body></html>';
  for (const key of ['content', 'userscript']) {
    const r = run(F[key], {
      href: 'https://weixin110.qq.com/cgi-bin/x?bancode=abc',
      html: warnHtml
    });
    check('[' + key + '] 警告页正文是套娃中间页 => bing', r.replaced(), 'https://www.bing.com');
  }
}

// D 组：完全拉黑（type=block）
console.log('\n=== 完全拉黑（block）场景 ===');
const APPEAL = 'https://weixin110.qq.com/security/url/newreadtemplate?t=verifywebmaster/index&url=aHR0cHM6Ly9odWF3ZWkuZG9nLw==&block_type=24';
const KF = 'https://kf.qq.com/faq/170118UnqeUZ170118mUb6fu.html';
const RULE = 'https://weixin.qq.com/cgi-bin/readtemplate?t=spec';
// 真实初始 HTML：cgiData 写在 <script> 里；Vue 渲染后的 <a> 没有 href
const blockHtml =
  '<html><head><script>var cgiData = {"type":"block","url":"","links":[' +
  '{"name":"申请恢复访问","url":"' + APPEAL + '"},' +
  '{"name":"客服指引","url":"' + KF + '"},' +
  '{"name":"查看规则","url":"' + RULE + '"}]};</script></head>' +
  '<body><h1>已停止访问该网页</h1><p>网页包含违法或违规内容</p>' +
  '<a class="weui-footer__link">申请恢复访问</a></body></html>';
// content + userscript：从初始 HTML 文本里的 verifywebmaster 链接还原
for (const key of ['content', 'userscript']) {
  const r = run(F[key], {
    href: 'https://weixin110.qq.com/cgi-bin/x?bancode=bc16',
    html: blockHtml
  });
  check('[' + key + '] block 从初始 HTML 文本 base64 还原', r.replaced(), 'https://huawei.dog/');
}
// inject + userscript：从全局 cgiData.links 提取（MAIN world 最可靠）
const blockData = {
  type: 'block', url: '',
  links: [
    { name: '申请恢复访问', url: APPEAL },
    { name: '客服指引', url: KF },
    { name: '查看规则', url: RULE }
  ]
};
for (const key of ['inject', 'userscript']) {
  const r = run(F[key], {
    href: 'https://weixin110.qq.com/cgi-bin/x?bancode=bc16',
    cgiData: blockData
  });
  r.timers.tick();
  check('[' + key + '] block 从 cgiData.links base64 还原', r.replaced(), 'https://huawei.dog/');
}
// block 但没有申请恢复链接（只有客服/规则），不应跳
{
  const noAppealData = {
    type: 'block', url: '',
    links: [
      { name: '客服指引', url: KF },
      { name: '查看规则', url: RULE }
    ]
  };
  for (const key of ['inject', 'userscript']) {
    const r = run(F[key], {
      href: 'https://weixin110.qq.com/cgi-bin/x?bancode=bc16',
      cgiData: noAppealData
    });
    r.timers.tick();
    check('[' + key + '] block 无申请恢复（不误跳客服）', r.replaced(), null);
  }
}

console.log('\n总计: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
