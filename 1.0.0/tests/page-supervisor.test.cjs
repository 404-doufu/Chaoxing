const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const code=['src/study-core.js','src/page-adapter.js','src/page-supervisor.js'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
function setup({embedded=false,path='/mycourse/studentstudy',store=new Map(),id='supervisor'}={}){
  const dom=new JSDOM('',{url:'https://mooc1.chaoxing.com'+path}),w=dom.window,timers=new Map(),reads=[],notices=[];let now=1000000,next=0;
  if(embedded)Object.defineProperty(w,'parent',{value:{}});
  w.setTimeout=(fn,ms)=>{timers.set(++next,{fn,at:now+ms});return next;};w.clearTimeout=id=>timers.delete(id);
  const factory=vm.runInNewContext(code+'\ncreatePageSupervisor',{URL,setTimeout:w.setTimeout,clearTimeout:w.clearTimeout}),helper=factory({win:w,doc:w.document,id,now:()=>now,getValue:(k,d)=>{reads.push(k);return store.has(k)?store.get(k):d;},setValue:(k,v)=>store.set(k,v),listValues:()=>[...store.keys()],notify:x=>notices.push(x)});
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  return{helper,w,store,reads,notices,timers,async tick(ms){const end=now+ms;await flush();for(let n=0;n<100;n++){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;timers.delete(entry[0]);now=entry[1].at;entry[1].fn();await flush();}now=end;await flush();},close(){helper.dispose();w.close();}};
}
test('单文件监督在课程顶层运行、只读监督状态且清理退出计时',async()=>{
  const s=setup();s.store.set('personalAI.config.v1',{apiKey:'FAKE-MUST-NOT-BE-READ'});s.store.set('edgeStudy.v1.heart.child',{version:1,session:'child',updatedAt:700000,role:'media',phase:'playing',lastProgressAt:700000});s.helper.install();await s.tick(150);assert.equal(s.store.get('edgeStudy.v1.supervisor').pages[0].state,'stale');assert.equal(s.notices.length,1);assert.ok(s.reads.every(k=>k.startsWith('edgeStudy.v1.')));s.close();assert.equal(s.timers.size,0);
});
test('子 iframe 与非课程页面不会创建监督循环',()=>{
  for(const args of [{embedded:true},{path:'/visit/interaction'}]){const s=setup(args);s.helper.install();assert.equal(s.timers.size,0);assert.equal(s.store.has('edgeStudy.v1.supervisor'),false);s.close();}
});
test('多个课程页只由租约持有者监督，关闭后另一页可接续',async()=>{
  const store=new Map(),a=setup({store,id:'a'}),b=setup({store,id:'b'});a.helper.install();b.helper.install();await a.tick(150);await b.tick(150);assert.equal(store.get('edgeStudy.v1.lease.tofu-page-supervisor').owner,'a');a.close();void b.helper.tick();await b.tick(150);assert.equal(store.get('edgeStudy.v1.lease.tofu-page-supervisor').owner,'b');b.close();
});
