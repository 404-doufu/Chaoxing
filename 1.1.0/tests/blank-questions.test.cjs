const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const fontCode=fs.readFileSync('src/font-decoder.js','utf8').replace('/* FONT_SIGNATURES */{}',fs.readFileSync('src/data/font-signatures.json','utf8').trim());
const code=['src/page-adapter.js','src/blank-fields.js','src/ai-helper.js'].map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+fontCode;
const factory=vm.runInNewContext(code+'\ncreateAIHelper',{URL,AbortController,setTimeout,clearTimeout,Uint8Array,Int32Array,DataView});
function fixture({count=1,rich=false,id='42',secret=false}={}){
  const title=secret?'并发嗺<span style="text-decoration:underline">&nbsp;&nbsp;&nbsp;</span>是嗸噯系统的两个最基本的嗲嗹,两者之间互为嗴在嗵件。':'并发和<span style="text-decoration:underline">&nbsp;&nbsp;&nbsp;</span>是基本特征';
  const blanks=Array.from({length:count},(_,i)=>`<div class="blankItemDiv"><span>第${i+1}空：</span><div class="blankItemInp">${rich?`<div id="inpDiv${id}${i+1}" class="InpDIV" style="display:none"></div><div class="edui-editor"><svg></svg><iframe id="ueditor_${id}_${i}"></iframe></div><textarea id="answerEditor${id}${i+1}" name="answerEditor${id}${i+1}" style="display:none"></textarea>`:`<textarea id="answer${id}_${i}" name="answer${id}_${i}"></textarea>`}</div></div>`).join('');
  return `<div class="TiMu newTiMu" data="2"><div class="Zy_TItle"><i>1</i><div class="fontLabel ${secret?'font-cxsecret':''}"><span>【填空题】</span>${title}</div></div><ul class="Zy_ulTk">${blanks}<input type="hidden" name="tiankongsize${id}" value="${count}"></ul><input type="hidden" name="answertype${id}" value="2"></div>`;
}
function attachUE(w,{ready=true,syncMirror=true}={}){
  w.UE={instants:{}};
  for(const input of w.document.querySelectorAll('textarea[id^=answerEditor]')){
    const group=input.closest('.blankItemDiv'),iframe=group.querySelector('iframe'),body=iframe.contentDocument.body;body.setAttribute('contenteditable','true');
    const ed={key:input.id,iframe,container:group.querySelector('.edui-editor'),body,isReady:ready,
      getContent:()=>body.innerHTML,getContentTxt:()=>body.textContent,
      setContent(html){body.innerHTML=html;this.fireEvent('contentChange');},
      fireEvent(name){if(syncMirror&&name==='contentChange')group.querySelector('.InpDIV').innerHTML=body.innerHTML;},sync(){input.value=body.innerHTML;}};
    w.UE.instants[input.id]=ed;
  }
}
function setup({html=fixture(),reply=['共享'],rich=false,ready=true,syncMirror=true,secret=false,delay=0}={}){
  const css=secret?`<style>@font-face{font-family:font-cxsecret;src:url(data:font/ttf;base64,${fs.readFileSync('tests/fixtures/blank-font.ttf').toString('base64')})}</style>`:'';
  const dom=new JSDOM(css+html,{url:'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew'}),w=dom.window,doc=w.document,calls=[],reports=[],completed=[];
  if(rich)attachUE(w,{ready,syncMirror});
  const helper=factory({win:w,doc,getValue:(k,d)=>k==='personalAI.config.v1'?{apiKey:'TEST-NOT-REAL',interval:0,retries:0}:d,setValue(){},report:x=>reports.push(x),onComplete:(summary,signal,context)=>completed.push({summary,context}),request:r=>{calls.push(JSON.parse(r.data));const timer=setTimeout(()=>r.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({answer:reply})},finish_reason:'stop'}]})}),delay);return{abort(){clearTimeout(timer);r.onabort?.();}};}});
  return{dom,w,doc,helper,calls,reports,completed,close:()=>w.close()};
}
test('本次实页混淆字体与下划线空位可还原为完整题干',async()=>{
  const s=setup({html:fixture({rich:true,secret:true}),rich:true,secret:true}),q=s.helper.readQuestions()[0];assert.equal(q.type,'填空题');assert.equal(q.reason,'');assert.equal(q.blanks.length,1);assert.equal(q.text,'并发和____是操作系统的两个最基本的特征,两者之间互为存在条件。');const result=await s.helper.run();assert.equal(result.filled,1);assert.equal(s.completed[0].context.canSubmit(),true);s.close();
});
test('通过实际 UEditor 源字段、富文本及镜像三者核对填空，不把工具栏 SVG 当题目图片',async()=>{
  const s=setup({html:fixture({rich:true}),rich:true}),result=await s.helper.run();assert.equal(result.filled,1);const ed=Object.values(s.w.UE.instants)[0];assert.equal(ed.getContentTxt(),'共享');assert.equal(s.doc.querySelector('textarea').value,'<p>共享</p>');assert.equal(s.doc.querySelector('.InpDIV').textContent,'共享');assert.equal(s.completed[0].context.canSubmit(),true);s.close();
});
test('多空按 DOM 顺序填答，允许不同空答案相同并保留大小写与逗号',async()=>{
  const s=setup({html:fixture({count:3}),reply:['共享','a,B','共享']}),result=await s.helper.run();assert.equal(result.filled,1);assert.deepEqual([...s.doc.querySelectorAll('textarea')].map(x=>x.value),['共享','a,B','共享']);const payload=JSON.parse(s.calls[0].messages[1].content);assert.equal(payload.blankCount,3);assert.deepEqual(payload.existingAnswers,['','','']);s.close();
});
test('已有部分答案保留，只补空位，并将已有内容告知模型',async()=>{
  const s=setup({html:fixture({count:2}),reply:['模型改写','剩余答案']});s.doc.querySelector('textarea').value='用户已有';const result=await s.helper.run();assert.equal(result.filled,1);assert.deepEqual([...s.doc.querySelectorAll('textarea')].map(x=>x.value),['用户已有','剩余答案']);assert.deepEqual(JSON.parse(s.calls[0].messages[1].content).existingAnswers,['用户已有','']);assert.ok(s.doc.querySelector('.dsa-result').textContent.includes('第1空：用户已有'));s.close();
});
test('全部已有富文本答案直接同步提交字段，不再请求模型',async()=>{
  const s=setup({html:fixture({rich:true}),rich:true});Object.values(s.w.UE.instants)[0].setContent('<p>用户答案</p>');const result=await s.helper.run();assert.equal(result.existing,1);assert.equal(s.calls.length,0);assert.equal(s.completed[0].context.canSubmit(),true);s.close();
});
test('答案数量不匹配、空字符串、数字或 HTML 不能填入或提交',async()=>{
  for(const reply of [[],['一','二'],[''],[3],['<img src=x onerror=alert(1)>']]){const s=setup({reply}),r=await s.helper.run();assert.equal(r.failed,1);assert.equal(s.doc.querySelector('textarea').value,'');assert.equal(s.completed[0].context.canSubmit(),false);s.close();}
});
test('单空可接收字符串，数字零需以字符串保留',async()=>{
  const s=setup({reply:'0'}),r=await s.helper.run();assert.equal(r.filled,1);assert.equal(s.doc.querySelector('textarea').value,'0');s.close();
});
test('等待模型期间用户改动填空时保留其输入，禁止继续提交',async()=>{
  const s=setup({delay:30}),pending=s.helper.run();s.doc.querySelector('textarea').value='手动改动';const r=await pending;assert.equal(r.failed,1);assert.equal(s.doc.querySelector('textarea').value,'手动改动');s.close();
});
test('编辑器延迟加载后可以继续填答，停止等待不会请求模型',async()=>{
  const s=setup({html:fixture({rich:true}),rich:true,ready:false}),pending=s.helper.run();Object.values(s.w.UE.instants)[0].isReady=true;const r=await pending;assert.equal(r.filled,1);s.close();const t=setup({html:fixture({rich:true}),rich:true,ready:false}),q=t.helper.run();t.helper.stop();await q;assert.equal(t.calls.length,0);t.close();
});
test('富文本与提交镜像不同步或控件只读时不算成功，不允许自动提交',async()=>{
  const s=setup({html:fixture({rich:true}),rich:true,syncMirror:false}),r=await s.helper.run();assert.equal(r.failed,1);assert.equal(s.completed[0].context.canSubmit(),false);s.close();const t=setup();t.doc.querySelector('textarea').readOnly=true;const result=await t.helper.run();assert.equal(result.failed,1);assert.equal(t.doc.querySelector('textarea').value,'');t.close();
});
test('提交前再次清空、替换或增加空位，会令完整性检查失败',async()=>{
  const s=setup();await s.helper.run();const check=s.completed[0].context.canSubmit;assert.equal(check(),true);s.doc.querySelector('textarea').value='';assert.equal(check(),false);s.close();const t=setup();await t.helper.run();t.doc.querySelector('textarea').replaceWith(t.doc.querySelector('textarea').cloneNode(true));assert.equal(t.completed[0].context.canSubmit(),false);t.close();
});

test('普通文本输入和行内 contenteditable 都触发页面输入事件',async()=>{
  for(const control of ['<input type="text" name="answer42_1">','<div contenteditable="true"></div>']){
    const s=setup({html:`<div class="TiMu" data="2"><div class="Zy_TItle">【填空题】并发和____</div><div class="blankItemDiv">${control}</div></div>`});let changes=0;s.doc.addEventListener('input',()=>changes++);const result=await s.helper.run();assert.equal(result.filled,1);assert.ok(changes>0);assert.equal(s.completed[0].context.canSubmit(),true);s.close();
  }
});
test('等待期间题干发生变化时不填入旧题答案',async()=>{
  const s=setup({delay:30}),pending=s.helper.run();s.doc.querySelector('.fontLabel').textContent='【填空题】换了一道题____';const result=await pending;assert.equal(result.failed,1);assert.equal(s.doc.querySelector('textarea').value,'');s.close();
});
