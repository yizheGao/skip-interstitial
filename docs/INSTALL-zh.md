========================================
 安全检测自动跳过 — Chrome/Edge 扩展（v1.0.0）
========================================

【作用】
在 QQ / 微信 / 豆包·抖音 中点击外链，或在浏览器里遇到安全检测
中间页时，自动把目标网址取出来直接打开，覆盖：
  - 腾讯系（QQ/微信）：
      “非官方网页，是否继续访问”确认页（自动点继续）
      “已停止访问 / 如需浏览请长按网址复制”页（直接抠出网址）
      type=empty 页目标藏在 cgiData.desc 且为 HTML 实体编码（&#x2f;）
      时，先解码实体再取网址
      “已停止访问该网页”完全拉黑页（type=block，url 为空）：
        从“申请恢复访问”链接的 base64 参数还原目标，且不会误跳
        到客服指引页（kf.qq.com）
      c.pc.qq.com 的 middlem / middlect / index / ios 等中间页
  - 字节系（豆包/抖音/头条）：
      link.wtturl.cn 安全链接页（target 参数）
  - 两家检测页互相套娃：
      字节页套腾讯页、腾讯页套字节页，都能层层解析直达目标。
安全检测只是不让它的内置浏览器跳转，目标网站在公网上仍然可访问，
所以把网址取出来直接打开即可。

【安装（Chrome / Edge / QQ浏览器等 Chromium 内核，需 111+）】
1. 先把 Release 里的 skip-interstitial-<版本>.zip 解压到一个固定位置（安装后不要删除）。
2. 地址栏输入并打开：
     Chrome  : chrome://extensions/
     Edge    : edge://extensions/
3. 打开右上角的“开发者模式”。
4. 点“加载已解压的扩展程序”，选择解压后
   包含 manifest.json 的那一层目录。
5. 列表里出现“安全检测自动跳过”即安装成功。

【验证】
在浏览器地址栏直接访问下面链接，应自动跳到 bing：
  腾讯单层：
  https://c.pc.qq.com/middlect.html?pfurl=https%3A%2F%2Fwww.bing.com
  字节套腾讯（套娃）：
  https://link.wtturl.cn/?target=https%3A%2F%2Fc.pc.qq.com%2Fmiddlect.html%3Fpfurl%3Dhttps%253a%252f%252fwww.bing.com

【工作方式（三层保险）】
1. inject.js 运行在页面主世界（document_start），最早拦截地址栏
   参数，并轮询 window.cgiData：确认页用 cgiData.url，完全拉黑时
   从 cgiData.links 里“申请恢复访问”链接的 base64 还原；
2. content.js 运行在隔离世界，从初始 HTML/脚本文本（含 %3A%2F
   编码形式、verifywebmaster 链接）中正则提取目标网址，监听 DOM
   异步渲染，并自动点击“继续访问”（不会误点“申请恢复”）；
   注：拉黑页底部的“申请恢复”在 DOM 里是没有 href 的 <a>，所以
   以 cgiData 文本/对象为准；
3. background.js 用 webNavigation 在导航刚开始时直接重定向。

【重要说明】
1. 手机 QQ / 微信 / 抖音 App 自带的内置浏览器不支持安装扩展，
   本扩展只在桌面版 Chromium 内核浏览器中生效。
   手机端方案：
   - 安卓：Kiwi Browser / Via 等支持油猴的浏览器，安装
     tencent-bypass.user.js；
   - 或在 App 里点右上角“…”，选择“用浏览器打开”。
2. 完全拉黑（type=block）时 cgiData.url 为空，正文也没有目标，
   脚本会从“申请恢复访问”链接的 base64 url 参数还原目标；
   客服指引（kf.qq.com）、查看规则等官方功能页已被排除，不会误跳。
   若连申请恢复链接都没有（页面无任何目标线索），则需你自己从
   聊天记录里复制链接，再到浏览器打开。
3. 若中间页改版导致参数名变化，可在各脚本的 PARAM_NAMES
   数组里补充新的参数名；新出现的检测域名可加入 MIDDLE_HOSTS，
   官方功能/帮助页可加入 FUNCTION_HOSTS。
