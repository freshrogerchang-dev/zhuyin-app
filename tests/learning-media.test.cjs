const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(){
  const status={textContent:''};
  const audios=[];
  const context={window:{},document:{getElementById:()=>status,addEventListener(){}},Audio:class{
    constructor(src){this.src=src;this.playCount=0;audios.push(this);}
    play(){this.playCount++;return Promise.resolve();}
    pause(){this.paused=true;}
  }};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('learning-media.js','utf8'),context);
  return {context,audios,status,run:code=>vm.runInContext(code,context)};
}
test('37 official clips map to Unicode sequence (not the app display sequence)',()=>{
  const f=fixture();
  assert.equal(f.run('ZHUYIN_AUDIO_ORDER.length'),37);
  for(const [symbol,file] of [['ㄅ',1],['ㄝ',25],['ㄦ',34],['ㄧ',35],['ㄨ',36],['ㄩ',37]]){
    f.context.playZhuyinSymbol(symbol);
    assert.equal(f.audios.at(-1).src,`assets/audio/zhuyin/F${file}.WAV`);
  }
  for(let i=1;i<=37;i++){
    const buffer=fs.readFileSync(`assets/audio/zhuyin/F${i}.WAV`);
    assert.equal(buffer.toString('ascii',0,4),'RIFF');
    assert.equal(buffer.toString('ascii',8,12),'WAVE');
  }
});
test('a request plays only once; repeated requests stop the previous audio',()=>{
  const f=fixture();
  f.context.playZhuyinSymbol('ㄅ');
  f.context.playZhuyinSymbol('ㄆ');
  assert.equal(f.audios[0].paused,true);
  assert.ok(f.audios.every(a=>a.playCount===1 && a.loop===false));
  f.context.cancelLearningSpeech();
  assert.equal(f.audios[1].paused,true);
  assert.equal(f.run('learningAudio'),null);
});
test('late audio errors cannot overwrite the next screen message',()=>{
  const f=fixture();
  f.context.playZhuyinSymbol('ㄅ');
  f.context.cancelLearningSpeech();
  f.audios[0].onerror();
  assert.equal(f.status.textContent,'');
});
test('current audio failure presents retry message instead of inaccurate synthetic fallback',()=>{
  const f=fixture();
  f.context.playZhuyinSymbol('ㄅ');
  f.audios[0].onerror();
  assert.match(f.status.textContent,/再試一次/);
  assert.equal(f.run('learningSpeechActive'),false);
});
test('cancelled TTS sequences and letter introductions cannot resume on a later screen',()=>{
  const f=fixture();
  const spoken=[];
  f.context.window.speechSynthesis=f.context.speechSynthesis={speak:u=>spoken.push(u),cancel(){},getVoices:()=>[]};
  f.context.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  const source=fs.readFileSync('app.js','utf8');
  vm.runInContext(source.slice(source.indexOf('function speak(text, lang)'),source.indexOf('// ---- 共用：音效與背景音樂')),f.context);
  vm.runInContext(source.slice(source.indexOf('function speakLetterWithCase(letter)'),source.indexOf('function setupLetterIntro()')),f.context);
  f.context.speakSequence(['第一段','第二段']);
  const stale=spoken[0];
  f.context.cancelLearningSpeech();
  stale.onend();
  assert.equal(spoken.length,1);
  f.context.speakLetterWithCase('A');
  const letter=spoken.at(-1);
  f.context.cancelLearningSpeech();
  letter.onend();
  assert.equal(spoken.length,2);
});
