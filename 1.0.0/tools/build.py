"""以原始参考脚本生成内部兼容构建，供稳定版构建与兼容测试使用。"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / '参考脚本.txt').read_text(encoding='utf-8-sig')
font = (ROOT / 'src/font-decoder.js').read_text(encoding='utf-8').replace('/* FONT_SIGNATURES */{}', (ROOT / 'src/data/font-signatures.json').read_text(encoding='utf-8').strip())
addon = (ROOT / 'src/page-adapter.js').read_text(encoding='utf-8') + '\n' + (ROOT / 'src/blank-fields.js').read_text(encoding='utf-8') + '\n' + font + '\n' + (ROOT / 'src/quiz-actions.js').read_text(encoding='utf-8') + '\n' + (ROOT / 'src/ai-helper.js').read_text(encoding='utf-8') + '\n' + (ROOT / 'src/course-helper.js').read_text(encoding='utf-8')

def replace_once(old, new):
    global source
    if source.count(old) != 1:
        raise RuntimeError(f'基线结构变化，停止构建：{old[:90]!r} 出现 {source.count(old)} 次')
    source = source.replace(old, new, 1)

source = re.sub(r'^// @name\s+.*$', '// @name         学习通自动刷课助手 · AI 完整版', source, count=1, flags=re.M)
source = re.sub(r'^// @namespace\s+.*$', '// @namespace    personal-chaoxing-ai', source, count=1, flags=re.M)
source = re.sub(r'^// @version\s+.*$', '// @version      1.1.1', source, count=1, flags=re.M)
source = re.sub(r'^// @description\s+.*$', '// @description  基于参考脚本保留任务流程；使用自填 API 的大模型处理章节文字题，支持 DeepSeek / Chat Completions 兼容接口。', source, count=1, flags=re.M)
source = re.sub(r'^// @author\s+.*$', '// @author       tofu', source, count=1, flags=re.M)
replace_once('// @storageName  unrivalxxt', '// @storageName  personal-chaoxing-ai-v1')
replace_once('// @grant        GM_info', '// @grant        GM_info\n// @grant        GM_registerMenuCommand\n// @connect      api.deepseek.com\n// @connect      localhost\n// @connect      127.0.0.1')
replace_once('// @connect      mooc1-1.chaoxing.com', '// @connect      self\n// @connect      chaoxing.com\n// @connect      mooc1-1.chaoxing.com')
source = source.replace('// @connect      cx.icodef.com\n', '')
replace_once('(() => {', '(() => {\n' + addon + '\n')
replace_once('randomDo = 1,', 'randomDo = 0,')
source = source.replace("        token = GM_getValue('tikutoken',\"111\"),//题库token\n", '')
replace_once("accuracy = GM_getValue('accuracy',60)", "accuracy = GM_getValue('accuracy',100)")
replace_once("        ctUrl = 'https://cx.icodef.com/wyn-nb?v=4',\n", '')
start = source.index('    _w.confirm = (msg) => {')
end = source.index('    if (parseFloat(rate)', start)
source = source[:start] + '''    // AI Key 仅留在脚本沙箱与 GM 存储，不挂到 unsafeWindow、不写入日志。
    let quizActions;
    const ai = createAIHelper({
        win: _w, doc: _d, getValue: GM_getValue, setValue: GM_setValue,
        request: GM_xmlhttpRequest, registerMenu: GM_registerMenuCommand, listenValue: GM_addValueChangeListener,
        report: message => {
            // 原日志通过 innerHTML 展示，这里先转义模型/题目文本。
            const safe = String(message).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
            try { _w.top.unrivalWorkInfo = safe; } catch (_) { /* 跨域父页面不提供日志 */ }
        },
        enabled: () => GM_getValue('unrivaldowork', '1') === '1' && !course.isPaused(),
        onComplete: async (summary, signal, completion) => {
            quizActions ||= createQuizActions({
                win: _w, doc: _d, getValue: GM_getValue, paused: () => course.isPaused()
            });
            await quizActions.complete(summary, signal, completion);
        }
    });
    ai.installMenu();
    const course = createCourseHelper({
        win: _w, doc: _d, getValue: GM_getValue, setValue: GM_setValue,
        request: GM_xmlhttpRequest,
        registerMenu: GM_registerMenuCommand, listenValue: GM_addValueChangeListener,
        openAI: () => ai.openSettings(),
        tasks: () => typeof missionList === 'undefined' ? null : missionList,
        rateChanged: value => { rate = value; },
        resume: () => {
            if (stop) { course.note('当前章节此前发生任务错误，请使用“刷新并重新识别”重试'); return; }
            if (_l.href.includes('work/phone/doHomeWork') && GM_getValue('unrivaldowork', '1') === '1') void ai.run();
        }
    });
    course.install();
    GM_addValueChangeListener('personalCourse.paused', (name, oldValue, value) => {
        if (value === true) ai.stop(false);
        else if (_l.href.includes('work/phone/doHomeWork') && GM_getValue('unrivaldowork', '1') === '1') void ai.run();
    });
''' + source[end:]
replace_once("GM_getValue('unrivalautosubmit', '1') || '1'", "GM_getValue('unrivalautosubmit', '0') || '0'")
start = source.index('        var tikutoken=GM_getValue("tikutoken")')
end = source.index('        var base222 = ', start)
source = source[:start] + source[end:]
# 原作者授权/署名保留在头部；替换不适用于自用版本的广告、索要账号密码等留言。
start = source.index('<div class="panel panel-info" id=\'remarks\'')
end = source.index('                <div class="panel panel-info" id="normalQuery">', start)
source = source[:start] + '''                <div class="panel panel-info" id="remarks">
                    <div class="panel-heading">自用 AI 版说明</div>
                    <div class="panel-body">答题使用你自己的 API。请先配置并测试连接；模型答案须自行核对。<br>
                    支持章节测试的单选、多选、判断文字题；图片和其他题型留待人工处理。<br>
                    原脚本作者：unrival，修改版继续遵循 GPL-3.0-or-later。</div>
                </div>
''' + source[end:]
start = source.index('                <div class="panel panel-info" id=\'tikupeizhi\'')
end = source.index('                <div class="panel panel-info" id=\'videoTime\'', start)
source = source[:start] + '''                <div class="panel panel-info" id="tikupeizhi">
                    <div class="panel-heading">自用大模型 API 配置</div>
                    <div class="panel-body">
                        <button type="button" id="personalAISettings" class="btn btn-primary">配置 API / 测试连接</button>
                        <p>默认 DeepSeek，可修改地址和模型名以接入自己的兼容服务。<br>
                        默认关闭自动提交；填答比例不代表实际正确率。<br>
                        测试页面内也有独立的 AI 面板，可开始、停止或重试。</p>
                    </div>
                </div>
''' + source[end:]
start = source.index("                    _d.getElementById('token').value=\"\";")
end = source.index("                    _d.getElementById('unrivalRate').value = rate;", start)
source = source[:start] + '''                    _d.getElementById('personalAISettings').onclick = () => ai.openSettings();
                    _d.getElementById('accuracy').value = accuracy;
                    _d.getElementById('updateaccuracy').onclick = function () {
                        const value = Number(_d.getElementById('accuracy').value);
                        if (!Number.isFinite(value) || value < 0 || value > 100) {
                            logs.addLog('填答比例阈值须为 0～100 的数字', 'orange'); return;
                        }
                        GM_setValue('accuracy', value); accuracy = value;
                        logs.addLog('自动提交填答比例阈值已更新为 ' + value + '%；此比例不代表正确率', 'green');
                    };
''' + source[end:]
source = source.replace('章节测试正确率(百分比)：', '自动提交填答比例阈值(%)：')
source = source.replace('在答题正确率在规定之上并且允许自动提交时才会提交答案', '达到填答比例阈值且无跳过或失败题目，并开启自动提交时才尝试提交；不代表答案正确率')
replace_once("logs.addLog('您设置的答题正确率为：' + String(accuracy) + '%，只有在高于此正确率时才会提交测试', 'blue');", "logs.addLog('自动提交填答比例阈值：' + String(accuracy) + '%；比例不代表答案正确率，默认关闭自动提交', 'blue');")
start = source.index('    } else if (_l.href.indexOf("work/phone/doHomeWork") > 0) {')
end = source.index("    } else if (_l.href.includes('work/phone/selectWorkQuestionYiPiYue'))", start)
source = source[:start] + '''    } else if (_l.href.indexOf("work/phone/doHomeWork") > 0) {
        _w.top.unrivalWorkDone = false;
        // 仅平台明确回报保存成功时延用原流程的保存标记。
        const originalAlert = _w.alert.bind(_w);
        _w.alert = msg => {
            if (msg === '保存成功') {
                _w.top.unrivalDoneWorkId = getQueryVariable('workId');
                return;
            }
            originalAlert(msg);
        };
        if (_w.top.unrivalDoneWorkId === getQueryVariable('workId')) {
            _w.top.unrivalWorkDone = true;
            return;
        }
        ai.openSettings();
        if (GM_getValue('unrivaldowork', '1') === '1') void ai.run();
''' + source[end:]
source = source.replace('学习通小助手v1.0&ensp;', '学习通助手 · 自用 AI 版&ensp;')
# 课程功能入口与原任务流程的修复。
start = source.index('        var busyThread = 0,')
end = source.index('        try {\n            vrefer = ', start)
source = source[:start] + '''        var busyThread = 0;
        const detectedPageData = course.readPageData();
        if (!detectedPageData) {
            course.note('未识别到章节任务数据。请从课程目录进入章节内容页；页面版本变化时需适配。不会将识别失败视为任务完成。');
            return;
        }
        const param = JSON.stringify(detectedPageData);
''' + source[end:]
source = source.replace('        var logs = {', '        course.mount();\n        course.note("已识别章节任务，视频/音频、文档和 AI 测试将按顺序处理");\n        var logs = {', 1)
replace_once('if (_w.top.unrivalScriptList.length > 1)', 'if (Array.isArray(_w.top.unrivalScriptList) && _w.top.unrivalScriptList.length > 1)')
replace_once('            loopjob = () => {', '''            loopjob = () => {
                if (course.isPaused()) { setTimeout(loopjob, 500); return; }''')
replace_once("            if (item['type'] == 'video') {", "            if (item['type'] == 'video' && course.enabled('video')) {")
replace_once("            } else if (item['type'] == 'document') {", "            } else if (item['type'] == 'document' && course.enabled('document')) {")
replace_once("loop = setInterval(function () {\n                        if (rate <= 0)", "loop = setInterval(function () {\n                        if (course.isPaused()) return;\n                        if (rate <= 0)")
# 文档请求不再把失败标记为完成；暂停时保留待执行任务。
start = source.index('            doDocument = (item) => {')
end = source.index('            doWork = (item) => {', start)
source = source[:start] + '''            doDocument = (item) => {
                const task = missionList['m' + item.jobid];
                task.running = true;
                logs.addLog('开始处理文档：' + item.name);
                const send = () => {
                    if (course.isPaused()) { setTimeout(send, 500); return; }
                    busyThread += 1;
                    let settled = false;
                    const finish = (success, message) => {
                        if (settled) return;
                        settled = true; busyThread -= 1; task.running = false;
                        task.done = success; task.failed = !success;
                        logs.addLog(message, success ? 'green' : 'red');
                        if (!success) { stop = true; course.note(message + '；已停止当前章节，请处理后刷新重试'); }
                    };
                    GM_xmlhttpRequest({
                        method: 'get', timeout: 30000,
                        url: _p + '//' + _h + '/ananas/job/document?jobid=' + item.jobid +
                            '&knowledgeid=' + chapterId + '&courseid=' + courseId + '&clazzid=' +
                            classId + '&jtoken=' + item.jtoken,
                        onload: res => {
                            try {
                                const result = JSON.parse(res.responseText);
                                const success = Number(res.status) === 200 && result.status === true;
                                finish(success, success ? '文档任务已完成' : '平台尚未确认文档任务完成');
                            } catch (_) { finish(false, '文档返回数据无法解析'); }
                        },
                        onerror: () => finish(false, '文档请求失败，请检查网络和脚本猫域名授权'),
                        ontimeout: () => finish(false, '文档请求超时')
                    });
                };
                setTimeout(send, parseInt(Math.random() * 2000 + 9000, 10));
            },
''' + source[end:]
# 视频任务详情请求异常必须释放等待计数，且明确停在当前章节。
start = source.index('        var video_getReady = (item) => {')
end = source.index('            doVideo = (item) => {', start)
source = source[:start] + '''        var video_getReady = (item) => {
            busyThread += 1;
            course.requestVideoInfo(item, { fid: FID }).then(({ info, objectId }) => {
                    missionList['m' + item.jobid] = {
                        module: item.property.module || 'video', type: 'video', dtoken: info.dtoken,
                        duration: Number(info.duration), objectId,
                        rt: item.property.rt || '0.9', otherInfo: item.otherInfo,
                        doublespeed: item.property.doublespeed, jobid: item.jobid,
                        name: item.property.name, done: false, running: false
                    };
                    const label = _d.createElement('div'); label.textContent = '[视频/音频]' + item.property.name;
                    _d.getElementById('joblist').append(label);
                    course.render();
            }).catch(e => {
                    stop = true;
                    const message = '获取视频/音频任务详情失败：' + e.message + '。请处理后刷新当前章节。';
                    course.note(message);
                    const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
                    logs.addLog(escape(message), 'red');
            }).finally(() => { busyThread -= 1; });
        },
''' + source[end:]
# 视频完成信息仍以平台响应判断，保留原来的报告与签名流程。
replace_once('            if (_w.jump) {', '            if (course.isPaused() || !course.enabled("jump")) return;\n            if (_w.jump) {')
source = source.replace('if (rd != _w.top.unrivalPageRd)', 'if (course.isPaused() || !course.enabled("jump") || rd != _w.top.unrivalPageRd)')
replace_once('                _w.onReadComplete1();', '                if (typeof _w.onReadComplete1 === "function") _w.onReadComplete1();')
replace_once('                setTimeout(\'jjump("\' + _w.top.unrivalPageRd + \'")\', 2856);', '                const rd = _w.top.unrivalPageRd;\n                setTimeout(() => _w.jjump(rd), 2856);')
# 原脚本的外部签名服务仅计算 MD5；用相同原公式本地计算，取消旧 HTTP 依赖。
replace_once("    var host = 'http://14.29.190.187:54223/',\n        rate =", "    var rate =")
source = source.replace('// @connect      14.29.190.187\n', '')
start = source.index("                            encUrl = host + 'chaoXing/v3/getEnc.php?classid='")
end = source.index('                            busyThread += 1;', start)
source = source[:start] + source[end:]
start = source.index('                            GM_xmlhttpRequest({\n                                method: "get",\n                                url: encUrl,')
end = source.index('                        }\n                        times += 1;', start)
source = source[:start] + '''                            const signText = `[${classId}][${UID}][${item.jobid}][${item.objectId}][${playTime * 1000}][d_yHJ!$pdA~5][${item.duration * 1000}][0_${item.duration}]`;
                            ecOnload({ status: 200, responseText: course.md5(signText) });
''' + source[end:]
replace_once('                                        enc = jq.md5(strEc);', '                                        enc = course.md5(strEc);')
# 旧流程在视频播完但平台未确认时也会标记完成；改为保留失败状态。
start = source.index("                                            } else if (isdrag == '4') {")
end = source.index('                                            } else {\n                                                logs.addLog(item[\'name\']', start)
source = source[:start] + '''                                            } else if (isdrag == '4') {
                                                const task = missionList['m' + item.jobid];
                                                task.running = false;
                                                task.done = _w.top.unrivalReviewMode === '1';
                                                task.failed = !task.done;
                                                clearInterval(loop);
                                                if (!task.done) {
                                                    stop = true;
                                                    course.note('视频计时结束，但平台尚未确认任务完成。已停在当前章节，请检查后刷新重试。');
                                                    logs.addLog('平台尚未确认视频任务完成，未自动切章', 'red');
                                                } else logs.addLog('复习视频已观看完毕', 'green');
''' + source[end:]
# 进度请求超时/网络失败时释放计数并停止，避免不断等待或误切章。
start = source.index('                                    onerror: function (err) {')
end = source.index('                                });\n                            };', start)
source = source[:start] + '''                                    onerror: () => {
                                        busyThread -= 1; clearInterval(loop); stop = true;
                                        const task = missionList['m' + item.jobid]; task.running = false; task.failed = true;
                                        course.note('视频进度请求失败，请检查网络或域名授权后刷新当前章节');
                                    },
                                    ontimeout: () => {
                                        busyThread -= 1; clearInterval(loop); stop = true;
                                        const task = missionList['m' + item.jobid]; task.running = false; task.failed = true;
                                        course.note('视频进度请求超时，请检查后刷新当前章节');
                                    }
''' + source[end:]
replace_once('                                    url: reportsUrl,', '                                    url: reportsUrl,\n                                    timeout: 30000,')
source = source.replace("                    encUrl = '',\n", '')
source = source.replace('        const param = JSON.stringify(detectedPageData);\n', '')
# 参数解析失败不等同于无任务，不自动跳转。
start = source.index('        try {\n            var pageData = JSON.parse(param);')
end = source.index('        var data = pageData[\'defaults\'],', start)
source = source[:start] + '        var pageData = detectedPageData;\n' + source[end:]
source = source.replace('学习通助手 · 自用 AI 版&ensp;', '自动刷课 + AI 答题 · 完整版&ensp;')
# 原题库配置和赞赏面板已移除，删除不再使用的图像数据与随机作答开关。
source = re.sub(r'^\s*var base222 = `data:image/png;base64,[^\n]*\n', '', source, count=1, flags=re.M)
source = re.sub(r'^\s*randomDo = 0,[^\n]*\n', '', source, count=1, flags=re.M)
out = ROOT / 'build' / 'legacy.user.js'
out.parent.mkdir(exist_ok=True)
out.write_text(source, encoding='utf-8', newline='\n')
print(f'已生成内部兼容构建 build/{out.name} ({out.stat().st_size} bytes)')
