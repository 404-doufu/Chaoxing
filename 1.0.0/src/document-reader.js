/* 只在已绑定的课件阅读器内翻阅；不调用完成接口，不修改平台进度。 */
function createDocumentReader(env) {
    'use strict';
    const { doc, now = () => Date.now() } = env;
    const dwell = 500, settle = 1500;
    let nextAt = now(), target = null, position = 0, pending = null, bottom = '', bottomSince = 0, jumpTried = false;
    let missingSince = now(), lastMetric = '', stagnantSince = now();
    const visible = element => {
        if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
        const style = element.ownerDocument.defaultView.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    };
    function documents() {
        const result = [], seen = new Set();
        function visit(current, depth) {
            if (!current || seen.has(current) || depth > 4) return;
            seen.add(current); result.push(current);
            for (const frame of current.querySelectorAll('iframe')) {
                try { visit(frame.contentDocument, depth + 1); } catch (_) { /* 跨域阅读器不能绕过浏览器隔离 */ }
            }
        }
        visit(doc, 0); return result.reverse();
    }
    function pageControl(current) {
        const field = current.querySelector('#pageNumber, #pageNum, input[name="pageNumber"], [aria-label="页码"]');
        const totalElement = current.querySelector('#numPages, #pageCount, .total-page, [data-total-pages]');
        const page = Number(field?.value || field?.textContent);
        const total = Number((totalElement?.getAttribute('data-total-pages') || totalElement?.textContent || '').replace(/[^0-9]/g, ''));
        const button = current.querySelector('#nextPage, #next-page, .next-page, [data-action="next-page"], [aria-label="下一页"], [title="下一页"], #next');
        const last = current.querySelector('#lastPage, #last-page, .last-page, [data-action="last-page"], [aria-label="最后一页"], [title="最后一页"], [aria-label="末页"], [title="末页"]');
        const usable = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && !node.classList.contains('disabled');
        if (!Number.isSafeInteger(page) || !Number.isSafeInteger(total) || page < 1 || page > total || (!visible(button) && !visible(last))) return null;
        return { kind: 'pages', element: button || last, page, total, last: usable(last) ? last : null, next: usable(button) ? button : null };
    }
    function detect() {
        for (const current of documents()) {
            if (current.querySelector('[aria-busy="true"]') || /^(?:\s*(?:正在加载|加载中|loading)[.…\s]*)$/i.test(current.body?.textContent || '')) continue;
            // 内置 PDF / 跨域子阅读器只有外壳可读时，不能拿外壳的滚动冒充翻阅。
            if (current.querySelector('iframe, embed[type="application/pdf"], object[type="application/pdf"]') && !current.querySelector('canvas, .page[data-page-number], .pdfViewer')) continue;
            // 连续阅读器优先滚动内部容器，不能只翻外层课程网页。
            const root = current.scrollingElement || current.documentElement;
            const candidates = [root, ...Array.from(current.querySelectorAll('div,main,section')).slice(0, 2500)];
            const scroll = candidates.filter(element => {
                if (!visible(element) || element.closest('#personal-course-control, #personal-ai-control')) return false;
                const style = current.defaultView.getComputedStyle(element);
                return element.clientHeight >= 100 && element.clientWidth >= 100 && element.scrollHeight > element.clientHeight + 20 &&
                    (element === root || /auto|scroll/.test(style.overflowY));
            }).sort((a, b) => {
                const score = e => (/viewer|reader|pdf|document/i.test(e.id + ' ' + e.className) ? 1e8 : 0) + e.clientHeight * e.clientWidth;
                return score(b) - score(a);
            })[0];
            if (scroll) return { kind: 'scroll', element: scroll };
            const pages = pageControl(current);
            if (pages) return pages;
            // 仅单页或内容尚未撑开时，等待平台确认；不将空白 iframe 当作已阅读。
            if (current.querySelector('canvas, img[src], .page[data-page-number]') && root?.clientHeight >= 100) return { kind: 'scroll', element: root };
        }
        return null;
    }
    function step() {
        const time = now(), view = detect();
        if (!view) return { phase: time - missingSince > 45000 ? 'needs_user' : 'buffering', reason: 'reader-unavailable', position };
        missingSince = time;
        if (target !== view.element) { target = view.element; pending = null; bottom = ''; nextAt = time; stagnantSince = time; jumpTried = false; }
        const metric = view.kind === 'pages' ? String(view.page) : String(Math.round(view.element.scrollTop));
        if (metric !== lastMetric) { lastMetric = metric; stagnantSince = time; }
        position = view.kind === 'pages' ? view.page : Math.max(0, Number(view.element.scrollTop) || 0);
        if (pending) {
            if (metric !== pending.metric) { pending = null; if (view.kind === 'pages') nextAt = time + dwell; }
            else if (pending.jump && time - pending.at >= settle) { pending = null; nextAt = time; }
            else if (time - pending.at >= 30000) return { phase: 'needs_user', reason: 'reader-stalled', position };
            else return { phase: 'buffering', reason: 'reader-turning', position };
        }
        const atEnd = view.kind === 'pages' ? view.page === view.total : view.element.scrollTop + view.element.clientHeight >= view.element.scrollHeight - 3;
        if (atEnd) {
            const geometry = view.kind === 'pages' ? `page:${view.total}` : `${view.element.scrollHeight}:${view.element.clientHeight}`;
            if (bottom !== geometry) { bottom = geometry; bottomSince = time; }
            return { phase: time - bottomSince >= settle ? 'confirming' : 'waiting', reason: 'reader-end', position };
        }
        bottom = '';
        if (time < nextAt) return { phase: 'playing', reason: 'reader-dwell', position };
        if (view.kind === 'pages' && !view.next && !(view.last && !jumpTried)) return { phase: time - stagnantSince > 45000 ? 'needs_user' : 'buffering', reason: 'reader-stalled', position };
        pending = { metric, at: time }; nextAt = time + dwell;
        if (view.kind === 'pages') {
            if (view.last && !jumpTried) { jumpTried = true; pending.jump = true; view.last.click(); }
            else view.next.click();
        }
        else {
            const top = Math.max(0, view.element.scrollHeight - view.element.clientHeight);
            // 即时定位可避免后台 smooth 动画被节流后持续堆积；浏览器仍触发原生 scroll。
            if (typeof view.element.scrollTo === 'function') view.element.scrollTo({ top, behavior: 'instant' });
            else view.element.scrollTop = top;
        }
        return { phase: 'playing', reason: 'reader-turning', position };
    }
    function resume() { nextAt = now() + dwell; pending = null; bottom = ''; }
    return { step, resume };
}
