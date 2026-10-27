const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const factory=vm.runInNewContext(fs.readFileSync('src/page-adapter.js','utf8')+'\ncreatePageAdapter',{URL});
function setup(path,html=''){const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com'+path});return{dom,w:dom.window,doc:dom.window.document,page:factory(dom.window,dom.window.document)};}
test('统一识别新旧测验、作业容器、章节、媒体与提交结果路由',()=>{
  for(const [path,role] of [['/mooc-ans/work/doHomeWorkNew','quiz'],['/work/phone/doHomeWork','quiz'],['/work/doHomeWork','quiz'],['/work/doHomeWorkNew/','quiz'],['/work/selectWorkQuestionYiPiYueNew','review'],['/work/phone/selectWorkQuestionYiPiYue','review'],['/mooc-ans/api/work','quizHost'],['/ananas/modules/work/index.html','quizHost'],['/mycourse/studentstudy/','main'],['/mooc-ans/knowledge/cards/','chapter'],['/ananas/modules/audio/index.html','media'],['/ananas/modules/pdf/index.html','document']]){const s=setup(path);assert.equal(s.page.role(),role,path);s.w.close();}
});
test('新地址依据实际题目与原生入口识别，结果页或无入口页面不误判',()=>{
  const html='<div class="TiMu"><ul class="Zy_ulTop"><li>A</li><li>B</li></ul></div>';
  for(const [path,suffix,expected] of [['/work/new-version','<a class="btnSubmit">提交</a>','quiz'],['/work/new-version','',''],['/work/selectWorkQuestionYiPiYueNew','<a class="btnSubmit">提交</a>','review'],['/unrelated','<a class="btnSubmit">提交</a>','']]){const s=setup(path,html+suffix);assert.equal(s.page.role(),expected);s.w.close();}
});
test('实页 workpop 模板识别一次，按显示文字提交而非旧 onclick 名称',()=>{
  const s=setup('/mycourse/studentstudy',fs.readFileSync('tests/fixtures/workpop.html','utf8'));assert.equal(s.page.confirmation(s.doc),null);s.doc.querySelector('#workpop').hidden=false;const result=s.page.confirmation(s.doc);assert.equal(result.button.id,'popok');assert.equal(result.blocked,undefined);s.w.close();
});
test('新语义弹窗支持提交/确认/确定，取消或未答题警告不自动点击',()=>{
  for(const label of ['提交','确定','确认','确认提交']){const s=setup('/work/doHomeWorkNew',`<section role="dialog"><p>确认提交？</p><button>${label}</button><button>取消</button></section>`);assert.equal(s.page.confirmation(s.doc).button.textContent,label);s.w.close();}
  const s=setup('/work/doHomeWorkNew','<section role="dialog">存在未答题目，确认提交？<button>提交</button><button>取消</button></section>');assert.equal(s.page.confirmation(s.doc).blocked,true);s.w.close();
});
test('多入口有歧义时停止；隐藏父容器里的弹窗不识别',()=>{
  const s=setup('/work/doHomeWorkNew','<div hidden><section role="dialog">确认提交？<button>提交</button></section></div>');assert.equal(s.page.confirmation(s.doc),null);s.doc.querySelector('div').hidden=false;s.doc.querySelector('section').insertAdjacentHTML('beforeend','<button>确定</button>');assert.equal(s.page.confirmation(s.doc).blocked,true);s.w.close();
});

test('目录只识别当前行的完成图标，不把别节、子节或数字 0 当作完成',()=>{
  const s=setup('/mycourse/studentstudy','<div id="curother"><span class="icon_Completed"></span></div><div id="curchapter"><span class="posCatalog_name" title="本节"></span><span>0</span><div id="curchild"><span class="icon_Completed"></span></div></div>');assert.equal(s.page.chapterStatus('chapter').completed,false);assert.equal(s.page.chapterStatus('missing'),null);s.doc.querySelector('#curchapter').insertAdjacentHTML('beforeend','<span class="icon_Completed"><span class="prevHoverTips">已完成</span></span>');assert.equal(s.page.chapterStatus('chapter').completed,true);s.w.close();
});
