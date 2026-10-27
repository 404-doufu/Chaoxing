/* 主课程页的停滞恢复。只保存章节标识和次数，不保存 URL、凭据或题目。 */
function createChapterRecovery({ now = Date.now, storage }) {
    const prefix = 'personalCourse.recovery.v1:';
    let scope = '', record = {}, since = now(), signature = null;
    function load() {
        try {
            const value = JSON.parse(storage?.getItem(prefix+scope) || 'null');
            if (value?.version === 1 && Number.isInteger(value.refreshes) && value.refreshes >= 0 && value.refreshes <= 2) return {
                version:1,refreshes:value.refreshes,lastActionAt:Math.min(now(),Math.max(0,Number(value.lastActionAt)||0)),
                skipped:value.skipped === true,...(value.skipped === true ? {reason:'stalled-after-two-reloads'} : {})
            };
        } catch (_) { /* 存储不可用时，刷新章节 iframe 仍由本主页面保留内存次数。 */ }
        return {version:1,refreshes:0,lastActionAt:0,skipped:false};
    }
    function save() { try { storage?.setItem(prefix+scope,JSON.stringify(record)); } catch (_) {} }
    function enter(value) {
        if (scope !== value) { scope = value; record = scope ? load() : {}; }
        since = now(); signature = null;
    }
    function observe(value) { if (signature !== value) { signature = value; since = now(); } }
    function hold() { since = now(); }
    function decide({ allowed = true, busy = false, ready = false, complete = false } = {}) {
        if (!scope) return null;
        if (!allowed || busy) { hold(); return null; }
        if (complete) return {type:'complete'};
        if ((!ready && !record.refreshes) || now()-Math.max(since,Number(record.lastActionAt)||0) < 10000) return null;
        if (record.refreshes < 2) {
            record = {...record,refreshes:record.refreshes+1,lastActionAt:now()}; since = now(); save();
            return {type:'reload',attempt:record.refreshes};
        }
        record = {...record,skipped:true,lastActionAt:now(),reason:'stalled-after-two-reloads'}; since = now(); save();
        return {type:'skip',attempt:record.refreshes};
    }
    return { enter, observe, hold, decide };
}
