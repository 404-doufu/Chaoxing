const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const factory=vm.runInNewContext(fs.readFileSync('src/page-adapter.js','utf8')+'\n'+fs.readFileSync('src/quiz-actions.js','utf8')+'\ncreateQuizActions',{URL});
const summary={total:2,filled:2,existing:0,skipped:0,failed:0,ratio:100,cancelled:false};
function setup({values={},html='<div id="RightCon"><a class="btnSubmit" role="button">提交</a><a class="btnSave" role="button">暂时保存</a><div id="confirmSubWin" style="display:none">确认提交？<a onclick="submitCheckTimes();">确定</a><a>取消</a></div><div id="verifyCodeWin" style="display:none">验证码</div><span class="workStatus">待完成</span></div>',path='/mooc-ans/work/doHomeWorkNew'}={}){
  const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com'+path}),w=dom.window,doc=w.document,timers=new Map(),reports=[];let sequence=0,now=0,starts=0,confirms=0,saves=0,notices=0,ready=true,paused=false;
  w.setTimeout=(fn,ms)=>{timers.set(++sequence,{fn,at:now+ms});return sequence;};w.clearTimeout=id=>timers.delete(id);
  doc.querySelector('.btnSubmit')?.addEventListener('click',()=>{starts++;doc.querySelector('#confirmSubWin').style.display='block';});
  doc.querySelector('.btnSave')?.addEventListener('click',()=>saves++);
  doc.querySelector('#confirmSubWin a')?.addEventListener('click',()=>{confirms++;doc.querySelector('#confirmSubWin').style.display='none';doc.querySelector('.workStatus').textContent='已提交';});
  const helper=factory({win:w,doc,getValue:(k,d)=>values[k]??d,paused:()=>paused,onDispatch:()=>notices++}),controller=new AbortController(),context={report:x=>reports.push(x),canSubmit:()=>ready};
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  return {helper,w,doc,dom,values,controller,context,reports,count:()=>({starts,confirms,saves,notices}),ready:v=>ready=v,pause:v=>paused=v,
    run:s=>helper.complete({...summary,...s},controller.signal,context),
    async tick(ms){const end=now+ms;await flush();for(let n=0;n<1000;n++){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;const[id,t]=entry;timers.delete(id);now=t.at;t.fn();await flush();}now=end;await flush();},close(){timers.clear();w.close();}};
}
test('默认开启提交：只点击原生提交与准确的确认框，平台确认后结束',async()=>{
  const s=setup(),p=s.run();await s.tick(250);await p;assert.deepEqual(s.count(),{starts:1,confirms:1,saves:0,notices:1});assert.ok(s.reports.includes('平台页面已确认提交'));s.close();
});
test('显式关闭提交保留选项，并提示重试可提交已有答案',async()=>{
  const s=setup({values:{unrivalautosubmit:'0'}});await s.run();assert.equal(s.count().starts,0);assert.ok(s.reports.some(x=>x.includes('自动提交已关闭')));s.close();
});
test('提交进行中或结束后再次答题不重复提交',async()=>{
  const s=setup(),p=s.run();await s.run();await s.tick(250);await p;await s.run();assert.equal(s.count().starts,1);assert.equal(s.count().confirms,1);s.close();
});
test('跳过、失败、无效阈值、选项不完整均不能提交',async()=>{
  for(const patch of [{skipped:1},{failed:1},{ratio:50},{cancelled:true},{total:0}]){const s=setup();await s.run(patch);assert.equal(s.count().starts,0);s.close();}
  const s=setup({values:{accuracy:'abc'}});await s.run();assert.equal(s.count().starts,0);s.close();const t=setup();t.ready(false);await t.run();assert.equal(t.count().starts,0);t.close();
});
test('等待确认期间关闭开关或改动答案时不会确认提交',async()=>{
  for(const change of [s=>s.values.unrivalautosubmit='0',s=>s.ready(false)]){
    const s=setup();s.doc.querySelector('.btnSubmit').replaceWith(s.doc.querySelector('.btnSubmit').cloneNode(true));s.doc.querySelector('.btnSubmit').onclick=()=>{};
    const p=s.run();change(s);s.doc.querySelector('#confirmSubWin').style.display='block';await s.tick(250);await p;assert.equal(s.count().confirms,0);s.close();
  }
});
test('停止与暂停阻止确认，迟到确认窗不再操作',async()=>{
  const s=setup();s.doc.querySelector('.btnSubmit').replaceWith(s.doc.querySelector('.btnSubmit').cloneNode(true));const p=s.run();s.controller.abort();await assert.rejects(p,{name:'AbortError'});s.doc.querySelector('#confirmSubWin').style.display='block';await s.tick(1000);assert.equal(s.count().confirms,0);s.close();
  const t=setup();t.pause(true);await assert.rejects(t.run(),{name:'AbortError'});assert.equal(t.count().starts,0);t.close();
});
test('验证码窗口由人工处理，不确认、不绕过',async()=>{
  const s=setup();s.doc.querySelector('#verifyCodeWin').style.display='block';await s.run();assert.equal(s.count().confirms,0);assert.ok(s.reports.some(x=>x.includes('验证码')));s.close();
});
test('原生校验未返回确认窗时超时停止，后续重试不重复点击',async()=>{
  const s=setup();s.doc.querySelector('.btnSubmit').replaceWith(s.doc.querySelector('.btnSubmit').cloneNode(true));let clicks=0;s.doc.querySelector('.btnSubmit').onclick=()=>clicks++;const p=s.run();await s.tick(15000);await p;await s.run();assert.equal(clicks,1);assert.equal(s.count().confirms,0);assert.ok(s.reports.some(x=>x.includes('未返回可识别确认窗')));s.close();
});
test('保存仍使用独立原生入口，不等同提交；部分答题可保存草稿',async()=>{
  for(const values of [{unrivalautosubmit:'0',unrivalautosave:'1'},{unrivalautosubmit:'1',unrivalautosave:'1'}]){const s=setup({values});await s.run({skipped:values.unrivalautosubmit==='1'?1:0});assert.equal(s.count().saves,1);assert.equal(s.count().confirms,0);s.close();}
});
test('新版缺失按钮不能猜测或绕过入口调用最终函数',async()=>{
  const s=setup({html:'<div></div>'});let bypass=0;s.w.submitAction=()=>bypass++;s.w.submitCheckTimes=()=>bypass++;await assert.rejects(s.run(),/未找到/);assert.equal(bypass,0);s.close();
});
test('旧版只调用原生校验，绝不串调最终提交绕过异步检查',async()=>{
  const s=setup({html:'<div></div>',path:'/work/phone/doHomeWork'}),calls=[];s.w.submitCheckTimes=()=>calls.push('check');s.w.escapeBlank=()=>calls.push('blank');s.w.submitAction=()=>calls.push('submit');await s.run();assert.deepEqual(calls,['check']);s.close();
});

const workpop=fs.readFileSync('tests/fixtures/workpop.html','utf8');
function topScene(child){
  const parent=new JSDOM(workpop,{url:'https://mooc1.chaoxing.com/mycourse/studentstudy'}),top=parent.window;
  Object.defineProperty(child.w,'parent',{value:top});
  const entry=child.doc.querySelector('.btnSubmit');entry.replaceWith(entry.cloneNode(true));
  return{parent,top,pop:top.document.querySelector('#workpop'),ok:top.document.querySelector('#popok')};
}
test('实际三级 iframe 的顶层 workpop 提交按钮可以确认，且不重复点击',async()=>{
  const s=setup(),t=topScene(s);let starts=0,final=0;
  // 增加一层作业容器，确认查找可跨越整个同源父链。
  const middle=new JSDOM('',{url:'https://mooc1.chaoxing.com/ananas/modules/work/index.html'});Object.defineProperty(middle.window,'parent',{value:t.top});Object.defineProperty(s.w,'parent',{value:middle.window});
  s.doc.querySelector('.btnSubmit').onclick=()=>{starts++;t.pop.hidden=false;};t.ok.onclick=()=>{final++;t.pop.hidden=true;s.doc.querySelector('.workStatus').textContent='已提交';};
  const p=s.run();await s.tick(500);await p;await s.run();assert.equal(starts,1);assert.equal(final,1);assert.equal(s.count().notices,1);assert.equal(t.top.document.documentElement.hasAttribute('data-personal-quiz-submit-owner'),false);s.close();middle.window.close();t.top.close();
});
test('旧本页确定之后还有新版顶层提交，两步都按序确认',async()=>{
  const s=setup(),t=topScene(s);let first=0,second=0;
  s.doc.querySelector('.btnSubmit').onclick=()=>s.doc.querySelector('#confirmSubWin').style.display='block';
  const old=s.doc.querySelector('#confirmSubWin a');old.replaceWith(old.cloneNode(true));s.doc.querySelector('#confirmSubWin a').onclick=()=>{first++;s.doc.querySelector('#confirmSubWin').style.display='none';t.pop.hidden=false;};
  t.ok.onclick=()=>{second++;t.pop.hidden=true;s.doc.querySelector('.workStatus').textContent='已提交';};
  const p=s.run();await s.tick(750);await p;assert.equal(first,1);assert.equal(second,1);assert.equal(s.count().notices,2);s.close();t.top.close();
});
test('同一顶层窗口的两份测验排队，不互相确认另一份的提交',async()=>{
  const a=setup(),b=setup(),t=topScene(a);Object.defineProperty(b.w,'parent',{value:t.top});const old=b.doc.querySelector('.btnSubmit');old.replaceWith(old.cloneNode(true));let owner='',aDone=0,bDone=0;
  for(const [id,s] of [['a',a],['b',b]])s.doc.querySelector('.btnSubmit').onclick=()=>{owner=id;t.pop.hidden=false;t.ok.onclick=()=>{if(id==='a')aDone++;else bDone++;t.pop.hidden=true;s.doc.querySelector('.workStatus').textContent='已提交';};};
  const p=a.run(),q=b.run();assert.equal(owner,'a');assert.equal(bDone,0);await a.tick(250);await p;await b.tick(500);await q;assert.equal(aDone,1);assert.equal(bDone,1);assert.ok(b.reports.some(x=>x.includes('排队等待')));a.close();b.close();t.top.close();
});
test('顶层窗口已存在或确认后未关闭时不重复发送/连点',async()=>{
  const s=setup(),t=topScene(s);t.pop.hidden=false;await s.run();assert.ok(s.reports.some(x=>x.includes('页面已有提交确认窗口')));assert.equal(s.count().notices,0);s.close();t.top.close();
  const a=setup(),u=topScene(a);let clicks=0;a.doc.querySelector('.btnSubmit').onclick=()=>u.pop.hidden=false;u.ok.onclick=()=>clicks++;const p=a.run();await a.tick(15000);await p;assert.equal(clicks,1);a.close();u.top.close();
});

test('确认按钮被页面重新渲染时，同一个弹窗不会再确认',async()=>{
  const s=setup(),t=topScene(s);let clicks=0;s.doc.querySelector('.btnSubmit').onclick=()=>t.pop.hidden=false;
  const handler=()=>{clicks++;const old=t.top.document.querySelector('#popok'),copy=old.cloneNode(true);copy.onclick=handler;old.replaceWith(copy);};t.ok.onclick=handler;
  const p=s.run();await s.tick(15000);await p;assert.equal(clicks,1);s.close();t.top.close();
});
