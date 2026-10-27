const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const fontSource=fs.readFileSync('src/font-decoder.js','utf8').replace('/* FONT_SIGNATURES */{}',fs.readFileSync('src/data/font-signatures.json','utf8').trim());
const factory=vm.runInNewContext(fontSource+'\ncreateFontDecoder',{Uint8Array,Int32Array,DataView,Map,Number,String,Array,Error});
const font=fs.readFileSync('tests/fixtures/quiz-font.ttf');
function setup(css=`@font-face{font-family:'font-cxsecret';src:url('data:application/font-ttf;charset=utf-8;base64,${font.toString('base64')}')}`){
  const dom=new JSDOM(`<style>${css}</style><div class="font-cxsecret">尥尨机尩尨</div>`);
  return {dom,decoder:factory({win:dom.window,doc:dom.window.document}),doc:dom.window.document};
}
test('字形摘要与标准 SHA-1 一致，含多块和中文 UTF-8',()=>{
  const s=setup();for(const input of ['', 'abc','a'.repeat(1000),'汉字']){const bytes=Buffer.from(input);assert.equal(s.decoder.sha1(bytes),crypto.createHash('sha1').update(bytes).digest('hex'));}s.dom.window.close();
});
test('实际显示字体的 23 个混淆字形全部匹配；题干还原且不改页面',()=>{
  const s=setup();const map=s.decoder.parse(font);assert.equal(map.size,23);assert.ok([...map.values()].every(Boolean));s.decoder.prepare();const original=s.doc.querySelector('div'),copy=original.cloneNode(true);s.decoder.decode(copy);assert.equal(copy.textContent,'处理机管理');assert.equal(original.textContent,'尥尨机尩尨');s.dom.window.close();
});
test('仅还原带特殊字体的文字，普通区域同码位不受影响',()=>{
  const s=setup();s.decoder.prepare();const copy=s.doc.createElement('div');copy.innerHTML='<span>尥</span><span class="font-cxsecret">尥</span>';s.decoder.decode(copy);assert.equal(copy.textContent,'尥处');s.dom.window.close();
});
test('字体尚未加载时阻止乱码；字体加载后重试可以恢复',()=>{
  const s=setup('');s.decoder.prepare();assert.throws(()=>s.decoder.decode(s.doc.querySelector('div').cloneNode(true)),/尚未加载/);s.doc.querySelector('style').textContent=`@font-face{font-family:font-cxsecret;src:url(data:font/ttf;base64,${font.toString('base64')})}`;s.decoder.prepare();const copy=s.doc.querySelector('div').cloneNode(true);s.decoder.decode(copy);assert.equal(copy.textContent,'处理机管理');s.dom.window.close();
});
test('不支持的字形、损坏或过大字体均不猜测',()=>{
  const s=setup();for(const bytes of [font.subarray(0,20),Buffer.alloc(3*1024*1024)])assert.throws(()=>s.decoder.parse(bytes));const altered=Buffer.from(font);altered.fill(0,724,5180);
  s.doc.querySelector('style').textContent=`@font-face{font-family:font-cxsecret;src:url(data:font/ttf;base64,${altered.toString('base64')})}`;s.decoder.prepare();assert.throws(()=>s.decoder.decode(s.doc.querySelector('div').cloneNode(true)),/未识别字形/);s.dom.window.close();
});
