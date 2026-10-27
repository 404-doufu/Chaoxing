const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const bundle=fs.readFileSync('学习通-Edge稳定学习版.user.js','utf8');
const background=fs.readFileSync('学习通-Edge后台监督.user.js','utf8');
function load({path='/mooc-ans/knowledge/cards?knowledgeid=ch',data,html='<div id="native">原播放器</div>',quiz=false,clock,embedded=false,autoSubmit='0'}={}){
  const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com'+path,runScripts:'outside-only'}),w=dom.window;
  const values=new Map([['personalAI.config.v1',{apiKey:'TEST-NOT-REAL',interval:0,retries:0}],['unrivalautosubmit',autoSubmit]]),requests=[];
  const roots=[];const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(options){const root=attach.call(this,options);roots.push(root);return root;};
  if(embedded)Object.defineProperty(w,'parent',{value:{}});
  if(clock)w.Date.now=()=>clock.now;
  w.unsafeWindow=w;w.GM_info={scriptHandler:'ScriptCat'};w.GM_getValue=(k,d)=>values.has(k)?values.get(k):d;w.GM_setValue=(k,v)=>values.set(k,v);w.GM_addValueChangeListener=()=>{};w.GM_registerMenuCommand=()=>{};
  w.mArg=data||{defaults:{userid:'u',courseid:'c',clazzId:'class',knowledgeid:'ch'},attachments:[]};
  w.GM_xmlhttpRequest=r=>{requests.push(r);if(quiz)w.setTimeout(()=>r.onload({status:200,responseText:'{"choices":[{"finish_reason":"stop","message":{"content":"{\\"answer\\":[\\"A\\"]}"}}]}'}),0);return{abort(){}};};
  let error;try{w.eval(bundle);}catch(e){error=e;}return{dom,w,error,values,requests,roots};
}
test('最终 Edge 安装文件能启动章节页，原播放器节点保持原样',()=>{
  const s=load();assert.equal(s.error,undefined);assert.equal(s.w.document.querySelector('#native').textContent,'原播放器');assert.ok(s.w.document.querySelector('#personal-course-control'));assert.equal(s.requests.length,0);s.dom.window.close();
});
test('最终文件可在课程主页与媒体子页面分别启动',()=>{
  for(const path of ['/mycourse/studentstudy','/ananas/modules/video/index.html','/ananas/modules/audio/index.html','/ananas/modules/pdf/index.html','/ananas/modules/ppt/index.html','/ananas/modules/document/index.html','/ananas/modules/office/index.html']){const s=load({path});assert.equal(s.error,undefined,path);assert.ok([...s.values.keys()].some(x=>x.startsWith('edgeStudy.v1.heart.')));s.dom.window.close();}
});
test('稳定版保留 AI 填答，明确关闭提交时不提交',async()=>{
  const html='<div class="Py-mian1"><div class="Py-m1-title">[单选题]1+1=?</div><input type="hidden" name="answertype1" id="answertype1" value="0"><input type="hidden" name="answer1"><ul class="answerList"><li><em id-param="A">A</em>2</li><li><em id-param="B">B</em>3</li></ul></div>';
  const s=load({path:'/work/phone/doHomeWork?workId=1',html,quiz:true});assert.equal(s.error,undefined);let submitted=0;s.w.submitAction=()=>submitted++;
  s.w.document.querySelectorAll('li').forEach(li=>li.onclick=()=>{s.w.document.querySelectorAll('li').forEach(x=>x.classList.remove('cur'));li.classList.add('cur');});
  await new Promise(r=>setTimeout(r,30));assert.equal(s.requests.length,1);assert.equal(s.w.document.querySelector('li.cur em').getAttribute('id-param'),'A');assert.equal(submitted,0);s.dom.window.close();
});

test('最终新版脚本把填答、原生提交、确认及平台页面结果串联',async()=>{
  const html='<div class="TiMu" data="0"><div class="Zy_TItle">【单选题】1+1=?</div><ul class="Zy_ulTop"><li><span class="num_option" data="A">A</span>2</li><li><span class="num_option" data="B">B</span>3</li></ul><input name="answer1" type="hidden"></div><div id="RightCon"><a class="btnSubmit" role="button">提交</a><div id="confirmSubWin" hidden>确认提交？<a onclick="submitCheckTimes();">确定</a></div><span class="workStatus">待完成</span></div>';
  const s=load({path:'/mooc-ans/work/doHomeWorkNew',html,quiz:true,embedded:true,autoSubmit:'1'});assert.equal(s.error,undefined);let submitted=0,checks=0;
  s.w.document.querySelectorAll('li').forEach(li=>li.onclick=()=>{li.querySelector('.num_option').classList.add('check_answer');s.w.document.querySelector('[name=answer1]').value=li.querySelector('.num_option').getAttribute('data');});
  s.w.document.querySelector('.btnSubmit').onclick=()=>{checks++;s.w.document.querySelector('#confirmSubWin').hidden=false;};
  s.w.document.querySelector('#confirmSubWin a').onclick=()=>{submitted++;s.w.document.querySelector('#confirmSubWin').hidden=true;s.w.document.querySelector('.workStatus').textContent='已提交';};
  await new Promise(r=>setTimeout(r,300));assert.equal(s.requests.length,1);assert.equal(checks,1);assert.equal(submitted,1);assert.equal(s.w.document.querySelector('.workStatus').textContent,'已提交');assert.equal(s.values.has('unrivalWorkDone'),false);s.dom.window.close();
});

test('最终安装文件直接启动 doHomeWorkNew 并还原加密字体后填答',async()=>{
  const font=fs.readFileSync('tests/fixtures/quiz-font.ttf').toString('base64');
  const html=`<style>@font-face{font-family:font-cxsecret;src:url(data:font/ttf;base64,${font})}</style><div class="TiMu newTiMu" data="0"><div class="Zy_TItle"><i>1</i><div class="fontLabel font-cxsecret">【单选题】尳尲屇屆屗尯尰( )程序。</div></div><ul class="Zy_ulTop"><li class="font-cxsecret"><span class="num_option" data="A">A</span>尮件</li><li class="font-cxsecret"><span class="num_option" data="B">B</span>尭件</li></ul><input name="answer1" type="hidden"></div>`;
  const s=load({path:'/mooc-ans/work/doHomeWorkNew',html,quiz:true,embedded:true});assert.equal(s.error,undefined);s.w.document.querySelectorAll('li').forEach(li=>li.onclick=()=>li.querySelector('.num_option').classList.add('check_answer'));
  await new Promise(r=>setTimeout(r,30));assert.equal(s.requests.length,1);const payload=JSON.parse(JSON.parse(s.requests[0].data).messages[1].content);assert.equal(payload.question,'操作系统是一组( )程序。');assert.equal(payload.options[0].text,'软件');assert.equal(s.w.document.querySelector('.check_answer').getAttribute('data'),'A');assert.equal(s.w.document.querySelector('#personal-course-control'),null);s.dom.window.close();
});
test('新版明确移除旧模拟计时、外部签名服务和静音保活分支',()=>{
  for(const text of ['playsTime += rate','14.29.190.187','audioPlayer.play()','url: reportsUrl','var audiofile ='])assert.ok(!bundle.includes(text),text);
  assert.equal(bundle.match(/^\/\/ @version\s+(.+)$/m)?.[1],require('../package.json').stableVersion);assert.match(bundle,/@storageName\s+personal-chaoxing-ai-v1/);
});
test('后台监督文件是独立后台脚本，使用与主脚本相同的存储',()=>{
  assert.match(background,/@background/);assert.match(background,/@grant\s+GM_listValues/);assert.match(background,/@storageName\s+personal-chaoxing-ai-v1/);assert.ok(!background.includes('GM_xmlhttpRequest'));assert.ok(!background.includes('apiKey'));
});
test('后台监督可独立启动，且不需要 DOM 或用户 Key',()=>{
  const vm=require('node:vm'),store=new Map();let scheduled;
  vm.runInNewContext(background,{GM_getValue:(k,d)=>store.get(k)??d,GM_setValue:(k,v)=>store.set(k,v),GM_listValues:()=>[],GM_notification:()=>{},setTimeout:(fn,ms)=>{scheduled=ms;},clearTimeout,console});
  assert.equal(scheduled,60000);assert.equal(store.get('edgeStudy.v1.supervisor').version,1);
});
test('最终安装文件收到平台确认后点击实际下一节并加载新章节',()=>{
  const clock={now:1000000},s=load({path:'/mycourse/studentstudy',html:'<iframe src="/mooc-ans/knowledge/cards?knowledgeid=ch"></iframe><button id="prevNextFocusNext">焦点</button><button class="prev_next next">下一节</button>',clock});assert.equal(s.error,undefined);const frame=s.w.document.querySelector('iframe');let next=0,focus=0;s.w.document.querySelector('#prevNextFocusNext').onclick=()=>focus++;s.w.document.querySelector('.next').onclick=()=>{next++;frame.src='/mooc-ans/knowledge/cards?knowledgeid=next';};const complete=()=>s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:s.w.location.origin,source:frame.contentWindow,data:{type:'edgeStudy.chapter.done.v1',chapter:'ch',card:'0'}}));complete();assert.equal(next,0);clock.now+=9999;complete();assert.equal(next,0);clock.now++;complete();assert.equal(next,1);assert.equal(focus,0);assert.match(frame.src,/knowledgeid=next/);s.dom.window.close();
});
test('最终安装文件按页面顺序授权第一个音视频，不被接口数组倒序影响',()=>{
  const data={defaults:{userid:'u',courseid:'c',clazzId:'class',knowledgeid:'ch'},attachments:[{job:true,jobid:'a2',type:'audio',isPassed:false,property:{objectid:'two'}},{job:true,jobid:'v1',type:'video',isPassed:false,property:{objectid:'one'}}]};
  const s=load({data,html:'<iframe data=\'{"objectid":"one"}\' src="/ananas/modules/video/index.html"></iframe><iframe data=\'{"objectid":"two"}\' src="/ananas/modules/audio/index.html"></iframe>'});assert.equal(s.error,undefined);const frames=s.w.document.querySelectorAll('iframe'),bindings=[];frames.forEach(frame=>frame.contentWindow.postMessage=value=>bindings.push(value));s.w.dispatchEvent(new s.w.MessageEvent('message',{origin:s.w.location.origin,source:frames[0].contentWindow,data:{type:'edgeStudy.media.ready.v1'}}));assert.equal(bindings.length,2);assert.equal(bindings[0].enabled,true);assert.equal(bindings[1].enabled,false);assert.equal(bindings[1].queued,true);assert.equal(bindings[0].queueScope,bindings[1].queueScope);assert.equal(bindings[0].queueSession,bindings[1].queueSession);s.dom.window.close();
});
test('最终安装文件只在最外层生成一个总控，章节及试题 iframe 保持无浮窗',()=>{
  const parent=load({path:'/mycourse/studentstudy'});assert.equal(parent.error,undefined);assert.equal(parent.w.document.querySelectorAll('#personal-course-control').length,1);
  for(const path of ['/knowledge/cards','/ananas/modules/video/index.html','/work/phone/doHomeWork']){const child=load({path,embedded:true});assert.equal(child.error,undefined,path);assert.equal(child.w.document.querySelector('#personal-course-control'),null,path);assert.equal(child.roots.length,0,path);child.dom.window.close();}parent.dom.window.close();
});
test('API 配置嵌入唯一总控，Key 不暴露在课程页面 DOM，返回按钮恢复控制页',()=>{
  const s=load({path:'/mycourse/studentstudy'}),root=s.roots.find(r=>r.host.id==='personal-course-control');root.querySelector('#api').click();const api=s.roots.find(r=>r!==root);assert.ok(api);assert.equal(api.host.style.position,'');assert.equal(api.querySelector('#apiKey').type,'password');assert.equal(s.w.document.querySelector('input[type=password]'),null);assert.equal(root.host.shadowRoot,null);assert.equal(s.w.document.querySelectorAll('#personal-course-control').length,1);api.querySelector('#close').click();assert.equal(root.querySelector('#controls').hidden,false);s.dom.window.close();
});
test('稳定版移除旧课程总控和独立 AI 浮窗的生成入口',()=>{
  for(const text of ['课程：打开自动学习控制面板','AI：配置 API / 测试连接','position:fixed;left:12px;bottom:12px','position:fixed;right:16px;top:24px','id="normalQuery"','id="tikupeizhi"'])assert.equal(bundle.includes(text),false,text);
});

test('最终安装包只走统一页面识别，移除旧答题路由与完成全局标记，显示实际版本',()=>{
  for(const text of ['unrivalDoneWorkId','unrivalWorkDone','_w.top.unrivalAutoSubmit','_l.href.includes(\'work/phone/doHomeWork\')','自动提交默认关闭','document.cookie','getCookie','phoneNumber','autoLogin ='])assert.equal(bundle.includes(text),false,text);
  const s=load({path:'/mycourse/studentstudy'});assert.equal(s.error,undefined);assert.equal(s.w.document.querySelector('#personal-course-control').getAttribute('data-version'),require('../package.json').stableVersion);assert.ok(s.roots[0].querySelector('#dragHandle strong').textContent.includes(require('../package.json').stableVersion));s.dom.window.close();
});

test('生成脚本识别真正位于顶层的 workpop，并调用平台原按钮事件',async()=>{
  const parent=new JSDOM(fs.readFileSync('tests/fixtures/workpop.html','utf8'),{url:'https://mooc1.chaoxing.com/mycourse/studentstudy'});
  const html='<div class="TiMu" data="0"><div class="Zy_TItle">【单选题】1+1=?</div><ul class="Zy_ulTop"><li><span class="num_option" data="A">A</span>2</li><li><span class="num_option" data="B">B</span>3</li></ul><input name="answer1" type="hidden"></div><div id="RightCon"><a class="btnSubmit" role="button">提交</a><span class="workStatus">待完成</span></div>';
  const s=load({path:'/mooc-ans/work/doHomeWorkNew',html,quiz:true,embedded:true,autoSubmit:'1'});Object.defineProperty(s.w,'parent',{value:parent.window});let submitted=0;
  s.w.document.querySelector('li').onclick=()=>{s.w.document.querySelector('.num_option').classList.add('check_answer');s.w.document.querySelector('[name=answer1]').value='A';};
  s.w.document.querySelector('.btnSubmit').onclick=()=>parent.window.document.querySelector('#workpop').hidden=false;
  parent.window.document.querySelector('#popok').onclick=()=>{submitted++;parent.window.document.querySelector('#workpop').hidden=true;s.w.document.querySelector('.workStatus').textContent='已提交';};
  await new Promise(r=>setTimeout(r,300));assert.equal(s.requests.length,1);assert.equal(submitted,1);assert.equal(s.w.document.querySelector('.workStatus').textContent,'已提交');assert.equal(s.w.document.querySelector('#personal-course-control'),null);s.w.close();parent.window.close();
});

test('最终安装脚本在任务消息滞后时依据当前目录对钩切章，仍等满十秒',()=>{
  const clock={now:1000000},s=load({path:'/mycourse/studentstudy',clock,html:'<iframe src="/knowledge/cards?knowledgeid=ch"></iframe><div id="curch"><span class="posCatalog_name"></span><span class="icon_Completed">已完成</span></div><button class="prev_next next">下一节</button>'});assert.equal(s.error,undefined);let next=0;s.w.document.querySelector('button.next').onclick=()=>{next++;s.w.document.querySelector('iframe').src='/knowledge/cards?knowledgeid=next';};clock.now+=9999;s.w.dispatchEvent(new s.w.Event('pageshow'));assert.equal(next,0);clock.now++;s.w.dispatchEvent(new s.w.Event('pageshow'));assert.equal(next,1);s.w.close();
});

test('最终安装脚本可将填空答案写入原生控件并走原生提交确认',async()=>{
  const html='<div class="TiMu" data="2"><div class="Zy_TItle">【填空题】填入字母A</div><div class="blankItemDiv"><textarea name="answer42_1"></textarea></div></div><div id="RightCon"><a class="btnSubmit" role="button">提交</a><div id="confirmSubWin" hidden>确认提交？<a role="button">提交</a></div><span class="workStatus">待完成</span></div>';
  const s=load({path:'/mooc-ans/work/doHomeWorkNew',html,quiz:true,embedded:true,autoSubmit:'1'});assert.equal(s.error,undefined);let submitted=0;
  s.w.document.querySelector('.btnSubmit').onclick=()=>s.w.document.querySelector('#confirmSubWin').hidden=false;s.w.document.querySelector('#confirmSubWin a').onclick=()=>{submitted++;s.w.document.querySelector('#confirmSubWin').hidden=true;s.w.document.querySelector('.workStatus').textContent='已提交';};
  await new Promise(r=>setTimeout(r,300));assert.equal(s.requests.length,1);assert.equal(JSON.parse(JSON.parse(s.requests[0].data).messages[1].content).blankCount,1);assert.equal(s.w.document.querySelector('textarea').value,'A');assert.equal(submitted,1);s.w.close();
});
