const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const bundle=fs.readFileSync('build/legacy.user.js','utf8');
function page(type='0') {
    return `<div class="Py-mian1"><div class="Py-m1-title fs16">1.[单选题]1+1等于？</div><input type="hidden" id="answertype1" name="answertype1" value="${type}"><input type="hidden" name="answer1" value=""><ul class="answerList"><li id-param="1"><em id-param="A">A</em><span>2</span></li><li id-param="1"><em id-param="B">B</em><span>3</span></li></ul></div>`;
}
async function smoke({submit='0',save='0',type='0',failure=false,missingKey=false,url}={}) {
    const dom=new JSDOM(page(type),{url:url||'https://mooc1.chaoxing.com/work/phone/doHomeWork?workId=42',runScripts:'outside-only'});
    const w=dom.window;
    const values={unrivalautosubmit:submit,unrivalautosave:save,'personalAI.config.v1':{apiKey:missingKey?'':'sk-test',interval:0,retries:0}};
    const actions=[],requests=[],menus=[];
    w.unsafeWindow=w;w.GM_info={scriptHandler:'ScriptCat'};
    w.GM_getValue=(k,d)=>values[k]??d;w.GM_setValue=(k,v)=>values[k]=v;
    w.GM_addValueChangeListener=()=>{};w.GM_registerMenuCommand=(name,fn)=>menus.push([name,fn]);
    w.GM_xmlhttpRequest=r=>{requests.push(r);w.setTimeout(()=>r.onload(failure?{status:401}:{status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"answer":["A"],"explanation":"2"}'}}]})}),0);return{abort(){}};};
    w.submitCheckTimes=()=>actions.push('check');w.escapeBlank=()=>actions.push('blank');w.submitAction=()=>actions.push('submit');w.noSubmit=()=>actions.push('save');
    w.document.querySelectorAll('li').forEach(li=>li.onclick=()=>{w.document.querySelectorAll('li').forEach(x=>x.classList.remove('cur'));li.classList.add('cur');w.document.querySelector('[name=answer1]').value=li.querySelector('em').getAttribute('id-param');});
    let thrown;
    try{w.eval(bundle);}catch(e){thrown=e;}
    const start=Date.now();
    while(!thrown&&!missingKey&&requests.length&&Date.now()-start<1000&&!/答题结束|队列已停止|答题中断|原生提交校验|原生保存入口|自动提交已关闭|未自动提交/.test(w.unrivalWorkInfo||'')) await new Promise(r=>setTimeout(r,5));
    const result={thrown,actions,requests,menus,values,selected:w.document.querySelector('li.cur')?.textContent,done:w.unrivalDoneWorkId};
    dom.window.close();return result;
}
test('完整安装文件能启动章节测试，默认填答不提交',async()=>{
    const r=await smoke();assert.equal(r.thrown,undefined);assert.equal(r.requests.length,1);assert.equal(r.selected,'A2');assert.deepEqual(r.actions,[]);assert.equal(r.menus.length,6);
    const payload=JSON.parse(JSON.parse(r.requests[0].data).messages[1].content);assert.equal(payload.options[0].text,'2');
});
test('显式开启自动提交后只调用原生校验入口，不绕过校验或提前标记成功',async()=>{
    const r=await smoke({submit:'1'});assert.equal(r.thrown,undefined);assert.deepEqual(r.actions,['check']);assert.equal(r.done,undefined);
});
test('自动保存使用原页面保存接口',async()=>{const r=await smoke({save:'1'});assert.deepEqual(r.actions,['save']);});
test('存在不支持题型即使开启自动提交也不提交',async()=>{const r=await smoke({submit:'1',type:'2'});assert.deepEqual(r.actions,[]);assert.equal(r.requests.length,0);});
test('API 身份错误不会自动保存或提交',async()=>{const r=await smoke({submit:'1',save:'1',failure:true});assert.deepEqual(r.actions,[]);assert.equal(r.requests.length,1);});
test('未填写 API Key 不发网络请求、不提交',async()=>{const r=await smoke({submit:'1',missingKey:true});assert.equal(r.thrown,undefined);assert.equal(r.requests.length,0);assert.deepEqual(r.actions,[]);});
test('非答题页面安装不发模型请求、不改写原生 confirm',async()=>{const r=await smoke({url:'https://mooc1.chaoxing.com/ordinary-page'});assert.equal(r.thrown,undefined);assert.equal(r.requests.length,0);assert.equal(r.menus.length,6);assert.ok(!bundle.includes('_w.confirm ='));});
test('新脚本元信息隔离存储，旧题库地址和随机答题代码已移除',()=>{
    assert.match(bundle,/@storageName\s+personal-chaoxing-ai-v1/);assert.match(bundle,/@connect\s+api.deepseek.com/);
    for(const text of ['cx.icodef.com','tikutoken','randomDo','base222'])assert.ok(!bundle.includes(text),text);
    assert.match(bundle,/@original-author unrival/);assert.match(bundle,/@license\s+GPL-3.0-or-later/);
});
