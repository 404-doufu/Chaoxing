/* 稳定版唯一 UI：只由最外层课程页面持有。GPL-3.0-or-later。 */
function createFloatingControl(env) {
    'use strict';
    const { win, doc, getValue, setValue } = env;
    const id = 'personal-course-control', positionKey = 'personalCourse.panelPosition.v1';
    const ownsPage = win.parent === win && ['main','chapter','quiz','review'].includes(createPageAdapter(win,doc).role());
    const aborter = new win.AbortController();
    let host, root, timer, resizeObserver, installed = false, disposed = false, folded = false, drag = null;
    let activeTab = 'control', motionFrame = null, motionId = 0;
    const animations = new Set();
    const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)');
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
    function settleMotion() {
        motionId++;
        if (motionFrame !== null) win.cancelAnimationFrame(motionFrame);
        motionFrame = null;
        for (const animation of animations) animation.cancel();
        animations.clear();
        if (!root) return;
        const body = root.querySelector('#body');
        body.style.height = ''; body.hidden = folded; body.inert = folded;
        body.removeAttribute('data-motion');
        root.querySelector('#views').style.height = '';
        for (const [id, name] of [['controls', 'control'], ['settings', 'api']]) {
            const panel = root.querySelector('#' + id);
            panel.hidden = name !== activeTab; panel.inert = name !== activeTab;
            panel.classList.remove('leaving'); panel.style.opacity = ''; panel.style.transform = '';
        }
    }
    // 高度使用同一条阻尼弹簧曲线；文字不缩放，始终由两层 overflow 裁切。
    function heightFrames(from, to) {
        return Array.from({ length: 37 }, (_, i) => {
            const t = i / 36;
            const spring = i === 36 ? 1 : 1 - Math.exp(-9 * t) * (Math.cos(7 * t) + 9 / 7 * Math.sin(7 * t));
            return { height: Math.max(0, from + (to - from) * spring) + 'px', offset: t };
        });
    }
    function transitionTo(nextFolded, nextTab = activeTab) {
        if (!root || disposed || (nextFolded === folded && nextTab === activeTab)) return;
        const body = root.querySelector('#body'), views = root.querySelector('#views');
        const inner = root.querySelector('#bodyInner'), previous = root.querySelector(activeTab === 'api' ? '#settings' : '#controls');
        const target = root.querySelector(nextTab === 'api' ? '#settings' : '#controls');
        const fromHeight = body.getBoundingClientRect().height, fromViewHeight = views.getBoundingClientRect().height;
        const fromOpacity = win.getComputedStyle(previous).opacity || '1';
        const fromTransform = win.getComputedStyle(previous).transform || 'translateY(0)';
        const targetOpacity = target.hidden ? '0' : win.getComputedStyle(target).opacity || '1';
        const targetTransform = target.hidden ? 'translateY(10px)' : win.getComputedStyle(target).transform || 'translateY(0)';
        const switching = nextTab !== activeTab;
        // 连点时从当前显示高度重新接续，并使旧动画的完成回调失效。
        settleMotion(); folded = nextFolded; activeTab = nextTab;
        const incoming = root.querySelector(activeTab === 'api' ? '#settings' : '#controls');
        body.hidden = false; body.inert = folded;
        root.querySelector('#collapse').textContent = folded ? '展开' : '收起';
        root.querySelector('#collapse').setAttribute('aria-expanded', String(!folded));
        root.querySelector('#controlTab').setAttribute('aria-selected', String(activeTab !== 'api'));
        root.querySelector('#api').setAttribute('aria-selected', String(activeTab === 'api'));
        if ((folded && body.contains(root.activeElement)) || (switching && previous.contains(root.activeElement))) {
            root.querySelector(folded ? '#collapse' : activeTab === 'api' ? '#api' : '#controlTab').focus({ preventScroll: true });
        }
        for (const panel of [previous, incoming]) { panel.hidden = panel !== incoming; panel.inert = panel !== incoming; }
        front();
        if (reducedMotion?.matches || typeof body.animate !== 'function' || typeof win.requestAnimationFrame !== 'function') {
            settleMotion(); clamp(); return;
        }
        body.setAttribute('data-motion', ''); body.style.height = fromHeight + 'px';
        views.style.height = fromViewHeight + 'px';
        if (switching) {
            inner.scrollTop = 0;
            previous.hidden = false; previous.inert = true; previous.classList.add('leaving');
            previous.style.opacity = fromOpacity; previous.style.transform = fromTransform;
            incoming.style.opacity = targetOpacity; incoming.style.transform = targetTransform;
        }
        const id = motionId;
        // API 容器在 settingsContainer() 返回后才同步填充，下一帧再测实际高度。
        motionFrame = win.requestAnimationFrame(() => {
            motionFrame = null;
            if (disposed || id !== motionId) return;
            views.style.height = '';
            const toViewHeight = views.getBoundingClientRect().height;
            const toHeight = folded ? 0 : inner.getBoundingClientRect().height;
            views.style.height = toViewHeight + 'px'; body.style.height = toHeight + 'px';
            const play = (element, frames, duration = 460, easing = 'linear') => {
                const animation = element.animate(frames, { duration, easing, fill: 'both' });
                animation.finished.catch(() => {});
                animations.add(animation); return animation;
            };
            const size = play(body, heightFrames(fromHeight, toHeight));
            if (switching) {
                play(views, heightFrames(fromViewHeight, toViewHeight));
                play(previous, [{ opacity: fromOpacity, transform: fromTransform }, { opacity: 0, transform: 'translateY(-6px)' }], 160, 'ease-out');
                play(incoming, [{ opacity: targetOpacity, transform: targetTransform }, { opacity: 1, transform: 'translateY(0)' }], 460, 'cubic-bezier(.22,1.12,.36,1)');
                incoming.style.opacity = ''; incoming.style.transform = '';
            }
            size.finished.then(() => { if (!disposed && id === motionId) { settleMotion(); clamp(); } }, () => {});
            clamp();
        });
    }
    function showTab(name) {
        if (!root) return;
        transitionTo(false, name === 'api' ? 'api' : 'control');
        front(); clamp();
    }
    function render() {
        if (!root || !host?.isConnected || disposed) return;
        root.querySelector('#status').textContent = env.status();
        root.querySelector('#state').textContent = env.isPaused() ? '已暂停' : '自动运行';
        root.querySelector('#state').setAttribute('data-paused', String(env.isPaused()));
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
          section{position:relative;isolation:isolate;width:360px;max-width:calc(100vw - 16px);color:#21384e;background:rgba(240,246,253,.94);border:1px solid rgba(255,255,255,.88);border-radius:24px;box-shadow:0 18px 56px #233d652b,0 4px 14px #243b5914,inset 0 1px 0 #fff,inset 0 -1px 0 #ffffff80;font:13px/1.65 'Microsoft YaHei',sans-serif;overflow:hidden;color-scheme:light}
          @supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){section{background:linear-gradient(135deg,#ffffffe0,#f3f8ff91 48%,#e6f6fba8);-webkit-backdrop-filter:blur(28px) saturate(155%);backdrop-filter:blur(28px) saturate(155%)}}
          section::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;background:radial-gradient(ellipse at 0 0,#ffffffc7,transparent 55%),radial-gradient(ellipse at 100% 90%,#c5ddff38,transparent 60%);box-shadow:inset 1px 1px 1px #ffffffd9,inset -1px -1px 1px #ffffff91}
          header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px 16px 12px;border-bottom:1px solid #ffffff80;cursor:move;touch-action:none;user-select:none}.identity{min-width:0}.eyebrow{display:block;font-size:10px;font-weight:700;letter-spacing:2px;color:#577592;margin-bottom:3px}strong{display:block;font-size:13px;font-weight:700;overflow-wrap:anywhere}
          #body{overflow:hidden;min-height:0}#bodyInner{max-height:min(760px,calc(100vh - 110px));overflow:auto;overscroll-behavior:contain;padding:14px 16px 16px;scrollbar-width:thin;scrollbar-color:#869cb666 transparent}#body[data-motion] #bodyInner{overflow:hidden}#views{position:relative;overflow:hidden;min-height:0}#views>.leaving{position:absolute;inset:0 0 auto;pointer-events:none}nav{display:flex;gap:4px;padding:4px;margin-bottom:16px;background:#52769e0c;border:1px solid #ffffff91;border-radius:14px}nav button{flex:1;margin:0;border:0;box-shadow:none;background:transparent}nav button[aria-selected=true]{background:#ffffffbf;color:#245888;box-shadow:0 2px 8px #24425b10,inset 0 1px 0 #fff}
          button{font:inherit;font-weight:500;cursor:pointer;border:1px solid #ffffffc7;border-radius:11px;padding:7px 10px;background:#ffffff73;color:#294963;margin:0;box-shadow:0 2px 5px #30496d08,inset 0 1px 0 #ffffffb3;transition:background .18s,box-shadow .18s,transform .18s}button:hover{background:#ffffffe8;box-shadow:0 3px 12px #2b4a7020}button:active{transform:translateY(1px)}button:focus-visible,input:focus-visible,header:focus-visible{outline:2px solid #397ac3;outline-offset:3px}header button{flex-shrink:0;font-size:11px;padding:5px 8px;border-radius:9px}
          .state-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.caption{font-size:11px;color:#536d85;letter-spacing:1px}#state{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:#22634e;background:#e9fff294;border:1px solid #ffffffab;border-radius:99px;padding:4px 10px}#state::before{content:'';width:6px;height:6px;border-radius:50%;background:#369a77;box-shadow:0 0 8px #369a7738}#state[data-paused=true]{color:#855b25;background:#fff4ddbd}#state[data-paused=true]::before{background:#bd8a41}
          .rate-row{display:flex;align-items:center;gap:8px;margin-bottom:14px}.rate-row label{margin-right:auto;color:#536d85}input[type=number]{width:58px;font:inherit;color:inherit;padding:6px;border:1px solid #ffffffd9;background:#ffffff85;border-radius:10px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.actions #resume{background:linear-gradient(135deg,#477dafe8,#396da2e8);border-color:#ffffff70;color:#fff;box-shadow:0 4px 12px #396da22b,inset 0 1px 0 #ffffff55}.actions #resume:hover{background:#386c9e}.actions #refresh{grid-column:1/-1}
          .card-title{display:block;font-size:10px;letter-spacing:1.5px;color:#536d85;margin:15px 0 6px}#status,#tasks{white-space:pre-wrap;overflow-wrap:anywhere;background:#ffffff59;border:1px solid #ffffffa6;padding:11px 12px;border-radius:13px;box-shadow:inset 0 1px 0 #ffffff6b}#tasks{line-height:1.9}.hint{font-size:11px;color:#536d85;margin-top:10px;line-height:1.7}
          @media(prefers-reduced-motion:reduce){button{transition:none}}@media(forced-colors:active){section,button,nav,#status,#tasks,#state{background:Canvas;color:CanvasText;border:1px solid CanvasText;box-shadow:none}section{backdrop-filter:none;-webkit-backdrop-filter:none}.actions #resume,nav button[aria-selected=true]{background:Highlight;color:HighlightText}}
          </style><section aria-label="学习通总控"><header id="dragHandle" tabindex="0" aria-label="拖动总控"><div class="identity"><span class="eyebrow">STUDY ASSISTANT</span><strong>学习通总控 · 拖动此处</strong></div><button id="collapse" type="button" aria-expanded="true" aria-controls="body">收起</button></header>
          <div id="body"><div id="bodyInner"><nav><button id="controlTab" aria-selected="true">学习控制</button><button id="api" aria-selected="false">API 配置</button></nav><div id="views">
          <div id="controls"><div class="state-row"><span class="caption">学习状态</span><b id="state" role="status"></b></div>
          <div class="rate-row"><label for="rate">视频倍速</label><input id="rate" type="number" min="0.1" max="16" step="0.1"><button id="saveRate">保存倍速</button></div>
          <div class="actions"><button id="resume">开始 / 继续</button><button id="pause">暂停学习</button><button id="runAI">开始 / 重试答题</button><button id="stopAI">停止 AI</button><button id="refresh">刷新当前页</button></div>
          <span class="card-title">当前进度</span><div id="status" role="status"></div><span class="card-title">章节任务</span><div id="tasks"></div><div id="supervisorStatus" class="hint"></div><div class="hint">音视频按顺序播放，完成复核后切章；每页至少停留 10 秒。</div></div>
          <div id="settings" hidden inert></div></div></div></div></section>`;
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
        root.querySelector('#collapse').onclick = () => transitionTo(!folded);
        root.querySelector('#controlTab').onclick = () => showTab('control');
        root.querySelector('#api').onclick = () => env.openAI();
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
        on(win, 'resize', () => { settleMotion(); clamp(); });
        on(doc, 'fullscreenchange', () => { settleMotion(); front(); clamp(); });
        if (reducedMotion?.addEventListener) on(reducedMotion, 'change', () => { settleMotion(); clamp(); });
        if (typeof win.ResizeObserver === 'function') { resizeObserver = new win.ResizeObserver(clamp); resizeObserver.observe(host); }
        render(); return host;
    }
    function settingsContainer() { if (!mount() || !root) return null; showTab('api'); return root.querySelector('#settings'); }
    function dispose() { if (disposed) return; settleMotion(); disposed = true; drag = null; clearInterval(timer); resizeObserver?.disconnect(); aborter.abort(); host?.remove(); }
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
