// 本次审阅新增的回归用例：实体编码、type=empty、套娃多层解码、静态资源、误跳顺序
const vm = require('vm'), fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..');
const F = {
  inject: path.join(base, 'extension', 'inject.js'),
  content: path.join(base, 'extension', 'content.js'),
  userscript: path.join(base, 'userscript', 'tencent-bypass.user.js'),
};

function run(file, href, opts = {}) {
  const replaced = [];
  const logs = [];
  const timeouts = [];
  const docEl = { outerHTML: opts.html || '', querySelectorAll: () => [] };
  const ctx = {
    console: {
      log: (...a) => console.log(...a),
      warn: () => {},
      error: (...a) => console.error(...a),
      debug: (...a) => logs.push(a.join(' ')),
    },
    URL, URLSearchParams, TextDecoder, atob, decodeURIComponent, Uint8Array,
    location: { href, replace: (u) => replaced.push(u) },
    document: {
      documentElement: docEl, readyState: 'complete', addEventListener() {},
      querySelectorAll: () => [], body: opts.body || { appendChild() {}, textContent: '' },
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: (fn) => { for (let i = 0; i < 3; i++) { try { fn(); } catch (e) { break; } } return 1; },
    setTimeout: (fn) => { timeouts.push(fn); return 1; },
    clearInterval() {}, clearTimeout() {},
  };
  ctx.window = ctx;
  if (opts.cgiData) ctx.cgiData = opts.cgiData;
  vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file }); }
  catch (e) { return { error: e.message, replaced, logs }; }
  // 跑一次注册的 setTimeout（诊断日志挂在 6s/8s 上，测试里立即触发）
  for (const fn of timeouts) { try { fn(); } catch (e) {} }
  return { replaced, logs };
}

const b64 = Buffer.from('https://huawei.dog/').toString('base64');
const live = `<!DOCTYPE html><html><head><title></title></head><body><div id="app"></div>
<script>var cgiData = {"retcode":0,"type":"empty","title":"\u5982\u9700\u6d4f\u89c8\uff0c\u8bf7\u957f\u6309\u7f51\u5740\u590d\u5236\u540e\u4f7f\u7528\u6d4f\u89c8\u5668\u8bbf\u95ee","desc":"https:&#x2f;&#x2f;v.douyin.com&#x2f;iykmKkgF&#x2f;"};</script>
</body></html>`; // 2026-11-11 实测 weixin110 type=empty 页面结构（内联夹具，不依赖本地文件）
const liveRendered = '<div class="weui-msg__text-area"><h2>如需浏览，请长按网址复制后使用浏览器访问</h2>' +
  '<p class="weui-msg__desc">https://v.douyin.com/iykmKkgF/</p></div>';

const cases = [
  ['[content] block 页 &amp; 转义申诉链接', F.content, 'https://weixin110.qq.com/x?click=1',
    { html: `<a href="https://weixin110.qq.com/security/url/newreadtemplate?t=verifywebmaster/index&amp;url=${b64}&amp;block_type=24">申请恢复</a>` },
    'https://huawei.dog/'],
  ['[userscript] block 页 &amp; 转义申诉链接', F.userscript, 'https://weixin110.qq.com/x?click=1',
    { html: `<a>申请恢复</a><script>var u="https://weixin110.qq.com/security/url/newreadtemplate?t=verifywebmaster/index&amp;url=${b64}&amp;block_type=24";</script>` },
    'https://huawei.dog/'],
  ['[inject] cgiData type=empty 的 desc（实体编码）', F.inject, 'https://weixin110.qq.com/x?click=1',
    { cgiData: { retcode: 0, type: 'empty', title: '如需浏览', desc: 'https:&#x2f;&#x2f;v.douyin.com&#x2f;iykmKkgF&#x2f;' } },
    'https://v.douyin.com/iykmKkgF/'],
  ['[userscript] cgiData type=empty 的 desc（实体编码）', F.userscript, 'https://weixin110.qq.com/x?click=1',
    { cgiData: { retcode: 0, type: 'empty', desc: 'https:&#x2f;&#x2f;v.douyin.com&#x2f;iykmKkgF&#x2f;' } },
    'https://v.douyin.com/iykmKkgF/'],
  ['[content] 实测 type=empty 页面初始 HTML', F.content, 'https://weixin110.qq.com/x?click=1',
    { html: live }, 'https://v.douyin.com/iykmKkgF/'],
  ['[content] 实测 type=empty 页面渲染后 DOM', F.content, 'https://weixin110.qq.com/x?click=1',
    { html: liveRendered }, 'https://v.douyin.com/iykmKkgF/'],
  ['[inject] 三重编码 pfurl', F.inject,
    'https://c.pc.qq.com/middlect.html?pfurl=' + encodeURIComponent(encodeURIComponent(encodeURIComponent('https://www.bing.com'))),
    {}, 'https://www.bing.com'],
  ['[inject] url 参数指向静态图片不再乱跳', F.inject,
    'https://c.pc.qq.com/middlect.html?url=https%3A%2F%2Fexample.com%2Flogo.png', {}, undefined],
  ['[content] 页面先出现无关外链时仍取申诉链接', F.content, 'https://weixin110.qq.com/x?click=1',
    { html: `<a href="https://www.12377.cn/">举报</a><script>var u="https://weixin110.qq.com/security/url/newreadtemplate?t=verifywebmaster/index&url=${b64}&block_type=24";</script>` },
    'https://huawei.dog/'],
  ['[inject] 确认页 cgiData.url 为腾讯域名(不跳)', F.inject, 'https://weixin110.qq.com/x?click=1',
    { cgiData: { url: 'https://weixin110.qq.com/security/readtemplate?t=warn' } }, undefined],
  ['[inject] 改版：目标字段改名 targetUrl', F.inject, 'https://weixin110.qq.com/x?click=1',
    { cgiData: { retcode: 0, type: 'empty', targetUrl: 'https://example.com/new' } }, 'https://example.com/new'],
  ['[inject] 改版：目标藏在 btns[].link', F.inject, 'https://weixin110.qq.com/x?click=1',
    { cgiData: { type: 'empty', desc: '', btns: [{ text: '继续', link: 'https://example.com/y' }] } }, 'https://example.com/y'],
  ['[inject] cgiData 里只有客服链接(不误跳)', F.inject, 'https://weixin110.qq.com/x?click=1',
    { cgiData: { type: 'empty', links: [{ name: '客服', url: 'https://kf.qq.com/faq/1.html' }] } }, undefined],
];

let pass = 0, fail = 0;
for (const [name, file, href, opts, expect] of cases) {
  const r = run(file, href, opts);
  const got = r.replaced[0];
  const ok = got === expect;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} => ${got}${r.error ? '  err=' + r.error : ''}`);
}
// 诊断日志：失败时输出一条，成功时不输出，且不泄露查询参数
const diagCases = [
  ['[inject] 失败时打一条诊断', F.inject, 'https://weixin110.qq.com/x?click=SECRET&bankey=SECRET2', {}, true],
  ['[inject] 跳成功时不打诊断', F.inject,
    'https://c.pc.qq.com/middlect.html?pfurl=https%3A%2F%2Fwww.bing.com', {}, false],
  ['[content] 失败时打一条诊断', F.content,
    'https://weixin110.qq.com/x?click=SECRET', { html: '<p>已停止访问该网页</p>' }, true],
  ['[content] 跳成功时不打诊断', F.content, 'https://weixin110.qq.com/x?click=SECRET',
    { html: '<p>https://example.com/ok</p>' }, false],
];

for (const [name, file, href, opts, shouldLog] of diagCases) {
  const r = run(file, href, opts);
  const log = r.logs[0] || '';
  let ok = shouldLog ? r.logs.length === 1 : r.logs.length === 0;
  if (ok && shouldLog) {
    ok = log.indexOf('[skip-interstitial]') === 0 &&
      log.indexOf('no-target') !== -1 &&
      log.indexOf('SECRET') === -1; // 查询参数里的票据不能进日志
  }
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${shouldLog ? ' => ' + log : ' => (no debug)'}`);
}

console.log(`\n扩展用例: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
