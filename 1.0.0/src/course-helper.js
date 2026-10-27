/* 课程控制与任务参数兼容层。视频/文档执行仍调用参考脚本的流程。 */
function createCourseHelper(env) {
    'use strict';
    const { win, doc, getValue, setValue } = env;
    const defaults = { video: true, document: true, jump: true, paused: false };
    const key = name => 'personalCourse.' + name;
    let root, host, lastStatus = '等待课程任务页识别视频、文档和章节测试';
    const enabled = name => getValue(key(name), defaults[name]) === true;
    const isPaused = () => getValue(key('paused'), false) === true;
    function setPaused(value) {
        setValue(key('paused'), value);
        if (value) {
            setValue('personalAI.stop', `${Date.now()}-${Math.random()}`);
            note('已暂停任务调度、视频计时和自动切章；已发出的请求仍可能正常返回');
        } else note('已继续自动学习，按当前章节任务顺序执行');
        render();
    }
    function note(message) { lastStatus = message; render(); }
    function valid(data) { return data && typeof data === 'object' && data.defaults && Array.isArray(data.attachments); }
    function parseVideoInfo(res) {
        const status = Number(res?.status);
        if (!status || status < 200 || status >= 300) {
            const hints = { 401: '登录状态失效，请重新登录课程', 403: '服务器拒绝访问，请检查课程登录状态或站点限制', 404: '当前站点不存在视频详情接口', 429: '服务器限制请求频率，请稍后重试' };
            throw new Error(`HTTP ${status || 0}：${hints[status] || '视频详情接口请求失败'}`);
        }
        const text = typeof res.responseText === 'string' ? res.responseText.trim() : '';
        if (/passport|\/login(?:[/?]|$)/i.test(res.finalUrl || '')) throw new Error('视频详情请求被转到登录页，请重新登录课程');
        if (/^</.test(text)) {
            if (/验证码|captcha|验证身份|人机验证/i.test(text)) throw new Error('接口返回验证页面，请先在课程页面手动完成验证');
            if (/登录|login|passport/i.test(text)) throw new Error('接口返回登录页面，请重新登录课程');
            throw new Error('接口返回 HTML 页面而非 JSON，可能是站点跳转或访问限制');
        }
        let result;
        try { result = text ? JSON.parse(text) : res.response; }
        catch (_) { throw new Error('接口返回的内容不是有效 JSON'); }
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('接口返回空内容或非对象数据');
        const info = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : result;
        const missing = [];
        if (!Number.isFinite(Number(info.duration)) || Number(info.duration) <= 0) missing.push('duration（有效时长）');
        if (typeof info.dtoken !== 'string' || !info.dtoken.trim()) missing.push('dtoken（视频访问参数）');
        if (missing.length) {
            // 只显示字段名，不显示接口原文、Cookie、token 等敏感值。
            const fields = Object.keys(info).filter(x => /^[a-zA-Z_][\w-]{0,30}$/.test(x)).slice(0, 15).join('、') || '无';
            throw new Error(`接口缺少 ${missing.join('、')}；返回字段：${fields}`);
        }
        return { ...info, duration: Number(info.duration) };
    }
    async function requestVideoInfo(item, context) {
        const property = item.property || {};
        const objectId = property.objectid ?? property.objectId ?? item.objectid;
        if (objectId === undefined || objectId === null || !String(objectId).trim()) throw new Error('任务缺少 objectid，未发起网络请求，请重新打开课程章节');
        const fid = context.fid;
        if (fid === undefined || fid === null || !String(fid).trim()) throw new Error('页面缺少 fid（学校/机构参数），未发起网络请求，请重新进入课程');
        const origin = new URL(win.location.href).origin;
        const url = new URL('/ananas/status/' + encodeURIComponent(String(objectId)), origin);
        url.searchParams.set('k', String(fid)); url.searchParams.set('flag', 'normal'); url.searchParams.set('_dc', String(Date.now()));
        const label = `${url.host}/ananas/status/…`;
        let nativeFailure = '';
        // 优先同源请求，使用当前课程的登录态，不依赖扩展跨域授权。
        if (typeof win.fetch === 'function') {
            const controller = new win.AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            let response;
            try {
                const res = await win.fetch(url.href, { credentials: 'same-origin', mode: 'same-origin', redirect: 'follow', signal: controller.signal });
                response = { status: res.status, responseText: await res.text(), finalUrl: res.url };
            } catch (e) {
                nativeFailure = e?.name === 'AbortError' ? '同源请求超时' : '同源请求被网络或页面策略阻止';
            } finally { clearTimeout(timer); }
            // HTTP/业务数据错误直接报告，不将它误判为网络错误反复请求。
            if (response) {
                try { return { info: parseVideoInfo(response), objectId: String(objectId), transport: '同源请求' }; }
                catch (e) { throw new Error(`${label}：${e.message}`); }
            }
        }
        if (typeof env.request !== 'function') throw new Error(`${label}：${nativeFailure || '同源请求不可用'}，且脚本猫请求接口不可用`);
        return new Promise((resolve, reject) => {
            let settled = false, handle;
            const finish = (res, error) => {
                if (settled) return;
                settled = true; clearTimeout(timer);
                try {
                    if (error) throw error;
                    resolve({ info: parseVideoInfo(res), objectId: String(objectId), transport: '脚本猫请求' });
                } catch (e) { reject(new Error(`${label}：${nativeFailure ? nativeFailure + '；' : ''}${e.message}`)); }
            };
            const timer = setTimeout(() => { finish(null, new Error('脚本猫请求超时')); handle?.abort?.(); }, 31000);
            try {
                handle = env.request({
                    method: 'GET', url: url.href, timeout: 30000, responseType: 'text', anonymous: false,
                    onload: res => finish(res),
                    onerror: error => {
                        const message = typeof error === 'string' ? error : String(error?.error || error?.message || '');
                        const denied = /@connect|not.?allow|permission|whitelist|blacklist|未授权|拒绝/i.test(message);
                        finish(null, new Error(denied ? `脚本猫拒绝请求，请检查当前域名 ${url.hostname} 的站点授权` : '脚本猫网络请求失败（未收到 HTTP 响应），请检查网络和站点授权'));
                    },
                    ontimeout: () => finish(null, new Error('脚本猫请求超时')),
                    onabort: () => finish(null, new Error('脚本猫请求被中止'))
                });
            } catch (_) { finish(null, new Error(`脚本猫请求未能发出，请检查当前域名 ${url.hostname} 的站点授权`)); }
        });
    }
    // RFC 1321 MD5：按参考脚本已有公式在本地计算视频协议所需的摘要。
    function md5(value) {
        const bytes = [];
        for (const ch of String(value)) {
            let cp = ch.codePointAt(0);
            if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
            if (cp < 0x80) bytes.push(cp);
            else if (cp < 0x800) bytes.push(0xc0 | cp >>> 6, 0x80 | cp & 63);
            else if (cp < 0x10000) bytes.push(0xe0 | cp >>> 12, 0x80 | cp >>> 6 & 63, 0x80 | cp & 63);
            else bytes.push(0xf0 | cp >>> 18, 0x80 | cp >>> 12 & 63, 0x80 | cp >>> 6 & 63, 0x80 | cp & 63);
        }
        const length = bytes.length, data = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
        data.set(bytes); data[length] = 0x80;
        const view = new DataView(data.buffer);
        view.setUint32(data.length - 8, length * 8 >>> 0, true);
        view.setUint32(data.length - 4, Math.floor(length / 0x20000000), true);
        const hash = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
        const shifts = [[7,12,17,22],[5,9,14,20],[4,11,16,23],[6,10,15,21]];
        for (let offset = 0; offset < data.length; offset += 64) {
            let [a,b,c,d] = hash;
            for (let i = 0; i < 64; i++) {
                let f, g;
                if (i < 16) { f = b & c | ~b & d; g = i; }
                else if (i < 32) { f = d & b | ~d & c; g = (5 * i + 1) % 16; }
                else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
                else { f = c ^ (b | ~d); g = 7 * i % 16; }
                const sum = a + f + (Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0) + view.getInt32(offset + 4 * g, true) | 0;
                const s = shifts[Math.floor(i / 16)][i % 4];
                const nextB = b + (sum << s | sum >>> (32 - s)) | 0;
                a = d; d = c; c = b; b = nextB;
            }
            hash[0] = hash[0] + a | 0; hash[1] = hash[1] + b | 0;
            hash[2] = hash[2] + c | 0; hash[3] = hash[3] + d | 0;
        }
        return hash.map(n => [0,8,16,24].map(s => (n >>> s & 255).toString(16).padStart(2, '0')).join('')).join('');
    }
    // 读取页面已有对象，或从 mArg 的 JSON 赋值提取数据；不执行页面脚本文本。
    function readPageData(sourceDoc = doc, allowWindow = true) {
        try {
            if (!allowWindow) throw new Error('仅解析传入页面');
            const value = typeof win.mArg === 'string' ? JSON.parse(win.mArg) : win.mArg;
            if (valid(value)) return value;
        } catch (_) { /* 尝试解析 script 中的赋值 */ }
        for (const script of sourceDoc.querySelectorAll('script:not([src])')) {
            const text = script.textContent;
            if (text.includes('==UserScript==')) continue;
            const re = /\bmArg\s*=\s*(?=\{)/g;
            let match;
            while ((match = re.exec(text))) {
                const start = re.lastIndex;
                let depth = 0, quoted = false, escaped = false;
                for (let i = start; i < text.length; i++) {
                    const c = text[i];
                    if (quoted) {
                        if (escaped) escaped = false;
                        else if (c === '\\') escaped = true;
                        else if (c === '"') quoted = false;
                    } else if (c === '"') quoted = true;
                    else if (c === '{') depth++;
                    else if (c === '}' && --depth === 0) {
                        try { const data = JSON.parse(text.slice(start, i + 1)); if (valid(data)) return data; } catch (_) { /* 非 JSON 不执行 */ }
                        break;
                    }
                }
            }
        }
        return null;
    }
    function render() {
        if (!root) return;
        root.querySelector('#status').textContent = lastStatus;
        root.querySelector('#state').textContent = isPaused() ? '已暂停' : '自动运行';
        for (const name of ['video', 'document', 'jump']) root.querySelector('#' + name).checked = enabled(name);
        for (const [name, storage] of [['answer','unrivaldowork'],['submit','unrivalautosubmit'],['save','unrivalautosave']]) {
            root.querySelector('#' + name).checked = getValue(storage, name === 'answer' ? '1' : '0') === '1';
        }
        const rate = root.querySelector('#rate');
        if (root.activeElement !== rate) rate.value = getValue('unrivalrate', '1');
        const tasks = env.tasks?.();
        const items = tasks ? Object.values(tasks) : [];
        const names = { video: '视频/音频', document: '文档', work: '章节测试' };
        root.querySelector('#tasks').textContent = items.length ? items.map(x => `${names[x.type] || x.type}：${x.name || ''} — ${x.failed ? '失败，待重试' : x.done ? '已完成' : x.running ? '处理中' : '等待'}`).join('\n') : '请进入课程章节内容页；章节测试页内仅显示 AI 答题面板。';
    }
    function mount() {
        if (host?.isConnected) { root.querySelector('section').hidden = false; render(); return; }
        host = doc.createElement('div'); host.id = 'personal-course-control';
        host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483646';
        root = host.attachShadow({ mode: 'closed' });
        root.innerHTML = `<style>
          :host{all:initial}*{box-sizing:border-box}section{width:320px;max-width:calc(100vw - 24px);max-height:80vh;overflow:auto;background:#fff;color:#19324d;border:1px solid #a5c2d9;border-radius:12px;padding:14px;box-shadow:0 8px 28px #0003;font:13px/1.65 'Microsoft YaHei',sans-serif}h3{margin:0;font-size:16px}.row{display:flex;gap:10px;flex-wrap:wrap}label{display:block}button{border:0;border-radius:5px;background:#236a9d;color:white;cursor:pointer;padding:7px 9px;margin:6px 4px 4px 0}input[type=number]{width:65px}#status,#tasks{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f6fa;padding:8px;margin:8px 0;font-size:12px}.hint{font-size:12px;color:#526778}
          </style><section><h3>自动刷课 + AI 答题 · 完整版</h3><div>状态：<b id="state"></b></div>
          <div class="row"><label><input id="video" type="checkbox">自动视频/音频</label><label><input id="document" type="checkbox">自动文档</label><label><input id="jump" type="checkbox">自动切章</label></div>
          <div class="row"><label><input id="answer" type="checkbox">AI 自动答题</label><label><input id="submit" type="checkbox">自动提交</label><label><input id="save" type="checkbox">自动保存</label></div>
          <div>视频倍速 <input id="rate" type="number" min="0.1" max="16" step="0.1"><button id="saveRate">保存倍速</button></div>
          <button id="resume">开始 / 继续</button><button id="pause">暂停学习</button><button id="api">配置模型 API</button><button id="refresh">刷新并重新识别</button><button id="collapse">收起</button>
          <div id="status"></div><div id="tasks"></div><div class="hint">视频、文档默认自动运行，不依赖 AI Key。视频/文档开关改变后刷新当前章节生效。自动提交默认关闭；遇到测试会等待处理，需连续执行时请自行开启自动提交或保存。倍速和提交结果以平台支持为准。</div></section>`;
        doc.documentElement.append(host);
        for (const name of ['video', 'document', 'jump']) root.querySelector('#' + name).onchange = e => {
            setValue(key(name), e.target.checked);
            note(name === 'jump' ? '自动切章设置已更新' : '任务开关已保存，刷新当前章节后生效');
        };
        for (const [name, storage] of [['answer','unrivaldowork'],['submit','unrivalautosubmit'],['save','unrivalautosave']]) root.querySelector('#' + name).onchange = e => {
            setValue(storage, e.target.checked ? '1' : '0');
            const topName = { answer: 'unrivalDoWork', submit: 'unrivalAutoSubmit', save: 'unrivalAutoSave' }[name];
            try { win.top[topName] = e.target.checked ? '1' : '0'; } catch (_) {}
            note(name === 'answer' ? '答题设置已保存；关闭后可只运行视频和文档任务，刷新当前章节生效' : '保存/提交设置已更新');
        };
        root.querySelector('#saveRate').onclick = () => {
            const rate = Number(root.querySelector('#rate').value);
            if (!Number.isFinite(rate) || rate < 0.1 || rate > 16) return note('倍速须在 0.1～16 之间');
            setValue('unrivalrate', String(rate)); env.rateChanged?.(rate); note('倍速已保存；页面不允许倍速时按平台规则处理');
        };
        root.querySelector('#resume').onclick = () => { setPaused(false); env.resume?.(); };
        root.querySelector('#pause').onclick = () => setPaused(true);
        root.querySelector('#api').onclick = env.openAI;
        root.querySelector('#refresh').onclick = () => win.location.reload();
        root.querySelector('#collapse').onclick = () => { root.querySelector('section').hidden = true; };
        render();
    }
    function install() {
        env.registerMenu?.('课程：打开自动学习控制面板', mount);
        env.registerMenu?.('课程：开始 / 继续自动学习', () => { mount(); setPaused(false); env.resume?.(); });
        env.registerMenu?.('课程：暂停学习', () => setPaused(true));
        if (/mycourse\/studentstudy|knowledge\/cards/.test(win.location.href)) mount();
        if (env.listenValue) {
            for (const name of ['video','document','jump','paused']) env.listenValue(key(name), render);
        }
        const timer = setInterval(render, 1000);
        win.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }
    return { enabled, isPaused, setPaused, note, mount, install, readPageData, render, md5, parseVideoInfo, requestVideoInfo };
}
