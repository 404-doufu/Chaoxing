const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const bundle = fs.readFileSync('build/legacy.user.js','utf8');
const source = fs.readFileSync('src/course-helper.js','utf8');
const factory = vm.runInNewContext(source+'\ncreateCourseHelper',{URL,setTimeout,clearTimeout,setInterval:()=>0,clearInterval,console});
const defaults = {clazzId:'class1',courseid:'course1',knowledgeid:'chapter1',userid:'user1',fid:'school1',reportUrl:'https://mooc1.chaoxing.com/report',ktoken:'kt'};
const video = {job:true,type:'video',jobid:'video1',otherInfo:'',property:{objectid:'obj1',name:'示例视频',module:'video',doublespeed:1}};
const document = {job:true,type:'document',jobid:'doc1',jtoken:'jt',property:{name:'示例文档'}};
const work = {job:true,type:'workid',jobid:'work-42',enc:'we',property:{workid:'42',title:'章节测试'}};

function unit(html='', mArg, extra={}) {
    const dom = new JSDOM(html,{url:'https://mooc1.chaoxing.com/knowledge/cards'});dom.window.mArg=mArg;
    const values={}, shadows=[];
    const attach=dom.window.Element.prototype.attachShadow;
    dom.window.Element.prototype.attachShadow=function(options){const root=attach.call(this,options);shadows.push(root);return root;};
    const helper=factory({win:dom.window,doc:dom.window.document,getValue:(k,d)=>values[k]??d,setValue:(k,v)=>values[k]=v,openAI:()=>{},...extra});
    return {helper,dom,values,shadows};
}
function harness({attachments=[video,document],values:patch={},rawScript,metadataFailure=false,documentFailure=false,reportFalse=false,reportFailure=false,url}={}) {
    const dom=new JSDOM('<html><body>'+(rawScript?`<script>${rawScript}</script>`:'')+'</body></html>',{url:url||'https://mooc1.chaoxing.com/knowledge/cards?courseId=course1&clazzId=class1',runScripts:'outside-only'});
    const w=dom.window,values={...patch},calls=[],menus=[],errors=[],shadows=[];let now=0,id=0;
    const timers=new Map();
    const schedule=(fn,ms,interval)=>{const key=++id;timers.set(key,{fn,at:now+Math.max(1,Number(ms)||1),interval});return key;};
    w.setTimeout=(fn,ms)=>schedule(fn,ms,0);w.setInterval=(fn,ms)=>schedule(fn,ms,Math.max(1,Number(ms)||1));
    w.clearTimeout=w.clearInterval=k=>timers.delete(k);
    Object.defineProperty(w.navigator,'userAgent',{value:'Mozilla/5.0 Chrome/130.0.0.0 Edg/130.0.0.0'});
    const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(o){const r=attach.call(this,o);shadows.push(r);return r;};
    w.unsafeWindow=w;w.GM_info={scriptHandler:'ScriptCat'};
    const listeners=new Map();
    w.GM_getValue=(k,d)=>values[k]??d;
    w.GM_setValue=(k,v)=>{const old=values[k];values[k]=v;for(const fn of listeners.get(k)||[])fn(k,old,v,false);};
    w.GM_addValueChangeListener=(k,fn)=>{if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn);};
    w.GM_registerMenuCommand=(name,fn)=>menus.push([name,fn]);
    if(!rawScript)w.mArg={defaults,attachments};
    w.GM_xmlhttpRequest=r=>{
        calls.push(r);
        w.setTimeout(()=>{
            if(r.url.includes('/ananas/status/')){if(metadataFailure)return r.ontimeout();return r.onload({status:200,responseText:JSON.stringify({duration:2,dtoken:'dt'})});}
            if(r.url.includes('getEnc.php'))return r.onload({status:200,responseText:'a'.repeat(32)});
            if(r.url.includes('/report/')){if(reportFailure)return r.ontimeout();return r.onload({status:200,responseText:JSON.stringify({isPassed:!reportFalse})});}
            if(r.url.includes('/ananas/job/document')){if(documentFailure)return r.onerror({error:'network'});return r.onload({status:200,responseText:JSON.stringify({status:true})});}
            errors.push(new Error('Unexpected URL: '+r.url));
        },1);
        return {abort(){}};
    };
    try{w.eval(bundle);}catch(e){errors.push(e);}
    const panel=()=>shadows.filter(x=>x.host.id==='personal-course-control'&&x.host.isConnected).at(-1);
    return {w,values,calls,menus,errors,panel,dom,
        async tick(ms){const target=now+ms;let count=0;for(;;){const entry=[...timers].filter(([,x])=>x.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!entry)break;if(++count>100000)throw Error('timer loop');const[k,t]=entry;now=t.at;if(t.interval)t.at+=t.interval;else timers.delete(k);try{if(typeof t.fn==='function')t.fn();else w.eval(t.fn);}catch(e){errors.push(e);}await Promise.resolve();}now=target;await Promise.resolve();},
        close(){timers.clear();dom.window.close();}
    };
}
test('任务参数支持页面对象和 JSON 字符串',()=>{
    for(const value of [{defaults,attachments:[video]},JSON.stringify({defaults,attachments:[video]})]){
        const s=unit('',value);assert.equal(s.helper.readPageData().attachments.length,1);s.dom.window.close();
    }
});
test('任务参数不再依赖 try/catch、空串声明、空格和固定换行',()=>{
    const data={defaults,attachments:[{...document,property:{name:'带大括号 } 和转义引号 " 的标题'}}]};
    for(const text of [`var mArg=${JSON.stringify(data)};`,`mArg = ""; try {\n mArg=${JSON.stringify(data)}\n } catch (e) {}`,`window.mArg = ${JSON.stringify(data)};`]){
        const s=unit(`<script>${text}</script>`);assert.equal(s.helper.readPageData().attachments[0].property.name,data.attachments[0].property.name);s.dom.window.close();
    }
});
test('不执行页面任意代码，不把无效数据当作无任务',()=>{
    const s=unit('<script>mArg={defaults:{},attachments:[],side:(globalThis.bad=1)};</script>');assert.equal(s.helper.readPageData(),null);assert.equal(s.dom.window.bad,undefined);s.dom.window.close();
});
test('统一控制面板默认开启视频、文档、切章，暂停/恢复可持久化',()=>{
    const s=unit();s.helper.mount();const p=s.shadows.at(-1);
    for(const key of ['video','document','jump','answer'])assert.equal(p.querySelector('#'+key).checked,true);
    assert.equal(p.querySelector('#submit').checked,false);p.querySelector('#pause').click();assert.equal(s.values['personalCourse.paused'],true);p.querySelector('#resume').click();assert.equal(s.values['personalCourse.paused'],false);s.dom.window.close();
});
test('任务页未获取参数时仍显示完整课程控制入口，不静默退出或跳章',async()=>{
    const s=harness({rawScript:'var other=1;'});await s.tick(1000);assert.equal(s.errors.length,0);assert.ok(s.panel());assert.match(s.panel().querySelector('#status').textContent,/未识别到/);assert.equal(s.w.jump,undefined);s.close();
});
test('没有 AI Key 也能完整执行视频和文档队列，平台确认完成后请求切章',async()=>{
    const s=harness();await s.tick(20000);assert.deepEqual(s.errors,[]);
    assert.equal(s.calls.filter(x=>x.url.includes('/ananas/status/')).length,1);
    assert.equal(s.calls.filter(x=>x.url.includes('/report/')).length,1);
    assert.equal(s.calls.filter(x=>x.url.includes('/ananas/job/document')).length,1);
    assert.ok(!s.calls.some(x=>x.url.includes('api.deepseek.com')));assert.equal(s.w.jump,true);
    const tasks=s.panel().querySelector('#tasks').textContent;assert.match(tasks,/视频\/音频：示例视频 — 已完成/);assert.match(tasks,/文档：示例文档 — 已完成/);s.close();
});
test('章节任务页直接打开时，没有父窗口脚本列表也能运行',async()=>{
    const s=harness({attachments:[document]});assert.equal(s.w.unrivalScriptList,undefined);await s.tick(16000);assert.deepEqual(s.errors,[]);assert.equal(s.w.jump,true);s.close();
});
test('视频和文档关闭时不发相应任务请求',async()=>{
    const s=harness({values:{'personalCourse.video':false,'personalCourse.document':false}});await s.tick(16000);assert.equal(s.calls.length,0);assert.deepEqual(s.errors,[]);s.close();
});
test('暂停期间不启动文档请求，恢复后执行',async()=>{
    const s=harness({attachments:[document],values:{'personalCourse.paused':true}});await s.tick(20000);assert.equal(s.calls.length,0);assert.notEqual(s.w.jump,true);s.panel().querySelector('#resume').click();await s.tick(16000);assert.equal(s.calls.length,1);assert.equal(s.w.jump,true);s.close();
});
test('文档已进入等待时暂停，延迟到期也不发出新请求',async()=>{
    const s=harness({attachments:[document]});await s.tick(500);s.panel().querySelector('#pause').click();await s.tick(16000);assert.equal(s.calls.length,0);s.panel().querySelector('#resume').click();await s.tick(2000);assert.equal(s.calls.length,1);s.close();
});
test('视频计时在暂停期间停止，恢复后再进入报告流程',async()=>{
    const s=harness({attachments:[video]});await s.tick(600);s.panel().querySelector('#pause').click();await s.tick(5000);assert.equal(s.calls.length,1);s.panel().querySelector('#resume').click();await s.tick(2000);assert.ok(s.calls.some(x=>x.url.includes('/report/')));s.close();
});
test('视频详情超时不会永远等待，也不会误标完成或跳章',async()=>{
    const s=harness({attachments:[video],metadataFailure:true});await s.tick(20000);assert.deepEqual(s.errors,[]);assert.match(s.panel().querySelector('#status').textContent,/失败/);assert.notEqual(s.w.jump,true);s.close();
});
test('文档网络失败不会误标完成或跳章',async()=>{
    const s=harness({attachments:[document],documentFailure:true});await s.tick(20000);assert.deepEqual(s.errors,[]);assert.match(s.panel().querySelector('#tasks').textContent,/失败，待重试/);assert.notEqual(s.w.jump,true);s.close();
});
test('章节测试任务仍接入原 iframe 调度，视频/文档与答题共用队列',async()=>{
    const s=harness({attachments:[document,work]});await s.tick(17000);assert.deepEqual(s.errors,[]);assert.match(s.w.document.querySelector('#frame_content').src,/workId=42/);assert.equal(s.w.document.querySelector('#workPanel').style.display,'block');assert.notEqual(s.w.jump,true);s.close();
});
test('课程主页自动显示完整面板，原下一章按钮可触发',async()=>{
    const s=harness({url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=course1&clazzId=class1'});
    const button=s.w.document.createElement('button');button.className='orientationright';let clicks=0;button.onclick=()=>clicks++;s.w.document.body.append(button);s.w.unrivalPageRd='r1';s.w.jump=true;
    await s.tick(10000);assert.deepEqual(s.errors,[]);assert.ok(s.panel());assert.equal(clicks,1);s.close();
});
test('关闭自动切章时不点击下一章，重新开启后正常切章',async()=>{
    const s=harness({url:'https://mooc1.chaoxing.com/mycourse/studentstudy',values:{'personalCourse.jump':false}});
    const button=s.w.document.createElement('button');button.className='orientationright';let clicks=0;button.onclick=()=>clicks++;s.w.document.body.append(button);s.w.unrivalPageRd='r1';s.w.jump=true;
    await s.tick(10000);assert.equal(clicks,0);s.w.GM_setValue('personalCourse.jump',true);await s.tick(10000);assert.equal(clicks,1);s.close();
});
test('内部兼容构建保留基线版本和隔离存储，用于稳定版构建与兼容回归',()=>{
    assert.equal(bundle.match(/^\/\/ @version\s+(.+)$/m)?.[1],require('../package.json').version);assert.match(bundle,/@storageName\s+personal-chaoxing-ai-v1/);
});
test('本地 MD5 与 Node 标准库逐一比对，覆盖 ASCII、中文、emoji 和分块边界',()=>{
    const {createHash}=require('node:crypto');const s=unit();
    for(const text of ['', 'a','abc','message digest','中文课程🎓','a'.repeat(55),'a'.repeat(56),'a'.repeat(63),'a'.repeat(64),'a'.repeat(65),'视频'.repeat(80),'\ud800'])assert.equal(s.helper.md5(text),createHash('md5').update(text).digest('hex'),text);
    s.dom.window.close();
});
test('视频原协议摘要在本地计算，不调用旧签名服务、不依赖页面 jQuery',async()=>{
    const {createHash}=require('node:crypto');const s=harness({attachments:[video]});await s.tick(3000);
    assert.deepEqual(s.errors,[]);assert.ok(!s.calls.some(x=>x.url.includes('getEnc.php')));assert.ok(!bundle.includes('14.29.190.187'));
    const url=new URL(s.calls.find(x=>x.url.includes('/report/')).url);
    // UID 来自课程 defaults，确保实际请求使用当前课程身份字段。
    const actualExpected=createHash('md5').update('[class1][user1][video1][obj1][0][d_yHJ!$pdA~5][2000][0_2]').digest('hex');
    assert.equal(url.searchParams.get('enc'),actualExpected);s.close();
});
test('视频播放计时结束但平台未确认时停止，不将任务标为完成',async()=>{
    const s=harness({attachments:[video],reportFalse:true});await s.tick(15000);assert.deepEqual(s.errors,[]);assert.match(s.panel().querySelector('#tasks').textContent,/失败，待重试/);assert.notEqual(s.w.jump,true);s.close();
});
test('视频进度请求超时会停止并显示失败，不自动重发或切章',async()=>{
    const s=harness({attachments:[video],reportFailure:true});await s.tick(15000);assert.deepEqual(s.errors,[]);assert.match(s.panel().querySelector('#status').textContent,/超时/);assert.match(s.panel().querySelector('#tasks').textContent,/失败，待重试/);assert.notEqual(s.w.jump,true);assert.equal(s.calls.filter(x=>x.url.includes('/report/')).length,1);s.close();
});
test('视频详情解析兼容 JSON 文本、response 对象和 data 包装',()=>{
    const s=unit();
    for(const response of [{responseText:'{"duration":"2","dtoken":"test"}'},{response:{duration:2,dtoken:'test'}},{responseText:'{"data":{"duration":2,"dtoken":"test"}}'}])assert.equal(s.helper.parseVideoInfo({status:200,...response}).duration,2);
    s.dom.window.close();
});
test('HTTP、登录页、验证码、非 JSON 和缺字段显示具体分类，不输出响应敏感值',()=>{
    const s=unit();
    for(const [response,pattern]of [
        [{status:403},/HTTP 403/],
        [{status:200,responseText:'<html>login password=secret</html>'},/登录页面/],
        [{status:200,responseText:'<html>验证码</html>'},/手动完成验证/],
        [{status:200,responseText:'not-json'},/有效 JSON/],
        [{status:200,responseText:'{"duration":2,"msg":"secret-value"}'},/dtoken.*返回字段：duration、msg/]
    ]){
        assert.throws(()=>s.helper.parseVideoInfo(response),e=>pattern.test(e.message)&&!e.message.includes('secret'));
    }
    s.dom.window.close();
});
test('优先使用同源 fetch，保留课程登录态，不调用扩展请求',async()=>{
    let gm=0,observed;
    const s=unit('',undefined,{request:()=>gm++});
    s.dom.window.fetch=async(url,options)=>{observed={url,options};return{status:200,url,text:async()=>' {"duration":2,"dtoken":"test"} '};};
    const result=await s.helper.requestVideoInfo(video,{fid:'school1'});
    assert.equal(result.transport,'同源请求');assert.equal(observed.options.credentials,'same-origin');assert.equal(observed.options.mode,'same-origin');assert.equal(gm,0);s.dom.window.close();
});
test('同源网络请求失败才回退脚本猫，且保留凭据和当前站点域名',async()=>{
    let req;
    const s=unit('',undefined,{request:r=>{req=r;r.onload({status:200,responseText:'{"duration":2,"dtoken":"test"}'});return{abort(){}};}});
    s.dom.window.fetch=async()=>{throw new TypeError('Failed to fetch');};
    const result=await s.helper.requestVideoInfo(video,{fid:'school1'});
    assert.equal(result.transport,'脚本猫请求');assert.equal(req.anonymous,false);assert.equal(new URL(req.url).origin,s.dom.window.location.origin);s.dom.window.close();
});
test('HTTP 登录错误不重复切换传输请求',async()=>{
    let gm=0;const s=unit('',undefined,{request:()=>gm++});
    s.dom.window.fetch=async(url)=>({status:401,url,text:async()=>''});
    await assert.rejects(s.helper.requestVideoInfo(video,{fid:'school1'}),/HTTP 401/);assert.equal(gm,0);s.dom.window.close();
});
test('objectid/fid 缺失直接提示，不请求 undefined 地址；兼容 objectId 并编码参数',async()=>{
    let calls=0,req;const s=unit('',undefined,{request:r=>{calls++;req=r;r.onload({status:200,responseText:'{"duration":2,"dtoken":"test"}'});return{abort(){}};}});
    await assert.rejects(s.helper.requestVideoInfo({property:{}},{fid:'school1'}),/objectid/);
    await assert.rejects(s.helper.requestVideoInfo(video,{fid:''}),/fid/);assert.equal(calls,0);
    const result=await s.helper.requestVideoInfo({property:{objectId:'id/a?b'}},{fid:'school&value'});
    assert.equal(result.objectId,'id/a?b');assert.equal(new URL(req.url).searchParams.get('k'),'school&value');assert.match(new URL(req.url).pathname,/id%2Fa%3Fb/);s.dom.window.close();
});
test('脚本猫授权错误提示当前域名且不泄露原错误里的完整敏感地址',async()=>{
    const s=unit('',undefined,{request:r=>{r.onerror({error:'URL https://example.com/?secret=abc is not in @connect list'});return{abort(){}};}});
    await assert.rejects(s.helper.requestVideoInfo(video,{fid:'school1'}),e=>/mooc1\.chaoxing\.com.*授权/.test(e.message)&&!e.message.includes('secret'));s.dom.window.close();
});
test('主日志直接显示视频详情超时原因',async()=>{
    const s=harness({attachments:[video],metadataFailure:true});await s.tick(1000);assert.match(s.w.document.querySelector('#log').textContent,/获取视频\/音频任务详情失败：.*脚本猫请求超时/);s.close();
});
