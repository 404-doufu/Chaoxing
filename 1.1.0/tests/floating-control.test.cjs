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

function motionHarness(s, reduce = false) {
  const frames=new Map(),animations=[];let next=0;
  s.w.requestAnimationFrame=callback=>{frames.set(++next,callback);return next;};
  s.w.cancelAnimationFrame=id=>frames.delete(id);
  s.w.Element.prototype.animate=function(keyframes,options){
    let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const animation={element:this,keyframes,options,finished,cancelled:false,finish:resolve,cancel(){this.cancelled=true;reject(Error('cancelled'));}};
    animations.push(animation);return animation;
  };
  // 在构造控制器前替换媒体偏好；默认的 setup 实例尚未 mount。
  s.w.matchMedia=()=>({matches:reduce});s.env.openAI=()=>{s.actions.push('api');s.control.settingsContainer();};s.control=s.factory(s.env);
  s.control.install();const r=s.root(),body=r.querySelector('#body'),views=r.querySelector('#views'),inner=r.querySelector('#bodyInner');
  const viewHeight=()=>views.style.height ? parseFloat(views.style.height) : !r.querySelector('#settings').hidden&&!r.querySelector('#settings').classList.contains('leaving') ? (r.querySelector('#settings').textContent ? 700 : 0) : 400;
  views.getBoundingClientRect=()=>({height:viewHeight()});inner.getBoundingClientRect=()=>({height:80+viewHeight()});
  body.getBoundingClientRect=()=>({height:body.hidden?0:body.style.height?parseFloat(body.style.height):80+viewHeight()});
  return {r,body,views,inner,frames,animations,frame(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());},async finish(){animations.findLast(x=>x.element===body&&!x.cancelled)?.finish();await Promise.resolve();await Promise.resolve();},close(){s.control.dispose();s.close();}};
}

test('收起后才隐藏内容，展开有小幅回弹且边界内裁切，结束恢复自然高度',async()=>{
  const s=setup(),m=motionHarness(s);m.r.querySelector('#collapse').click();
  assert.equal(m.body.hidden,false);assert.equal(m.body.inert,true);assert.equal(m.r.querySelector('#collapse').getAttribute('aria-expanded'),'false');m.frame();
  assert.equal(m.animations[0].keyframes[0].height,'480px');assert.equal(m.animations[0].keyframes.at(-1).height,'0px');assert.ok(m.animations[0].keyframes.every(x=>parseFloat(x.height)>=0));
  assert.equal(m.body.contains(m.views),true);assert.equal(m.r.querySelector('#settings').parentElement,m.views);
  await m.finish();assert.equal(m.body.hidden,true);assert.equal(m.body.style.height,'');
  m.r.querySelector('#collapse').click();m.frame();const opening=m.animations.at(-1);assert.equal(opening.keyframes[0].height,'0px');assert.equal(opening.keyframes.at(-1).height,'480px');
  const peak=Math.max(...opening.keyframes.map(x=>parseFloat(x.height)));assert.ok(peak>480&&peak<495);await m.finish();assert.equal(m.body.hidden,false);assert.equal(m.body.inert,false);assert.equal(m.body.hasAttribute('data-motion'),false);m.close();
});

test('API 延迟到下一帧测量，旧页退场不可点击，切回后清理叠层',async()=>{
  const s=setup(),m=motionHarness(s);m.r.querySelector('#api').click();m.r.querySelector('#settings').textContent='同步挂载的 API 表单';m.frame();
  assert.equal(m.animations.find(x=>x.element===m.body).keyframes.at(-1).height,'780px');assert.equal(m.r.querySelector('#controls').hidden,false);assert.equal(m.r.querySelector('#controls').inert,true);assert.equal(m.r.querySelector('#settings').inert,false);
  await m.finish();assert.equal(m.r.querySelector('#controls').hidden,true);assert.equal(m.views.style.height,'');
  m.r.querySelector('#controlTab').click();m.frame();await m.finish();assert.equal(m.r.querySelector('#controls').hidden,false);assert.equal(m.r.querySelector('#settings').hidden,true);assert.equal(m.r.querySelectorAll('.leaving').length,0);m.close();
});

test('快速反向操作从当前高度接续，旧回调不会隐藏新界面',async()=>{
  const s=setup(),m=motionHarness(s);m.r.querySelector('#collapse').click();m.frame();const old=m.animations[0];
  m.body.getBoundingClientRect=()=>({height:150});m.r.querySelector('#collapse').click();assert.equal(old.cancelled,true);m.frame();assert.equal(m.animations.at(-1).keyframes[0].height,'150px');old.finish();await Promise.resolve();assert.equal(m.body.hidden,false);await m.finish();assert.equal(m.body.hidden,false);
  m.r.querySelector('#api').click();m.r.querySelector('#controlTab').click();assert.equal(m.frames.size,1);m.frame();await m.finish();assert.equal(m.r.querySelector('#controls').hidden,false);assert.equal(m.r.querySelector('#settings').hidden,true);m.close();
});

test('减少动态效果时直接切换；离页或缩放时清理所有动画',async()=>{
  const reduced=setup(),r=motionHarness(reduced,true);r.r.querySelector('#collapse').click();assert.equal(r.body.hidden,true);assert.equal(r.frames.size,0);r.r.querySelector('#api').click();assert.equal(r.body.hidden,false);assert.equal(r.animations.length,0);r.close();
  const s=setup(),m=motionHarness(s);m.r.querySelector('#api').click();m.frame();s.w.dispatchEvent(new s.w.Event('resize'));assert.ok(m.animations.every(x=>x.cancelled));assert.equal(m.r.querySelector('#settings').hidden,false);assert.equal(m.body.style.height,'');
  m.r.querySelector('#collapse').click();assert.equal(m.frames.size,1);s.w.dispatchEvent(new s.w.PageTransitionEvent('pagehide',{persisted:false}));assert.equal(m.frames.size,0);assert.equal(m.r.host.isConnected,false);await Promise.resolve();m.close();
});
test('课程打开后只有一个总控，多次 install/mount 或重复实例都不增加窗口',()=>{
  const s=setup();s.control.install();s.control.install();s.control.mount();const another=s.factory(s.env);another.install();assert.equal(s.w.document.querySelectorAll('#personal-course-control').length,1);assert.equal(s.timers.size,1);assert.equal(s.w.document.querySelector('#personal-course-control').shadowRoot,null);another.dispose();s.close();
});

test('自动化选项从总控移除，状态仍可正常刷新',()=>{
  const s=setup();s.control.install();assert.equal(s.root().querySelector('input[type=checkbox]'),null);for(const name of ['video','document','jump','answer','submit','save'])assert.equal(s.root().querySelector('#'+name),null);s.control.render();assert.equal(s.root().querySelector('#state').textContent,'自动运行');s.close();
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
test('倍速、暂停继续和答题入口保留在精简浮窗',()=>{
  const s=setup();s.control.install();const r=s.root();r.querySelector('#rate').value='1.5';r.querySelector('#saveRate').click();assert.equal(s.values.get('unrivalrate'),'1.5');r.querySelector('#pause').click();assert.equal(s.values.get('personalCourse.paused'),true);s.control.render();assert.equal(r.querySelector('#state').getAttribute('data-paused'),'true');r.querySelector('#resume').click();assert.equal(s.values.get('personalCourse.paused'),false);r.querySelector('#runAI').click();r.querySelector('#stopAI').click();assert.deepEqual(s.actions,['resume','run','stop']);s.close();
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
