// ==UserScript==
// @name         学习通 Edge 后台监督（配套）
// @namespace    personal-chaoxing-ai-supervisor
// @version      1.0.0
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
/* Edge 稳定运行公共模块。GPL-3.0-or-later。只保存状态，不保存凭据或接口响应。 */
function createStudyCore(env) {
    'use strict';
    const PREFIX = 'edgeStudy.v1.';
    const now = env.now || Date.now;
    const timers = env.timers || { setTimeout, clearTimeout };
    const inflight = new Map();
    const id = env.id || `${now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const phases = new Set(['waiting', 'playing', 'buffering', 'paused', 'offline', 'confirming', 'complete', 'needs_user', 'closed', 'frozen', 'duplicate']);
    function cancellation() { return Object.assign(new Error('任务已取消'), { name: 'AbortError' }); }
    function check(signal) { if (signal?.aborted) throw cancellation(); }
    function delay(ms, signal) {
        check(signal);
        return new Promise((resolve, reject) => {
            const abort = () => { timers.clearTimeout(timer); reject(cancellation()); };
            const timer = timers.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
            signal?.addEventListener('abort', abort, { once: true });
        });
    }
    async function online(signal) {
        while ((env.online && !env.online()) || env.paused?.()) {
            check(signal); env.status?.(env.paused?.() ? '任务已暂停，等待继续' : '网络已断开，等待恢复后继续');
            await delay(2000, signal);
        }
    }
    function retryable(error) {
        if (error?.name === 'AbortError' || error?.fatal) return false;
        if (error?.retry === true) return true;
        return error?.status === 429 || error?.status >= 500 || error instanceof TypeError || error?.name === 'TypeError';
    }
    function run(key, operation, options = {}) {
        // 同一页面同一资源仅允许一个在途操作。暂停/页面退出的信号由调用方统一取消。
        if (inflight.has(key)) return inflight.get(key);
        const promise = (async () => {
            const delays = options.delays || [2000, 5000, 15000];
            for (let attempt = 0; ; attempt++) {
                check(options.signal); await online(options.signal); check(options.signal);
                try { return await operation(attempt); }
                catch (error) {
                    check(options.signal);
                    if (!retryable(error) || attempt >= delays.length) throw error;
                    options.onRetry?.(attempt + 1, delays[attempt], error);
                    env.status?.(`临时请求失败，第 ${attempt + 1}/${delays.length} 次重试等待中`);
                    await delay(delays[attempt], options.signal);
                }
            }
        })();
        inflight.set(key, promise);
        promise.then(() => inflight.delete(key), () => inflight.delete(key));
        return promise;
    }
    function taskKey(context) {
        return PREFIX + 'task.' + encodeURIComponent([
            context.account, context.course, context.clazz, context.chapter, context.job, context.object || ''
        ].map(x => String(x ?? '')).join('|'));
    }
    function checkpoint(key, patch) {
        if (!key.startsWith(PREFIX + 'task.')) throw new Error('无效断点键');
        const previous = env.getValue(key, {});
        const record = { version: 1, updatedAt: now(), phase: phases.has(patch.phase) ? patch.phase : previous.phase || 'waiting' };
        for (const field of ['observedPosition', 'duration']) {
            const value = patch[field] ?? previous[field];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) record[field] = value;
        }
        // observedPosition 仅用于显示；不据此恢复 seek，也不充当平台确认值。
        record.platformComplete = patch.platformComplete === true || (patch.platformComplete === undefined && previous.platformComplete === true);
        if (patch.platformComplete === false) record.platformComplete = false;
        env.setValue(key, record); return record;
    }
    function heartbeat(patch) {
        const record = { version: 1, session: id, updatedAt: now(), role: ['main', 'chapter', 'media', 'document', 'quiz'].includes(patch.role) ? patch.role : 'main', phase: phases.has(patch.phase) ? patch.phase : 'waiting' };
        if (typeof patch.scope === 'string' && patch.scope.startsWith(PREFIX + 'task.')) record.scope = patch.scope;
        for (const field of ['lastProgressAt', 'observedPosition']) if (Number.isFinite(patch[field]) && patch[field] >= 0) record[field] = patch[field];
        env.setValue(PREFIX + 'heart.' + id, record); return record;
    }
    async function claim(resource, signal) {
        check(signal);
        const key = PREFIX + 'lease.' + encodeURIComponent(resource);
        const existing = env.getValue(key, null);
        if (existing && existing.owner !== id && existing.until > now()) return false;
        env.setValue(key, { owner: id, until: now() + 120000 });
        // GM 存储不是 CAS；写入后重新检查，执行动作前仍须核对 owner。
        try { await delay(150, signal); }
        catch (error) { release(resource); throw error; }
        return env.getValue(key, null)?.owner === id;
    }
    function owns(resource) {
        const lease = env.getValue(PREFIX + 'lease.' + encodeURIComponent(resource), null);
        return lease?.owner === id && lease.until > now();
    }
    function renew(resource) {
        if (!owns(resource)) return false;
        env.setValue(PREFIX + 'lease.' + encodeURIComponent(resource), { owner: id, until: now() + 120000 }); return true;
    }
    function release(resource) {
        const key = PREFIX + 'lease.' + encodeURIComponent(resource);
        if (env.getValue(key, null)?.owner === id) env.setValue(key, { owner: id, until: 0 });
    }
    function supervise() {
        const rows = [];
        for (const key of env.listValues?.() || []) {
            if (!key.startsWith(PREFIX + 'heart.')) continue;
            const heart = env.getValue(key, null);
            if (heart?.version !== 1 || typeof heart.session !== 'string' || !Number.isFinite(heart.updatedAt) || !phases.has(heart.phase)) continue;
            if (heart.phase === 'closed' || now() - heart.updatedAt > 86400000) continue;
            const age = now() - heart.updatedAt;
            let state = heart.phase;
            if (!['paused', 'complete', 'needs_user'].includes(heart.phase) && age > 180000) state = 'stale';
            if (state === 'playing' && Number.isFinite(heart.lastProgressAt) && now() - heart.lastProgressAt > 180000) state = 'stalled';
            rows.push({ session: heart.session, role: heart.role, state, ageMs: Math.max(0, age) });
            const commandKey = PREFIX + 'command.' + heart.session;
            const command = env.getValue(commandKey, null);
            if (['stale', 'stalled', 'offline'].includes(state) && (!command || command.expiresAt < now())) {
                // 只请求页面醒来后自检；不强制刷新、不访问 DOM、不操作作业。
                env.setValue(commandKey, { version: 1, action: 'probe', nonce: `${id}-${now()}`, expiresAt: now() + 600000 });
            }
            const healthKey = PREFIX + 'health.' + heart.session;
            const old = env.getValue(healthKey, {});
            env.setValue(healthKey, { state, checkedAt: now() });
            if (['stale', 'stalled', 'needs_user'].includes(state) && (old.state !== state || now() - (old.notifiedAt || 0) > 1800000)) {
                env.notify?.(state === 'needs_user' ? '课程需要人工处理，请查看页面提示' : '课程页面长时间未响应，请打开 Edge 课程标签页检查');
                env.setValue(healthKey, { state, checkedAt: now(), notifiedAt: now() });
            } else if (old.notifiedAt) env.setValue(healthKey, { state, checkedAt: now(), notifiedAt: old.notifiedAt });
        }
        env.setValue(PREFIX + 'supervisor', { version: 1, checkedAt: now(), pages: rows });
        return rows;
    }
    return { PREFIX, id, now, delay, check, run, retryable, taskKey, checkpoint, heartbeat, claim, owns, renew, release, supervise };
}

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
