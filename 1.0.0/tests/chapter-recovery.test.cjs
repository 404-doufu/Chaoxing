const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const factory=vm.runInNewContext(fs.readFileSync('src/chapter-recovery.js','utf8')+'\ncreateChapterRecovery');
function setup(shared=new Map()){let now=1000000;const storage={getItem:k=>shared.get(k)||null,setItem:(k,v)=>shared.set(k,v)},r=factory({now:()=>now,storage});return{r,shared,storage,advance:ms=>now+=ms,now:()=>now};}
test('十秒首次刷新，再十秒第二次，再十秒跳过；跳过与完成区分',()=>{
  const s=setup();s.r.enter('chapter');s.r.observe('same');s.advance(9999);assert.equal(s.r.decide({ready:true}),null);s.advance(1);assert.equal(s.r.decide({ready:true}).attempt,1);s.advance(10000);assert.equal(s.r.decide({ready:true}).attempt,2);s.advance(9999);assert.equal(s.r.decide({ready:true}),null);s.advance(1);assert.equal(s.r.decide({ready:true}).type,'skip');const saved=JSON.parse([...s.shared.values()][0]);assert.equal(saved.skipped,true);assert.equal(saved.completed,undefined);
});
test('刷新后实例重建仍累计次数，不回到第一轮；无子页响应仍能完成两次恢复',()=>{
  const s=setup();s.r.enter('chapter');s.advance(10000);s.r.decide({ready:true});const second=factory({now:s.now,storage:s.storage});second.enter('chapter');s.advance(10000);assert.equal(second.decide().attempt,2);second.enter('chapter');s.advance(10000);assert.equal(second.decide().type,'skip');
});
test('有真实进展重置等待时间，重复心跳不重置；次数仍按本章累计',()=>{
  const s=setup();s.r.enter('chapter');s.r.observe('p1');s.advance(9000);s.r.observe('p2');s.advance(9000);s.r.observe('p2');assert.equal(s.r.decide({ready:true}),null);s.advance(1000);assert.equal(s.r.decide({ready:true}).type,'reload');s.r.enter('chapter');s.r.observe('p3');s.advance(10000);assert.equal(s.r.decide({ready:true}).attempt,2);
});
test('暂停/离线/活动任务期间保持等待，恢复后再等十秒',()=>{
  for(const hold of [{allowed:false},{busy:true}]){const s=setup();s.r.enter('chapter');s.advance(20000);assert.equal(s.r.decide({...hold,ready:true}),null);s.advance(9999);assert.equal(s.r.decide({ready:true}),null);s.advance(1);assert.equal(s.r.decide({ready:true}).type,'reload');}
});
test('目录完成直接返回完成，不消耗刷新次数；活动媒体不能被对钩跳过',()=>{
  const s=setup();s.r.enter('chapter');assert.equal(s.r.decide({complete:true}).type,'complete');assert.equal(s.r.decide({complete:true,busy:true}),null);assert.equal(s.shared.size,0);
});
test('不同章节独立计数，存储损坏或不可用不会形成无限刷新',()=>{
  const s=setup();s.r.enter('one');s.advance(10000);s.r.decide({ready:true});s.r.enter('two');s.advance(10000);assert.equal(s.r.decide({ready:true}).attempt,1);s.r.enter('one');s.advance(10000);assert.equal(s.r.decide({ready:true}).attempt,2);
  let now=0;const r=factory({now:()=>now,storage:{getItem(){throw Error();},setItem(){throw Error();}}});r.enter('no-store');for(const expected of ['reload','reload','skip']){now+=10000;assert.equal(r.decide({ready:true}).type,expected);}
});
