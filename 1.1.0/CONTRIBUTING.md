# 构建与贡献

安装 Node.js（支持 `node --test`）与 Python 3，在仓库根目录执行：

```powershell
npm ci
npm run build
npm run check
npm test
```

公开发行号由 `package.json.stableVersion` 决定；`version` 为内部兼容构建号。修改 `src/` 源码后运行完整构建，不直接修改生成脚本。

构建链为 `参考脚本.txt` 与源码 → `build/legacy.user.js` → 稳定开发产物 → 当前 `发行<版本>.user.js`。兼容中间文件和两份稳定开发脚本用于回归，不能与正式脚本同时启用。字体摘要已随源码提供，正常构建不需要联网下载字形索引。

`npm run package:release` 按清单复制当前安装脚本、源码、测试、构建工具及公开说明，生成版本目录、`SHA256SUMS` 和同名 ZIP；同名目录/ZIP 存在时拒绝覆盖。上传到 GitHub 时，将版本目录内的文件放在仓库根目录；GitHub Release 可使用该 ZIP 或安装脚本。发布前重新检查版本号、测试结果和许可。

`python tools/preview_control.py` 提供只绑定 127.0.0.1 的界面预览；预览按钮和检测代码不会进入安装脚本。预览无真实 API/课程连接，不能替代 Edge + 脚本猫的实页验收。

保留顺序串行音视频、至少 10 秒停留、平台完成复核、文档翻阅、自动切章、个人 API 答题及页面监督。页面适配集中在 `src/page-adapter.js`。不要伪造观看进度或完成结果；暂停、停止、验证码和登录阻断仍须生效。页面监督不保证唤醒关闭或冻结的页面。

API Key 只保存在脚本猫隔离存储；勿提交真实 Key、Cookie、认证链接、浏览器存储或个人课程截图。保留原作者来源声明、`LICENSE` 与字体许可，用户说明统一维护在 `README.md`。
