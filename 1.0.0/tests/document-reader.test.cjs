const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const factory=vm.runInNewContext(fs.readFileSync('src/document-reader.js','utf8')+'\ncreateDocumentReader');
function setup(html='<div id="viewerContainer" style="overflow-y:auto"><canvas></canvas></div>'){
  const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com/ananas/modules/pdf/index.html'}),w=dom.window;
  let time=0;const reader=factory({win:w,doc:w.document,now:()=>time});
  return {w,reader,at:t=>time=t,close:()=>w.close()};
}
function scrollbox(element,{height=500,width=800,length=1800,stuck=false}={}){
  let top=0,calls=0;
  Object.defineProperties(element,{clientHeight:{get:()=>height},clientWidth:{get:()=>width},scrollHeight:{get:()=>length},scrollTop:{get:()=>top,set:v=>top=v}});
  element.scrollTo=({top:value})=>{calls++;if(!stuck)top=value;};
  return {get top(){return top;},get calls(){return calls;},length:v=>length=v};
}
test('连续课件识别后直接滚动内部阅读器至末尾',()=>{
  const s=setup(),box=scrollbox(s.w.document.querySelector('#viewerContainer'));s.reader.step();assert.equal(box.calls,1);assert.equal(box.top,1300);assert.equal(s.w.document.documentElement.scrollTop,0);s.close();
});
test('翻到末尾后等待稳定，仅返回等待平台确认',()=>{
  const s=setup(),box=scrollbox(s.w.document.querySelector('#viewerContainer'),{length:900});s.reader.step();s.at(500);assert.equal(s.reader.step().phase,'waiting');s.at(2000);assert.equal(s.reader.step().phase,'confirming');assert.equal(box.calls,1);s.close();
});
test('懒加载新增页后继续滚动，不停在原来的文档底部',()=>{
  const s=setup(),box=scrollbox(s.w.document.querySelector('#viewerContainer'),{length:900});s.reader.step();s.at(500);s.reader.step();box.length(1700);s.at(1000);assert.equal(s.reader.step().phase,'playing');assert.equal(box.top,1200);s.at(1500);s.reader.step();box.length(2100);s.at(2000);s.reader.step();assert.equal(box.top,1600);s.close();
});
test('恢复后至多滚动一次，不补翻暂停期间应翻的页数',()=>{
  const s=setup(),box=scrollbox(s.w.document.querySelector('#viewerContainer'));s.reader.step();box.length(3000);s.at(600000);s.reader.resume();s.reader.step();assert.equal(box.calls,1);s.at(600500);s.reader.step();assert.equal(box.calls,2);assert.equal(box.top,2500);s.close();
});
test('分页模式等待页码改变，不在加载中连续点击下一页',()=>{
  const s=setup('<input id="pageNumber" value="1"><span id="numPages">3</span><button id="nextPage">下一页</button>');let clicks=0;s.w.document.querySelector('button').onclick=()=>clicks++;
  s.reader.step();s.at(500);assert.equal(s.reader.step().phase,'buffering');assert.equal(clicks,1);s.w.document.querySelector('input').value='2';s.at(1000);s.reader.step();assert.equal(clicks,1);s.at(1500);s.reader.step();assert.equal(clicks,2);s.close();
});
test('分页达到最后一页时不再点击下一页',()=>{
  const s=setup('<input id="pageNumber" value="3"><span id="numPages">3</span><button id="nextPage">下一页</button>');let clicks=0;s.w.document.querySelector('button').onclick=()=>clicks++;s.reader.step();s.at(1500);assert.equal(s.reader.step().phase,'confirming');assert.equal(clicks,0);s.close();
});
test('翻页不生效时提示人工处理，不无限点击',()=>{
  const s=setup(),box=scrollbox(s.w.document.querySelector('#viewerContainer'),{stuck:true});s.reader.step();s.at(30000);assert.equal(s.reader.step().phase,'needs_user');s.at(60000);s.reader.step();assert.equal(box.calls,1);s.close();
});
test('空白或不可访问阅读器不会误判完成',()=>{
  const s=setup('<iframe></iframe>');s.reader.step();s.at(46000);assert.equal(s.reader.step().phase,'needs_user');assert.equal(s.reader.step().reason,'reader-unavailable');s.close();
});
test('同源多层 iframe 中定位实际阅读器',()=>{
  const s=setup('<iframe></iframe>');const inner=s.w.document.querySelector('iframe').contentDocument;inner.body.innerHTML='<div id="viewerContainer" style="overflow-y:auto"><canvas></canvas></div>';const box=scrollbox(inner.querySelector('div'));s.reader.step();assert.equal(box.top,1300);assert.equal(s.w.document.documentElement.scrollTop,0);s.close();
});
test('未知下一节按钮不能作为课件翻页按钮点击',()=>{
  const s=setup('<button id="next">下一节</button>');let clicks=0;s.w.document.querySelector('button').onclick=()=>clicks++;s.reader.step();s.at(60000);assert.equal(s.reader.step().phase,'needs_user');assert.equal(clicks,0);s.close();
});
test('跨域或内置 PDF 的外壳滚动不能当作文档翻阅',()=>{
  const s=setup('<div id="viewerContainer" style="overflow-y:auto"><embed type="application/pdf"></div>'),box=scrollbox(s.w.document.querySelector('div'));s.reader.step();s.at(46000);assert.equal(s.reader.step().reason,'reader-unavailable');assert.equal(box.calls,0);s.close();
});
test('延迟加载的阅读器出现后可以重新识别并翻阅',()=>{
  const s=setup('<div></div>');s.reader.step();s.at(46000);assert.equal(s.reader.step().phase,'needs_user');s.w.document.body.innerHTML='<div id="viewerContainer" style="overflow-y:auto"><canvas></canvas></div>';const box=scrollbox(s.w.document.querySelector('div'));assert.equal(s.reader.step().phase,'playing');assert.equal(box.calls,1);s.close();
});
test('分页阅读器有末页按钮时直接跳到末页',()=>{
  const s=setup('<input id="pageNumber" value="1"><span id="numPages">60</span><button id="nextPage">下一页</button><button id="lastPage">末页</button>');let next=0,last=0;s.w.document.querySelector('#nextPage').onclick=()=>next++;s.w.document.querySelector('#lastPage').onclick=()=>{last++;s.w.document.querySelector('input').value='60';};s.reader.step();assert.equal(last,1);assert.equal(next,0);s.at(500);s.reader.step();s.at(2000);assert.equal(s.reader.step().phase,'confirming');assert.equal(last,1);s.close();
});
test('末页按钮无效果时仅尝试一次，然后回退快速逐页翻阅',()=>{
  const s=setup('<input id="pageNumber" value="1"><span id="numPages">3</span><button id="nextPage">下一页</button><button id="lastPage">末页</button>');let next=0,last=0;s.w.document.querySelector('#lastPage').onclick=()=>last++;s.w.document.querySelector('#nextPage').onclick=()=>{next++;s.w.document.querySelector('input').value=String(next+1);};s.reader.step();s.at(1000);s.reader.step();assert.equal(next,0);s.at(1500);s.reader.step();assert.equal(next,1);s.at(2000);s.reader.step();s.at(2500);s.reader.step();assert.equal(next,2);assert.equal(last,1);s.close();
});
test('末页按钮被禁用时直接使用下一页',()=>{
  const s=setup('<input id="pageNumber" value="1"><span id="numPages">3</span><button id="nextPage">下一页</button><button id="lastPage" disabled>末页</button>');let clicks=0;s.w.document.querySelector('#nextPage').onclick=()=>clicks++;s.reader.step();assert.equal(clicks,1);s.close();
});
