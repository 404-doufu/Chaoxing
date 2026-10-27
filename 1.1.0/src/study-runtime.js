/* 页面执行层：保留原生播放器/平台进度上报；不伪造观看时间或完成状态。 */
function createStudyRuntime(env) {
    'use strict';
    const { win, doc, course, getValue, setValue } = env;
    const page = createPageAdapter(win,doc);
    const core = createStudyCore({ ...env, online: () => win.navigator.onLine !== false, paused: () => course.isPaused(), status: message => course.note(message) });
    let recoveryStorage;
    try { recoveryStorage = env.recoveryStorage || win.sessionStorage; } catch (_) {}
    const recovery = createChapterRecovery({now:core.now,storage:recoveryStorage});
    const quizActivities = new Map();
    let aiWorking = false, quizRevision = 0, mainState = {received:false,aiBusy:false,mediaPending:false,blocked:false};
    const aborter = new win.AbortController();
    const minimumTaskAge = 10000, taskStartedAt = core.now();
    let role = '', phase = 'waiting', data = null, context = null, jobs = [], disposed = false, lastMessage = '', playbackReason = '';
    let lastVerify = 0, verificationPending = false, verificationFatal = false, platformConfirmed = false, media = null, bound = null, claiming = false;
    let reader = null, pendingBinding = null, quizVerifyTimer;
    let activeMedia = null, mediaCursor = -1, mediaQueue = null, queueBlocked = '', queueTimer;
    let observed = 0, lastProgressAt = core.now(), lastPublish = 0, playAttempts = 0, mediaBusy = false;
    let needsGesture = false, nextAttemptAt = 0, webLockRelease = null, webLockOwned = false, webLockPending = false, webLockScope = '', webLocksBroken = false;
    let parentOrigin = '', lastSettledNotice = 0, lastSettledVerify = 0, lastHandshake = 0, lastCommand = '', timer, observer, completionTimer;
    let navigation = { key: '', confirmed: false, attempts: 0, lastAt: 0, openedAt: core.now() };
    let lastHeartbeatAt = -Infinity, lastHeartbeatState = '';
    const watchedFrames = new WeakSet();
    const frameScopes = new WeakMap();
    const on = (name, handler, target = win) => target.addEventListener(name, handler, { signal: aborter.signal });
    const stopped = () => disposed || course.isPaused();
    const isTaskJob = value => [true, 1, '1', 'true'].includes(value.job);
    function note(value, nextPhase) { if (nextPhase) phase = nextPhase; lastMessage = value; course.note(value); }
    function identity(defaults, attachment = {}) {
        const property = attachment.property || {};
        return { account: String(defaults.userid || ''), course: String(defaults.courseid || ''), clazz: String(defaults.clazzId || ''), chapter: String(defaults.knowledgeid || ''), job: String(attachment.jobid || property.jobid || ''), object: String(property.objectid || property.objectId || '') };
    }
    function trustedOrigin(origin) {
        try { const url = new URL(origin); return /^https?:$/.test(url.protocol) && (origin === win.location.origin || /(^|\.)chaoxing\.com$/.test(url.hostname)); }
        catch (_) { return false; }
    }
    function safePost(target, payload, origin) { if (trustedOrigin(origin)) target.postMessage(payload, origin); }
    function postParent(payload) {
        if (win.parent === win) return;
        try {
            const origin = parentOrigin || new URL(doc.referrer || win.parent.location.href).origin;
            safePost(win.parent, payload, origin);
        } catch (_) { /* 无法确定父页面 origin 时不使用通配符发送 */ }
    }
    function heartbeat() {
        if (disposed) return;
        if (role === 'quiz' && aiWorking) postParent({type:'edgeStudy.quiz.activity.v1',busy:true,revision:quizRevision});
        const state = { role, phase: course.isPaused() ? 'paused' : phase, scope: bound?.scope, observedPosition: observed, lastProgressAt };
        const signature = JSON.stringify(state);
        if (signature !== lastHeartbeatState || core.now() - lastHeartbeatAt >= 5000) {
            core.heartbeat(state); lastHeartbeatState = signature; lastHeartbeatAt = core.now();
        }
        const command = getValue(core.PREFIX + 'command.' + core.id, null);
        if (command?.version === 1 && command.action === 'probe' && command.expiresAt > core.now() && command.nonce !== lastCommand) {
            lastCommand = command.nonce;
            // 唤醒后走同一检查流程；从不通过监督命令刷新作业或提交答案。
            if (role === 'media') nextAttemptAt = 0;
            if (role === 'chapter') lastVerify = 0;
        }
    }
    function dispose() {
        if (disposed) return;
        if (role === 'quiz') postParent({type:'edgeStudy.quiz.activity.v1',busy:false});
        disposed = true; pendingBinding = null; clearInterval(timer); clearTimeout(completionTimer); clearTimeout(queueTimer); clearTimeout(quizVerifyTimer); observer?.disconnect(); aborter.abort();
        if (role === 'media') pausePlayers();
        if (bound && ownsPlayback()) setValue(core.PREFIX + 'media.' + bound.scope, { version: 1, session: core.id, phase: 'closed', observedPosition: observed, updatedAt: core.now() });
        releasePlayback();
        core.heartbeat({ role, phase: 'closed' });
    }
    function taskView() {
        const ordered = mediaQueue ? [...mediaQueue, ...jobs.filter(j => j.type === 'video' && !mediaQueue.includes(j))] : null;
        let index = 0;
        return jobs.map(j => ordered && j.type === 'video' ? ordered[index++] : j).map(j => ({ type: j.type, name: j.name, running: j.active === true, done: j.done && (j !== activeMedia || j.playbackEnded === true), failed: j.failed }));
    }
    function selectMedia() {
        if (activeMedia) {
            const state = getValue(core.PREFIX + 'media.' + activeMedia.scope, null);
            if (state?.ended === true && state.queueSession === core.id && core.now() - state.updatedAt < 120000) activeMedia.playbackEnded = true;
            if (stopped()) return activeMedia;
            if (activeMedia.done && activeMedia.playbackEnded) {
                const remaining = minimumTaskAge - (core.now() - activeMedia.selectedAt);
                if (remaining > 0) {
                    if (!queueTimer) queueTimer = setTimeout(() => { queueTimer = null; chapterTick(); }, remaining);
                    return activeMedia;
                }
                activeMedia = null;
            } else if (activeMedia.playbackEnded && !verificationFatal && !queueTimer) {
                queueTimer = setTimeout(() => {
                    queueTimer = null;
                    if (!stopped() && !verificationFatal && !verificationPending) void verifyChapter();
                    chapterTick();
                }, minimumTaskAge);
            }
        }
        if (!activeMedia && !stopped() && mediaQueue && !(jobs.some(j => j.type === 'video' && !j.disabled && j.done) && !platformConfirmed)) {
            for (let i = mediaCursor + 1; i < mediaQueue.length; i++) {
                const job = mediaQueue[i];
                mediaCursor = i;
                if (job.done || job.disabled) continue;
                activeMedia = job; job.selectedAt = core.now(); break;
            }
        }
        return activeMedia;
    }
    async function rawText(url) {
        const controller = new win.AbortController();
        const cancel = () => controller.abort();
        aborter.signal.addEventListener('abort', cancel, { once: true });
        const timeout = setTimeout(() => controller.abort(), 30000);
        let response;
        try {
            if (typeof win.fetch === 'function') {
                try {
                    const r = await win.fetch(url, { credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal: controller.signal });
                    response = { status: r.status, text: await r.text(), finalUrl: r.url };
                } catch (error) { if (aborter.signal.aborted) throw error; }
            }
            if (!response) {
                response = await new Promise((resolve, reject) => {
                    let settled = false, handle;
                    const finish = (error, result) => {
                        if (settled) return;
                        settled = true; clearTimeout(watchdog); aborter.signal.removeEventListener('abort', cancelXHR);
                        error ? reject(error) : resolve(result);
                    };
                    const cancelXHR = () => { finish(Object.assign(new Error('任务取消'), { name: 'AbortError' })); handle?.abort?.(); };
                    const watchdog = setTimeout(() => { finish(Object.assign(new Error('平台状态查询超时'), { retry: true })); handle?.abort?.(); }, 31000);
                    aborter.signal.addEventListener('abort', cancelXHR, { once: true });
                    try {
                        handle = env.request({ method: 'GET', url, anonymous: false, nocache: true, timeout: 30000,
                            onload: r => finish(null, { status: r.status, text: r.responseText || '', finalUrl: r.finalUrl }),
                            ontimeout: () => finish(Object.assign(new Error('平台状态查询超时'), { retry: true })),
                            onerror: e => finish(Object.assign(new Error(/@connect|permission|not.?allow/i.test(String(e?.error || e || '')) ? '脚本猫未授权课程域名' : '平台状态查询网络失败'), { retry: !/@connect|permission|not.?allow/i.test(String(e?.error || e || '')) })),
                            onabort: () => finish(Object.assign(new Error('请求中止'), { name: 'AbortError' })) });
                    } catch (_) { finish(Object.assign(new Error('无法请求平台状态，请检查脚本猫站点权限'), { fatal: true })); }
                });
            }
            core.check(aborter.signal);
            const code = Number(response.status);
            if (!code || code < 200 || code >= 300) throw Object.assign(new Error(`平台查询 HTTP ${code || 0}`), { status: code, retry: code === 429 || code >= 500 || !code, fatal: code >= 400 && code < 500 && code !== 429 });
            if (/passport|\/login(?:[/?]|$)/i.test(response.finalUrl || '') || /<title[^>]*>[^<]*(?:登录|login)/i.test(response.text)) throw Object.assign(new Error('课程登录已失效，请重新登录'), { fatal: true });
            if (/验证码|captcha|人机验证/.test(response.text) && !/\bmArg\s*=/.test(response.text)) throw Object.assign(new Error('课程需要人工验证，请在页面完成验证'), { fatal: true });
            return response.text;
        } finally { clearTimeout(timeout); aborter.signal.removeEventListener('abort', cancel); }
    }
    function updateTasks(fresh) {
        const statuses = new Map(), byId = new Map(), knownIds = new Map();
        for (const job of jobs) if (job.id) knownIds.set(job.id, (knownIds.get(job.id) || 0) + 1);
        for (const attachment of fresh.attachments) {
            const ctx = identity(fresh.defaults, attachment), scope = core.taskKey(ctx), passed = attachment.isPassed === true;
            // 缺少编号或复用编号时仍按对象隔离；冲突状态不能被最后一条 true 覆盖。
            statuses.set(scope, passed && (statuses.get(scope) ?? true));
            if (ctx.job) { if (!byId.has(ctx.job)) byId.set(ctx.job, []); byId.get(ctx.job).push({ object: ctx.object, passed }); }
        }
        for (const job of jobs) {
            // 持久断点只作显示，完成与否每次由服务器重新确认。
            const sameId = byId.get(job.id);
            job.done = statuses.has(job.scope) ? statuses.get(job.scope) : !!(job.id && knownIds.get(job.id) === 1 && sameId?.length === 1 && !sameId[0].object && sameId[0].passed);
            core.checkpoint(job.scope, { phase: job.done ? 'complete' : 'waiting', platformComplete: job.done });
        }
    }
    function currentCards() {
        return Array.from(doc.querySelectorAll('iframe')).find(frame => {
            try { return /\/knowledge\/cards(?:[/?]|$)/.test(new URL(frame.src, win.location.href).pathname); } catch (_) { return false; }
        });
    }
    function navigationStatus() {
        const aiBusy = quizBusy();
        const progress = JSON.stringify([jobs.map(j => [j.scope,j.done,getValue(core.PREFIX+'media.'+j.scope,null)?.observedPosition || 0]),Array.from(quizActivities.values()).map(x => x.revision)]);
        postParent({ type: 'edgeStudy.chapter.status.v1', chapter: context.chapter, card: new URL(win.location.href).searchParams.get('num') || '0', tasks: taskView(), phase,
            activity:{aiBusy,mediaPending:!!(activeMedia && !activeMedia.playbackEnded) || !!queueBlocked,blocked:verificationFatal},progress:progress.slice(0,16000),
            message: phase === 'complete' ? '本章启用的任务已获平台确认' : (lastMessage || '按原生页面执行课程任务，进度以平台确认为准').slice(0,300) });
    }
    function quizBusy() {
        // 忙碌以真实请求结束/离开页面为准，不能因后台心跳节流误判为已结束。
        return Array.from(doc.querySelectorAll('iframe')).some(frame => isQuizFrame(frame) && quizActivities.get(frame.contentWindow)?.busy === true);
    }
    function sendComplete() {
        if (stopped() || !course.enabled('jump') || !platformConfirmed || activeMedia) return;
        const remaining = minimumTaskAge - (core.now() - taskStartedAt);
        if (remaining > 0) {
            if (!completionTimer) completionTimer = setTimeout(() => {
                completionTimer = null;
                if (phase === 'complete') sendComplete();
            }, remaining);
            return;
        }
        postParent({ type: 'edgeStudy.chapter.done.v1', chapter: context.chapter, card: new URL(win.location.href).searchParams.get('num') || '0' });
    }
    function cardsKey(frame) {
        if (!frame) return '';
        const url = new URL(frame.src, win.location.href);
        return [url.origin, url.pathname, ...['courseid','clazzid','knowledgeid','num'].map(k => url.searchParams.get(k) || (k === 'num' ? '0' : ''))].join('|');
    }
    function nextButtons() {
        const result = [];
        // 平台真正的导航按钮优先，焦点辅助按钮只作为后备。
        for (const selector of ['.prev_next.next', '.orientationright', '#prevNextFocusNext']) {
            for (const element of doc.querySelectorAll(selector)) {
                if (result.includes(element) || element.disabled || element.getAttribute('aria-disabled') === 'true' || element.closest('[hidden], [aria-hidden="true"], .disabled, .disable')) continue;
                let visible = true;
                for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
                    const style = win.getComputedStyle(node);
                    if (style.display === 'none' || style.visibility === 'hidden') { visible = false; break; }
                }
                if (visible) result.push(element);
            }
        }
        return result;
    }
    function mainTick(forceHandshake = false) {
        if (disposed) return;
        const frame = currentCards(), key = cardsKey(frame);
        if (key !== navigation.key) {
            const changed = !!navigation.key;
            navigation = { key, confirmed: false, attempts: 0, lastAt: 0, openedAt: core.now() }; lastHandshake = 0;
            resetMainState(frame);
            if (changed) note('已检测到新章节或新内容页，等待任务状态同步', 'waiting');
        }
        if (frame && !watchedFrames.has(frame)) {
            watchedFrames.add(frame);
            on('load', () => {
                if (currentCards() !== frame) return;
                navigation = { key: cardsKey(frame), confirmed: false, attempts: 0, lastAt: 0, openedAt: core.now() };
                resetMainState(frame);
                lastHandshake = 0; mainTick(true);
            }, frame);
        }
        if (frame && (forceHandshake || core.now() - lastHandshake >= 5000)) {
            lastHandshake = core.now();
            safePost(frame.contentWindow, { type: 'edgeStudy.parent.ready.v1' }, new URL(frame.src, win.location.href).origin);
        }
        const busy = mainState.aiBusy || mainState.mediaPending || jobs.some(j => j.type === 'video' && j.active) ||
            !!page.confirmation(doc) || page.visible(doc.querySelector('#verifyCodeWin'));
        const allowed = !stopped() && course.enabled('jump') && win.navigator.onLine !== false && !mainState.blocked;
        if (!navigation.confirmed && !navigation.skipped) {
            const chapter = frame ? new URL(frame.src,win.location.href).searchParams.get('knowledgeid') : '';
            const catalog = page.chapterStatus(chapter);
            const action = recovery.decide({allowed,busy,ready:mainState.received,complete:catalog?.completed === true || (mainState.received && phase === 'complete')});
            if (action?.type === 'complete') {
                navigation.confirmed = true; navigation.source = catalog?.completed ? 'catalog' : 'platform';
                note(catalog?.completed ? '目录对钩已确认本节完成，准备进入下一节' : '平台状态已确认本节完成，准备进入下一节','complete');
            } else if (action?.type === 'reload' && frame) {
                note(`本节连续 10 秒无任务进展，正在刷新当前章节（${action.attempt}/2）`);
                if (env.reloadChapter) env.reloadChapter(frame);
                else frame.setAttribute('src',frame.getAttribute('src'));
                return;
            } else if (action?.type === 'skip') {
                navigation.skipped = true; navigation.source = 'skipped';
                note('本节累计刷新 2 次仍无任务进展，按设置跳过本节；未标记为平台已完成');
            }
        }
        if ((!navigation.confirmed && !navigation.skipped) || !allowed || busy) return;
        const remaining = minimumTaskAge - (core.now() - navigation.openedAt);
        if (remaining > 0) {
            note(`本节${navigation.skipped ? '停滞待跳过' : '已完成'}，至少停留 10 秒后切换，还需 ${Math.ceil(remaining / 1000)} 秒`);
            return;
        }
        if (navigation.lastAt && core.now() - navigation.lastAt < minimumTaskAge) return;
        if (navigation.attempts >= 3) {
            if (lastMessage !== '下一节点击后章节仍未变化，已停止重试；请检查平台提示或点击“继续”重试') note('下一节点击后章节仍未变化，已停止重试；请检查平台提示或点击“继续”重试', 'needs_user');
            return;
        }
        const buttons = nextButtons();
        if (!buttons.length) {
            if (lastMessage !== '等待可用的下一节按钮；若已是最后一节则无需切换') note('等待可用的下一节按钮；若已是最后一节则无需切换', 'needs_user');
            return;
        }
        const button = buttons[Math.min(navigation.attempts, buttons.length - 1)];
        navigation.attempts++; navigation.lastAt = core.now();
        try { button.click(); note(`已点击下一节（第 ${navigation.attempts} 次），正在确认章节是否切换`); }
        catch (_) { note('下一节按钮执行失败，稍后重试', 'needs_user'); }
    }
    function resetMainState(frame) {
        jobs = []; mainState = {received:false,aiBusy:false,mediaPending:false,blocked:false};
        let scope = '';
        if (frame) {
            const p = new URL(frame.src,win.location.href).searchParams;
            const chapter = p.get('knowledgeid');
            if (chapter) scope = JSON.stringify([p.get('courseid') || p.get('courseId') || '',p.get('clazzid') || p.get('clazzId') || '',chapter]);
        }
        recovery.enter(scope);
    }
    async function verifyChapter() {
        if (verificationPending || stopped()) return;
        verificationPending = true; lastVerify = core.now();
        try {
            const fresh = await core.run('chapter-confirm', async () => {
                const html = await rawText(win.location.href);
                const parsed = new win.DOMParser().parseFromString(html, 'text/html');
                const result = course.readPageData(parsed, false);
                if (!result) throw Object.assign(new Error('平台返回数据无法识别，未将章节视为完成'), { fatal: true });
                const freshIdentity = identity(result.defaults);
                if (['account','course','clazz','chapter'].some(k => context[k] !== freshIdentity[k])) throw Object.assign(new Error('平台返回了不同课程或账号的数据，已停止自动确认'), { fatal: true });
                return result;
            }, { signal: aborter.signal });
            if (stopped()) return;
            updateTasks(fresh);
            platformConfirmed = true;
            verificationFatal = false;
            bindFrames();
            if (!activeMedia && jobs.every(x => x.done || x.disabled)) { note('本章启用任务均已由平台确认完成', 'complete'); sendComplete(); }
            else if (phase !== 'needs_user') {
                phase = 'waiting';
                if (jobs.some(x => x.done)) note('本节还有未完成任务：' + jobs.filter(x => !x.done && !x.disabled).map(x => x.name).join('、').slice(0,200));
            }
        } catch (error) {
            if (disposed || error.name === 'AbortError') return;
            verificationFatal = error.fatal === true;
            note(error.fatal ? error.message : '平台状态查询暂时失败，下一轮继续核对；未跳过任务', error.fatal ? 'needs_user' : 'offline');
        } finally { verificationPending = false; if (!disposed) navigationStatus(); }
    }
    function resolveFrames() {
        const entries = [];
        for (const frame of doc.querySelectorAll('iframe')) {
            let url;
            try { url = new URL(frame.getAttribute('src') || 'about:blank', win.location.href); } catch (_) { continue; }
            const module = url.pathname.match(/\/ananas\/modules\/(video|audio|pdf|ppt|document|office)\//)?.[1];
            let property = {};
            try { property = JSON.parse(frame.getAttribute('data') || '{}') || {}; } catch (_) {}
            const nested = property.property || {};
            const object = String(property.objectid || property.objectId || nested.objectid || nested.objectId || frame.getAttribute('objectid') || url.searchParams.get('objectid') || '');
            const id = String(property._jobid || property.jobid || property.jobId || nested._jobid || nested.jobid || frame.getAttribute('jobid') || url.searchParams.get('jobid') || '');
            // 预留 iframe 也参与页面排序，但没有真实播放器地址时禁止启用。
            const placeholder = !module && (url.href === 'about:blank') && (object || id);
            if (!module && !placeholder) continue;
            const kind = module ? /video|audio/.test(module) ? 'video' : 'document' : null;
            const candidates = jobs.filter(j => !kind || j.type === kind);
            let matches = id ? candidates.filter(j => j.id === id && (!object || !j.object || j.object === object)) : object ? candidates.filter(j => j.object === object) : [];
            const job = matches.length === 1 ? matches[0] : null;
            const ungraded = !!object && data?.attachments.some(x => !isTaskJob(x) && String(x.property?.objectid || x.property?.objectId || '') === object);
            entries.push({ frame, kind: kind || job?.type, job, object, id, playable: !!module, ungraded });
        }
        for (const entry of entries) {
            // 只有完全缺少身份信息且确实唯一时才允许后备匹配；禁止把未知对象猜成第一条。
            if (!entry.job && !entry.object && !entry.id) {
                const candidates = jobs.filter(j => j.type === entry.kind);
                if (candidates.length === 1 && entries.filter(e => e.kind === entry.kind).length === 1) entry.job = candidates[0];
            }
        }
        const seen = new Set();
        for (const entry of entries) {
            entry.canonical = !!entry.job && !seen.has(entry.job);
            if (entry.job) seen.add(entry.job);
        }
        if (!mediaQueue || (mediaCursor < 0 && !activeMedia)) {
            const mediaEntries = entries.filter(e => e.kind === 'video');
            const missing = jobs.filter(j => j.type === 'video' && !j.disabled && !(platformConfirmed && j.done) && !mediaEntries.some(e => e.job === j));
            const ambiguous = mediaEntries.some(e => !e.job && !e.ungraded);
            queueBlocked = missing.length || ambiguous ? '正在核对页面音视频顺序，播放器身份信息未齐全或有歧义；后续任务不会抢先播放' : '';
            mediaQueue = queueBlocked ? null : mediaEntries.filter(e => e.canonical).map(e => e.job);
        }
        return entries;
    }
    function bindFrames() {
        const entries = resolveFrames();
        const currentMedia = selectMedia();
        for (const entry of entries) {
            const { frame, job } = entry;
            if (!watchedFrames.has(frame)) {
                watchedFrames.add(frame);
                on('load', bindFrames, frame);
            }
            if (!job || !entry.playable) {
                const previousScope = frameScopes.get(frame);
                if (previousScope && entry.playable) {
                    safePost(frame.contentWindow, { type: entry.kind === 'video' ? 'edgeStudy.media.bind.v1' : 'edgeStudy.document.bind.v1', scope: previousScope, enabled: false,
                        queueScope: entry.kind === 'video' ? core.taskKey({ ...context, job: '__media_queue__', object: new URL(win.location.href).searchParams.get('num') || '0' }) : undefined,
                        queueSession: core.id }, new URL(frame.src, win.location.href).origin);
                    frameScopes.delete(frame);
                }
                continue;
            }
            const kind = job.type, origin = new URL(frame.src, win.location.href).origin;
            frameScopes.set(frame, job.scope);
            safePost(frame.contentWindow, { type: kind === 'document' ? 'edgeStudy.document.bind.v1' : 'edgeStudy.media.bind.v1', scope: job.scope,
                enabled: entry.canonical && !stopped() && !job.disabled && (kind === 'video' ? job === currentMedia && !job.playbackEnded : !job.done),
                queued: kind === 'video' && !job.done && job !== currentMedia,
                queueScope: kind === 'video' ? core.taskKey({ ...context, job: '__media_queue__', object: new URL(win.location.href).searchParams.get('num') || '0' }) : undefined,
                queueSession: kind === 'video' ? core.id : undefined,
                allowRate: job.allowRate }, origin);
        }
    }
    function chapterTick() {
        if (disposed) return;
        phase = stopped() ? 'paused' : win.navigator.onLine === false ? 'offline' : phase;
        bindFrames();
        for (const job of jobs) {
            const state = getValue(core.PREFIX + 'media.' + job.scope, null);
            job.active = !job.disabled && (job.type === 'video' ? job === activeMedia && !job.playbackEnded : !job.done) && state?.phase === 'playing' && core.now() - state.updatedAt < 120000;
            if (state?.phase === 'needs_user' && !job.done && !job.disabled) {
                const descriptions = { 'autoplay-blocked': 'Edge 明确阻止了自动播放，请在原播放器点击一次播放；这与脚本加载失败不同', 'media-error': '原播放器报告媒体错误，请查看播放器提示', 'retry-limit': '播放器恢复已达到重试上限，请检查网络或重新打开章节', 'script-error': '播放控制遇到异常，请检查页面控制台' };
                descriptions['reader-unavailable'] = '文档阅读器暂不可访问：可能仍在加载、位于跨域 iframe 或使用浏览器内置 PDF，请在原阅读器翻阅；未跳过任务';
                descriptions['reader-stalled'] = '文档翻页后页面没有变化，请检查阅读器加载或翻页控件；未将任务视为完成';
                note(descriptions[state.reason] || '播放器需要人工处理，请查看原播放器提示', 'needs_user');
            } else if (job.type === 'document' && !job.done && !job.disabled && state && core.now() - state.updatedAt < 120000) {
                if (!stopped() && !verificationFatal && phase === 'needs_user') phase = 'waiting';
                note(state.phase === 'confirming' ? '文档已到当前末尾，正在等待平台确认任务点；不会直接跳过' : state.phase === 'playing' ? '正在快速翻阅文档：优先直达末尾；可随时暂停' : '文档阅读器正在加载或等待翻页');
            } else if (job.type === 'document' && !job.done && !job.disabled && core.now() - job.startedAt > 45000) {
                note('未收到文档阅读器响应：请确认新脚本已在课件 iframe 中运行；当前阅读器结构可能尚未适配，未跳过任务', 'needs_user');
            }
        }
        if (activeMedia && !stopped() && phase !== 'needs_user') {
            note(activeMedia.playbackEnded ? `“${activeMedia.name}”已播放结束，等待平台确认及至少 10 秒停留；后续音视频保持等待` : `按页面顺序播放（第 ${mediaQueue.indexOf(activeMedia) + 1}/${mediaQueue.length} 条）：${activeMedia.name}；后续音视频保持等待`);
        }
        if (queueBlocked && !stopped()) note(queueBlocked, core.now() - taskStartedAt > 45000 ? 'needs_user' : 'waiting');
        if (!stopped() && platformConfirmed && !activeMedia && jobs.length && jobs.every(x => x.done || x.disabled) && phase !== 'needs_user') phase = 'complete';
        if (!stopped() && phase === 'complete') sendComplete();
        if (!stopped() && !verificationFatal && core.now() - lastVerify >= 60000) void verifyChapter();
        heartbeat(); navigationStatus(); course.render();
    }
    function onMessage(event) {
        const value = event.data;
        if (!value || !trustedOrigin(event.origin)) return;
        if (value.type === 'edgeStudy.ui.ai.v1' && event.source === win.parent && ['chapter','quiz','quizHost'].includes(role)) {
            if (value.action === 'run') requestAI('run');
            return;
        }
        if (['chapter','quizHost'].includes(role) && value.type === 'edgeStudy.quiz.activity.v1') {
            const frame = Array.from(doc.querySelectorAll('iframe')).find(x => x.contentWindow === event.source);
            if (!frame || !isQuizFrame(frame)) return;
            const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
            if (quizActivities.get(frame.contentWindow)?.revision !== revision) quizRevision++;
            quizActivities.set(frame.contentWindow,{busy:value.busy === true,at:core.now(),revision});
            if (role === 'quizHost') postParent({type:'edgeStudy.quiz.activity.v1',busy:quizBusy(),revision:quizRevision});
            else if (context) navigationStatus();
            return;
        }
        if (['chapter','quizHost'].includes(role) && value.type === 'edgeStudy.quiz.submitted.v1') {
            const frame = Array.from(doc.querySelectorAll('iframe')).find(x => x.contentWindow === event.source);
            if (!frame || !isQuizFrame(frame)) return;
            if (role === 'quizHost') postParent({ type:'edgeStudy.quiz.submitted.v1' });
            else if (context && !quizVerifyTimer) {
                // 提交只是触发稍后的复核；沿用至少十秒间隔，绝不直接标记任务完成。
                quizVerifyTimer = setTimeout(() => {
                    quizVerifyTimer = null;
                    if (!stopped() && !verificationFatal && !verificationPending) { lastSettledVerify = core.now(); void verifyChapter(); }
                },minimumTaskAge);
            }
            return;
        }
        if (['chapter','quizHost'].includes(role) && value.type === 'edgeStudy.quiz.status.v1') {
            const frame = Array.from(doc.querySelectorAll('iframe')).find(x => x.contentWindow === event.source);
            if (!frame || !isQuizFrame(frame)) return;
            course.note('AI 答题：' + String(value.message || '').slice(0,300));
            postParent({ type:'edgeStudy.quiz.status.v1', ...(role === 'chapter' && context ? {chapter:context.chapter,card:new URL(win.location.href).searchParams.get('num') || '0'} : {}), message:String(value.message || '').slice(0,300) });
            return;
        }
        if (role === 'chapter' && value.type === 'edgeStudy.parent.ready.v1' && event.source === win.parent) {
            parentOrigin = event.origin;
            if (context) { navigationStatus(); if (phase === 'complete') sendComplete(); }
            return;
        }
        if (role === 'chapter' && value.type === 'edgeStudy.task.settled.v1' && context) {
            const frame = Array.from(doc.querySelectorAll('iframe')).find(x => x.contentWindow === event.source);
            if (frame && frameScopes.get(frame) === value.scope && !stopped() && !verificationFatal && !verificationPending && core.now() - lastSettledVerify >= minimumTaskAge) {
                lastSettledVerify = core.now(); void verifyChapter();
            }
            return;
        }
        if (role === 'chapter' && ['edgeStudy.media.ready.v1','edgeStudy.document.ready.v1'].includes(value.type)) {
            if (Array.from(doc.querySelectorAll('iframe')).some(frame => event.source === frame.contentWindow)) bindFrames();
            return;
        }
        if (event.source === win.parent && ((role === 'media' && value.type === 'edgeStudy.media.bind.v1') || (role === 'document' && value.type === 'edgeStudy.document.bind.v1'))) {
            if (typeof value.scope !== 'string' || !value.scope.startsWith(core.PREFIX + 'task.')) return;
            if (value.queueScope !== undefined && (typeof value.queueScope !== 'string' || !value.queueScope.startsWith(core.PREFIX + 'task.'))) return;
            applyBinding(value);
        }
        if (role === 'main') {
            const frame = currentCards();
            if (!frame || event.source !== frame.contentWindow) return;
            const currentChapter = new URL(frame.src, win.location.href).searchParams.get('knowledgeid');
            if (!currentChapter || value.chapter !== currentChapter) return;
            if (String(value.card || '0') !== (new URL(frame.src, win.location.href).searchParams.get('num') || '0')) return;
            if (cardsKey(frame) !== navigation.key) mainTick();
            if (value.type === 'edgeStudy.chapter.status.v1') {
                jobs = Array.isArray(value.tasks) ? value.tasks.slice(0,100).map(x => ({ type: String(x.type || ''), name: String(x.name || '').slice(0,200), done: x.done === true, active: x.running === true, failed: x.failed === true })) : [];
                const previouslyBusy = mainState.aiBusy || mainState.mediaPending;
                mainState = {received:true,aiBusy:value.activity?.aiBusy === true,mediaPending:value.activity?.mediaPending === true,blocked:value.activity?.blocked === true};
                if (previouslyBusy && !mainState.aiBusy && !mainState.mediaPending) recovery.hold();
                recovery.observe(JSON.stringify([jobs.map(j => [j.type,j.name,j.done]),String(value.progress || '').slice(0,16000)]));
                if (!navigation.confirmed && !navigation.skipped) {
                    phase = ['complete','needs_user','offline','waiting'].includes(value.phase) ? value.phase : 'waiting';
                    note(phase === 'complete' ? '本章任务已由平台确认完成' : (typeof value.message === 'string' ? value.message.slice(0,300) : '正在运行原生课程页面，任务状态已同步'));
                }
            }
            if (value.type === 'edgeStudy.chapter.done.v1') {
                navigation.confirmed = true; mainTick();
            }
            if (value.type === 'edgeStudy.quiz.status.v1') note('AI 答题：' + String(value.message || '').slice(0,300));
        }
    }
    function applyBinding(value) {
        if (disposed) return;
        const session = typeof value.queueSession === 'string' ? value.queueSession : '';
        const changed = !bound || bound.scope !== value.scope || bound.queueScope !== value.queueScope || bound.queueSession !== session;
        if (mediaBusy) {
            pendingBinding = value;
            // 保留旧绑定及许可，直到旧的异步 play/锁申请确实结束；不提前腾给下一条。
            if (bound && (changed || value.enabled !== true)) { bound.enabled = false; pausePlayers(); }
            return;
        }
        if (changed) {
            pausePlayers(); releasePlayback(); observed = 0; lastProgressAt = core.now(); reader = null;
            needsGesture = false; playAttempts = 0; nextAttemptAt = 0; playbackReason = ''; lastPublish = 0; lastSettledNotice = 0;
        }
        bound = { scope: value.scope, enabled: value.enabled === true, queued: value.queued === true, queueScope: value.queueScope, queueSession: session, allowRate: value.allowRate === true };
        if (role === 'media' && !bound.enabled) stopMedia();
        if (role === 'document') void documentTick(); else void mediaTick();
    }
    function flushBinding() {
        const next = pendingBinding; pendingBinding = null;
        if (next && !disposed) applyBinding(next);
    }
    function publishMedia(force = false) {
        if (!bound || disposed || (!force && core.now() - lastPublish < 5000)) return;
        if (!ownsPlayback()) { heartbeat(); return; }
        lastPublish = core.now();
        const position = Number(media?.currentTime);
        if (Number.isFinite(position) && position >= 0) {
            if (position > observed + 0.05) { lastProgressAt = core.now(); playAttempts = 0; }
            observed = position;
        }
        core.checkpoint(bound.scope, { phase, observedPosition: observed, duration: Number.isFinite(media?.duration) ? media.duration : undefined });
        setValue(core.PREFIX + 'media.' + bound.scope, { version: 1, session: core.id, queueSession: bound.queueSession, phase, reason: playbackReason, ended: role === 'media' && media?.ended === true, observedPosition: observed, updatedAt: core.now() });
        if (phase === 'confirming' && core.now() - lastSettledNotice >= minimumTaskAge) {
            lastSettledNotice = core.now(); postParent({ type: 'edgeStudy.task.settled.v1', scope: bound.scope });
        }
        heartbeat();
    }
    async function mediaLease() {
        if (!bound) return false;
        const resource = playbackResource();
        // 章节队列的 GM 租约也用于跨域 iframe；Web Locks 自身只在同源间互斥。
        if (role === 'media' && bound.queueScope) {
            if (!core.owns(resource)) {
                if (claiming) return false;
                claiming = true;
                let acquired;
                try { acquired = await core.claim(resource, aborter.signal); }
                finally { claiming = false; }
                if (!acquired) return false;
                if (disposed || stopped() || !bound.enabled || playbackResource() !== resource) { core.release(resource); return false; }
            } else core.renew(resource);
        }
        let manager;
        try { if (!webLocksBroken) manager = win.navigator.locks; }
        catch (_) { webLocksBroken = true; }
        if (manager?.request) {
            if (webLockOwned) return webLockScope === resource;
            if (webLockPending) return false;
            webLockPending = true;
            const requestedScope = resource, requestedJob = bound.scope;
            // Web Locks 提供同源原子互斥；扩展 GM 租约作为不支持 Web Locks 时的后备。
            // ifAvailable 不能与 signal 共用；单独等待“是否拿到锁”的结果，
            // 不等待整个持锁回调结束，否则播放器永远无法进入 play()。
            try {
                return await new Promise((resolve, reject) => {
                    const callback = async lock => {
                        webLockPending = false;
                        if (!lock || disposed || !bound?.enabled || bound.scope !== requestedJob || playbackResource() !== requestedScope) { if (!webLockOwned) core.release(requestedScope); resolve(false); return; }
                        webLockOwned = true; webLockScope = requestedScope;
                        // 先安装释放器，再允许播放，以便随时可以 dispose。
                        let release;
                        const released = new Promise(done => { release = done; webLockRelease = done; });
                        resolve(true);
                        await released;
                        if (webLockRelease === release) { webLockOwned = false; webLockScope = ''; webLockRelease = null; }
                    };
                    Promise.resolve(manager.request(requestedScope, { mode: 'exclusive', ifAvailable: true }, callback)).catch(error => {
                        webLockPending = false; reject(error);
                    });
                });
            } catch (error) {
                webLockPending = false;
                if (disposed || error.name === 'AbortError') return false;
                // API 被环境禁用时回退租约；callback(null) 是真的被其他页面占用，
                // 已在上方返回 false，不能绕过 Web Lock 再启动第二个播放器。
                webLocksBroken = true;
            }
        }
        if (core.owns(resource)) { core.renew(resource); return true; }
        if (claiming) return false;
        claiming = true;
        try { return await core.claim(resource, aborter.signal); }
        finally { claiming = false; }
    }
    function playbackResource() { return role === 'media' && bound?.queueScope || bound?.scope; }
    function ownsPlayback() {
        const resource = playbackResource();
        if (!resource) return false;
        const leased = core.owns(resource);
        if (role === 'media' && bound?.queueScope && !leased) return false;
        return (webLockOwned && webLockScope === resource) || leased;
    }
    function releasePlayback() {
        const resource = playbackResource();
        const release = webLockRelease;
        webLockRelease = null; webLockOwned = false; webLockScope = '';
        if (resource) core.release(resource);
        release?.();
    }
    function pausePlayers() {
        if (role !== 'media') return;
        for (const player of doc.querySelectorAll('video, audio')) if (!player.paused) player.pause();
    }
    function stopMedia() {
        pausePlayers(); phase = bound?.queued ? 'waiting' : 'paused'; playbackReason = bound?.queued ? 'queue-wait' : '';
        publishMedia(true); releasePlayback();
    }
    function attachMedia() {
        if (media?.isConnected) return;
        const previous = media;
        media = doc.querySelector('video, audio');
        if (previous && !previous.paused) previous.pause();
        if (!media) return;
        needsGesture = false; playAttempts = 0; nextAttemptAt = 0;
        const attached = media;
        for (const name of ['timeupdate','playing','waiting','stalled','pause','ended','error','loadedmetadata']) on(name, () => {
            if (disposed || media !== attached || !attached.isConnected) return;
            if (name === 'playing') {
                if (stopped() || !bound?.enabled || !ownsPlayback() || webLockPending || claiming) { media.pause(); phase = bound?.queued ? 'waiting' : 'paused'; publishMedia(true); return; }
                phase = 'playing'; needsGesture = false; playbackReason = '';
            }
            else if (name === 'waiting' || name === 'stalled') phase = 'buffering';
            else if (name === 'ended') phase = 'confirming';
            else if (name === 'pause' && !media.ended) phase = 'paused';
            publishMedia(name === 'ended');
            if (name === 'loadedmetadata') void mediaTick();
        }, media);
    }
    async function mediaTick() {
        if (mediaBusy || disposed) return;
        mediaBusy = true;
        try {
            attachMedia();
            if (!media || !bound) { pausePlayers(); heartbeat(); return; }
            if (stopped() || !bound.enabled) { stopMedia(); return; }
            if (!await mediaLease()) { if (!media.paused) media.pause(); phase = 'duplicate'; publishMedia(true); return; }
            if (disposed) return;
            if (stopped() || !bound.enabled) { stopMedia(); return; }
            if (win.navigator.onLine === false) { phase = 'offline'; publishMedia(true); return; }
            if (media.ended) { phase = 'confirming'; publishMedia(true); return; }
            const requestedRate = Number(getValue('unrivalrate', '1'));
            const rate = bound.allowRate && requestedRate > 0 && requestedRate <= 16 ? requestedRate : 1;
            if (media.playbackRate !== rate) media.playbackRate = rate;
            if (needsGesture || core.now() < nextAttemptAt) { publishMedia(); return; }
            if (media.error || media.paused) {
                if (playAttempts >= 4 || (media.error && media.error.code !== 2)) { phase = 'needs_user'; playbackReason = playAttempts >= 4 ? 'retry-limit' : 'media-error'; publishMedia(true); return; }
                playAttempts++;
                nextAttemptAt = core.now() + [2000,5000,15000,30000][playAttempts - 1];
                if (media.error?.code === 2) media.load();
                const startingMedia = media;
                try {
                    await startingMedia.play();
                    if (stopped() || !bound.enabled || media !== startingMedia || !startingMedia.isConnected) {
                        if (!startingMedia.paused) startingMedia.pause();
                        phase = 'paused';
                    } else phase = 'playing';
                }
                catch (error) { phase = error.name === 'NotAllowedError' ? 'needs_user' : 'buffering'; needsGesture = error.name === 'NotAllowedError'; playbackReason = needsGesture ? 'autoplay-blocked' : ''; }
            } else phase = 'playing';
            publishMedia();
        } catch (error) { if (!disposed && error.name !== 'AbortError') { phase = 'needs_user'; playbackReason = 'script-error'; publishMedia(true); } }
        finally {
            mediaBusy = false;
            if (stopped() || bound?.enabled === false) stopMedia();
            flushBinding();
            if (!disposed && media && !media.isConnected) void mediaTick();
        }
    }
    async function documentTick() {
        if (mediaBusy || disposed) return;
        mediaBusy = true;
        try {
            if (!bound) { heartbeat(); return; }
            if (stopped() || !bound.enabled) { phase = 'paused'; reader?.resume(); publishMedia(true); return; }
            if (!await mediaLease()) { phase = 'duplicate'; heartbeat(); return; }
            if (disposed) return;
            if (stopped() || !bound.enabled) { phase = 'paused'; publishMedia(true); return; }
            if (win.navigator.onLine === false) { phase = 'offline'; reader?.resume(); publishMedia(true); return; }
            if (!reader) reader = createDocumentReader({ win, doc, now: core.now });
            const result = reader.step();
            if (result.position !== observed) lastProgressAt = core.now();
            const changed = result.position !== observed || phase !== result.phase || playbackReason !== result.reason;
            observed = result.position; phase = result.phase; playbackReason = result.reason;
            publishMedia(changed);
        } catch (error) {
            if (!disposed && error.name !== 'AbortError') { phase = 'needs_user'; playbackReason = 'reader-unavailable'; publishMedia(true); }
        } finally { mediaBusy = false; flushBinding(); }
    }
    function resume() {
        if (disposed) return;
        needsGesture = false; playAttempts = 0; nextAttemptAt = 0;
        if (role === 'media') void mediaTick();
        if (role === 'document') { reader?.resume(); void documentTick(); }
        if (role === 'main') { recovery.hold(); navigation.attempts = 0; mainTick(true); }
        if (role === 'chapter') { if (phase === 'needs_user') phase = 'waiting'; verificationFatal = false; lastVerify = 0; chapterTick(); }
        if (role === 'quiz' && !stopped() && getValue('unrivaldowork','1') === '1') void env.ai?.run();
    }
    function aiStatus(message) {
        if (role !== 'quiz') return;
        phase = /正在解答|重试等待|正在测试/.test(message) ? 'waiting' : 'needs_user';
        course.note('AI 答题：' + String(message).slice(0,300));
        postParent({ type:'edgeStudy.quiz.status.v1', message:String(message).slice(0,300) });
        heartbeat();
    }
    function aiActivity(active) {
        aiWorking = active === true;
        if (['quiz','review'].includes(role)) postParent({type:'edgeStudy.quiz.activity.v1',busy:aiWorking,revision:quizRevision});
        heartbeat();
    }
    function quizSubmitted() {
        if (['quiz','review'].includes(role) && !stopped()) postParent({ type:'edgeStudy.quiz.submitted.v1' });
    }
    function isQuizFrame(frame) {
        return page.isQuizFrame(frame);
    }
    function requestAI(action = 'run') {
        if (disposed || action !== 'run') return false;
        if (stopped()) { note('学习已暂停，请先点击“开始 / 继续”再答题'); return false; }
        if (role === 'quiz') { void env.ai?.run(); return true; }
        const frames = role === 'main' ? [currentCards()].filter(Boolean) : ['chapter','quizHost'].includes(role) ? Array.from(doc.querySelectorAll('iframe')).filter(isQuizFrame) : [];
        if (!frames.length) { note('当前内容页没有可用的章节测试，请先打开测试页面'); return false; }
        for (const frame of frames) safePost(frame.contentWindow, { type:'edgeStudy.ui.ai.v1', action:'run' }, new URL(frame.src, win.location.href).origin);
        return true;
    }
    function handleRoute() {
        role = page.role();
        if (!role) return false;
        on('message', onMessage);
        on('online', resume);
        on('visibilitychange', () => { if (!doc.hidden) resume(); heartbeat(); }, doc);
        on('resume', resume, doc);
        on('freeze', () => { phase = 'frozen'; heartbeat(); }, doc);
        on('pagehide', event => { if (!event.persisted) dispose(); else { phase = 'frozen'; heartbeat(); } });
        on('pageshow', resume);
        env.listenValue?.('personalCourse.paused', () => { if (course.isPaused()) { if (media && !media.paused) media.pause(); phase = 'paused'; heartbeat(); if (role === 'chapter' && context) chapterTick(); } else resume(); });
        if (role === 'chapter') {
            data = course.readPageData();
            if (!data) { note('未识别到章节参数；保留原页面，请打开课程内容后重试', 'needs_user'); }
            else {
                context = identity(data.defaults);
                if (['account','course','clazz','chapter'].some(k => !context[k])) { note('课程身份参数不完整，未启动自动任务', 'needs_user'); context = null; }
                else {
                    jobs = data.attachments.filter(isTaskJob).map(x => {
                        const kind = x.type === 'video' || x.type === 'audio' ? 'video' : x.type === 'document' ? 'document' : x.type === 'workid' ? 'work' : 'unsupported';
                        const ctx = identity(data.defaults, x);
                        return { id: ctx.job, scope: core.taskKey(ctx), object: ctx.object, type: kind, name: x.property?.name || x.property?.title || x.type, allowRate: [1, '1', true].includes(x.property?.doublespeed), disabled: kind === 'video' ? !course.enabled('video') : kind === 'document' ? !course.enabled('document') : kind === 'work' ? getValue('unrivaldowork','1') !== '1' : false, done: x.isPassed === true, active: false, startedAt: core.now() };
                    });
                    updateTasks(data);
                    note('已启用 Edge 稳定模式：保留平台原播放器和原生进度上报');
                    lastVerify = jobs.length && (jobs.every(x => x.done || x.disabled) || jobs.some(x => x.type === 'video' && x.done && !x.disabled)) ? 0 : core.now(); chapterTick();
                }
            }
        }
        if (role === 'chapter' && context && typeof win.MutationObserver === 'function') {
            observer = new win.MutationObserver(() => bindFrames());
            observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data', 'objectid', 'jobid'] });
        }
        if (role === 'media') {
            const guardPlayback = event => {
                if (event.target !== media || stopped() || !bound?.enabled || !ownsPlayback() || webLockPending || claiming) {
                    if (typeof event.target.pause === 'function' && !event.target.paused) event.target.pause();
                }
            };
            for (const name of ['play','playing']) doc.addEventListener(name, guardPlayback, { capture: true, signal: aborter.signal });
            void mediaTick();
            postParent({ type: 'edgeStudy.media.ready.v1' });
            if (typeof win.MutationObserver === 'function') {
                observer = new win.MutationObserver(() => { if (!media?.isConnected) { void mediaTick(); postParent({ type: 'edgeStudy.media.ready.v1' }); } });
                observer.observe(doc.documentElement, { childList: true, subtree: true });
            }
        }
        if (role === 'document') {
            void documentTick();
            postParent({ type: 'edgeStudy.document.ready.v1' });
        }
        if (role === 'main') {
            mainTick(true);
            if (typeof win.MutationObserver === 'function') {
                observer = new win.MutationObserver(records => {
                    if (records.some(r => r.target.tagName === 'IFRAME' || Array.from(r.addedNodes).some(n => n.nodeType === 1 && (n.tagName === 'IFRAME' || n.querySelector?.('iframe'))))) mainTick(true);
                });
                observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
            }
        }
        if (role === 'quiz') {
            const changed = () => { quizRevision++; aiActivity(aiWorking); };
            on('input',changed,doc); on('change',changed,doc);
            on('click',event => { if (event.target.closest?.('.answerList li,.Zy_ulTop li')) changed(); },doc);
            const editorDocuments = new WeakSet();
            const bindEditors = () => {
                for (const frame of doc.querySelectorAll('.blankItemDiv iframe,.Zy_ulTk iframe')) {
                    if (!watchedFrames.has(frame)) { watchedFrames.add(frame); on('load',bindEditors,frame); }
                    try {
                        const current = frame.contentDocument;
                        if (current && !editorDocuments.has(current)) { editorDocuments.add(current); on('input',changed,current); on('change',changed,current); }
                    } catch (_) { /* 跨域编辑区不绕过浏览器隔离。 */ }
                }
            };
            bindEditors();
            if (typeof win.MutationObserver === 'function') {
                observer = new win.MutationObserver(bindEditors);
                observer.observe(doc.documentElement,{childList:true,subtree:true});
            }
            phase = getValue('unrivaldowork','1') === '1' ? 'waiting' : 'paused';
            if (!stopped() && getValue('unrivaldowork','1') === '1') void env.ai?.run();
        }
        if (role === 'review') {
            note('当前为平台提交结果/批阅页，不再自动答题或提交；章节任务点仍由平台复核');
            quizSubmitted();
            aiActivity(false);
        }
        timer = setInterval(() => {
            if (role === 'media') void mediaTick();
            else if (role === 'document') void documentTick();
            else if (role === 'chapter' && context) chapterTick();
            else if (role === 'main') { mainTick(); heartbeat(); }
            else heartbeat();
        }, role === 'document' ? 500 : role === 'main' ? 1000 : 15000);
        heartbeat();
        // 所有已识别页面统一使用当前执行层，测试页不再落入仅识别旧地址的分支。
        return true;
    }
    return { handleRoute, resume, aiStatus, aiActivity, quizSubmitted, requestAI, tasks: taskView, dispose, verifyChapter, chapterTick, mediaTick, documentTick, heartbeat, core };
}
