/* 稳定版唯一 UI：只由最外层课程页面持有。GPL-3.0-or-later。 */
function createFloatingControl(env) {
    'use strict';
    const { win, doc, getValue, setValue } = env;
    const id = 'personal-course-control', positionKey = 'personalCourse.panelPosition.v1';
    const ownsPage = win.parent === win && ['main','chapter','quiz','review'].includes(createPageAdapter(win,doc).role());
    const aborter = new win.AbortController();
    let host, root, timer, resizeObserver, installed = false, disposed = false, folded = false, drag = null;
    let position = { x: 16, y: 24 };
    const on = (target, name, handler) => target.addEventListener(name, handler, { signal: aborter.signal });
    function clamp() {
        if (!host) return;
        const viewportWidth = doc.documentElement.clientWidth || win.innerWidth;
        const viewportHeight = doc.documentElement.clientHeight || win.innerHeight;
        const box = host.getBoundingClientRect();
        const width = box.width || Math.min(360, viewportWidth - 16);
        const height = box.height || (folded ? 44 : Math.min(600, viewportHeight - 16));
        position.x = Math.max(0, Math.min(position.x, Math.max(0, viewportWidth - width)));
        position.y = Math.max(0, Math.min(position.y, Math.max(0, viewportHeight - height)));
        host.style.left = Math.round(position.x) + 'px'; host.style.top = Math.round(position.y) + 'px';
    }
    function front() {
        if (!host?.isConnected) return;
        // Popover 的 top layer 避免普通 z-index 被页面自己的堆叠上下文盖住。
        if (typeof host.showPopover === 'function') {
            try {
                host.setAttribute('popover', 'manual');
                if (!host.matches(':popover-open')) host.showPopover();
            } catch (_) { host.removeAttribute('popover'); }
        }
    }
    function showTab(name) {
        if (!root) return;
        folded = false;
        root.querySelector('#body').hidden = false;
        root.querySelector('#collapse').textContent = '收起';
        root.querySelector('#controls').hidden = name === 'api';
        root.querySelector('#settings').hidden = name !== 'api';
        root.querySelector('#controlTab').setAttribute('aria-selected', String(name !== 'api'));
        root.querySelector('#api').setAttribute('aria-selected', String(name === 'api'));
        front(); clamp();
    }
    function render() {
        if (!root || !host?.isConnected || disposed) return;
        root.querySelector('#status').textContent = env.status();
        root.querySelector('#state').textContent = env.isPaused() ? '已暂停' : '自动运行';
        for (const name of ['video','document','jump']) root.querySelector('#' + name).checked = env.enabled(name);
        for (const [name,key] of [['answer','unrivaldowork'],['submit','unrivalautosubmit'],['save','unrivalautosave']]) root.querySelector('#' + name).checked = getValue(key, name === 'save' ? '0' : '1') === '1';
        const rate = root.querySelector('#rate');
        if (root.activeElement !== rate) rate.value = getValue('unrivalrate', '1');
        const names = { video:'视频/音频', document:'文档', work:'章节测试' };
        const tasks = env.tasks?.() || [];
        root.querySelector('#tasks').textContent = Object.values(tasks).map(x => `${names[x.type] || x.type}：${x.name || ''} — ${x.failed ? '失败，待重试' : x.done ? '已完成' : x.running ? '处理中' : '等待'}`).join('\n') || '等待当前课程的任务状态';
        const supervisor = getValue('edgeStudy.v1.supervisor', null);
        const supervisorName = env.supervisorMode === 'page' ? '页面监督' : '后台监督';
        root.querySelector('#supervisorStatus').textContent = supervisor && Date.now() - supervisor.checkedAt < 180000 ? supervisorName+'：最近已检查' : supervisorName+'：等待最近检查';
    }
    function mount() {
        if (!ownsPage || disposed) return null;
        const existing = doc.getElementById(id);
        if (existing && existing !== host && existing.getAttribute('data-controller') === 'floating-v1') return existing;
        if (host?.isConnected) { front(); render(); return host; }
        // 兼容升级时遗留的旧宿主，不保留第二个总控。
        if (existing) existing.remove();
        host = doc.createElement('div'); host.id = id; host.setAttribute('data-controller', 'floating-v1');
        if (env.version) host.setAttribute('data-version',env.version);
        host.style.cssText = 'position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;z-index:2147483647;overflow:visible;max-width:calc(100vw - 16px)';
        root = host.attachShadow({ mode:'closed' });
        root.innerHTML = `<style>
          :host{all:initial} :host::backdrop{background:transparent;pointer-events:none} *{box-sizing:border-box}[hidden]{display:none!important}
          section{width:360px;max-width:calc(100vw - 16px);color:#18334e;background:#fff;border:1px solid #9bb9d2;border-radius:12px;box-shadow:0 10px 36px #0004;font:13px/1.65 'Microsoft YaHei',sans-serif;overflow:hidden}
          header{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#173c60;color:#fff;cursor:move;touch-action:none;user-select:none}strong{font-size:15px}
          #body{max-height:calc(100vh - 76px);overflow:auto;padding:12px}nav{display:flex;gap:6px;margin-bottom:10px}nav button[aria-selected=true]{background:#184c78;color:#fff}
          button{font:inherit;cursor:pointer;border:1px solid #bad0e1;border-radius:6px;padding:5px 9px;background:#edf4fa;color:#173c60;margin:3px 3px 3px 0}header button{background:transparent;border-color:#6685a0;color:#fff;margin:0}
          .row{display:flex;gap:7px;flex-wrap:wrap}.row label{white-space:nowrap}input[type=number]{width:64px;font:inherit;padding:3px;border:1px solid #bad0e1;border-radius:4px}
          #status,#tasks{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f6fa;padding:8px;border-radius:6px;margin-top:9px}.hint{font-size:12px;color:#526b80;margin-top:8px}
          </style><section aria-label="学习通总控"><header id="dragHandle" tabindex="0" aria-label="拖动总控"><strong>学习通总控 · 拖动此处</strong><button id="collapse" type="button">收起</button></header>
          <div id="body"><nav><button id="controlTab" aria-selected="true">学习控制</button><button id="api" aria-selected="false">API 配置</button></nav>
          <div id="controls"><div>状态：<b id="state"></b></div>
          <div class="row"><label><input id="video" type="checkbox">自动音视频</label><label><input id="document" type="checkbox">自动文档</label><label><input id="jump" type="checkbox">自动切章</label></div>
          <div class="row"><label><input id="answer" type="checkbox">AI 答题</label><label><input id="submit" type="checkbox">自动提交</label><label><input id="save" type="checkbox">自动保存</label></div>
          <div>视频倍速 <input id="rate" type="number" min="0.1" max="16" step="0.1"><button id="saveRate">保存倍速</button></div>
          <div><button id="resume">开始 / 继续</button><button id="pause">暂停学习</button><button id="runAI">开始 / 重试答题</button><button id="stopAI">停止 AI</button><button id="refresh">刷新当前页</button></div>
          <div id="status"></div><div id="tasks"></div><div id="supervisorStatus" class="hint"></div><div class="hint">音视频按页面顺序串行播放；完成并满足 10 秒停留后交接。自动提交以当前勾选状态为准。</div></div>
          <div id="settings" hidden></div></div></section>`;
        if (env.version) root.querySelector('#dragHandle strong').textContent = (env.brand ? env.brand+' · ' : '')+'学习通总控 v' + env.version + ' · 拖动此处';
        doc.documentElement.append(host);
        const saved = getValue(positionKey, null);
        if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) position = { x:saved.x, y:saved.y };
        clamp(); front();
        const handle = root.querySelector('#dragHandle');
        on(handle, 'pointerdown', event => {
            if (event.button !== 0 || event.target.closest('button')) return;
            event.preventDefault(); front();
            drag = { id:event.pointerId, x:event.clientX, y:event.clientY, left:position.x, top:position.y };
            try { handle.setPointerCapture(event.pointerId); } catch (_) {}
        });
        on(win, 'pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            position = { x:drag.left + event.clientX - drag.x, y:drag.top + event.clientY - drag.y }; clamp();
        });
        const finishDrag = event => {
            if (!drag || event.pointerId !== drag.id) return;
            drag = null; setValue(positionKey, { ...position });
            try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
        };
        on(win, 'pointerup', finishDrag); on(win, 'pointercancel', finishDrag);
        on(handle, 'keydown', event => {
            const steps = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }, step = steps[event.key];
            if (!step || event.target !== handle) return;
            event.preventDefault(); const distance = event.shiftKey ? 30 : 10;
            position.x += step[0] * distance; position.y += step[1] * distance; clamp(); setValue(positionKey, { ...position });
        });
        root.querySelector('#collapse').onclick = () => { folded = !folded; root.querySelector('#body').hidden = folded; root.querySelector('#collapse').textContent = folded ? '展开' : '收起'; clamp(); };
        root.querySelector('#controlTab').onclick = () => showTab('control');
        root.querySelector('#api').onclick = () => env.openAI();
        for (const name of ['video','document','jump']) root.querySelector('#' + name).onchange = event => { setValue('personalCourse.' + name, event.target.checked); env.note(name === 'jump' ? '自动切章设置已更新' : '任务开关已保存，刷新当前章节后生效'); };
        for (const [name,key] of [['answer','unrivaldowork'],['submit','unrivalautosubmit'],['save','unrivalautosave']]) root.querySelector('#' + name).onchange = event => { setValue(key, event.target.checked ? '1' : '0'); env.note('答题与保存/提交设置已更新'); };
        root.querySelector('#saveRate').onclick = () => {
            const value = Number(root.querySelector('#rate').value);
            if (!Number.isFinite(value) || value < 0.1 || value > 16) return env.note('倍速须在 0.1～16 之间');
            setValue('unrivalrate', String(value)); env.rateChanged?.(value); env.note('倍速已保存，仍以平台允许为准');
        };
        root.querySelector('#resume').onclick = () => { env.setPaused(false); env.resume?.(); };
        root.querySelector('#pause').onclick = () => env.setPaused(true);
        root.querySelector('#runAI').onclick = () => env.runAI?.('run');
        root.querySelector('#stopAI').onclick = () => env.stopAI?.();
        root.querySelector('#refresh').onclick = () => win.location.reload();
        on(win, 'resize', clamp); on(doc, 'fullscreenchange', () => { front(); clamp(); });
        if (typeof win.ResizeObserver === 'function') { resizeObserver = new win.ResizeObserver(clamp); resizeObserver.observe(host); }
        render(); return host;
    }
    function settingsContainer() { if (!mount() || !root) return null; showTab('api'); return root.querySelector('#settings'); }
    function dispose() { if (disposed) return; disposed = true; drag = null; clearInterval(timer); resizeObserver?.disconnect(); aborter.abort(); host?.remove(); }
    function install() {
        if (installed || !ownsPage || disposed) return;
        installed = true; if (!mount() || !root) return; timer = setInterval(render, 1000);
        on(win, 'pagehide', event => { if (!event.persisted) dispose(); });
        on(win, 'pageshow', () => { front(); clamp(); render(); });
        env.listenValue?.('personalCourse.paused', render);
        if (env.apiConfigured && !env.apiConfigured()) env.openAI();
    }
    return { install, mount, render, settingsContainer, showControls: () => showTab('control'), dispose };
}
