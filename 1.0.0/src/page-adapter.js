/* 页面版本适配集中在此处；只根据路径及 DOM 能力识别，不读取认证参数。 */
function createPageAdapter(win, doc) {
    const questionSelector = '.Py-mian1, .questionLi, .TiMu';
    const blankGroupSelector = '.blankItemDiv,.blankItemInp';
    const blankInputSelector = 'textarea,input[type="text"],input:not([type]),[contenteditable="true"]';
    const dialogSelector = '#workpop,#confirmSubWin,[role="dialog"],[role="alertdialog"],.layui-layer-dialog,.el-message-box,.ant-modal-content,.van-dialog';
    function pathRole(path) {
        if (/\/knowledge\/cards\/?$/.test(path)) return 'chapter';
        if (/\/ananas\/modules\/(video|audio)\//.test(path)) return 'media';
        if (/\/ananas\/modules\/(pdf|ppt|document|office)\//.test(path)) return 'document';
        if (/\/mycourse\/studentstudy\/?$/.test(path)) return 'main';
        if (/\/work\/(?:phone\/)?(?:selectWorkQuestionYiPiYue\w*|viewWork)\/?$/i.test(path)) return 'review';
        if (/\/work\/(?:phone\/)?doHomeWork(?:New)?\/?$/i.test(path)) return 'quiz';
        if (/\/ananas\/modules\/work\/|\/api\/work\/?$/.test(path)) return 'quizHost';
        return '';
    }
    function role() {
        const known = pathRole(win.location.pathname);
        if (known) return known;
        if (/\/work\//.test(win.location.pathname) && doc.querySelector(questionSelector) &&
            doc.querySelector('.answerList li,.Zy_ulTop li,.Zy_ulTk,.blankItemDiv,input[type="radio"],input[type="checkbox"]') &&
            doc.querySelector('.btnSubmit,[data-action="submit-work"]')) return 'quiz';
        return '';
    }
    function isQuizFrame(frame) {
        try {
            const path = new URL(frame.src,win.location.href).pathname;
            if (['quiz','quizHost','review'].includes(pathRole(path))) return true;
            return /\/work\//.test(path) && !!frame.contentDocument && ['quiz','review'].includes(createPageAdapter(frame.contentWindow,frame.contentDocument).role());
        }
        catch (_) { return false; }
    }
    function visible(el) {
        if (!el?.isConnected) return false;
        const view = el.ownerDocument.defaultView || win;
        for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
            const css = view.getComputedStyle(node);
            if (node.hidden || node.getAttribute('aria-hidden') === 'true' || css.display === 'none' || css.visibility === 'hidden') return false;
        }
        return true;
    }
    const editable = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('disabled');
    function ancestors() {
        const result = [doc]; let current = win, blocked = false;
        for (let i = 0; i < 8 && current.parent && current.parent !== current; i++) {
            try {
                const parent = current.parent, parentDoc = parent.document;
                if (!parentDoc?.documentElement) break;
                const origin = new URL(parentDoc.URL).origin;
                if (origin !== win.location.origin && !/(^|\.)chaoxing\.com$/.test(new URL(origin).hostname)) break;
                if (!result.includes(parentDoc)) result.push(parentDoc);
                current = parent;
            } catch (_) { blocked = true; break; }
        }
        return { documents:result, blocked };
    }
    function confirmation(targetDoc) {
        const roots = [...new Set(Array.from(targetDoc.querySelectorAll(dialogSelector)).map(el => el.closest('#workpop,#confirmSubWin') || el))];
        const matches = [];
        for (const root of roots) {
            if (!visible(root)) continue;
            const text = root.textContent.replace(/\s/g,'');
            if (!/(?:确认|确定|是否).{0,6}提交|提交.{0,6}(?:确认|确定)/.test(text)) continue;
            if (/未答|未完成|验证码|重新登录|异常|失败|强制|删除/.test(text)) return { blocked:true, reason:'平台提示未答题、验证或异常，请人工处理' };
            const buttons = Array.from(root.querySelectorAll('a,button,[role="button"],input[type="button"],input[type="submit"]')).filter(el =>
                /^(?:提交|确定|确认|确认提交|确定提交)$/.test((el.textContent || el.value || el.getAttribute('aria-label') || '').trim()) && editable(el));
            if (buttons.length !== 1) return { blocked:true, reason:'确认窗口按钮有歧义，请人工处理' };
            matches.push({root,button:buttons[0]});
        }
        const unique = matches.filter((item,index) => !matches.some((other,i) => i < index && other.button === item.button));
        return unique.length > 1 ? {blocked:true,reason:'同时存在多个提交确认窗口，请人工处理'} : unique[0] || null;
    }
    function chapterStatus(id) {
        const row = doc.getElementById('cur'+id);
        if (!id || !row) return null;
        // 只认当前章节自身的完成图标；子章节对钩及黄色数字 0 均不作为完成。
        const icons = Array.from(row.querySelectorAll('.icon_Completed,[aria-label="已完成"]'));
        return { id, completed:icons.some(icon => icon.closest('[id^="cur"]') === row), title:row.querySelector('.posCatalog_name')?.getAttribute('title') || '' };
    }
    return { questionSelector, blankGroupSelector, blankInputSelector, dialogSelector, role, pathRole, isQuizFrame, visible, editable, ancestors, confirmation, chapterStatus };
}
