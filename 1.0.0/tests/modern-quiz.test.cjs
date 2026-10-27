const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const font=fs.readFileSync('tests/fixtures/quiz-font.ttf').toString('base64');
const code=fs.readFileSync('src/page-adapter.js','utf8')+'\n'+fs.readFileSync('src/blank-fields.js','utf8')+'\n'+fs.readFileSync('src/font-decoder.js','utf8').replace('/* FONT_SIGNATURES */{}',fs.readFileSync('src/data/font-signatures.json','utf8').trim())+'\n'+fs.readFileSync('src/ai-helper.js','utf8');
const factory=vm.runInNewContext(code+'\ncreateAIHelper',{URL,AbortController,setTimeout,clearTimeout,Uint8Array,Int32Array,DataView});
function fixture({type='0',secret=true}={}){
  const texts=secret?['尪程','存尬尫','尭件','尮件']:['第一项','第二项','第三项','第四项'];
  const options=type==='3'?['正确','错误']:texts;
  return `<div id="question1" class="singleQuesId"><div class="TiMu newTiMu" data="${type}"><div class="Zy_TItle"><i>1</i><div class="fontLabel ${secret?'font-cxsecret':''}"><span class="newZy_TItle">【${{'0':'单选题','1':'多选题','3':'判断题'}[type]}】</span><p>${secret?'操作系统的功能是进行尥尨机尩尨、(   )尩尨。':'完整文字题'}</p></div></div><ul class="Zy_ulTop" aria-hidden="true">${options.map((text,i)=>`<li class="${secret?'font-cxsecret':''}" qtype="${type}" role="${type==='1'?'checkbox':'radio'}"><label><span class="num_option" data="${type==='3'?String(i===0):String.fromCharCode(65+i)}">${String.fromCharCode(65+i)}</span></label><a><p>${text}</p></a></li>`).join('')}</ul><input type="hidden" name="answer1"><input type="hidden" name="answertype1" value="${type}"></div></div>`;
}
function setup({html=fixture(),css=`@font-face{font-family:font-cxsecret;src:url(data:font/ttf;base64,${font})}`,reply=['B']}={}){
  const dom=new JSDOM(`<style>${css}</style>${html}`,{url:'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew'}),doc=dom.window.document,calls=[],reports=[];
  doc.querySelectorAll('.TiMu li').forEach(li=>li.onclick=()=>{
    const root=li.closest('.TiMu'),multi=root.getAttribute('data')==='1';
    if(!multi)root.querySelectorAll('.num_option').forEach(span=>span.classList.remove('check_answer'));
    li.querySelector('.num_option').classList.toggle('check_answer');
    root.querySelector('[name=answer1]').value=[...root.querySelectorAll('.check_answer')].map(span=>span.getAttribute('data')).join('');
  });
  const helper=factory({win:dom.window,doc,getValue:(k,d)=>k==='personalAI.config.v1'?{apiKey:'TEST-NOT-REAL',interval:0,retries:0}:d,setValue(){},report:x=>reports.push(x),request:r=>{calls.push(JSON.parse(r.data));setTimeout(()=>r.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({answer:reply})},finish_reason:'stop'}]})}),0);return {abort(){}};}});
  return {helper,dom,doc,calls,reports};
}
test('当前新版 DOM 完整提取题干与四个选项，模型收到显示文字',async()=>{
  const s=setup(),q=s.helper.readQuestions()[0];assert.equal(q.reason,'');assert.equal(q.text,'操作系统的功能是进行处理机管理、(   )管理。');assert.deepEqual(Array.from(q.options,x=>x.text),['进程','存储器','硬件','软件']);
  const summary=await s.helper.run();assert.equal(summary.filled,1);const payload=JSON.parse(s.calls[0].messages[1].content);assert.equal(payload.options[1].text,'存储器');assert.equal(s.doc.querySelector('.check_answer').getAttribute('data'),'B');s.dom.window.close();
});
test('新版已选答案由内部编号标记识别，不覆盖人工选择',async()=>{
  const s=setup();s.doc.querySelector('li').click();const summary=await s.helper.run();assert.equal(summary.existing,1);assert.equal(s.calls.length,0);assert.equal(s.doc.querySelector('.check_answer').getAttribute('data'),'A');s.dom.window.close();
});
test('新版多选复核内部标记，判断题使用 true/false',async()=>{
  for(const [type,reply,expected] of [['1',['A','C'],'AC'],['3',false,'false']]){
    const s=setup({html:fixture({type,secret:false}),reply}),summary=await s.helper.run();assert.equal(summary.filled,1);assert.equal(s.doc.querySelector('[name=answer1]').value,expected);s.dom.window.close();
  }
});
test('特殊字体缺失时提示并跳过，不向 API 发送乱码',async()=>{
  const s=setup({css:''}),summary=await s.helper.run();assert.equal(summary.skipped,1);assert.equal(s.calls.length,0);assert.match(s.doc.querySelector('.dsa-result').textContent,/特殊字体尚未加载/);s.dom.window.close();
});
