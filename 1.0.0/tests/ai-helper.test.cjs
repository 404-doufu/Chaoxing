const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('src/page-adapter.js', 'utf8') + '\n' + fs.readFileSync('src/blank-fields.js', 'utf8') + '\n' + fs.readFileSync('src/ai-helper.js', 'utf8');
const factory = vm.runInNewContext(source + '\ncreateAIHelper', { URL, AbortController, setTimeout, clearTimeout, console });

function fixture(number, type = '0', opts = ['红色', '深红色', '蓝色']) {
    const isBool = type === '3';
    const choices = isBool ? ['true', 'false'].map((x, i) => `<li id-param="${number}" val-param="${x}">${i ? '错误' : '正确'}</li>`).join('') : opts.map((x, i) => `<li id-param="${number}"><em id-param="${String.fromCharCode(65 + i)}">${String.fromCharCode(65 + i)}.</em><span>${x}</span></li>`).join('');
    return `<div class="Py-mian1"><div class="Py-m1-title fs16">${number}.[${({0:'单选题',1:'多选题',3:'判断题'})[type] || '填空题'}]题目 ${number} &lt;测试&gt;</div><input id="answertype${number}" name="answertype${number}" value="${type}" type="hidden"><input name="answer${number}" type="hidden" value=""><ul class="answerList">${choices}</ul></div>`;
}
function setup(html = fixture(1), replies = [{ answer: ['B'], explanation: '依据' }], extra = {}) {
    const dom = new JSDOM(html, { url: 'https://mooc1.chaoxing.com/work/phone/doHomeWork?workId=42' });
    const doc = dom.window.document;
    doc.querySelectorAll('.Py-mian1').forEach(root => {
        const multi = root.querySelector('[id^=answertype]')?.value === '1';
        root.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
            if (!multi) root.querySelectorAll('li').forEach(x => x.classList.remove('cur'));
            li.classList.toggle('cur');
            const selected = [...root.querySelectorAll('li.cur')].map(x => x.getAttribute('val-param') || x.querySelector('em').getAttribute('id-param'));
            root.querySelector('[name^=answer]:not([name^=answertype])').value = selected.join('');
        }));
    });
    const values = { 'personalAI.config.v1': { apiKey: 'sk-TEST-DO-NOT-USE', interval: 0, retries: 0 }, ...extra.values };
    const calls = [], reports = [], completed = [];
    let aborted = 0;
    const env = {
        win: dom.window, doc, getValue: (k, d) => values[k] ?? d,
        setValue: (k, v) => { values[k] = v; }, report: x => reports.push(x),
        onComplete: x => completed.push(x),
        request: req => {
            calls.push(req); const reply = replies[calls.length - 1] ?? replies.at(-1);
            const timer = setTimeout(() => {
                if (typeof reply === 'function') return reply(req);
                req.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }) });
            }, extra.delay || 0);
            return { abort() { aborted++; clearTimeout(timer); req.onabort?.(); } };
        },
        ...extra.env
    };
    const helper = factory(env);
    return { helper, dom, doc, values, calls, reports, completed, aborted: () => aborted };
}
function json(value) { return JSON.parse(JSON.stringify(value)); }

test('API 地址规范化，支持基础地址、v1、完整接口和本机', () => {
    const { helper: h } = setup();
    for (const [input, output] of [
        ['https://api.deepseek.com/', 'https://api.deepseek.com/chat/completions'],
        ['https://example.com/v1/', 'https://example.com/v1/chat/completions'],
        ['https://example.com/v1/chat/completions', 'https://example.com/v1/chat/completions'],
        ['http://127.0.0.1:8080/v1', 'http://127.0.0.1:8080/v1/chat/completions']
    ]) assert.equal(h.endpoint(input), output);
    for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:pw@example.com', 'https://example.com/?key=secret', 'https://example.com/#secret']) assert.throws(() => h.endpoint(url));
});
test('配置校验不接受空 Key、非整数、无效范围，错误配置不落盘', () => {
    const { helper: h, values } = setup();
    for (const patch of [{apiKey:''}, {apiKey:'x\nX: bad'}, {timeout:9}, {retries:4}, {interval:-1}, {maxTokens:2}, {retries:NaN}, {timeout:10000.5}]) {
        assert.throws(() => h.save({...h.config(), ...patch}));
    }
    assert.equal(values['personalAI.config.v1'].apiKey, 'sk-TEST-DO-NOT-USE');
});
test('提取题目、编号与 HTML 实体，保留重复选项文本的不同编号', () => {
    const { helper: h } = setup(fixture(1, '0', ['相同', '相同', '不同']));
    const [q] = h.readQuestions();
    assert.equal(q.text, '题目 1 <测试>');
    assert.deepEqual(json(q.options.map(o => o.id)), ['A', 'B', 'C']);
    assert.equal(q.reason, '');
});

test('向父运行层报告真实答题活动，停止请求后清除忙碌状态',async()=>{
    const activity=[],s=setup(fixture(1),[{answer:['A']}],{delay:100,env:{activity:x=>activity.push(x)}});const pending=s.helper.run();assert.deepEqual(activity,[true]);s.helper.stop();await pending;assert.deepEqual(activity,[true,false]);s.dom.window.close();
});
test('JSON 答案支持单选、多选、判断和代码围栏', () => {
    const { helper: h } = setup(); const q = h.readQuestions()[0];
    assert.deepEqual(json(h.parseAnswer('```json\n{"answer":["b"]}\n```', q).values), ['B']);
    assert.deepEqual(json(h.parseAnswer('{"answer":["A","C"]}', {...q, type:'多选题'}).values), ['A','C']);
    for (const value of [false, 'false', '错误', ['错']]) assert.deepEqual(json(h.parseAnswer(JSON.stringify({answer:value}), {...q, type:'判断题'}).values), ['false']);
});
test('拒绝不存在、重复、空、含解释文字或不确定的答案，不做子串匹配', () => {
    const { helper: h } = setup(); const q = h.readQuestions()[0];
    for (const value of [{answer:[]},{answer:['Z']},{answer:['A','B']},{answer:'答案是B'},{answer:'深红色'},{answer:['B'],uncertain:true},{answer:['B','B']},null]) {
        assert.throws(() => h.parseAnswer(JSON.stringify(value), q));
    }
    assert.throws(() => h.parseAnswer('{"answer":"maybe"}', {...q, type:'判断题'}));
});
test('完整单选请求仅发送题干、题型、选项，并精确选择 B', async () => {
    const { helper: h, calls, reports, completed } = setup();
    const result = await h.run();
    assert.equal(result.filled, 1); assert.equal(completed.length, 1);
    assert.equal(h.readQuestions()[0].options[1].node.className, 'cur');
    const request = calls[0], body = JSON.parse(request.data);
    assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer sk-TEST-DO-NOT-USE');
    assert.equal(request.anonymous, true); assert.equal(request.redirect, 'error');
    assert.equal(body.stream, false); assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.thinking.type, 'disabled');
    assert.deepEqual(Object.keys(JSON.parse(body.messages[1].content)).sort(), ['options','question','type']);
    assert.ok(!JSON.stringify(reports).includes('sk-TEST')); assert.ok(!JSON.stringify(body).includes('sk-TEST'));
});
test('多题串行处理，单选/多选/判断不会串题', async () => {
    const { helper: h, completed } = setup(fixture(1) + fixture(2,'1') + fixture(3,'3'), [{answer:['B']},{answer:['A','C']},{answer:false}]);
    const result = await h.run();
    assert.equal(result.filled, 3); assert.equal(result.ratio, 100);
    assert.deepEqual(json(h.readQuestions().map(q => q.options.filter(o=>o.node.classList.contains('cur')).map(o=>o.id))), [['B'],['A','C'],['false']]);
    assert.equal(completed.length,1);
});
test('重复多选填答幂等，并能取消多余的旧选项', () => {
    const { helper:h }=setup(fixture(1,'1')); const q=h.readQuestions()[0];
    q.options[1].node.click();
    h.applyAnswer(q,{values:['A','C']}); h.applyAnswer(q,{values:['A','C']});
    assert.deepEqual(json(q.options.filter(o=>o.node.classList.contains('cur')).map(o=>o.id)),['A','C']);
});
test('保留已有选择，不花费 API 调用', async () => {
    const { helper:h,calls }=setup(); h.readQuestions()[0].options[0].node.click();
    const result=await h.run(); assert.equal(result.existing,1);assert.equal(calls.length,0);
});
test('图像题、缺少填空控件、题干缺失计入总数，跳过且不请求', async () => {
    const { helper:h,doc,calls }=setup(fixture(1)+fixture(2,'2')+fixture(3));
    doc.querySelector('.Py-m1-title').append(doc.createElement('img'));
    doc.querySelectorAll('.Py-m1-title')[2].remove();
    const result=await h.run();assert.equal(result.total,3);assert.equal(result.skipped,3);assert.equal(result.ratio,0);assert.equal(calls.length,0);
});
test('未知判断值不根据顺序猜测 true/false', () => {
    const { helper:h,doc }=setup(fixture(1,'3'));
    doc.querySelectorAll('li').forEach(x=>{x.removeAttribute('val-param');x.textContent='未知';});
    assert.match(h.readQuestions()[0].reason,/true\/false/);
});
test('空题目不触发完成和提交回调', async () => {
    const {helper:h,calls,completed}=setup('<div>不是测试页面</div>');
    assert.equal(await h.run(),undefined);assert.equal(calls.length,0);assert.equal(completed.length,0);
});
test('停止立即 abort 请求，迟到结果不填答、不触发完成回调', async () => {
    const {helper:h,calls,completed,aborted}=setup(fixture(1),[{answer:['B']}],{delay:100});
    const pending=h.run(); assert.equal(calls.length,1);h.stop();
    const result=await pending;assert.equal(result.cancelled,true);assert.equal(aborted(),1);assert.equal(completed.length,0);
    calls[0].onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'{"answer":["B"]}'}}]})});
    assert.equal(h.readQuestions()[0].options.some(o=>o.node.classList.contains('cur')),false);
});
test('父配置面板发出的停止通知可以停止试题 iframe 的请求', async () => {
    let listener;
    const s=setup(fixture(1),[{answer:['B']}],{delay:100,env:{listenValue:(key,fn)=>{listener=fn;}}});
    const pending=s.helper.run();listener();
    assert.equal((await pending).cancelled,true);assert.equal(s.aborted(),1);
});
test('等待期间用户手动改答案，保留手动选择', async () => {
    const {helper:h,completed}=setup(fixture(1),[{answer:['B']}],{delay:20});
    const pending=h.run();h.readQuestions()[0].options[0].node.click();
    const result=await pending;assert.equal(result.failed,1);assert.equal(result.filled,0);
    assert.equal(h.readQuestions()[0].options[0].node.className,'cur');assert.equal(completed[0].ratio,0);
});
test('页面未确认选中时不计入填答成功，建议仍可供手动参考', async () => {
    const {helper:h,doc}=setup();
    doc.querySelectorAll('li').forEach(x=>x.replaceWith(x.cloneNode(true)));
    const result=await h.run();assert.equal(result.filled,0);assert.equal(result.failed,1);
    assert.match(doc.querySelector('.dsa-result').textContent,/AI 建议：B/);
});
test('Key 无效立即停止整队，不重复向后续题目请求', async () => {
    const {helper:h,calls,completed}=setup(fixture(1)+fixture(2),[r=>r.onload({status:401,responseText:'secret'})]);
    const result=await h.run();assert.equal(result.failed,1);assert.equal(calls.length,1);assert.equal(completed.length,0);
});
test('503 按配置有限重试后成功', async () => {
    const {helper:h,calls}=setup(fixture(1),[r=>r.onload({status:503}),{answer:['A']}],{values:{'personalAI.config.v1':{apiKey:'test',interval:0,retries:1}}});
    const result=await h.run();assert.equal(result.filled,1);assert.equal(calls.length,2);
});
test('超时重试次数受限，最终失败不乱选', async () => {
    const {helper:h,calls}=setup(fixture(1),[r=>r.ontimeout()]);
    const result=await h.run();assert.equal(result.failed,1);assert.equal(calls.length,1);assert.equal(result.filled,0);
});
test('无效 JSON、空响应和截断输出不乱选', async () => {
    for(const choice of [{message:{content:'oops'}},{message:{content:''}},{message:{content:'{"answer":["B"]}'},finish_reason:'length'}]) {
        const {helper:h}=setup(fixture(1),[r=>r.onload({status:200,responseText:JSON.stringify({choices:[choice]})})]);
        const result=await h.run();assert.equal(result.failed,1);assert.equal(result.filled,0);
    }
});
test('缓存与选项顺序、模型绑定，配置保存清缓存', async () => {
    const {helper:h,calls}=setup();const q=h.readQuestions()[0];const c=h.validate(h.config());
    await h.answer(q,c);await h.answer(q,c);assert.equal(calls.length,1);
    await h.answer({...q,options:[...q.options].reverse()},c);assert.equal(calls.length,2);
    h.save(c);await h.answer(q,c);assert.equal(calls.length,3);
});
test('配置面板可保存/清除 Key，模型文本不会作为 HTML 插入', () => {
    const {helper:h,doc,values}=setup();
    const original=doc.createElement.bind(doc);let shadow;
    doc.createElement=(name,...args)=>{const el=original(name,...args);if(name==='div'){const attach=el.attachShadow.bind(el);el.attachShadow=o=>(shadow=attach(o));}return el;};
    h.openSettings();assert.equal(shadow.querySelector('#apiKey').type,'password');
    shadow.querySelector('#model').value='<img src=x onerror=alert(1)>';
    shadow.querySelector('#save').click();assert.equal(values['personalAI.config.v1'].model,'<img src=x onerror=alert(1)>');assert.equal(shadow.querySelectorAll('img').length,0);
    shadow.querySelector('#clear').click();assert.equal(values['personalAI.config.v1'].apiKey,'');
});
test('模型解释作为纯文本展示，不执行 HTML', async () => {
    const {helper:h,doc}=setup(fixture(1),[{answer:['B'],explanation:'<img src=x onerror=alert(1)>'}]);
    await h.run();assert.equal(doc.querySelector('.dsa-result img'),null);assert.match(doc.querySelector('.dsa-result').textContent,/<img/);
});
test('本机自定义模型兼容请求可以关闭 JSON 模式，不发送专属 thinking 字段', async () => {
    const {helper:h,calls}=setup();const q=h.readQuestions()[0];
    await h.answer(q,h.validate({...h.config(),baseURL:'http://localhost:8000/v1',model:'my-deepseek',jsonMode:false}));
    const body=JSON.parse(calls[0].data);assert.equal(body.response_format,undefined);assert.equal(body.thinking,undefined);
});
test('连接测试每次真实请求，不使用答题缓存', async () => {
    const {helper:h,calls}=setup(fixture(1),[{answer:['A']}]);
    await h.testConnection(h.config());await h.testConnection(h.config());assert.equal(calls.length,2);
});
test('原生 radio 结构可读取和填写', async () => {
    const html='<div class="questionLi"><div class="mark_name">[单选题]1+1=?</div><label><input type="radio" name="q" value="A">A. 2</label><label><input type="radio" name="q" value="B">B. 3</label></div>';
    const {helper:h,doc}=setup(html,[{answer:['A']}]);const result=await h.run();assert.equal(result.filled,1);assert.equal(doc.querySelector('input').checked,true);
});
test('嵌套题目容器不重复发送', () => {
    const {helper:h}=setup('<div class="TiMu">'+fixture(1)+'</div>');assert.equal(h.readQuestions().length,1);
});
