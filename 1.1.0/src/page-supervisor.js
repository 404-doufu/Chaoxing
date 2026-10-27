/* 单文件发行用页面级监督：课程页存在且能运行时检查；不宣称能唤醒冻结页面。 */
function createPageSupervisor(env) {
    const { win, doc } = env;
    const core = createStudyCore({...env,timers:{setTimeout:win.setTimeout.bind(win),clearTimeout:win.clearTimeout.bind(win)}});
    const controller = new win.AbortController(), resource = 'tofu-page-supervisor';
    let timer, installed = false, disposed = false, pending = false;
    async function tick() {
        if (disposed || pending) return;
        win.clearTimeout(timer); pending = true;
        try {
            if (!core.owns(resource) && !await core.claim(resource,controller.signal)) return;
            if (disposed) return;
            core.renew(resource); core.supervise();
        } catch (_) { /* 扩展权限暂不可用时有限间隔继续检查，不记录敏感异常文本。 */ }
        finally { pending = false; if (!disposed) timer = win.setTimeout(tick,60000); }
    }
    function dispose() { if (disposed) return; disposed = true; controller.abort(); win.clearTimeout(timer); core.release(resource); }
    function install() {
        if (installed || win.parent !== win || !['main','chapter','quiz','review'].includes(createPageAdapter(win,doc).role())) return;
        installed = true;
        win.addEventListener('pagehide',event => { if (!event.persisted) dispose(); });
        win.addEventListener('pageshow',tick);
        void tick();
    }
    return { install, tick, dispose };
}
