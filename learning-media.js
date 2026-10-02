// The Ministry's file order is Unicode order, not the display order in zhuyinData.
const ZHUYIN_AUDIO_ORDER = 'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ';
let learningAudio = null;
let speechGeneration = 0;
let learningSpeechActive = false;
function cancelLearningSpeech(){
  speechGeneration++;
  learningSpeechActive = false;
  if(learningAudio){ learningAudio.pause(); learningAudio = null; }
  if('speechSynthesis' in window) speechSynthesis.cancel();
}
function setTaiwanVoice(utterance){
  if(utterance.lang !== 'zh-TW') return;
  const voice = speechSynthesis.getVoices().find(v=>/^zh[-_]TW$/i.test(v.lang));
  if(voice) utterance.voice = voice;
}
function playZhuyinSymbol(symbol){
  cancelLearningSpeech();
  const index = ZHUYIN_AUDIO_ORDER.indexOf(symbol);
  if(index < 0) return;
  const status = document.getElementById('zhuyin-audio-status');
  status.textContent = '';
  const generation = speechGeneration;
  const audio = new Audio(`assets/audio/zhuyin/F${index+1}.WAV`);
  learningAudio = audio;
  learningSpeechActive = true;
  audio.loop = false;
  const failed = ()=>{
    if(generation !== speechGeneration) return;
    learningSpeechActive = false;
    status.textContent = '暫時無法播放，請點「聽注音發音」再試一次。';
  };
  audio.onended = ()=>{ if(generation === speechGeneration) learningSpeechActive = false; };
  audio.onerror = failed;
  audio.play().catch(failed);
}
function renderVerticalZhuyin(container, text){
  const stack = document.createElement('span');
  stack.className = 'zhuyin-stack';
  stack.setAttribute('role','img');
  stack.setAttribute('aria-label',text);
  const glyphs = document.createElement('span');
  glyphs.className = 'zhuyin-glyphs';
  glyphs.setAttribute('aria-hidden','true');
  const tone = [...text].find(c=>'ˊˇˋ˙ˉ'.includes(c));
  for(const symbol of text.replace(/[ˊˇˋ˙ˉ]/g,'')){
    const glyph = document.createElement('span');
    glyph.textContent = symbol;
    glyphs.appendChild(glyph);
  }
  stack.appendChild(glyphs);
  if(tone){
    const mark = document.createElement('span');
    mark.className = 'zhuyin-tone' + (tone === '˙' ? ' neutral' : '');
    mark.textContent = tone;
    mark.setAttribute('aria-hidden','true');
    stack.appendChild(mark);
  }
  container.replaceChildren(stack);
}
const MEMORY_SPOKEN_NAMES = {'🐶':'小狗','🐱':'小貓','🐰':'兔子','🐻':'小熊','🐵':'猴子','🦊':'狐狸'};
function speakGameQuestion(screen, text){
  if(document.getElementById(screen)?.classList.contains('active')) speak(text);
}
function replayGameQuestion(){
  const screen = document.querySelector('.screen.active')?.id;
  const prompts = {
    'screen-race':raceCurrentChar,
    'screen-race-multi':mpCurrentChar,
    'screen-balloon':balloonCurrentChar,
    'screen-fish':fishCurrentChar,
    'screen-match':matchSelectedChar || '點選國字，聽發音，再找出相同的注音。',
    'screen-memory':'翻開卡片，找出一樣的動物。',
    'screen-mole':'點一下出現的小地鼠。'
  };
  if(prompts[screen]) speakGameQuestion(screen,prompts[screen]);
}
function installGameSpeechButtons(){
  ['race','race-multi','balloon','fish','match','memory','mole'].forEach(game=>{
    const heading = document.querySelector(`#screen-${game} .card h2`);
    if(!heading) return;
    const button = document.createElement('button');
    button.className = 'game-speech-btn';
    button.textContent = ['mole','memory'].includes(game) ? '🔊 聽玩法' : '🔊 再聽一次';
    button.onclick = replayGameQuestion;
    heading.after(button);
  });
}
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) cancelLearningSpeech(); });
