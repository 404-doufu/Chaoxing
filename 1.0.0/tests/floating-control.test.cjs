const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const code=fs.readFileSync('src/page-adapter.js','utf8')+'\n'+fs.readFileSync('src/floating-control.js','utf8');
function setup({path='/mycourse/studentstudy',embedded=false,values:initial={}}={}){
  const dom=new JSDOM('<body><div id="native">原课程页面</div></body>',{url:'https://mooc1.chaoxing.com'+path}),w=dom.window,values=new Map(Object.entries(initial)),roots=[],actions=[],timers=new Set();let count=0,status='等待任务',control;
  if(embedded)Object.defineProperty(w,'parent',{value:{}});
  const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(options){const root=attach.call(this,options);roots.push(root);return root;};
  const factory=vm.runInNewContext(code+'\ncreateFloatingControl',{setInterval:fn=>{timers.add(++count);return count;},clearInterval:id=>timers.delete(id),Date});
  const env={win:w,doc:w.document,getValue:(k,d)=>values.has(k)?values.get(k):d,setValue:(k,v)=>values.set(k,v),enabled:name=>values.get('personalCourse.'+name)??true,isPaused:()=>values.get('personalCourse.paused')??false,setPaused:value=>values.set('personalCourse.paused',value),status:()=>status,note:value=>{status=value;control?.render();},tasks:()=>[{type:'video',name:'第一个视频',running:true}],openAI:()=>{actions.push('api');control.settingsContainer();},runAI:value=>actions.push(value),stopAI:()=>actions.push('stop'),resume:()=>actions.push('resume')};
  control=factory(env);return{w,dom,values,roots,actions,timers,control,factory,env,root:()=>roots.find(r=>r.host.id==='personal-course-control'),close:()=>{control.dispose();w.close();}};
}
function pointer(w,target,type,x,y){target.dispatchEvent(new w.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y}));}
test('课程打开后只有一个总控，多次 install/mount 或重复实例都不增加窗口',()=>{
  const s=setup();s.control.install();s.control.install();s.control.mount();const another=s.factory(s.env);another.install();assert.equal(s.w.document.querySelectorAll('#personal-course-control').length,1);assert.equal(s.timers.size,1);assert.equal(s.w.document.querySelector('#personal-course-control').shadowRoot,null);another.dispose();s.close();
});

test('未设置过时默认勾选自动提交，但保留用户明确关闭的设置',()=>{
  for(const [values,expected] of [[{},true],[{unrivalautosubmit:'0'},false]]){const s=setup({values});s.control.install();assert.equal(s.root().querySelector('#submit').checked,expected);s.close();}
});
test('章节、视频和测试子 iframe 不生成总控',()=>{
  for(const path of ['/knowledge/cards','/ananas/modules/video/index.html','/work/phone/doHomeWork']){const s=setup({path,embedded:true});s.control.install();s.control.mount();assert.equal(s.roots.length,0,path);assert.equal(s.timers.size,0);s.close();}
});
test('非课程界面不生成浮窗，独立打开的章节和测试页仍只有一份',()=>{
  const outside=setup({path:'/visit/interaction'});outside.control.install();assert.equal(outside.roots.length,0);outside.close();for(const path of ['/knowledge/cards','/work/phone/doHomeWork']){const s=setup({path});s.control.install();assert.equal(s.roots.length,1);s.close();}
});
test('拖动标题条可移动浮窗，松开后保存位置，重新打开时恢复',()=>{
  const s=setup();s.control.install();const root=s.root(),handle=root.querySelector('#dragHandle'),host=root.host;pointer(s.w,handle,'pointerdown',20,30);pointer(s.w,s.w,'pointermove',180,130);pointer(s.w,s.w,'pointerup',180,130);assert.equal(host.style.left,'176px');assert.equal(host.style.top,'124px');const saved=s.values.get('personalCourse.panelPosition.v1');assert.deepEqual({...saved},{x:176,y:124});s.close();const reopened=setup({values:{'personalCourse.panelPosition.v1':saved}});reopened.control.install();assert.equal(reopened.root().host.style.left,'176px');reopened.close();
});
test('按钮点击不会触发拖动，收起后仍保留唯一标题条并可展开',()=>{
  const s=setup();s.control.install();const r=s.root();pointer(s.w,r.querySelector('#collapse'),'pointerdown',10,10);pointer(s.w,s.w,'pointermove',400,400);pointer(s.w,s.w,'pointerup',400,400);assert.equal(s.values.has('personalCourse.panelPosition.v1'),false);r.querySelector('#collapse').click();assert.equal(r.querySelector('#body').hidden,true);r.querySelector('#collapse').click();assert.equal(r.querySelector('#body').hidden,false);assert.equal(s.w.document.querySelectorAll('#personal-course-control').length,1);s.close();
});
test('保存位置超出屏幕时自动约束，缩小窗口后仍可找到浮窗',()=>{
  const s=setup({values:{'personalCourse.panelPosition.v1':{x:99999,y:99999}}});s.control.install();Object.defineProperties(s.w,{innerWidth:{value:500,configurable:true},innerHeight:{value:400,configurable:true}});s.w.dispatchEvent(new s.w.Event('resize'));assert.ok(parseInt(s.root().host.style.left)<=140);assert.ok(parseInt(s.root().host.style.top)<=16);s.close();
});
test('标题条支持方向键移动并记住位置',()=>{
  const s=setup();s.control.install();s.root().querySelector('#dragHandle').dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(s.values.get('personalCourse.panelPosition.v1').x,26);s.close();
});
test('原课程开关、倍速、暂停继续和答题入口集中到浮窗',()=>{
  const s=setup();s.control.install();const r=s.root();r.querySelector('#video').click();assert.equal(s.values.get('personalCourse.video'),false);r.querySelector('#submit').click();assert.equal(s.values.get('unrivalautosubmit'),'0');r.querySelector('#rate').value='1.5';r.querySelector('#saveRate').click();assert.equal(s.values.get('unrivalrate'),'1.5');r.querySelector('#pause').click();assert.equal(s.values.get('personalCourse.paused'),true);r.querySelector('#resume').click();assert.equal(s.values.get('personalCourse.paused'),false);r.querySelector('#runAI').click();r.querySelector('#stopAI').click();assert.deepEqual(s.actions,['resume','run','stop']);s.close();
});
test('API 入口切换同一浮窗的内容，不创建第二个窗口',()=>{
  const s=setup();s.control.install();const r=s.root();r.querySelector('#api').click();assert.equal(r.querySelector('#controls').hidden,true);assert.equal(r.querySelector('#settings').hidden,false);r.querySelector('#controlTab').click();assert.equal(r.querySelector('#controls').hidden,false);assert.equal(s.w.document.querySelectorAll('#personal-course-control').length,1);s.close();
});
test('支持 Popover 时进入 top layer，失败时回退最高 z-index',()=>{
  for(const throws of [false,true]){const s=setup();let calls=0;s.w.HTMLElement.prototype.showPopover=function(){calls++;if(throws)throw Error('unsupported');};s.control.install();assert.equal(calls,1);assert.equal(s.root().host.style.zIndex,'2147483647');assert.equal(s.root().host.hasAttribute('popover'),!throws);s.close();}
});
test('缓存页面隐藏保留浮窗，真正离开页面移除并清理计时器',()=>{
  const s=setup();s.control.install();s.w.dispatchEvent(new s.w.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(s.root().host.isConnected,true);s.w.dispatchEvent(new s.w.PageTransitionEvent('pagehide',{persisted:false}));assert.equal(s.root().host.isConnected,false);assert.equal(s.timers.size,0);s.close();
});
test('视口存在滚动条时也不把浮窗右侧放到可见区域之外',()=>{
  const s=setup({values:{'personalCourse.panelPosition.v1':{x:16,y:24}}});Object.defineProperty(s.w,'innerWidth',{value:380,configurable:true});Object.defineProperty(s.w.document.documentElement,'clientWidth',{value:365,configurable:true});s.control.install();s.root().host.getBoundingClientRect=()=>({width:360,height:500});s.w.dispatchEvent(new s.w.Event('resize'));assert.equal(s.root().host.style.left,'5px');s.close();
});
