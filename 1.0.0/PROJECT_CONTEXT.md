# 发行 1.0.0 开发接续

公开维护作者：tofu。公开安装版本以 `package.json.stableVersion` 为准；`package.json.version` 是内部兼容构建版本。唯一正式安装入口为 `发行1.0.0.user.js`。

## 开始开发

先读 `README.md` 与 `AGENTS.md`。修改 `src/` 中的源文件，通过 `npm run build` 生成安装脚本，不直接修改生成文件。开发环境需要 Node.js/npm 与 Python 3；依赖由 `npm ci` 安装。

构建链：`参考脚本.txt` + `src/` → `build/legacy.user.js` → 两份稳定开发产物 → `发行1.0.0.user.js`。`build/legacy.user.js` 是构建时生成的必要中间文件，`build/` 不提交仓库。

## 维护范围

保留页面顺序串行音视频、至少 10 秒停留、平台完成复核、文档翻阅、自动切章、个人 API 答题及页面级监督。只由最外层课程页持有一份可拖动置顶总控，API 配置嵌入同一浮窗。页面关闭、冻结或系统休眠时，页面监督不能保证继续执行。

页面路由、题目容器和确认窗口集中维护在 `src/page-adapter.js`。文字填空和 UEditor 适配在 `src/blank-fields.js`；原生提交与确认在 `src/quiz-actions.js`；媒体与切章在 `src/study-runtime.js`；停滞恢复在 `src/chapter-recovery.js`。全部模块的源码、构建工具和测试均随仓库提供。

API Key 仅由使用者在脚本猫中配置，不将真实 Key、Cookie、认证 URL、浏览器存储或课程截图写入源码、日志和接续文档。测试中的模拟配置不代表真实账户配置。

## 验证边界

变更后顺序执行 `npm run build`、`npm run check`、`npm test`。报告实际结果；本地模拟测试不代表当前 Edge/Chrome 实页验收。真实 API、平台完成、自动切章与长期后台行为需要分别验收。

原参考与许可保持独立；字体来源和测试字体许可见 `docs/字体适配说明.md`。公开安装与使用说明统一维护在 `README.md`。
