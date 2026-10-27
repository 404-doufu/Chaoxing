"""本地浮窗预览；只绑定 127.0.0.1，不连接课程、不调用真实 API。Ctrl+C 退出。"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import json

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['stableVersion']


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = urlsplit(self.path)
        if route.path != '/mycourse/studentstudy':
            self.send_error(404)
            return
        code = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in ['src/page-adapter.js', 'src/blank-fields.js', 'src/ai-helper.js', 'src/floating-control.js'])
        html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>浮窗总控 · 本地预览</title>
<style>body{font:16px/1.8 'Microsoft YaHei',sans-serif;background:radial-gradient(ellipse at 10% 15%,#94d6d5,transparent 40%),radial-gradient(ellipse at 65% 50%,#b2b8e9,transparent 50%),linear-gradient(135deg,#d5e4ef,#e5eff5);color:#203c55;margin:0;min-height:100vh}main{max-width:900px;margin:40px auto;padding:30px;background:#ffffff80;border:1px solid #ffffffa6;border-radius:24px}h1{font-size:26px}aside{padding:14px;background:#e3effa80;border-radius:12px}.media{margin-top:24px;height:280px;background:linear-gradient(135deg,#203f5a,#61849e);border-radius:18px;display:grid;place-items:center;color:#bbcee0;font-size:26px}p{color:#597187}</style>
<div id="previewTools" style="position:fixed;top:0;left:0;display:flex;gap:4px;height:22px"><button id="previewFold">收起 / 展开</button><button id="previewAPI">API</button><button id="previewControl">学习</button><button id="previewAudit">动效检查</button></div>
<main><h1>浮窗总控 · 本地界面预览</h1><aside>模拟任务，仅验证界面。这里不连接真实课程或真实 API。</aside><div class="media">课程播放器占位</div><p>拖动总控标题条调整位置；学习控制与 API 配置在同一个浮窗中切换。</p><pre id="previewResults" style="white-space:pre-wrap">尚未运行浏览器动效检查</pre></main><script>
const previewRoots=[], previewAttachShadow=Element.prototype.attachShadow;
Element.prototype.attachShadow=function(options){const root=previewAttachShadow.call(this,options);previewRoots.push(root);return root;};
''' + code + '''
let control, message='按页面顺序播放（第 1/2 条）：示例视频；后续音视频保持等待';
const values=new Map(), getValue=(key,fallback)=>values.has(key)?values.get(key):fallback, setValue=(key,value)=>values.set(key,value);
const note=value=>{message=value;control?.render();};
const ai=createAIHelper({win:window,doc:document,getValue,setValue,settingsContainer:()=>control.settingsContainer(),closeSettings:()=>control.showControls(),runCurrent:()=>note('本地预览不执行真实答题'),report:note,request:options=>{setTimeout(()=>options.onerror?.(),0);return{abort(){}};}});
control=createFloatingControl({win:window,doc:document,getValue,setValue,version:'__VERSION__',brand:'tofu',supervisorMode:'page',status:()=>message,note,enabled:name=>getValue('personalCourse.'+name,true),isPaused:()=>getValue('personalCourse.paused',false),setPaused:value=>{setValue('personalCourse.paused',value);note(value?'已暂停学习':'已继续学习');},tasks:()=>[{type:'video',name:'示例视频',running:true},{type:'video',name:'第二个视频',running:false}],openAI:()=>ai.openSettings(),runAI:()=>note('本地预览不执行真实答题'),stopAI:()=>note('预览：已停止 AI'),resume:()=>note('预览：已继续学习')});
control.install();
const previewRoot=previewRoots.find(root=>root.host.id==='personal-course-control');
document.querySelector('#previewFold').onclick=()=>previewRoot.querySelector('#collapse').click();
document.querySelector('#previewAPI').onclick=()=>ai.openSettings();
document.querySelector('#previewControl').onclick=()=>control.showControls();
document.querySelector('#previewAudit').onclick=async()=>{
    const result={localOnly:true,failures:[],phases:[]}, body=previewRoot.querySelector('#body'), views=previewRoot.querySelector('#views');
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const measure=async(name,change)=>{
        change();await frame();await frame();const heights=[];
        for(let i=0;i<120;i++){
            const box=body.getBoundingClientRect(), host=previewRoot.host.getBoundingClientRect();heights.push(Math.round(box.height*100)/100);
            if(getComputedStyle(body).overflow!=='hidden'||getComputedStyle(views).overflow!=='hidden')result.failures.push(name+': clipping');
            if(host.bottom>innerHeight+1||host.top<0)result.failures.push(name+': viewport');
            if(!body.hasAttribute('data-motion'))break;await frame();
        }
        if(body.hasAttribute('data-motion'))result.failures.push(name+': unfinished');
        result.phases.push({name,frames:heights.length,first:heights[0],last:heights.at(-1),peak:Math.max(...heights),hidden:body.hidden});
    };
    control.showControls();await frame();
    await measure('collapse',()=>previewRoot.querySelector('#collapse').click());
    await measure('expand',()=>previewRoot.querySelector('#collapse').click());
    await measure('api',()=>ai.openSettings());
    await measure('return',()=>previewRoots.find(root=>root.querySelector('#baseURL')).querySelector('#close').click());
    await measure('rapid-reverse',()=>{previewRoot.querySelector('#collapse').click();previewRoot.querySelector('#collapse').click();ai.openSettings();control.showControls();});
    const refresh=getComputedStyle(previewRoot.querySelector('#refresh')), pause=getComputedStyle(previewRoot.querySelector('#pause'));
    result.refreshMatches=['backgroundColor','borderColor','borderRadius','fontSize','boxShadow'].every(key=>refresh[key]===pause[key]);
    if(!result.refreshMatches)result.failures.push('refresh style');
    document.querySelector('#previewResults').textContent=JSON.stringify(result,null,2);
};
</script></html>'''
        if parse_qs(route.query).get('view') == ['api']:
            html = html.replace('control.install();', 'control.install(); ai.openSettings();')
        body = html.replace('__VERSION__', VERSION).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    print(f'Preview: http://127.0.0.1:{server.server_port}/mycourse/studentstudy', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
