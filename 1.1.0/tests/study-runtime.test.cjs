const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const code=['src/page-adapter.js','src/chapter-recovery.js','src/study-core.js','src/document-reader.js','src/study-runtime.js'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
const defaults={userid:'user',courseid:'course',clazzId:'clazz',knowledgeid:'chapter'};
const video={job:true,jobid:'v1',type:'video',isPassed:false,property:{objectid:'obj1',name:'真实视频',doublespeed:0}};
const documentJob={job:true,jobid:'d1',type:'document',isPassed:false,property:{objectid:'doc1',name:'课件'}};
function setup({path='/knowledge/cards?knowledgeid=chapter',html='<div id="original-player">原播放器保留</div>',data={defaults,attachments:[video]},values:initial={},response,store:shared,id='runtime',origin='https://mooc1.chaoxing.com',ai,reloadChapter,recoveryStorage}={}){
  const dom=new JSDOM(html,{url:origin+path,runScripts:'outside-only'});const w=dom.window;
  let now=1000000,sequence=0;const timers=new Map(),store=shared||new Map(Object.entries(initial)),notes=[],requests=[],posts=[],writes=[],events=new Map();
  const schedule=(fn,ms,interval=0)=>{const id=++sequence;timers.set(id,{fn,at:now+Math.max(1,Number(ms)||1),interval});return id;};
  w.setTimeout=(fn,ms)=>schedule(fn,ms);w.setInterval=(fn,ms)=>schedule(fn,ms,Math.max(1,Number(ms)||1));w.clearTimeout=w.clearInterval=id=>timers.delete(id);
  const getValue=(k,d)=>store.has(k)?store.get(k):d,setValue=(k,v)=>{writes.push({key:k,value:v});store.set(k,v);for(const cb of events.get(k)||[])cb(k,null,v,false);};
  const course={note:x=>notes.push(x),render(){},enabled:name=>getValue('personalCourse.'+name,true),isPaused:()=>getValue('personalCourse.paused',false),readPageData:(doc,allowWindow)=>{
    if(!doc)return data;const text=doc.querySelector('script[data-fixture]')?.textContent;return text?JSON.parse(text):null;
  }};
  const factory=vm.runInNewContext(code+'\ncreateStudyRuntime',{URL,Date,console,setTimeout:w.setTimeout,clearTimeout:w.clearTimeout,setInterval:w.setInterval,clearInterval:w.clearInterval});
  const runtime=factory({win:w,doc:w.document,course,ai,getValue,setValue,id,reloadChapter,recoveryStorage,now:()=>now,timers:{setTimeout:w.setTimeout,clearTimeout:w.clearTimeout},listenValue:(k,fn)=>{if(!events.has(k))events.set(k,[]);events.get(k).push(fn);},request:r=>{
    requests.push(r);w.setTimeout(()=>{if(response)response(r);else r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify(data)}</script>`});},1);return{abort(){}};
  }});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  return{runtime,dom,w,store,notes,requests,posts,writes,course,setValue,
    async tick(ms){const end=now+ms;await flush();for(let count=0;;count++){const entry=[...timers].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!entry)break;if(count>100000)throw new Error('timer loop');const[id,t]=entry;now=t.at;if(t.interval)t.at+=t.interval;else timers.delete(id);t.fn();await flush();}now=end;await flush();},
    async bind(scope='edgeStudy.v1.task.test',enabled=true,extra={}){w.dispatchEvent(new w.MessageEvent('message',{origin:w.location.origin,source:w.parent,data:{type:'edgeStudy.media.bind.v1',scope,enabled,allowRate:false,...extra}}));await flush();},
    close(){runtime.dispose();timers.clear();dom.window.close();}
  };
}
function player(s,{blocked=false,error=null}={}){
  const el=s.w.document.querySelector('video, audio');let position=0,paused=true,ended=false,err=error,playCalls=0,pauseCalls=0,loads=0;
  Object.defineProperties(el,{currentTime:{get:()=>position,set:v=>position=v},duration:{get:()=>100},paused:{get:()=>paused},ended:{get:()=>ended},error:{get:()=>err}});
  el.play=async()=>{playCalls++;if(blocked)throw Object.assign(new Error('gesture'),{name:'NotAllowedError'});paused=false;el.dispatchEvent(new s.w.Event('playing'));};
  el.pause=()=>{pauseCalls++;paused=true;el.dispatchEvent(new s.w.Event('pause'));};el.load=()=>{loads++;err=null;};
  return{el,position:v=>{position=v;el.dispatchEvent(new s.w.Event('timeupdate'));},end:()=>{ended=true;paused=true;el.dispatchEvent(new s.w.Event('ended'));},error:v=>err=v,unblock:()=>blocked=false,get plays(){return playCalls;},get pauses(){return pauseCalls;},get loads(){return loads;}};
}
test('稳定章节模式保留原播放器 DOM，不重建页面、不发送模拟进度',async()=>{
  const s=setup();assert.equal(s.runtime.handleRoute(),true);await s.tick(61000);assert.ok(s.w.document.querySelector('#original-player'));assert.ok(s.requests.every(x=>!x.url.includes('/report/')&&!x.url.includes('/ananas/job/document')));assert.equal(s.runtime.tasks()[0].done,false);s.close();
});
test('仅最新平台数据能确认任务完成，不相信旧本地断点',async()=>{
  const s=setup();const scope=s.runtime.core.taskKey({account:'user',course:'course',clazz:'clazz',chapter:'chapter',job:'v1',object:'obj1'});s.runtime.core.checkpoint(scope,{phase:'complete',platformComplete:true});s.runtime.handleRoute();assert.equal(s.store.get(scope).platformComplete,false);
  await s.tick(61000);assert.equal(s.runtime.tasks()[0].done,false);s.close();
});
test('平台返回 isPassed=true 后确认完成',async()=>{
  const data={defaults,attachments:[video]};const s=setup({data,response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[{...video,isPassed:true}]})}</script>`})});s.runtime.handleRoute();const scope=s.runtime.core.taskKey({account:'user',course:'course',clazz:'clazz',chapter:'chapter',job:'v1',object:'obj1'});s.store.set('edgeStudy.v1.media.'+scope,{ended:true,queueSession:s.runtime.core.id,updatedAt:1000000});await s.tick(61000);assert.equal(s.runtime.tasks()[0].done,true);s.close();
});
test('平台返回不同账号或章节时不确认，不切章',async()=>{
  const s=setup({response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults:{...defaults,userid:'other'},attachments:[{...video,isPassed:true}]})}</script>`})});s.runtime.handleRoute();await s.tick(61000);assert.equal(s.runtime.tasks()[0].done,false);assert.ok(s.notes.some(x=>x.includes('不同课程或账号')));s.close();
});
test('403 不反复重试，提示人工处理',async()=>{
  const s=setup({response:r=>r.onload({status:403,responseText:''})});s.runtime.handleRoute();await s.tick(61000);assert.equal(s.requests.length,1);assert.ok(s.notes.some(x=>x.includes('HTTP 403')));s.close();
});
test('临时 503 退避后成功，完成标记来自重试响应',async()=>{
  let count=0;const s=setup({response:r=>{if(++count===1)r.onload({status:503});else r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[{...video,isPassed:true}]})}</script>`});}});s.runtime.handleRoute();await s.tick(59000);const scope=s.runtime.core.taskKey({account:'user',course:'course',clazz:'clazz',chapter:'chapter',job:'v1',object:'obj1'});s.store.set('edgeStudy.v1.media.'+scope,{ended:true,queueSession:s.runtime.core.id,updatedAt:1059000});await s.tick(6000);assert.equal(count,2);assert.equal(s.runtime.tasks()[0].done,true);s.close();
});
test('暂停期间不查询平台，恢复后再核对',async()=>{
  const s=setup({values:{'personalCourse.paused':true}});s.runtime.handleRoute();await s.tick(120000);assert.equal(s.requests.length,0);s.setValue('personalCourse.paused',false);await s.tick(1000);assert.equal(s.requests.length,1);s.close();
});
test('真实播放器 currentTime 是唯一观察位置，后台延迟不会补写时间',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);s.runtime.handleRoute();await s.bind();await s.tick(200);p.position(12);await s.tick(600000);
  const record=s.store.get('edgeStudy.v1.task.test');assert.equal(record.observedPosition,12);assert.equal(record.platformComplete,false);assert.ok(s.requests.length===0);assert.equal(p.el.currentTime,12);s.close();
});
test('播放结束仅进入等待平台确认，不自行标记完成',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);s.runtime.handleRoute();await s.bind();await s.tick(200);p.position(100);p.end();assert.equal(s.store.get('edgeStudy.v1.task.test').platformComplete,false);s.close();
});
test('暂停与恢复作用于原播放器，禁用任务也不播放',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);s.runtime.handleRoute();await s.bind();await s.tick(200);assert.equal(p.plays,1);s.setValue('personalCourse.paused',true);assert.equal(p.el.paused,true);s.setValue('personalCourse.paused',false);await s.tick(2000);assert.equal(p.el.paused,false);await s.bind('edgeStudy.v1.task.test',false);assert.equal(p.el.paused,true);s.close();
});
test('自动播放被浏览器拒绝时等待手动播放，不无限重试',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s,{blocked:true});s.runtime.handleRoute();await s.bind();await s.tick(120000);assert.equal(p.plays,1);assert.equal(s.store.get('edgeStudy.v1.media.edgeStudy.v1.task.test').phase,'needs_user');assert.equal(s.store.get('edgeStudy.v1.media.edgeStudy.v1.task.test').reason,'autoplay-blocked');p.unblock();s.runtime.resume();await s.tick(1000);assert.equal(p.plays,2);s.close();
});
test('重复页面的存储租约只允许一个播放器启动',async()=>{
  const store=new Map(),a=setup({path:'/ananas/modules/video/index.html',html:'<video></video>',store,id:'a'}),b=setup({path:'/ananas/modules/video/index.html',html:'<video></video>',store,id:'b'});const pa=player(a),pb=player(b);a.runtime.handleRoute();b.runtime.handleRoute();await a.bind();await a.tick(200);await b.bind();await b.tick(200);assert.equal(pa.plays,1);assert.equal(pb.plays,0);a.close();b.close();
});
test('媒体绑定消息须来自当前父窗口且域名可信',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);s.runtime.handleRoute();s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:'https://evil.example',source:s.w.parent,data:{type:'edgeStudy.media.bind.v1',scope:'edgeStudy.v1.task.test',enabled:true}}));await s.tick(16000);assert.equal(p.plays,0);s.close();
});
test('页面关闭释放租约并写入 closed，取消计时任务',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});player(s);s.runtime.handleRoute();await s.bind();await s.tick(200);s.runtime.dispose();assert.equal(s.store.get('edgeStudy.v1.heart.runtime').phase,'closed');assert.equal(s.runtime.core.owns('edgeStudy.v1.task.test'),false);s.close();
});
test('作业页不强制刷新，监督探测不会提交或运行未知操作',async()=>{
  const s=setup({path:'/work/phone/doHomeWork?workId=1',html:'<textarea>未保存答案</textarea>'});assert.equal(s.runtime.handleRoute(),true);s.store.set('edgeStudy.v1.command.runtime',{version:1,action:'probe',nonce:'n',expiresAt:2000000});s.runtime.heartbeat();await s.tick(16000);assert.equal(s.w.document.querySelector('textarea').value,'未保存答案');assert.equal(s.requests.length,0);s.close();
});
test('正式验证码页面停止查询并保留课程页面',async()=>{
  const s=setup({response:r=>r.onload({status:200,responseText:'<html>captcha 人机验证</html>'})});s.runtime.handleRoute();await s.tick(61000);assert.equal(s.requests.length,1);assert.ok(s.notes.some(x=>x.includes('人工验证')));assert.ok(s.w.document.querySelector('#original-player'));s.close();
});
test('缺失章节参数保留原页面并明确提示',()=>{
  const s=setup({data:null});s.runtime.handleRoute();assert.ok(s.notes.some(x=>x.includes('未识别到章节参数')));assert.ok(s.w.document.querySelector('#original-player'));s.close();
});
test('切章仅接受当前章节 iframe 消息，重复完成消息不会连续重复点击',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button id="prevNextFocusNext">下一节</button>'});let clicks=0;const frame=s.w.document.querySelector('iframe');s.w.document.querySelector('button').onclick=()=>clicks++;s.runtime.handleRoute();
  const message=(chapter,source=frame.contentWindow)=>s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:s.w.location.origin,source,data:{type:'edgeStudy.chapter.done.v1',chapter}}));
  message('wrong');message('chapter',s.w);assert.equal(clicks,0);message('chapter');message('chapter');assert.equal(clicks,0);await s.tick(10000);assert.equal(clicks,1);s.close();
});
test('关闭自动切章或暂停时，不点击下一节',()=>{
  for(const values of [{'personalCourse.jump':false},{'personalCourse.paused':true}]){
    const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button id="prevNextFocusNext">下一节</button>',values});let clicks=0;s.w.document.querySelector('button').onclick=()=>clicks++;s.runtime.handleRoute();s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:s.w.location.origin,source:s.w.document.querySelector('iframe').contentWindow,data:{type:'edgeStudy.chapter.done.v1',chapter:'chapter'}}));assert.equal(clicks,0);s.close();
  }
});
test('课程父页面接收子页状态，控制面板不再只显示等待',()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe>'});s.runtime.handleRoute();s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:s.w.location.origin,source:s.w.document.querySelector('iframe').contentWindow,data:{type:'edgeStudy.chapter.status.v1',chapter:'chapter',phase:'waiting',tasks:[{type:'video',name:'真实视频',running:true,done:false}]}}));assert.equal(s.runtime.tasks()[0].running,true);assert.equal(s.runtime.tasks()[0].name,'真实视频');s.close();
});
test('Web Locks 分支在未拿到锁时不播放，取得后才播放',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);let callback,release;
  Object.defineProperty(s.w.navigator,'locks',{value:{request:async(name,options,fn)=>{callback=fn;return new Promise(r=>release=r);}}});s.runtime.handleRoute();await s.bind();assert.equal(p.plays,0);const holding=callback({name:'media'});await s.tick(15000);assert.equal(p.plays,1);s.runtime.dispose();await holding;release();s.close();
});
test('申请租约期间暂停，租约返回后也不启动播放器',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);s.runtime.handleRoute();await s.bind();s.setValue('personalCourse.paused',true);await s.tick(200);assert.equal(p.plays,0);s.close();
});
test('按 Web Locks 真实参数约束验证：不混用 signal/ifAvailable，拿到锁后立即播放',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);let optionsSeen;
  Object.defineProperty(s.w.navigator,'locks',{value:{request:(name,options,callback)=>{
    optionsSeen=options;
    if(options.ifAvailable&&options.signal)return Promise.reject(new s.w.DOMException('signal and ifAvailable cannot be used together','NotSupportedError'));
    return Promise.resolve().then(()=>callback({name}));
  }}});
  s.runtime.handleRoute();await s.bind();assert.equal(optionsSeen.ifAvailable,true);assert.equal(optionsSeen.signal,undefined);assert.equal(p.plays,1);s.close();
});
test('Web Locks 不可用时回退存储租约，不永久卡在 duplicate',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);
  Object.defineProperty(s.w.navigator,'locks',{value:{request:()=>Promise.reject(new s.w.DOMException('disabled','SecurityError'))}});
  s.runtime.handleRoute();await s.bind();await s.tick(200);assert.equal(p.plays,1);s.close();
});
test('Web Lock 被另一页面持有时不能回退绕过互斥',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'});const p=player(s);
  Object.defineProperty(s.w.navigator,'locks',{value:{request:(name,options,callback)=>Promise.resolve().then(()=>callback(null))}});
  s.runtime.handleRoute();await s.bind();await s.tick(16000);assert.equal(p.plays,0);assert.ok(![...s.store.keys()].some(k=>k.startsWith('edgeStudy.v1.lease.')));s.close();
});
test('播放器脚本 ready 消息到达时章节立即重发绑定，不等待十五秒轮询',()=>{
  const s=setup({html:'<iframe data=\'{"objectid":"obj1"}\' src="/ananas/modules/video/index.html"></iframe>'});let binds=0;
  const frame=s.w.document.querySelector('iframe');frame.contentWindow.postMessage=()=>binds++;
  s.runtime.handleRoute();const initial=binds;
  s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:s.w.location.origin,source:frame.contentWindow,data:{type:'edgeStudy.media.ready.v1'}}));assert.equal(binds,initial+1);s.close();
});
test('动态出现的播放器 iframe 会被立即识别并绑定',async()=>{
  const s=setup();s.runtime.handleRoute();const frame=s.w.document.createElement('iframe');frame.src='/ananas/modules/video/index.html';frame.setAttribute('data','{"objectid":"obj1"}');s.w.document.body.append(frame);let binds=0;frame.contentWindow.postMessage=()=>binds++;
  await s.tick(1);assert.ok(binds>=1);s.close();
});
test('video 节点延迟创建也会触发播放，不必等周期检查',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<div></div>'});s.runtime.handleRoute();await s.bind();const el=s.w.document.createElement('video');s.w.document.body.append(el);const p=player(s);await s.tick(200);assert.equal(p.plays,1);s.close();
});

function readerBox(s){
  const element=s.w.document.querySelector('#viewerContainer');let top=0,calls=0;
  Object.defineProperties(element,{clientHeight:{value:500},clientWidth:{value:800},scrollHeight:{value:1300},scrollTop:{get:()=>top,set:v=>top=v}});
  element.scrollTo=({top:value})=>{top=value;calls++;};return{get top(){return top;},get calls(){return calls;}};
}
async function bindDocument(s,enabled=true,origin=s.w.location.origin,source=s.w.parent){
  s.w.dispatchEvent(new s.w.MessageEvent('message',{origin,source,data:{type:'edgeStudy.document.bind.v1',scope:'edgeStudy.v1.task.doc',enabled}}));await s.tick(200);
}
test('文档模块获得任务绑定后滚动，默认不向平台发送完成请求',async()=>{
  const s=setup({path:'/ananas/modules/pdf/index.html',html:'<div id="viewerContainer" style="overflow-y:auto"><canvas></canvas></div>'}),box=readerBox(s);
  assert.equal(s.runtime.handleRoute(),true);await bindDocument(s);assert.equal(box.top,800);await s.tick(2500);assert.equal(s.store.get('edgeStudy.v1.media.edgeStudy.v1.task.doc').phase,'confirming');assert.equal(s.store.get('edgeStudy.v1.task.doc').platformComplete,false);assert.equal(s.requests.length,0);s.close();
});
test('文档翻阅遵守全局暂停、恢复和任务开关',async()=>{
  const s=setup({path:'/ananas/modules/ppt/index.html',html:'<div id="viewerContainer" style="overflow-y:auto"><canvas></canvas></div>',values:{'personalCourse.paused':true}}),box=readerBox(s);s.runtime.handleRoute();await bindDocument(s);await s.tick(60000);assert.equal(box.calls,0);s.setValue('personalCourse.paused',false);await s.tick(1000);assert.equal(box.calls,1);await bindDocument(s,false);await s.tick(60000);assert.equal(box.calls,1);s.close();
});
test('重复文档页只允许一个执行翻阅',async()=>{
  const store=new Map(),a=setup({path:'/ananas/modules/pdf/index.html',html:'<div id="viewerContainer" style="overflow-y:auto"></div>',store,id:'a'}),b=setup({path:'/ananas/modules/pdf/index.html',html:'<div id="viewerContainer" style="overflow-y:auto"></div>',store,id:'b'}),aa=readerBox(a),bb=readerBox(b);
  a.runtime.handleRoute();b.runtime.handleRoute();await bindDocument(a);await bindDocument(b);await a.tick(11000);await b.tick(11000);assert.equal(aa.calls,1);assert.equal(bb.calls,0);a.close();b.close();
});
test('未授权来源不能启动文档翻阅',async()=>{
  const s=setup({path:'/ananas/modules/pdf/index.html',html:'<div id="viewerContainer" style="overflow-y:auto"></div>'}),box=readerBox(s);s.runtime.handleRoute();await bindDocument(s,true,'https://evil.example');await s.tick(30000);assert.equal(box.calls,0);s.close();
});
test('章节按对象匹配文档和视频，不因混合 iframe 绑定到错误任务',()=>{
  const s=setup({data:{defaults,attachments:[video,documentJob]},html:'<iframe data=\'{"objectid":"obj1"}\' src="/ananas/modules/video/index.html"></iframe><iframe data=\'{"objectid":"doc1"}\' src="/ananas/modules/pdf/index.html"></iframe>'});const messages=[];s.w.document.querySelectorAll('iframe').forEach(frame=>frame.contentWindow.postMessage=value=>messages.push(value));s.runtime.handleRoute();assert.ok(messages.some(x=>x.type==='edgeStudy.document.bind.v1'&&decodeURIComponent(x.scope).includes('d1|doc1')));assert.ok(messages.some(x=>x.type==='edgeStudy.media.bind.v1'&&decodeURIComponent(x.scope).includes('v1|obj1')));s.close();
});
test('阅读器不可访问时提示，章节仍复核平台完成状态',async()=>{
  const data={defaults,attachments:[documentJob]},s=setup({data,response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[{...documentJob,isPassed:true}]})}</script>`})});s.runtime.handleRoute();const scope=s.runtime.core.taskKey({account:'user',course:'course',clazz:'clazz',chapter:'chapter',job:'d1',object:'doc1'});s.store.set('edgeStudy.v1.media.'+scope,{version:1,phase:'needs_user',reason:'reader-unavailable',updatedAt:1000000});s.runtime.chapterTick();assert.ok(s.notes.some(x=>x.includes('文档阅读器暂不可访问')));await s.tick(61000);assert.equal(s.runtime.tasks()[0].done,true);s.close();
});
test('章节没有文档子页心跳时明确提示，不无限显示等待',async()=>{
  const s=setup({data:{defaults,attachments:[documentJob]}});s.runtime.handleRoute();await s.tick(61000);assert.ok(s.notes.some(x=>x.includes('未收到文档阅读器响应')));assert.equal(s.runtime.tasks()[0].done,false);s.close();
});

function chapterDone(s,card='0',chapter='chapter'){
  s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:s.w.location.origin,source:s.w.document.querySelector('iframe').contentWindow,data:{type:'edgeStudy.chapter.done.v1',chapter,card}}));
}
function wire(parent,child,selector='iframe'){
  const frame=parent.w.document.querySelector(selector);
  const proxy={location:{href:parent.w.location.href},postMessage:data=>parent.w.dispatchEvent(new parent.w.MessageEvent('message',{origin:child.w.location.origin,source:child.w,data}))};
  Object.defineProperty(child.w,'parent',{value:proxy});
  Object.defineProperty(frame,'contentWindow',{get:()=>child.w});
  child.w.postMessage=data=>child.w.dispatchEvent(new child.w.MessageEvent('message',{origin:parent.w.location.origin,source:proxy,data}));
  return frame;
}
test('真实下一节按钮优先于焦点辅助按钮，切换成功后不再重试',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button id="prevNextFocusNext">焦点</button><button class="prev_next next">下一节</button>'});let actual=0,focus=0;const frame=s.w.document.querySelector('iframe');s.w.document.querySelector('#prevNextFocusNext').onclick=()=>focus++;s.w.document.querySelector('.next').onclick=()=>{actual++;frame.src='/knowledge/cards?knowledgeid=next';};s.runtime.handleRoute();chapterDone(s);await s.tick(20000);assert.equal(actual,1);assert.equal(focus,0);s.close();
});
test('点击未切换时等待十秒重试，第二次切换后停止',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'});let clicks=0;const frame=s.w.document.querySelector('iframe');s.w.document.querySelector('button').onclick=()=>{if(++clicks===2)frame.src='/knowledge/cards?knowledgeid=next';};s.runtime.handleRoute();chapterDone(s);chapterDone(s);await s.tick(9999);assert.equal(clicks,0);await s.tick(1);assert.equal(clicks,1);await s.tick(9999);assert.equal(clicks,1);await s.tick(10001);assert.equal(clicks,2);s.close();
});
test('点击三次均无变化时停止并提示，不无限点击',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'});let clicks=0;s.w.document.querySelector('button').onclick=()=>clicks++;s.runtime.handleRoute();chapterDone(s);await s.tick(60000);assert.equal(clicks,3);assert.ok(s.notes.some(x=>x.includes('已停止重试')));s.close();
});
test('隐藏按钮不阻断导航，可用按钮稍后出现也能切换',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next" style="display:none">隐藏</button><button id="prevNextFocusNext" disabled>下一节</button>'});let clicks=0;s.w.document.querySelectorAll('button').forEach(button=>button.onclick=()=>clicks++);s.runtime.handleRoute();chapterDone(s);assert.equal(clicks,0);await s.tick(10000);assert.equal(clicks,0);s.w.document.querySelector('#prevNextFocusNext').disabled=false;await s.tick(1000);assert.equal(clicks,1);s.close();
});
test('同章节不同内容页的旧完成消息不能触发导航',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter&num=1"></iframe><button class="prev_next next">下一节</button>'});let clicks=0;s.w.document.querySelector('button').onclick=()=>clicks++;s.runtime.handleRoute();chapterDone(s,'0');await s.tick(10000);assert.equal(clicks,0);chapterDone(s,'1');assert.equal(clicks,1);s.close();
});
test('父页握手可恢复无 referrer 时的完成通知',async()=>{
  const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'}),chapter=setup({data:{defaults,attachments:[documentJob]},response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[{...documentJob,isPassed:true}]})}</script>`})});let clicks=0;main.w.document.querySelector('button').onclick=()=>clicks++;wire(main,chapter);Object.defineProperty(chapter.w.document,'referrer',{value:'invalid-referrer'});chapter.runtime.handleRoute();const confirming=chapter.runtime.verifyChapter();await chapter.tick(10000);await confirming;assert.equal(clicks,0);main.runtime.handleRoute();assert.equal(clicks,0);await main.tick(10000);assert.equal(clicks,1);main.close();chapter.close();
});
test('章节首次显示已完成也必须用新平台数据复核',async()=>{
  const data={defaults,attachments:[{...video,isPassed:true}]},s=setup({data,response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[video]})}</script>`})});s.runtime.handleRoute();await s.tick(10);assert.equal(s.requests.length,1);assert.equal(s.runtime.tasks()[0].done,false);s.close();
});
test('文档到末尾、平台复核完成、点击下一节完整串联，无需等待一分钟',async()=>{
  const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'});
  const chapter=setup({data:{defaults,attachments:[documentJob]},html:'<iframe data=\'{"objectid":"doc1"}\' src="/ananas/modules/pdf/index.html"></iframe>',response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[{...documentJob,isPassed:true}]})}</script>`})});
  const reader=setup({path:'/ananas/modules/pdf/index.html',html:'<div id="viewerContainer" style="overflow-y:auto"><canvas></canvas></div>'});readerBox(reader);const frame=wire(main,chapter);wire(chapter,reader);let clicks=0;main.w.document.querySelector('button').onclick=()=>{clicks++;frame.src='/knowledge/cards?knowledgeid=next';};reader.runtime.handleRoute();chapter.runtime.handleRoute();main.runtime.handleRoute();await reader.tick(3000);await chapter.tick(10000);await main.tick(9999);assert.equal(clicks,0);await main.tick(1);assert.equal(chapter.requests.length,1);assert.equal(chapter.runtime.tasks()[0].done,true);assert.equal(clicks,1);assert.match(frame.src,/knowledgeid=next/);main.close();chapter.close();reader.close();
});
test('文档完成通知不直接切章，仍须等待服务器确认',async()=>{
  const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'}),chapter=setup({data:{defaults,attachments:[documentJob]},html:'<iframe data=\'{"objectid":"doc1"}\' src="/ananas/modules/pdf/index.html"></iframe>'});wire(main,chapter);let clicks=0;main.w.document.querySelector('button').onclick=()=>clicks++;chapter.runtime.handleRoute();main.runtime.handleRoute();const frame=chapter.w.document.querySelector('iframe'),scope=chapter.runtime.core.taskKey({account:'user',course:'course',clazz:'clazz',chapter:'chapter',job:'d1',object:'doc1'});chapter.w.dispatchEvent(new chapter.w.MessageEvent('message',{origin:chapter.w.location.origin,source:frame.contentWindow,data:{type:'edgeStudy.task.settled.v1',scope}}));await chapter.tick(10);assert.equal(chapter.requests.length,1);assert.equal(clicks,0);main.close();chapter.close();
});
test('一个文档完成但同节还有视频时不能自动跳过视频',async()=>{
  const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'}),chapter=setup({data:{defaults,attachments:[documentJob,video]},response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[{...documentJob,isPassed:true},video]})}</script>`})});wire(main,chapter);let clicks=0;main.w.document.querySelector('button').onclick=()=>clicks++;chapter.runtime.handleRoute();main.runtime.handleRoute();const verifying=chapter.runtime.verifyChapter();await chapter.tick(10);await verifying;assert.equal(chapter.runtime.tasks()[0].done,true);assert.equal(chapter.runtime.tasks()[1].done,false);assert.equal(clicks,0);assert.ok(chapter.notes.some(x=>x.includes('本节还有未完成任务')&&x.includes('真实视频')));main.close();chapter.close();
});
test('任务已存在十秒后才确认完成时可以直接切换，不额外等十秒',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'});let clicks=0;s.w.document.querySelector('button').onclick=()=>clicks++;s.runtime.handleRoute();await s.tick(12000);assert.equal(clicks,0);chapterDone(s);assert.equal(clicks,1);s.close();
});
test('进入下一任务后重新计算十秒，不能沿用上一任务停留时间',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'});let clicks=0;const frame=s.w.document.querySelector('iframe');s.w.document.querySelector('button').onclick=()=>{clicks++;if(clicks===1)frame.src='/knowledge/cards?knowledgeid=next';};s.runtime.handleRoute();chapterDone(s);await s.tick(10000);assert.equal(clicks,1);chapterDone(s,'0','next');await s.tick(9999);assert.equal(clicks,1);await s.tick(1);assert.equal(clicks,2);s.close();
});
test('同一任务页重新加载后也必须再停留十秒',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'});let clicks=0;const frame=s.w.document.querySelector('iframe');s.w.document.querySelector('button').onclick=()=>clicks++;s.runtime.handleRoute();chapterDone(s);await s.tick(5000);frame.dispatchEvent(new s.w.Event('load'));chapterDone(s);await s.tick(9999);assert.equal(clicks,0);await s.tick(1);assert.equal(clicks,1);s.close();
});
test('继续运行不能绕过下一节重试的十秒间隔',async()=>{
  const s=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'});let clicks=0;s.w.document.querySelector('button').onclick=()=>clicks++;s.runtime.handleRoute();chapterDone(s);await s.tick(10000);assert.equal(clicks,1);await s.tick(5000);s.runtime.resume();assert.equal(clicks,1);await s.tick(4999);assert.equal(clicks,1);await s.tick(1);assert.equal(clicks,2);s.close();
});

const audioJob={job:true,jobid:'a2',type:'audio',isPassed:false,property:{objectid:'audio2',name:'第二个音频'}};
function serialScene({attachments=[video,audioJob],reverseFrames=false,frameOrder}={}){
  const store=new Map();let fresh=attachments.map(x=>({...x}));
  const ordered=frameOrder?frameOrder.map(id=>attachments.find(x=>x.jobid===id)):reverseFrames?[...attachments].reverse():attachments;
  const html=ordered.map(x=>`<iframe id="${x.jobid}" data='{"objectid":"${x.property.objectid}","_jobid":"${x.jobid}"}' src="/ananas/modules/${x.type}/index.html"></iframe>`).join('');
  const chapter=setup({store,id:'chapter-agent',data:{defaults,attachments},html,response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:fresh})}</script>`})});
  const children=attachments.map((x,i)=>setup({store,id:'player-'+i,path:`/ananas/modules/${x.type}/index.html`,html:`<${x.type}></${x.type}>`}));
  const players=children.map(child=>player(child));children.forEach((child,i)=>wire(chapter,child,'#'+attachments[i].jobid));
  return{chapter,children,players,pass:id=>fresh=fresh.map(x=>x.jobid===id?{...x,isPassed:true}:x),setFresh:value=>fresh=value,
    async start(){children.forEach(child=>child.runtime.handleRoute());chapter.runtime.handleRoute();for(const child of children)await child.tick(200);await chapter.tick(200);},
    async tick(ms){for(const child of children)await child.tick(ms);await chapter.tick(ms);},
    async verify(){const pending=chapter.runtime.verifyChapter();await chapter.tick(10);await pending;for(const child of children)await child.tick(200);},
    close(){chapter.close();children.forEach(child=>child.close());}
  };
}
test('页面顺序与接口数组相反时，优先播放页面上方的播放器',async()=>{
  const s=serialScene({reverseFrames:true});await s.start();assert.equal(s.players[0].plays,0);assert.equal(s.players[1].plays,1);await s.tick(31000);assert.equal(s.players[0].plays,0);assert.equal(s.players[1].plays,1);assert.equal(s.players[1].el.paused,false);s.close();
});
test('音频在前视频在后也按顺序执行，前一个结束且平台确认后才启动后一个',async()=>{
  const s=serialScene({attachments:[audioJob,video]});await s.start();assert.equal(s.players[0].plays,1);assert.equal(s.players[1].plays,0);await s.tick(11000);s.players[0].end();await s.chapter.tick(10);assert.equal(s.players[1].plays,0);s.pass('a2');await s.verify();assert.equal(s.players[0].el.paused,true);assert.equal(s.players[1].plays,1);s.close();
});
test('服务器提前确认第一个任务完成时仍等实际 ended，不抢播下一任务',async()=>{
  const s=serialScene();await s.start();await s.tick(11000);s.pass('v1');await s.verify();assert.equal(s.players[1].plays,0);assert.equal(s.players[0].el.paused,false);assert.equal(s.chapter.runtime.tasks()[0].done,false);s.players[0].end();await s.verify();assert.equal(s.players[1].plays,1);s.close();
});
test('原生自动播放尝试会被阻止，排队任务不能抢占当前任务',async()=>{
  const s=serialScene();await s.start();await s.players[1].el.play();assert.equal(s.players[1].el.paused,true);assert.equal(s.players[0].el.paused,false);s.chapter.runtime.chapterTick();await s.children[0].tick(1000);await s.children[1].tick(1000);assert.equal(s.players[0].plays,1);assert.equal(s.players[1].el.paused,true);s.close();
});
test('当前任务缓冲或全局暂停时不换任务，恢复仍播放同一个',async()=>{
  const s=serialScene();await s.start();s.players[0].el.dispatchEvent(new s.children[0].w.Event('waiting'));await s.tick(1000);assert.equal(s.players[1].plays,0);s.chapter.setValue('personalCourse.paused',true);assert.equal(s.players[0].el.paused,true);await s.tick(11000);assert.equal(s.players[1].plays,0);s.chapter.setValue('personalCourse.paused',false);await s.children[0].tick(200);await s.children[1].tick(200);assert.equal(s.players[0].el.paused,false);assert.equal(s.players[1].plays,0);s.close();
});
test('切换到下一音视频后旧平台状态回退也不来回抢播',async()=>{
  const s=serialScene();await s.start();await s.tick(11000);s.players[0].end();s.pass('v1');await s.verify();assert.equal(s.players[1].plays,1);s.setFresh([video,audioJob]);await s.verify();await s.tick(31000);assert.equal(s.players[0].plays,1);assert.equal(s.players[0].el.paused,true);assert.equal(s.players[1].plays,1);s.close();
});
test('极短媒体播放完且获确认仍需满足该任务十秒停留才换下一个',async()=>{
  const s=serialScene();await s.start();s.players[0].end();s.pass('v1');await s.verify();assert.equal(s.players[1].plays,0);await s.chapter.tick(9789);assert.equal(s.players[1].plays,0);await s.chapter.tick(1);await s.children[1].tick(200);assert.equal(s.players[1].plays,1);s.close();
});
test('跨域播放器共享队列许可，迟到 play Promise 结束前不允许下一任务播放',async()=>{
  const store=new Map(),a=setup({store,id:'a',path:'/ananas/modules/video/index.html',html:'<video></video>'}),b=setup({store,id:'b',origin:'https://mooc1-1.chaoxing.com',path:'/ananas/modules/audio/index.html',html:'<audio></audio>'}),pa=player(a),pb=player(b),queueScope='edgeStudy.v1.task.shared-queue';let finish;const original=pa.el.play;pa.el.play=()=>new Promise(resolve=>{finish=async()=>{await original();resolve();};});
  for(const s of [a,b])Object.defineProperty(s.w.navigator,'locks',{value:{request:(name,options,fn)=>Promise.resolve().then(()=>fn({name}))}});
  a.runtime.handleRoute();b.runtime.handleRoute();await a.bind('edgeStudy.v1.task.a',true,{queueScope});await a.tick(200);assert.equal(typeof finish,'function');await a.bind('edgeStudy.v1.task.a',false,{queueScope});await b.bind('edgeStudy.v1.task.b',true,{queueScope});await b.tick(200);assert.equal(pb.plays,0);await finish();await a.tick(1);assert.equal(pa.el.paused,true);await b.bind('edgeStudy.v1.task.b',true,{queueScope});await b.tick(200);assert.equal(pb.plays,1);assert.equal(pa.el.paused,true);a.close();b.close();
});
test('上一页面遗留的 ended 状态不能推进当前播放队列',async()=>{
  const s=serialScene();await s.start();const scope=s.chapter.runtime.core.taskKey({account:'user',course:'course',clazz:'clazz',chapter:'chapter',job:'v1',object:'obj1'});s.chapter.store.set('edgeStudy.v1.media.'+scope,{ended:true,queueSession:'old-chapter-session',updatedAt:1000000});s.pass('v1');await s.tick(11000);await s.verify();assert.equal(s.players[1].plays,0);assert.equal(s.players[0].el.paused,false);s.close();
});
test('初始平台缓存显示全部完成但新复核未返回时不能切章',async()=>{
  const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe><button class="prev_next next">下一节</button>'}),chapter=setup({data:{defaults,attachments:[{...video,isPassed:true}]},response:()=>{}});wire(main,chapter);let clicks=0;main.w.document.querySelector('button').onclick=()=>clicks++;chapter.runtime.handleRoute();main.runtime.handleRoute();await chapter.tick(20000);await main.tick(20000);assert.equal(clicks,0);main.close();chapter.close();
});

const secondVideo={job:true,jobid:'v2',type:'video',isPassed:false,property:{objectid:'obj2',name:'页面第二个视频'}};
test('两个视频的接口顺序颠倒时仍先播页面第一个，再播第二个',async()=>{
  const s=serialScene({attachments:[secondVideo,video],frameOrder:['v1','v2']});await s.start();assert.equal(s.players[1].plays,1);assert.equal(s.players[0].plays,0);assert.equal(s.chapter.runtime.tasks()[0].name,video.property.name);assert.ok(s.chapter.notes.some(x=>x.includes('按页面顺序播放（第 1/2 条）')));await s.tick(11000);s.players[1].end();s.pass('v1');await s.verify();assert.equal(s.players[1].plays,1);assert.equal(s.players[1].el.paused,true);assert.equal(s.players[0].plays,1);s.close();
});
test('第一个播放器延迟插入时等待，不先启动已加载的第二个',async()=>{
  const s=serialScene({attachments:[video,secondVideo]}),first=s.chapter.w.document.querySelector('#v1');first.remove();await s.start();assert.equal(s.players[0].plays,0);assert.equal(s.players[1].plays,0);s.chapter.w.document.body.prepend(first);await s.chapter.tick(1);await s.children[0].tick(200);await s.children[1].tick(200);assert.equal(s.players[0].plays,1);assert.equal(s.players[1].plays,0);s.close();
});
test('页面第一个是待加载 iframe 时仍排在最前，地址就绪后才播放',async()=>{
  const s=serialScene({attachments:[video,secondVideo]}),first=s.chapter.w.document.querySelector('#v1');first.src='about:blank';await s.start();assert.equal(s.players[0].plays,0);assert.equal(s.players[1].plays,0);first.src='/ananas/modules/video/index.html';await s.chapter.tick(1);await s.children[0].tick(200);assert.equal(s.players[0].plays,1);assert.equal(s.players[1].plays,0);s.close();
});
test('多个任务复用同一媒体对象时按 jobid 准确绑定，不把第二个认成第一个',async()=>{
  const duplicate={...secondVideo,property:{...secondVideo.property,objectid:'obj1'}};
  const s=serialScene({attachments:[duplicate,video],frameOrder:['v1','v2']});await s.start();assert.equal(s.players[1].plays,1);assert.equal(s.players[0].plays,0);await s.tick(11000);s.players[1].end();s.pass('v1');await s.verify();assert.equal(s.players[0].plays,1);s.close();
});
test('同一对象对应多个任务却没有 jobid 时等待，不按数组猜测播放器',async()=>{
  const duplicate={...secondVideo,property:{...secondVideo.property,objectid:'obj1'}};
  const s=serialScene({attachments:[video,duplicate]});s.chapter.w.document.querySelectorAll('iframe').forEach(frame=>frame.setAttribute('data','{"objectid":"obj1"}'));await s.start();assert.equal(s.players[0].plays,0);assert.equal(s.players[1].plays,0);assert.ok(s.chapter.notes.some(x=>x.includes('播放器身份信息未齐全或有歧义')));s.close();
});
test('唯一播放器显式指向其他对象时也不能用后备匹配误启动',async()=>{
  const s=serialScene({attachments:[video]});s.chapter.w.document.querySelector('iframe').setAttribute('data','{"objectid":"unknown"}');await s.start();assert.equal(s.players[0].plays,0);s.close();
});
test('初始缓存误把第一个标完成时先复核，平台返回未完成后从第一个开始',async()=>{
  const s=serialScene({attachments:[{...video,isPassed:true},secondVideo]});s.setFresh([video,secondVideo]);await s.start();assert.equal(s.players[1].plays,0);await s.children[0].tick(200);assert.equal(s.players[0].plays,1);assert.equal(s.players[1].plays,0);s.close();
});
test('播放开始后 DOM 重新排列也不抢播另一个播放器',async()=>{
  const s=serialScene({attachments:[video,secondVideo]});await s.start();s.chapter.w.document.body.prepend(s.chapter.w.document.querySelector('#v2'));await s.chapter.tick(1);await s.children[1].tick(1000);assert.equal(s.players[0].plays,1);assert.equal(s.players[1].plays,0);s.close();
});
test('平台 job 标记为字符串时也识别第一个任务，不将它过滤掉',async()=>{
  const s=serialScene({attachments:[{...video,job:'1'},secondVideo]});await s.start();assert.equal(s.players[0].plays,1);assert.equal(s.players[1].plays,0);s.close();
});
test('新平台数据确认第一个确已完成时才允许跳过它',async()=>{
  const s=serialScene({attachments:[{...video,isPassed:true},secondVideo]});await s.start();await s.children[1].tick(200);assert.equal(s.chapter.requests.length,1);assert.equal(s.players[0].plays,0);assert.equal(s.players[1].plays,1);s.close();
});
test('当前播放器身份变得无法识别时撤销原授权，不让它继续播放其他内容',async()=>{
  const s=serialScene({attachments:[video,secondVideo]});await s.start();s.chapter.w.document.querySelector('#v1').setAttribute('data','{"objectid":"unknown"}');await s.chapter.tick(1);assert.equal(s.players[0].el.paused,true);assert.equal(s.players[1].plays,0);s.close();
});
test('播放请求尚未返回时更换绑定，仍保留旧许可直到旧播放停止',async()=>{
  const store=new Map(),a=setup({store,id:'a',path:'/ananas/modules/video/index.html',html:'<video></video>'}),b=setup({store,id:'b',path:'/ananas/modules/audio/index.html',html:'<audio></audio>'}),pa=player(a),pb=player(b),queueScope='edgeStudy.v1.task.audit-queue';let finish;const original=pa.el.play;pa.el.play=()=>new Promise(resolve=>{finish=async()=>{await original();resolve();};});
  a.runtime.handleRoute();b.runtime.handleRoute();await a.bind('edgeStudy.v1.task.old',true,{queueScope});await a.tick(200);await a.bind('edgeStudy.v1.task.replacement',false,{queueScope});await b.bind('edgeStudy.v1.task.next',true,{queueScope});await b.tick(200);assert.equal(pb.plays,0);await finish();await a.tick(1);assert.equal(pa.el.paused,true);await b.bind('edgeStudy.v1.task.next',true,{queueScope});await b.tick(200);assert.equal(pb.plays,1);a.close();b.close();
});
test('新任务绑定不继承旧任务的自动播放失败与重试等待',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'}),p=player(s,{blocked:true});s.runtime.handleRoute();await s.bind('edgeStudy.v1.task.old');await s.tick(200);assert.equal(p.plays,1);p.unblock();await s.bind('edgeStudy.v1.task.new');await s.tick(200);assert.equal(p.plays,2);assert.equal(p.el.paused,false);s.close();
});
test('替换播放器后旧节点迟到的 ended 事件不能污染当前播放状态',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'}),old=player(s);s.runtime.handleRoute();await s.bind();await s.tick(200);old.el.remove();s.w.document.body.innerHTML='<video></video>';const current=player(s);await s.tick(1);assert.equal(current.plays,1);old.end();assert.equal(s.store.get('edgeStudy.v1.media.edgeStudy.v1.task.test').phase,'playing');assert.equal(current.el.paused,false);s.close();
});
test('缺少 jobid 的两个文档仍按媒体对象分别核对完成状态',async()=>{
  const one={...documentJob,jobid:undefined,property:{objectid:'doc-one',name:'第一份'}},two={...documentJob,jobid:undefined,property:{objectid:'doc-two',name:'第二份'}},data={defaults,attachments:[one,two]};
  const s=setup({data,response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[one,{...two,isPassed:true}]})}</script>`})});s.runtime.handleRoute();const pending=s.runtime.verifyChapter();await s.tick(10);await pending;assert.equal(s.runtime.tasks()[0].done,false);assert.equal(s.runtime.tasks()[1].done,true);s.close();
});
test('稳定状态心跳限频，但冻结等状态变化仍立即更新',async()=>{
  const s=setup({path:'/mycourse/studentstudy'});s.runtime.handleRoute();await s.tick(20000);const writes=s.writes.filter(x=>x.key==='edgeStudy.v1.heart.runtime');assert.ok(writes.length<=6);assert.ok(s.store.get('edgeStudy.v1.heart.runtime').updatedAt>=1015000);s.w.document.dispatchEvent(new s.w.Event('freeze'));assert.equal(s.store.get('edgeStudy.v1.heart.runtime').phase,'frozen');s.close();
});
test('平台省略对象但保留唯一 jobid 的完成响应仍能兼容',async()=>{
  const s=setup({data:{defaults,attachments:[documentJob]},response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[{...documentJob,property:{name:'课件'},isPassed:true}]})}</script>`})});s.runtime.handleRoute();const pending=s.runtime.verifyChapter();await s.tick(10);await pending;assert.equal(s.runtime.tasks()[0].done,true);s.close();
});
test('两个文档复用 jobid 时仍按对象区分，不能互相覆盖完成状态',async()=>{
  const one={...documentJob,property:{objectid:'one'}},two={...documentJob,property:{objectid:'two'}},s=setup({data:{defaults,attachments:[one,two]},response:r=>r.onload({status:200,responseText:`<script data-fixture>${JSON.stringify({defaults,attachments:[one,{...two,isPassed:true}]})}</script>`})});s.runtime.handleRoute();const pending=s.runtime.verifyChapter();await s.tick(10);await pending;assert.equal(s.runtime.tasks()[0].done,false);assert.equal(s.runtime.tasks()[1].done,true);s.close();
});
test('页面关闭后迟到的播放请求不会执行待处理的新绑定',async()=>{
  const s=setup({path:'/ananas/modules/video/index.html',html:'<video></video>'}),p=player(s),queueScope='edgeStudy.v1.task.close-queue';let finish;const original=p.el.play;p.el.play=()=>new Promise(resolve=>{finish=async()=>{await original();resolve();};});s.runtime.handleRoute();await s.bind('edgeStudy.v1.task.old',true,{queueScope});await s.tick(200);await s.bind('edgeStudy.v1.task.new',true,{queueScope});s.runtime.dispose();await finish();await s.tick(200);assert.equal(p.el.paused,true);assert.equal(s.runtime.core.owns(queueScope),false);assert.equal(s.store.get('edgeStudy.v1.heart.runtime').phase,'closed');assert.equal(s.store.has('edgeStudy.v1.task.new'),false);s.close();
});
test('最外层总控的手动答题命令逐层传给当前试题 iframe',()=>{
  let runs=0;const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe>'}),chapter=setup({html:'<iframe src="/work/phone/doHomeWork?workId=1"></iframe>'}),quiz=setup({path:'/work/phone/doHomeWork?workId=1',html:'<div>题目</div>',ai:{run:async()=>runs++}});wire(main,chapter);wire(chapter,quiz);quiz.runtime.handleRoute();chapter.runtime.handleRoute();main.runtime.handleRoute();runs=0;assert.equal(main.runtime.requestAI(),true);assert.equal(runs,1);main.close();chapter.close();quiz.close();
});
test('手动答题命令拒绝未知来源，并遵守全局暂停',()=>{
  let runs=0;const s=setup({path:'/work/phone/doHomeWork',ai:{run:async()=>runs++}});s.runtime.handleRoute();runs=0;const send=(origin,source)=>s.w.dispatchEvent(new s.w.MessageEvent('message',{origin,source,data:{type:'edgeStudy.ui.ai.v1',action:'run'}}));send('https://evil.example',s.w.parent);send(s.w.location.origin,{});assert.equal(runs,0);send(s.w.location.origin,s.w.parent);assert.equal(runs,1);s.setValue('personalCourse.paused',true);send(s.w.location.origin,s.w.parent);assert.equal(runs,1);s.close();
});
test('试题状态汇总到最外层总控，其他 iframe 的伪造状态被忽略',()=>{
  const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe>'}),chapter=setup({html:'<iframe id="quiz" src="/work/phone/doHomeWork"></iframe><iframe id="other" src="/unknown"></iframe>'}),quiz=setup({path:'/work/phone/doHomeWork'});wire(main,chapter);wire(chapter,quiz,'#quiz');quiz.runtime.handleRoute();chapter.runtime.handleRoute();main.runtime.handleRoute();quiz.runtime.aiStatus('正在解答第 1/2 题');assert.ok(main.notes.some(x=>x.includes('正在解答第 1/2 题')));const length=main.notes.length;chapter.w.dispatchEvent(new chapter.w.MessageEvent('message',{origin:chapter.w.location.origin,source:chapter.w.document.querySelector('#other').contentWindow,data:{type:'edgeStudy.quiz.status.v1',message:'伪造'}}));assert.equal(main.notes.length,length);main.close();chapter.close();quiz.close();
});

test('新版测验经作业容器及重定向 API iframe 转发命令和状态',()=>{
  let runs=0;
  const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/mooc-ans/knowledge/cards?knowledgeid=chapter"></iframe>'}),chapter=setup({html:'<iframe src="/ananas/modules/work/index.html"></iframe>'}),host=setup({path:'/ananas/modules/work/index.html',html:'<iframe id="frame_content" src="/mooc-ans/api/work?workId=1"></iframe><iframe id="other" src="/unknown"></iframe>'}),quiz=setup({path:'/mooc-ans/work/doHomeWorkNew',ai:{run:async()=>runs++}});
  wire(main,chapter);wire(chapter,host);wire(host,quiz,'#frame_content');
  assert.equal(quiz.runtime.handleRoute(),true);assert.equal(runs,1);assert.equal(host.runtime.handleRoute(),true);chapter.runtime.handleRoute();main.runtime.handleRoute();
  assert.equal(main.runtime.requestAI(),true);assert.equal(runs,2);quiz.runtime.aiStatus('已完成新版题目');assert.ok(main.notes.some(x=>x.includes('已完成新版题目')));
  const length=main.notes.length;host.w.dispatchEvent(new host.w.MessageEvent('message',{origin:host.w.location.origin,source:host.w.document.querySelector('#other').contentWindow,data:{type:'edgeStudy.quiz.status.v1',message:'伪造'}}));assert.equal(main.notes.length,length);
  main.close();chapter.close();host.close();quiz.close();
});

test('新版独立测验默认启动，暂停或关闭自动答题时不自动启动',()=>{
  for(const values of [{},{'personalCourse.paused':true},{unrivaldowork:'0'}]){
    let runs=0;const s=setup({path:'/mooc-ans/work/doHomeWorkNew',values,ai:{run:async()=>runs++}});assert.equal(s.runtime.handleRoute(),true);assert.equal(runs,Object.keys(values).length?0:1);s.close();
  }
});

test('提交通知逐层转发后等待十秒复核，不能直接标记完成或切章',async()=>{
  const work={job:true,jobid:'work1',type:'workid',property:{name:'章节测试'},isPassed:false};
  const chapter=setup({html:'<iframe src="/ananas/modules/work/index.html"></iframe><iframe id="other" src="/unknown"></iframe>',data:{defaults,attachments:[work]}}),host=setup({path:'/ananas/modules/work/index.html',html:'<iframe src="/mooc-ans/api/work"></iframe>'}),quiz=setup({path:'/mooc-ans/work/doHomeWorkNew'});
  wire(chapter,host);wire(host,quiz);quiz.runtime.handleRoute();host.runtime.handleRoute();chapter.runtime.handleRoute();quiz.runtime.quizSubmitted();quiz.runtime.quizSubmitted();assert.equal(chapter.runtime.tasks()[0].done,false);await chapter.tick(9999);assert.equal(chapter.requests.length,0);await chapter.tick(10);assert.equal(chapter.requests.length,1);assert.equal(chapter.runtime.tasks()[0].done,false);
  const before=chapter.requests.length;chapter.w.dispatchEvent(new chapter.w.MessageEvent('message',{origin:chapter.w.location.origin,source:chapter.w.document.querySelector('#other').contentWindow,data:{type:'edgeStudy.quiz.submitted.v1'}}));await chapter.tick(10010);assert.equal(chapter.requests.length,before);chapter.close();host.close();quiz.close();
});

test('新版批阅结果页走统一路由，不再落入旧处理分支或重新答题',()=>{
  let calls=0;const s=setup({path:'/mooc-ans/work/selectWorkQuestionYiPiYueNew',html:'<div class="TiMu">平台结果</div>',ai:{run:async()=>calls++}});assert.equal(s.runtime.handleRoute(),true);assert.equal(calls,0);assert.ok(s.notes.some(x=>x.includes('提交结果/批阅页')));s.runtime.resume();assert.equal(calls,0);s.close();
});

function recoveryScene({checked=false,activity={},values={},modal=false}={}){
  let refreshes=0,next=0,s,send,current={activity,progress:'initial'};
  s=setup({path:'/mycourse/studentstudy',values,html:`<iframe src="/knowledge/cards?courseid=c&clazzid=g&knowledgeid=chapter"></iframe><div id="curother"><span class="icon_Completed"></span></div><div id="curchapter"><span class="posCatalog_name" title="当前节"></span>${checked?'<span class="icon_Completed"></span>':'<span class="icon">0</span>'}</div><button class="prev_next next">下一节</button>${modal?'<div id="workpop">确认提交？<button>提交</button></div>':''}`,
    reloadChapter:frame=>{refreshes++;frame.dispatchEvent(new s.w.Event('load'));send();}});
  const frame=s.w.document.querySelector('iframe');
  send=(patch={})=>{current={...current,...patch};s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:s.w.location.origin,source:frame.contentWindow,data:{type:'edgeStudy.chapter.status.v1',chapter:'chapter',card:'0',phase:'waiting',tasks:[{type:'work',name:'已提交但旧状态仍等待',done:false}],...current}}));};
  s.w.document.querySelector('button.next').onclick=()=>{next++;frame.src='/knowledge/cards?courseid=c&clazzid=g&knowledgeid=next';};s.runtime.handleRoute();send();
  return{...s,frame,send,count:()=>({refreshes,next})};
}
test('当前目录对钩可替代滞后的任务数组，十秒后切章且不刷新',async()=>{
  const s=recoveryScene({checked:true});await s.tick(9999);assert.deepEqual(s.count(),{refreshes:0,next:0});await s.tick(1);assert.deepEqual(s.count(),{refreshes:0,next:1});assert.ok(s.notes.some(x=>x.includes('目录对钩')));s.close();
});
test('无进展十秒刷新一次，本章累计两次后跳过，不冒充完成',async()=>{
  const s=recoveryScene();await s.tick(9999);assert.equal(s.count().refreshes,0);await s.tick(1);assert.equal(s.count().refreshes,1);await s.tick(10000);assert.equal(s.count().refreshes,2);assert.equal(s.count().next,0);await s.tick(10000);assert.deepEqual(s.count(),{refreshes:2,next:1});const key=s.w.sessionStorage.key(0),saved=JSON.parse(s.w.sessionStorage.getItem(key));assert.equal(saved.skipped,true);assert.equal(saved.completed,undefined);assert.ok(s.notes.some(x=>x.includes('未标记为平台已完成')));s.close();
});
test('模型请求或提交仍在活动时不刷新，结束后重新计算停滞十秒',async()=>{
  const s=recoveryScene({activity:{aiBusy:true}});await s.tick(40000);assert.equal(s.count().refreshes,0);s.send({activity:{aiBusy:false}});await s.tick(9999);assert.equal(s.count().refreshes,0);await s.tick(1);assert.equal(s.count().refreshes,1);s.close();
});
test('目录即使打钩，前一个媒体尚未实际结束仍不能切章或刷新',async()=>{
  const s=recoveryScene({checked:true,activity:{mediaPending:true}});await s.tick(40000);assert.deepEqual(s.count(),{refreshes:0,next:0});s.send({activity:{mediaPending:false}});await s.tick(1000);assert.deepEqual(s.count(),{refreshes:0,next:1});s.close();
});
test('文档或答题进展持续发生时不刷新，相同心跳不能掩盖停滞',async()=>{
  const s=recoveryScene();await s.tick(9000);s.send({progress:'page2'});await s.tick(9000);s.send({progress:'page3'});await s.tick(9000);s.send({progress:'page3'});assert.equal(s.count().refreshes,0);await s.tick(1000);assert.equal(s.count().refreshes,1);s.close();
});
test('暂停、离线、关闭自动切章或平台阻断时不触发恢复',async()=>{
  for(const option of [{values:{'personalCourse.paused':true}},{values:{'personalCourse.jump':false}},{activity:{blocked:true}}]){const s=recoveryScene(option);await s.tick(40000);assert.deepEqual(s.count(),{refreshes:0,next:0});s.close();}
  const s=recoveryScene();Object.defineProperty(s.w.navigator,'onLine',{value:false});await s.tick(40000);assert.equal(s.count().refreshes,0);s.close();
});
test('提交确认窗口仍在显示时不刷新或跳过，关闭后再等十秒',async()=>{
  const s=recoveryScene({modal:true});await s.tick(40000);assert.equal(s.count().refreshes,0);s.w.document.querySelector('#workpop').hidden=true;await s.tick(9999);assert.equal(s.count().refreshes,0);await s.tick(1);assert.equal(s.count().refreshes,1);s.close();
});
test('题目活动及输入修改可经作业容器同步到父页，伪造来源不影响恢复',async()=>{
  const main=setup({path:'/mycourse/studentstudy',html:'<iframe src="/knowledge/cards?knowledgeid=chapter"></iframe>'}),chapter=setup({html:'<iframe src="/ananas/modules/work/index.html"></iframe>',data:{defaults,attachments:[]}}),host=setup({path:'/ananas/modules/work/index.html',html:'<iframe src="/mooc-ans/api/work"></iframe>'}),quiz=setup({path:'/mooc-ans/work/doHomeWorkNew',html:'<input><div class="TiMu">问题</div><div class="blankItemDiv"><iframe id="ueditor_sample"></iframe></div>'});
  wire(main,chapter);wire(chapter,host);wire(host,quiz);quiz.runtime.handleRoute();host.runtime.handleRoute();chapter.runtime.handleRoute();main.runtime.handleRoute();quiz.runtime.aiActivity(true);const first=main.notes.length;quiz.w.document.querySelector('input').dispatchEvent(new quiz.w.Event('input',{bubbles:true}));assert.ok(main.notes.length>first);quiz.runtime.aiActivity(false);const beforeEditor=main.notes.length,editorDoc=quiz.w.document.querySelector('#ueditor_sample').contentDocument;editorDoc.body.dispatchEvent(new editorDoc.defaultView.Event('input',{bubbles:true}));assert.ok(main.notes.length>beforeEditor);assert.equal(chapter.runtime.tasks().length,0);main.close();chapter.close();host.close();quiz.close();
});
