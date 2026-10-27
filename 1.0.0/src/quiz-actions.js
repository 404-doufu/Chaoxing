/* 平台原生保存/提交；查找本页及可访问父页的新旧确认窗，不构造提交请求。 */
function createQuizActions({ win, doc, getValue, paused = () => false, onDispatch = () => {} }) {
    const page = createPageAdapter(win,doc), { visible, editable } = page;
    const ownerKey = 'data-personal-quiz-submit-owner';
    let pending = false, attempted = false, confirmations = 0;
    const enabled = key => getValue(key,key === 'unrivalautosubmit' ? '1' : '0') === '1';
    const cancelled = () => Object.assign(new Error('已停止保存/提交'),{name:'AbortError'});
    function check(signal) { if (signal.aborted || paused()) throw cancelled(); }
    function wait(ms,signal) {
        check(signal);
        return new Promise((resolve,reject) => {
            const stop = () => { win.clearTimeout(timer); reject(cancelled()); };
            const timer = win.setTimeout(() => { signal.removeEventListener('abort',stop); resolve(); },ms);
            signal.addEventListener('abort',stop,{once:true});
        });
    }
    function button(kind) {
        const text = kind === 'submit' ? /^(提交|提交作业)$/ : /^(暂时保存|保存草稿|保存)$/;
        const nodes = Array.from(doc.querySelectorAll('a,button,[role="button"],input[type="button"],input[type="submit"]')).filter(el =>
            text.test((el.textContent || el.value || '').trim()) && editable(el) && !el.closest(page.dialogSelector));
        if (nodes.length > 1) throw new Error('存在多个保存/提交入口，请手动处理');
        return nodes[0];
    }
    function result() {
        if (page.role() === 'review') return true;
        return Array.from(doc.querySelectorAll('#RightCon .status,#RightCon .workStatus,[data-work-status]')).some(el => visible(el) && /^(已提交|提交成功|已完成|待批阅)$/.test(el.textContent.trim()));
    }
    async function complete(summary,signal,{report = () => {},canSubmit = () => false} = {}) {
        check(signal);
        if (!summary.total || summary.cancelled) return;
        let submit = enabled('unrivalautosubmit');
        const save = enabled('unrivalautosave');
        if (!submit && !save) { report('选项已填好；自动提交已关闭，可勾选后点击“开始/重试答题”提交，无需重复调用模型'); return; }
        if (result()) { report('平台页面显示测验已提交，无需再次提交'); return; }
        if (pending || attempted) { report('本页已有保存/提交操作；为避免重复不会再次发送，请查看页面结果'); return; }
        if (submit) {
            const threshold = Number(getValue('accuracy',100));
            if (summary.failed || summary.skipped || !Number.isFinite(threshold) || threshold < 0 || threshold > 100 || summary.ratio < threshold || !canSubmit()) {
                report('答案尚未全部确认或存在跳过/失败题目，未自动提交；请检查题目');
                if (!save) return;
                submit = false;
            }
        }
        pending = true;
        const chain = page.ancestors(), lockRoot = chain.documents.at(-1).documentElement;
        const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        let owns = false;
        const readOwner = () => { try { return JSON.parse(lockRoot.getAttribute(ownerKey) || 'null'); } catch (_) { return null; } };
        const renew = () => lockRoot.setAttribute(ownerKey,JSON.stringify({token,expires:Date.now()+30000}));
        const clicked = new WeakSet(), clickedRoots = new WeakSet();
        try {
            // 同一课程页的不同测验串行使用共享顶层弹窗，避免确认到另一份作业。
            for (let elapsed = 0; elapsed < 60000; elapsed += 250) {
                check(signal);
                if (submit && (!enabled('unrivalautosubmit') || !canSubmit())) { report('等待期间答案或提交设置已变化，已停止提交'); return; }
                const owner = readOwner();
                if (!owner || owner.expires <= Date.now()) { renew(); owns = true; break; }
                if (!elapsed) report('另一份测验正在保存/提交，当前测验排队等待');
                await wait(250,signal);
            }
            if (!owns) { report('等待其他测验提交超时，请检查课程页弹窗；未重复点击'); return; }
            for (const target of chain.documents) {
                if (page.confirmation(target)) { report('页面已有提交确认窗口，请先处理原窗口后重试；未点击新的提交'); return; }
            }
            const entry = button(submit ? 'submit' : 'save');
            if (!entry) {
                const legacy = /\/work\/phone\/doHomeWork\/?$/i.test(win.location.pathname);
                const fn = submit ? win.submitCheckTimes : win.noSubmit;
                if (!legacy || typeof fn !== 'function') throw new Error('未找到可用的原生提交/保存按钮，请检查页面提示后手动处理');
                attempted = true; fn.call(win);
                if (submit) onDispatch();
                report(submit ? '已调用原生提交校验，等待平台确认；不会重复发送' : '已调用原生保存入口，请查看平台保存结果');
                return;
            }
            attempted = true; entry.click();
            if (!submit) { report('已触发原生保存，请查看平台保存结果；保存不等于提交'); return; }
            report('正在等待平台提交校验及本页/课程顶层确认窗口');
            for (let elapsed = 0; elapsed < 15000; elapsed += 250) {
                check(signal);
                if (readOwner()?.token !== token) { report('提交窗口控制权已变化，已停止确认'); return; }
                renew();
                if (!enabled('unrivalautosubmit')) { report('自动提交已关闭，已停止确认操作'); return; }
                if (chain.documents.some(target => visible(target.querySelector('#verifyCodeWin')))) { report('平台要求验证码，请人工完成；未绕过验证或重复提交'); return; }
                if (result()) { report('平台页面已确认提交'); return; }
                for (const target of [...chain.documents].reverse()) {
                    const match = page.confirmation(target);
                    if (!match) continue;
                    if (match.blocked) { report(match.reason); return; }
                    if (clicked.has(match.button) || clickedRoots.has(match.root)) break;
                    if (!canSubmit()) { report('等待期间答案已变化或不完整，未确认提交'); return; }
                    if (confirmations >= 3) { report('提交确认步骤超出已支持范围，请人工检查'); return; }
                    clicked.add(match.button); clickedRoots.add(match.root); confirmations++;
                    match.button.click(); onDispatch();
                    report('已确认提交（第 ' + confirmations + ' 步），等待平台回报；任务点仍以平台复核为准');
                    break;
                }
                await wait(250,signal);
            }
            report(confirmations ? '提交已发出，平台结果尚未确认；请检查页面，脚本不会重复提交' : '原生提交校验未返回可识别确认窗，请检查网络或页面提示后手动处理；未绕过校验' + (chain.blocked ? '（部分父页面跨域不可访问）' : ''));
        } finally {
            pending = false;
            if (owns && readOwner()?.token === token) lockRoot.removeAttribute(ownerKey);
        }
    }
    return { complete };
}
