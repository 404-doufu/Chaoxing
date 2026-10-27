"""本地浮窗预览；只绑定 127.0.0.1，不连接课程、不调用真实 API。Ctrl+C 退出。"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/mycourse/studentstudy':
            self.send_error(404)
            return
        code = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in ['src/page-adapter.js', 'src/blank-fields.js', 'src/ai-helper.js', 'src/floating-control.js'])
        html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>浮窗总控 · 本地预览</title>
<style>body{font:16px/1.8 'Microsoft YaHei',sans-serif;background:#eef3f8;color:#203c55;margin:0}main{max-width:900px;margin:40px auto;padding:30px;background:white;border-radius:14px}h1{font-size:26px}aside{padding:14px;background:#e3effa;border-radius:8px}.media{margin-top:24px;height:280px;background:#203f5a;border-radius:12px;display:grid;place-items:center;color:#bbcee0;font-size:26px}p{color:#597187}</style>
<main><h1>浮窗总控 · 本地界面预览</h1><aside>模拟任务，仅验证单例、置顶和拖动。这里不连接真实课程或真实 API。</aside><div class="media">课程播放器占位</div><p>拖动总控标题条调整位置；学习控制与 API 配置在同一个浮窗中切换。</p></main><script>
''' + code + '''
let control, message='按页面顺序播放（第 1/2 条）：示例视频；后续音视频保持等待';
const values=new Map(), getValue=(key,fallback)=>values.has(key)?values.get(key):fallback, setValue=(key,value)=>values.set(key,value);
const note=value=>{message=value;control?.render();};
const ai=createAIHelper({win:window,doc:document,getValue,setValue,settingsContainer:()=>control.settingsContainer(),closeSettings:()=>control.showControls(),runCurrent:()=>note('本地预览不执行真实答题'),report:note,request:options=>{setTimeout(()=>options.onerror?.(),0);return{abort(){}};}});
control=createFloatingControl({win:window,doc:document,getValue,setValue,status:()=>message,note,enabled:name=>getValue('personalCourse.'+name,true),isPaused:()=>getValue('personalCourse.paused',false),setPaused:value=>{setValue('personalCourse.paused',value);note(value?'已暂停学习':'已继续学习');},tasks:()=>[{type:'video',name:'示例视频',running:true},{type:'video',name:'第二个视频',running:false}],openAI:()=>ai.openSettings(),runAI:()=>note('本地预览不执行真实答题'),stopAI:()=>note('预览：已停止 AI'),resume:()=>note('预览：已继续学习')});
control.install();
</script></html>'''
        body = html.encode('utf-8')
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
