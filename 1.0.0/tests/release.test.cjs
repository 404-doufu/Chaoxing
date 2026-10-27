const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const release=fs.readFileSync('发行1.0.0.user.js','utf8');
function load({path='/mycourse/studentstudy',html='',store=new Map(),embedded=false,reply=['A']}={}){
  const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com'+path,runScripts:'outside-only'}),w=dom.window,roots=[],requests=[];
  const original=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(options){const root=original.call(this,options);roots.push(root);return root;};
  if(embedded)Object.defineProperty(w,'parent',{value:{}});
  Object.assign(w,{unsafeWindow:w,GM_info:{scriptHandler:'ScriptCat'},GM_getValue:(k,d)=>store.has(k)?store.get(k):d,GM_setValue:(k,v)=>store.set(k,v),GM_listValues:()=>[...store.keys()],GM_notification(){},GM_addValueChangeListener(){},GM_registerMenuCommand(){},GM_xmlhttpRequest:r=>{requests.push(r);w.setTimeout(()=>r.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({answer:reply})},finish_reason:'stop'}]})}),0);return{abort(){}};}});
  let error;try{w.eval(release);}catch(e){error=e;}
  return{dom,w,store,roots,requests,error,close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
test('正式发行元信息为 tofu / 1.0.0，说明独立放入 README，脚本保留许可来源',()=>{
  assert.match(release,/^\/\/ @name\s+发行1\.0\.0$/m);assert.match(release,/^\/\/ @version\s+1\.0\.0$/m);assert.match(release,/^\/\/ @author\s+tofu$/m);assert.equal((release.match(/^\/\/ ==UserScript==$/gm)||[]).length,1);assert.ok(!/^\/\/ @background/m.test(release));assert.ok(!/^\/\/ @require/m.test(release));assert.match(release,/^\/\/ @connect\s+\*$/m);assert.ok(!release.includes('发行说明 · tofu'));assert.ok(!release.includes('把本文件从头到尾全部复制粘贴'));assert.ok(!release.includes(fs.readFileSync('LICENSE','utf8').trim()));assert.ok(!release.includes(fs.readFileSync('docs/licenses/SourceHanSans-OFL.txt','utf8').trim()));assert.match(release,/@original-author\s+unrival/);assert.match(release,/SPDX-License-Identifier: GPL-3\.0-or-later/);assert.match(release,/docs\/licenses\/SourceHanSans-OFL\.txt/);
  const readme=fs.readFileSync('README.md','utf8');assert.ok(readme.includes('发行1.0.0.user.js'));assert.ok(readme.includes('## 下载与安装'));assert.ok(readme.includes('## 配置 API'));assert.ok(readme.includes('SourceHanSans-OFL.txt'));
});
test('发行文件内不带用户配置或示例密钥，不要求修改 API 域名白名单源码',()=>{
  assert.match(release,/model: 'deepseek-flash', apiKey: ''/);for(const text of ['TEST-NOT-REAL','sk-test','sk-TEST-DO-NOT-USE','E:\\脚本工程','document.cookie','更换服务域名时须在脚本头添加'])assert.ok(!release.includes(text),text);assert.ok(release.includes('本发行支持自填域名'));
});
test('新用户首次进入自动在唯一浮窗中显示 API 设置，不发模型请求',()=>{
  const s=load();assert.equal(s.error,undefined);const host=s.w.document.querySelector('#personal-course-control');assert.ok(host);assert.equal(host.getAttribute('data-version'),'1.0.0');assert.equal(s.w.document.querySelectorAll('#personal-course-control').length,1);const root=s.roots.find(r=>r.host===host);assert.match(root.querySelector('strong').textContent,/tofu.*1\.0\.0/);assert.equal(root.querySelector('#settings').hidden,false);assert.ok(s.roots.some(r=>r.querySelector('#apiKey')));assert.equal(s.requests.length,0);s.close();
});
test('用户只填 API 地址/模型/Key 后可保存并测试自定义域名，无需编辑脚本',async()=>{
  const s=load(),ui=s.roots.find(r=>r.querySelector('#apiKey'));ui.querySelector('#baseURL').value='https://model.example.org/v1';ui.querySelector('#model').value='my-model';ui.querySelector('#apiKey').value='FAKE-FOR-LOCAL-TEST';ui.querySelector('#save').click();assert.equal(s.store.get('personalAI.config.v1').model,'my-model');ui.querySelector('#test').click();await new Promise(r=>setTimeout(r,20));assert.equal(s.requests.length,1);assert.equal(s.requests[0].url,'https://model.example.org/v1/chat/completions');assert.equal(s.requests[0].anonymous,true);assert.match(ui.querySelector('#status').textContent,/测试通过/);s.close();
});
test('已有 API 设置时不强制跳到设置页，内置监督无需第二份脚本',async()=>{
  const store=new Map([['personalAI.config.v1',{apiKey:'FAKE-FOR-LOCAL-TEST'}]]),s=load({store});assert.equal(s.error,undefined);assert.equal(s.roots[0].querySelector('#settings').hidden,true);await new Promise(r=>setTimeout(r,180));assert.equal(store.get('edgeStudy.v1.supervisor').version,1);assert.equal(s.requests.length,0);s.close();
});
test('单文件正式版仍完成填空、原生提交确认，子页不生成浮窗',async()=>{
  const store=new Map([['personalAI.config.v1',{baseURL:'https://custom.example.org/v1',model:'my-model',apiKey:'FAKE-FOR-LOCAL-TEST',interval:0,retries:0}]]);
  const html='<div class="TiMu" data="2"><div class="Zy_TItle">【填空题】并发和____是基本特征</div><div class="blankItemDiv"><textarea name="answer42_1"></textarea></div></div><div id="RightCon"><a class="btnSubmit" role="button">提交</a><div id="confirmSubWin" hidden>确认提交？<a role="button">提交</a></div><span class="workStatus">待完成</span></div>';
  const s=load({path:'/mooc-ans/work/doHomeWorkNew',html,store,embedded:true,reply:['共享']});assert.equal(s.error,undefined);let submitted=0;s.w.document.querySelector('.btnSubmit').onclick=()=>s.w.document.querySelector('#confirmSubWin').hidden=false;s.w.document.querySelector('#confirmSubWin a').onclick=()=>{submitted++;s.w.document.querySelector('#confirmSubWin').hidden=true;s.w.document.querySelector('.workStatus').textContent='已提交';};await new Promise(r=>setTimeout(r,300));assert.equal(s.requests.length,1);assert.equal(s.w.document.querySelector('textarea').value,'共享');assert.equal(submitted,1);assert.equal(s.w.document.querySelector('#personal-course-control'),null);s.close();
});
