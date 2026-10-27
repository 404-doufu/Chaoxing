const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/study-core.js','utf8');
const factory=vm.runInNewContext(source+'\ncreateStudyCore',{setTimeout,clearTimeout,console});
function setup(extra={}){
  let time=1000000;const store=extra.store||new Map(),notifications=[],statuses=[];
  const env={id:'test-session',now:()=>time,getValue:(k,d)=>store.has(k)?store.get(k):d,setValue:(k,v)=>store.set(k,v),listValues:()=>[...store.keys()],notify:x=>notifications.push(x),status:x=>statuses.push(x),...extra};
  return{core:factory(env),store,notifications,statuses,advance:ms=>time+=ms};
}
const task={account:'user1',course:'course1',clazz:'class1',chapter:'ch1',job:'job1',object:'obj1'};

test('租约申请期间取消会立即释放自己的占位，不阻塞后续页面',async()=>{
  const s=setup(),controller=new AbortController(),resource=s.core.taskKey(task);const pending=s.core.claim(resource,controller.signal);assert.equal(s.core.owns(resource),true);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(s.core.owns(resource),false);
});
test('断点按账号、课程、班级、章节、任务及对象隔离',()=>{
  const{core}=setup();const key=core.taskKey(task);
  for(const field of Object.keys(task))assert.notEqual(core.taskKey({...task,[field]:'different'}),key);
});
test('持久断点只保存白名单字段，过滤凭据、URL、响应原文',()=>{
  const{core}=setup();const record=core.checkpoint(core.taskKey(task),{phase:'playing',observedPosition:12,apiKey:'secret',cookie:'secret',dtoken:'secret',url:'https://x/?token=secret',response:'secret'});
  assert.equal(record.observedPosition,12);assert.ok(!JSON.stringify(record).includes('secret'));assert.equal(record.platformComplete,false);
});
test('观察到的播放时间不视为平台完成，刷新可撤销旧的完成标记',()=>{
  const{core}=setup();const key=core.taskKey(task);
  core.checkpoint(key,{phase:'complete',platformComplete:true,observedPosition:100});
  assert.equal(core.checkpoint(key,{phase:'waiting',platformComplete:false}).platformComplete,false);
});
test('后台延迟十分钟不会凭空累计观察时间',()=>{
  const s=setup();const key=s.core.taskKey(task);s.core.checkpoint(key,{phase:'playing',observedPosition:10});s.advance(600000);
  assert.equal(s.core.checkpoint(key,{phase:'playing'}).observedPosition,10);
});
test('临时错误按次数退避重试，永久错误不重试',async()=>{
  const{core}=setup();let attempts=0;
  assert.equal(await core.run('r',async()=>{if(++attempts<3)throw Object.assign(new Error('temporary'),{status:503});return'ok';},{delays:[0,0]}),'ok');assert.equal(attempts,3);
  attempts=0;await assert.rejects(core.run('fatal',async()=>{attempts++;throw Object.assign(new Error('login'),{status:401,fatal:true});},{delays:[0,0]}),/login/);assert.equal(attempts,1);
});
test('重试达到上限后抛错且释放在途锁',async()=>{
  const{core}=setup();let attempts=0;await assert.rejects(core.run('r',async()=>{attempts++;throw Object.assign(new Error('network'),{retry:true});},{delays:[0,0]}));assert.equal(attempts,3);
  assert.equal(await core.run('r',async()=>42),42);
});
test('同一任务的并发调用复用一个请求',async()=>{
  const{core}=setup();let resolve,calls=0;const op=()=>{calls++;return new Promise(r=>resolve=r);};
  const a=core.run('one',op),b=core.run('one',op);assert.equal(a,b);await Promise.resolve();resolve(7);assert.equal(await a,7);assert.equal(calls,1);
});
test('重试等待可被停止，停止后不再发送请求',async()=>{
  const{core}=setup();const controller=new AbortController();let count=0;
  const p=core.run('stop',async()=>{count++;throw Object.assign(new Error('temporary'),{retry:true});},{signal:controller.signal,delays:[10000]});
  await Promise.resolve();await Promise.resolve();controller.abort();await assert.rejects(p,e=>e.name==='AbortError');assert.equal(count,1);
});
test('离线期间不发请求，恢复后继续',async()=>{
  let online=false;const{core}=setup({online:()=>online,timers:{setTimeout:fn=>setTimeout(()=>{online=true;fn();},1),clearTimeout}});let calls=0;
  assert.equal(await core.run('offline',async()=>{calls++;return'test';}),'test');assert.equal(calls,1);
});
test('租约阻止重复页面执行，过期后新页面可接管，旧页失去所有权',async()=>{
  const store=new Map(),a=setup({id:'page-a',store}),b=setup({id:'page-b',store});
  assert.equal(await a.core.claim('video'),true);assert.equal(await b.core.claim('video'),false);
  b.advance(120001);assert.equal(await b.core.claim('video'),true);assert.equal(a.core.owns('video'),false);a.core.release('video');assert.equal(b.core.owns('video'),true);
});
test('页面关闭只释放自己的租约',async()=>{
  const store=new Map(),a=setup({id:'a',store}),b=setup({id:'b',store});await a.core.claim('r');b.core.release('r');assert.equal(a.core.owns('r'),true);a.core.release('r');assert.equal(a.core.owns('r'),false);
});
test('后台监督仅扫描心跳，不读取 API 配置或生成网络请求',()=>{
  const s=setup();s.store.set('personalAI.config.v1',{apiKey:'secret'});s.core.heartbeat({role:'media',phase:'playing',lastProgressAt:1000000});
  const read=[];const spy=setup({store:s.store,getValue:(k,d)=>{read.push(k);return s.store.has(k)?s.store.get(k):d;}});spy.core.supervise();assert.ok(read.every(x=>x.startsWith('edgeStudy.v1.')));
});
test('心跳超时发送有期限的自检命令，重复检查不重复提醒',()=>{
  const s=setup();s.core.heartbeat({role:'media',phase:'playing'});s.advance(180001);
  assert.equal(s.core.supervise()[0].state,'stale');assert.equal(s.notifications.length,1);s.core.supervise();assert.equal(s.notifications.length,1);
  const command=s.store.get('edgeStudy.v1.command.test-session');assert.equal(command.action,'probe');assert.ok(command.expiresAt>1000000);assert.equal(command.url,undefined);assert.equal(command.action==='reload',false);
});
test('暂停或已完成的页面不按冻结报警，人工处理单独提醒',()=>{
  for(const phase of ['paused','complete','needs_user']){const s=setup();s.core.heartbeat({role:'chapter',phase});s.advance(180001);const row=s.core.supervise()[0];assert.notEqual(row.state,'stalled');if(phase!=='needs_user')assert.equal(s.notifications.length,0);}
});
test('播放心跳正常但播放位置三分钟没变化，判为卡住',()=>{
  const s=setup();s.advance(200000);s.core.heartbeat({role:'media',phase:'playing',lastProgressAt:1000000});assert.equal(s.core.supervise()[0].state,'stalled');
});
test('后台重启后仍使用持久通知记录，避免反复弹窗',()=>{
  const s=setup();s.core.heartbeat({role:'quiz',phase:'needs_user'});s.core.supervise();const restarted=setup({store:s.store});restarted.core.supervise();assert.equal(restarted.notifications.length,0);
});
test('关闭的心跳不再报警',()=>{const s=setup();s.core.heartbeat({role:'media',phase:'closed'});s.advance(300000);assert.equal(s.core.supervise().length,0);});
test('等待重试时暂停会拦截下一次请求，继续后才发送',async()=>{
  let paused=false,scheduled=[];const s=setup({paused:()=>paused,timers:{setTimeout:fn=>{scheduled.push(fn);return scheduled.length;},clearTimeout:()=>{}}});let calls=0;
  const p=s.core.run('pause-retry',async()=>{if(++calls===1){paused=true;throw Object.assign(new Error('temporary'),{retry:true});}return'ok';},{delays:[1]});
  for(let i=0;i<6;i++)await Promise.resolve();scheduled.shift()();for(let i=0;i<6;i++)await Promise.resolve();assert.equal(calls,1);paused=false;scheduled.shift()();assert.equal(await p,'ok');assert.equal(calls,2);
});
