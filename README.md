# skip-interstitial

跳过 QQ / 微信 / 豆包·抖音 的外链安全检测中间页，直接打开真实目标地址。

Chrome / Edge（MV3 扩展）+ Tampermonkey（单文件用户脚本），两套实现逻辑同源。

当前公开版本为 **1.0.0**，功能变更见 [CHANGELOG](CHANGELOG.md)。

> 中间页本质是 URL 包装器：它只阻止 App 内置浏览器跳转，目标站点在公网上照常可访问。
> 本项目只做「从中间页里取出目标 URL → `location.replace`」，不调用任何检测接口、不伪造票据、不改目标站点。

---

## 支持面

| 场景 | 处理方式 | 状态 |
|---|---|---|
| `c.pc.qq.com/middlect.html?pfurl=…`（QQ 外链确认页） | 地址栏参数静态解析 | ✅ |
| `c.pc.qq.com/{middlem,middleb,index,ios,pc,android}.html` | 同上 | ✅ |
| 微信「已停止访问」确认页（`weixin110` + `cgiData.url`） | 读页面全局对象 | ✅ |
| 微信「如需浏览，请长按网址复制」页（`cgiData.type=empty`，目标在 `desc` 且被实体编码） | 解码 `&#x2f;` 后提取 | ✅ |
| 微信「已停止访问该网页」完全拉黑页（`type=block`，`cgiData.url` 为空） | 从「申请恢复访问」链接的 base64 `url=` 参数还原 | ✅ |
| 字节 `link.wtturl.cn/?app_id=…&target=…`（豆包 / 抖音 / 头条） | `target` 参数解析 | ✅ |
| 腾讯页套字节页、字节页套腾讯页、三层以上 | 逐层递归解包（上限 5 层） | ✅ |
| `kf.qq.com`（客服）、`urlsec.qq.com`（网址自查） | 白名单排除，永不作为目标 | ✅ |
| App 内置浏览器（手机 QQ / 微信 / 抖音 webview） | 装不了扩展，本项目不覆盖 | ❌ |

---

## 原理

扩展挂三处，按触发时机从早到晚：

1. **`extension/background.js`** — `webNavigation` 在导航开始时就命中中间页域名并 `tabs.update` 重定向，页面还没渲染就跳走。
2. **`extension/inject.js`**（`world: MAIN`, `document_start`）— 与页面共享 JS 环境，直接读 `window.cgiData`：确认页取 `.url`，完全拉黑页取 `.links` 里 `verifywebmaster` 的 base64，`type=empty` 取 `.desc` 文本。
3. **`extension/content.js`**（`world: ISOLATED`）— 兜底：先按 base64 申诉链接还原，再扫解码 HTML 实体后的 `outerHTML` 与 `body.textContent`，最后 `MutationObserver` 等异步渲染，并自动点「继续访问」。

油猴版 `userscript/tencent-bypass.user.js` 把 2 + 3 合并成一个文件。

递归解包（`extractTarget`）：

```
current = 输入 URL
重复最多 5 层:
  按 PARAM_NAMES 优先级找参数（pfurl / url / target / redirect_uri / …）
  逐层 decodeURIComponent 到解出 http(s) 为止
  找到的目标不在中间页域名表 → 返回（终点了）
  否则 current = 目标，继续向内
```

---

## 安装

### Chrome / Edge（扩展）

1. 下载 [Releases](../../releases) 里的 `skip-interstitial-<version>.zip` 并解压到固定目录；
2. 打开 `chrome://extensions/`（Edge 是 `edge://extensions/`），开启「开发者模式」；
3. 「加载已解压的扩展程序」，选择包含 `manifest.json` 的那一层。

需要 Chrome 111+（用到 content script 的 `world: "MAIN"`）。

### Tampermonkey（油猴）

安装 `userscript/tencent-bypass.user.js`，或从仓库原文新建脚本粘贴。Android 的 Kiwi / Via 等支持油猴的浏览器同样可用。

---

## 目录

```
extension/            MV3 扩展（inject / content / background / manifest / icons）
userscript/           油猴单文件版（与扩展逻辑同源）
docs/INSTALL-zh.md    面向用户的中文安装/验证说明（同时打进 Release 包外单独提供）
test/
  test-bypass.js      原 66 条用例（参数提取、cgiData 注入、DOM 文本、block base64 还原）
  test-extended.js    17 条补充用例（HTML 实体、type=empty、三重编码、误跳顺序、字段改名、诊断日志）
scripts/
  check.js            语法 + JSON + 常量表一致性 + 版本同步 + 票据扫描 + 两套用例（CI 入口）
  consistency.js      四份脚本的 MIDDLE_HOSTS/FUNCTION_HOSTS/PARAM_NAMES 必须逐字一致
  pack.sh             打包 dist/*.zip
```

```bash
npm run check     # 83 条用例全过才算通过
npm run pack      # 生成 dist/skip-interstitial-<version>.zip
```

测试用 Node `vm` mock `window` / `document` / `location`，不访问网络、不启动浏览器。

提取失败时会打一行诊断（只在没跳成时输出一次，查询参数已剔除，不会带出 `bancode/bankey`）：

```
[skip-interstitial] no-target https://weixin110.qq.com/cgi-bin/... type=empty retcode=0 keys=retcode,type,title,desc url=no links=no strings=4
```

改版排查时先看这行：`cgiData=undefined` 说明页面没给数据；`strings=0` 说明数据里没有明文字符串；有 `strings` 但仍不跳，多半被中间页/功能页/静态资源过滤器挡了。

---

## 已知限制

1. **桌面 Chromium 才生效**。手机 App 内置 webview 装不了扩展；要么点「…」用系统浏览器打开，要么走代理/重写方案（见下方对比）。
2. **完全拉黑页若连「申请恢复」链接都没有**，页面不含任何目标线索，脚本无法还原，只能从聊天记录复制原链接。
3. 微信停止页地址栏只有加密的 `bancode/bankey/click/midpagecode`，无法从地址栏解，依赖 `cgiData` 或页面文本。
4. 腾讯/字节改版后参数名可能变化：改 `MIDDLE_HOSTS` / `PARAM_NAMES` / `FUNCTION_HOSTS` 即可，四份实现要同步（见下）。
5. `link.wtturl.cn` 缺 `app_id` 会直接返回 400，手工构造验证链接时必须带上真实 `app_id`。


---

## 维护须知

`MIDDLE_HOSTS` / `FUNCTION_HOSTS` / `PARAM_NAMES` 目前在 `inject.js`、`content.js`、`background.js`、`tencent-bypass.user.js` 四份文件里各有一份拷贝，改一处必须同步四处，同时更新 `manifest.json` 的 `host_permissions` 与 `content_scripts.matches`。
下一步可合并成 `core.js` + 构建脚本，四份产物从同一源生成。

## License

MIT
