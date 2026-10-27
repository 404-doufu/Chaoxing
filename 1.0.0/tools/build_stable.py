"""从内部兼容构建生成两份 Edge 安装脚本；先运行 build.py 或 npm run build。"""
from pathlib import Path
import re
import json

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['stableVersion']
source = (ROOT / 'build' / 'legacy.user.js').read_text(encoding='utf-8')
core = (ROOT / 'src/study-core.js').read_text(encoding='utf-8')
runtime = (ROOT / 'src/study-runtime.js').read_text(encoding='utf-8')
reader = (ROOT / 'src/document-reader.js').read_text(encoding='utf-8')
floating = (ROOT / 'src/floating-control.js').read_text(encoding='utf-8')
recovery = (ROOT / 'src/chapter-recovery.js').read_text(encoding='utf-8')

def once(old, new):
    global source
    if source.count(old) != 1:
        raise RuntimeError(f'构建基线变化：{old[:65]!r}')
    source = source.replace(old, new, 1)

source = re.sub(r'^// @name\s+.*$', '// @name         学习通 Edge 稳定学习版 · AI + 后台监督', source, count=1, flags=re.M)
source = re.sub(r'^// @version\s+.*$', '// @version      ' + version, source, count=1, flags=re.M)
source = re.sub(r'^// @description\s+.*$', '// @description  保留平台原播放器；实际播放进度、断点记录、断网重试和可选后台监督。电脑休眠及页面冻结期间不能保证继续执行。', source, count=1, flags=re.M)
source = source.replace('(() => {', '(() => {\n' + core + '\n' + reader + '\n' + recovery + '\n' + runtime + '\n' + floating + '\n', 1)
once('    const course = createCourseHelper({', '    let studyRuntime = null;\n    const course = createCourseHelper({\n        version: ' + json.dumps(version) + ',')
once('        report: message => {', '        report: message => {\n            studyRuntime?.aiStatus(message);')
once('getValue: GM_getValue, paused: () => course.isPaused()', 'getValue: GM_getValue, paused: () => course.isPaused(), onDispatch: () => studyRuntime?.quizSubmitted()')
once('        tasks: () => typeof missionList === \'undefined\' ? null : missionList,', '        tasks: () => studyRuntime ? studyRuntime.tasks() : null,')
start_resume = source.index('        resume: () => {', source.index('const course = createCourseHelper({'))
end_resume = source.index('\n        }\n    });', start_resume)
source = source[:start_resume] + '        resume: () => studyRuntime?.resume()' + source[end_resume + len('\n        }'):]
once("        else if (_l.href.includes('work/phone/doHomeWork') && GM_getValue('unrivaldowork', '1') === '1') void ai.run();", '        else studyRuntime?.resume();')
once('    const ai = createAIHelper({', '''    const ai = createAIHelper({
        activity: active => studyRuntime?.aiActivity(active),
        headless: () => _w.parent !== _w,
        settingsContainer: () => course.settingsContainer(),
        closeSettings: () => course.showControls(),
        runCurrent: () => studyRuntime?.requestAI('run'),''')
once('    ai.installMenu();', '    // 所有可见控制入口统一到最外层浮窗。')
once('        ai.openSettings();\n', '        // 试题页不再另外弹出 AI 设置窗口。\n')
once("        host.style.cssText = container ? 'display:block;width:100%' : 'position:fixed;right:16px;top:24px;z-index:2147483647;max-width:calc(100vw - 24px)';", "        host.style.cssText = 'display:block;width:100%';")
once('        } else doc.documentElement.append(host);', '        } // 稳定版 API 设置只嵌入唯一总控。')
menu_start = source.index('    function installMenu() {', source.index('function createAIHelper(env)'))
menu_end = source.index('    return { config, save, endpoint,', menu_start)
source = source[:menu_start] + source[menu_end:]
once('openSettings, installMenu, testConnection', 'openSettings, testConnection')
# 去掉旧的重建页面、静音音频保活、模拟计时/签名上报和旧切章循环。
start = source.index('    if (_l.href.indexOf("knowledge/cards") > 0) {')
# 稳定安装产物不再携带旧版答题/批阅/后台路由作为兜底。
end = source.rindex('})();')
source = source[:start] + '''    studyRuntime = createStudyRuntime({
        win: _w, doc: _d, course, ai, getValue: GM_getValue, setValue: GM_setValue,
        request: GM_xmlhttpRequest, listenValue: GM_addValueChangeListener
    });
    studyRuntime.handleRoute();
''' + source[end:]
# 旧顶部全局标记、仅手机号版路由及初始化默认值不再影响稳定执行层。
old_init = source.index('    if (parseFloat(rate) == parseInt(rate)) {')
new_init = source.index('    studyRuntime = createStudyRuntime({', old_init)
source = source[:old_init] + source[new_init:]
# 旧模拟执行层的参数、Cookie 读取和账号占位字段已无消费者，不能留在推荐安装产物中。
prelude_start = source.index('    var jumpType = 1,')
prelude_end = source.index('    // AI Key', prelude_start)
source = source[:prelude_start] + '''    const _w = unsafeWindow, _d = _w.document;
    let rate = GM_getValue('unrivalrate','1');
''' + source[prelude_end:]
# 稳定版直接移除旧总控的生成/菜单代码，兼容构建仍保留用于旧流程回归。
helper_start = source.index('function createCourseHelper(env)')
ui_start = source.index('    function render() {', helper_start)
ui_end = source.index('    return { enabled, isPaused, setPaused, note, mount, install,', ui_start)
source = source[:ui_start] + '''    const control = createFloatingControl({
        ...env, enabled, isPaused, setPaused, note, status: () => lastStatus,
        runAI: action => studyRuntime?.requestAI(action), stopAI: () => ai.stop()
    });
    const render = () => control.render();
    const mount = () => control.mount();
    const install = () => control.install();
''' + source[ui_end:]
once('    let root, host, lastStatus =', '    let lastStatus =')
once('return { enabled, isPaused, setPaused, note, mount, install, readPageData,', 'return { enabled, isPaused, setPaused, note, mount, install, settingsContainer: () => control.settingsContainer(), showControls: () => control.showControls(), readPageData,')
# 稳定执行层不依赖页面 jQuery 或旧版账号/进度全局字段。
out = ROOT / '学习通-Edge稳定学习版.user.js'
out.write_text(source, encoding='utf-8', newline='\n')

background = '''// ==UserScript==
// @name         学习通 Edge 后台监督（配套）
// @namespace    personal-chaoxing-ai-supervisor
// @version      VERSION
// @description  只监督页面心跳、记录断点状态并提醒；不伪造进度、不刷新作业、不操作 DOM。
// @author       tofu
// @license      GPL-3.0-or-later
// @storageName  personal-chaoxing-ai-v1
// @background
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_notification
// ==/UserScript==
(() => {
CORE
    const core = createStudyCore({
        getValue: GM_getValue, setValue: GM_setValue, listValues: GM_listValues,
        notify: message => GM_notification({ title: 'Edge 课程监督', text: message, timeout: 10000 })
    });
    const tick = () => {
        try { core.supervise(); }
        finally { setTimeout(tick, 60000); }
    };
    tick();
})();
'''.replace('VERSION', version).replace('CORE', core)
(ROOT / '学习通-Edge后台监督.user.js').write_text(background, encoding='utf-8', newline='\n')
print(f'已生成 Edge 稳定版 {version} 与配套后台监督脚本')
