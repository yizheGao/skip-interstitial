# 取现场证据（3 步）

出现「不跳了」时，先在出问题的页面按 F12 → Console，执行：

```js
// 1. 页面数据（插件 inject 层读的就是这个）
copy(JSON.stringify(window.cgiData, null, 2));

// 2. 页面可见文本（插件 content 层扫的就是这个）
copy(document.body.innerText);

// 3. 页面源码片段（实体编码的 URL 在这里能看到）
copy(document.documentElement.outerHTML.slice(0, 20000));
```

三次 `copy()` 的内容粘到 issue 里即可。`bancode/bankey/click` 可以打码，但请保留字段名。

## 快速判断卡在哪一层

| 现象 | 大概率原因 |
|---|---|
| `cgiData` 是 `undefined`，文本里也没有网址 | 页面没给数据（UA/来源校验），桌面端通常无解 |
| `cgiData` 有值但里面没有明文 `http` | 值是加密/base64 形态，只能靠渲染后的文本兜底 |
| `cgiData` 有明文网址但没跳 | 被中间页/功能页/静态资源过滤器挡了，或目标本身就是腾讯域名 |
| 有「继续访问」但没点 | 按钮文案不在白名单（`继续访问/继续前往/仍然访问/继续打开/继续/确定`） |

## 开发者本地复现

```bash
# 用桌面 UA 直接拉页面，看服务端返回的 cgiData
curl -sS -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36" \
  "<出问题的完整 URL>" | grep -o 'cgiData = {[^<]*'
```

拿到结构后，在 `test/test-extended.js` 里加一条同形态的用例，再改代码——先有红灯，再让它变绿。
