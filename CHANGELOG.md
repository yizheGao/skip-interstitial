# Changelog

## 1.0.0 — 2026-11-13（首个公开版本）

**支持面**

- QQ 中间页 `c.pc.qq.com/{middlect,middlem,middleb,index,ios,pc,android}.html`：`pfurl` 参数提取
- 微信停止页三种形态：`cgiData.url`（确认页）、`cgiData.links` 里的 base64 申诉链接（完全拉黑）、`cgiData.type=empty` 的 `desc`（实体编码）
- 字节 `link.wtturl.cn/?app_id=…&target=…`
- 腾讯页 ↔ 字节页互相套娃，递归解包上限 5 层
- `kf.qq.com` / `urlsec.qq.com` 白名单排除，避免误跳客服页

**实现要点**

- HTML 实体解码（`&#x2f;`、`&amp;`）先于正则匹配
- 参数多级解码，解出 `http(s)` 即停，避免二次解码污染目标自身的 query
- 地址栏参数、`cgiData` 三种形态、DOM 文本三层兜底，`inject` / `content` / `background` 按触发时机从早到晚
- `cgiData` 提取不挑字段名，递归扫描全部字符串值（字段改名仍可用）
- 提取失败时输出一行诊断日志，查询参数已剔除，不含 `bancode/bankey`

**工程**

- 83 条用例（66 条基础 + 17 条补充），Node `vm` mock，不联网
- CI 校验：语法/JSON、四份脚本常量表一致、版本号四处同步、真实票据扫描、全部用例
