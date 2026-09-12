// App 狀態與主要邏輯
let coins = 8;
let wrongCount = 0;
let hintUsed = false;
let currentChar = '大';
let writer = null;
let progressMap = {}; // key: 字/注音符號 -> {best_reward, perfect_count, attempt_count}

let currentZhuyinIndex = 0;

function syncCoinDisplay(){
  document.getElementById('coin-count-home').textContent = coins;
  document.querySelectorAll('.coin-count').forEach(el => el.textContent = coins);
}

// ---- Supabase：讀取/寫入進度與金幣 ----
async function initFromSupabase(){
  try{
    const { data: stateRow } = await sb.from('zhuyin_app_state').select('*').eq('id',1).maybeSingle();
    if(stateRow){ coins = stateRow.coins; }
    else{ await sb.from('zhuyin_app_state').insert({id:1, coins:8}); coins = 8; }
  }catch(e){ console.warn('讀取金幣失敗，先用本機預設值', e); }

  try{
    const { data: rows } = await sb.from('zhuyin_app_char_progress').select('*');
    (rows||[]).forEach(r=>{ progressMap[r.character] = r; });
  }catch(e){ console.warn('讀取練習紀錄失敗', e); }

  syncCoinDisplay();
  renderCharSelectGrid();
}

function saveCoins(){
  sb.from('zhuyin_app_state').update({coins: coins, updated_at: new Date().toISOString()}).eq('id',1)
    .then(({error})=>{ if(error) console.warn('金幣儲存失敗', error); });
}

function recordProgress(key, coinReward){
  const existing = progressMap[key] || {best_reward:0, perfect_count:0, attempt_count:0};
  const updated = {
    character: key,
    best_reward: Math.max(existing.best_reward||0, coinReward),
    perfect_count: (existing.perfect_count||0) + (coinReward===3 ? 1 : 0),
    attempt_count: (existing.attempt_count||0) + 1,
    last_reward: coinReward,
    updated_at: new Date().toISOString()
  };
  progressMap[key] = updated;
  sb.from('zhuyin_app_char_progress').upsert(updated)
    .then(({error})=>{ if(error) console.warn('進度儲存失敗', error); });
}

// 已經寫得很熟(滿分次數多)的字，被抽到的權重越低
function pickWeightedFrom(keys){
  const weighted = [];
  keys.forEach(k=>{
    const p = progressMap[k];
    let weight;
    if(!p || !p.attempt_count) weight = 5;        // 還沒練過：最容易被抽到
    else if(p.best_reward < 3) weight = 4;         // 練過但沒滿分過
    else if(p.perfect_count === 1) weight = 2;     // 滿分過一次
    else weight = 1;                               // 滿分很多次：仍會出現，但機率最低
    for(let i=0;i<weight;i++) weighted.push(k);
  });
  return weighted[Math.floor(Math.random()*weighted.length)];
}

const GAME_SCREEN_MUSIC = { 'screen-mole': 'mole', 'screen-memory': 'memory', 'screen-match': 'match', 'screen-race': 'race' };
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(GAME_SCREEN_MUSIC[id]) startGameMusic(GAME_SCREEN_MUSIC[id]);
  else stopGameMusic();
}

function speak(text, lang){
  if(!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang || 'zh-TW';
  u.rate = 0.6;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ---- 共用：音效與背景音樂 ----
let _audioCtx = null;
function getAudioCtx(){
  if(!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
function playTone(ctx, freq, start, duration, type, volume){
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}
function playCoinSound(){
  try{
    const ctx = getAudioCtx();
    [880, 1318.5].forEach((freq, i)=> playTone(ctx, freq, ctx.currentTime + i*0.09, 0.25, 'sine', 0.25));
  }catch(e){ /* 瀏覽器不支援或被封鎖就靜靜跳過，不影響其他功能 */ }
}
function playFlipSound(){
  try{
    const ctx = getAudioCtx();
    playTone(ctx, 700, ctx.currentTime, 0.1, 'square', 0.12);
  }catch(e){ /* 靜靜跳過 */ }
}
function playMatchFoundSound(){
  try{
    const ctx = getAudioCtx();
    [784, 1046.5].forEach((freq, i)=> playTone(ctx, freq, ctx.currentTime + i*0.08, 0.2, 'sine', 0.2));
  }catch(e){ /* 靜靜跳過 */ }
}
function playMismatchSound(){
  try{
    const ctx = getAudioCtx();
    [392, 311].forEach((freq, i)=> playTone(ctx, freq, ctx.currentTime + i*0.1, 0.18, 'sawtooth', 0.12));
  }catch(e){ /* 靜靜跳過 */ }
}
function playMoleHitSound(){
  try{
    const ctx = getAudioCtx();
    playTone(ctx, 520, ctx.currentTime, 0.12, 'square', 0.2);
  }catch(e){ /* 靜靜跳過 */ }
}
function playMoleMissSound(){
  try{
    const ctx = getAudioCtx();
    playTone(ctx, 200, ctx.currentTime, 0.08, 'sine', 0.08);
  }catch(e){ /* 靜靜跳過 */ }
}
function playStrokeSound(strokeNum){
  try{
    const ctx = getAudioCtx();
    const scale = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5];
    const freq = scale[strokeNum % scale.length];
    playTone(ctx, freq, ctx.currentTime, 0.15, 'sine', 0.15);
  }catch(e){ /* 靜靜跳過 */ }
}
function playDingDongSound(){
  try{
    const ctx = getAudioCtx();
    const ding = 659.25, dong = 523.25;
    [[ding,0],[dong,0.22],[ding,0.55],[dong,0.77]].forEach(([freq, offset])=>
      playTone(ctx, freq, ctx.currentTime + offset, 0.22, 'sine', 0.22)
    );
  }catch(e){ /* 靜靜跳過 */ }
}
function playRaceMoveSound(){
  try{
    const ctx = getAudioCtx();
    [440, 587.33, 739.99].forEach((freq, i)=> playTone(ctx, freq, ctx.currentTime + i*0.04, 0.1, 'sawtooth', 0.15));
  }catch(e){ /* 靜靜跳過 */ }
}
function playRaceBlockedSound(){
  try{
    const ctx = getAudioCtx();
    playTone(ctx, 220, ctx.currentTime, 0.15, 'square', 0.1);
  }catch(e){ /* 靜靜跳過 */ }
}
function playRaceWinSound(){
  try{
    const ctx = getAudioCtx();
    [659.25, 783.99, 987.77, 1318.5].forEach((freq, i)=> playTone(ctx, freq, ctx.currentTime + i*0.12, 0.3, 'sine', 0.22));
  }catch(e){ /* 靜靜跳過 */ }
}

// ---- 共用：小遊戲背景音樂 ----
// 每個遊戲配一組不同「音色 + 節奏 + 旋律走向」的組合，讓三首聽起來明顯不一樣，
// 不只是同一個調子換音高。
let _bgmTimer = null;
let _bgmStep = 0;
const BGM_TRACKS = {
  // 打地鼠：快節奏、方波，音符短促跳躍，配合手忙腳亂的緊張感
  mole: {
    waveType: 'square',
    volume: 0.05,
    notes: [
      [523.25, 0.14], [659.25, 0.14], [783.99, 0.14], [1046.5, 0.16],
      [783.99, 0.14], [659.25, 0.14], [523.25, 0.14], [392.0, 0.18]
    ]
  },
  // 翻牌配對：慢節奏、正弦波，音符綿長平穩，配合安靜思考的氣氛
  memory: {
    waveType: 'sine',
    volume: 0.045,
    notes: [
      [440.0, 0.55], [493.88, 0.55], [523.25, 0.55], [587.33, 0.75],
      [523.25, 0.55], [493.88, 0.55], [440.0, 0.9]
    ]
  },
  // 字音配對：三角波、長短交錯的跳躍節奏，帶點俏皮的搖擺感
  match: {
    waveType: 'triangle',
    volume: 0.06,
    notes: [
      [392.0, 0.2], [392.0, 0.12], [587.33, 0.28], [523.25, 0.14],
      [440.0, 0.14], [659.25, 0.32], [587.33, 0.14], [493.88, 0.3]
    ]
  },
  // 注音賽車：鋸齒波、又快又密集的固定節奏，模擬引擎轟轟往前衝的感覺
  race: {
    waveType: 'sawtooth',
    volume: 0.04,
    notes: [
      [329.63, 0.1], [329.63, 0.1], [392.0, 0.1], [329.63, 0.1],
      [493.88, 0.14], [440.0, 0.1], [392.0, 0.1], [329.63, 0.16]
    ]
  }
};
function startGameMusic(game){
  stopGameMusic();
  try{
    const ctx = getAudioCtx();
    const track = BGM_TRACKS[game] || BGM_TRACKS.mole;
    _bgmStep = 0;
    const step = () => {
      const [freq, dur] = track.notes[_bgmStep % track.notes.length];
      playTone(ctx, freq, ctx.currentTime, dur, track.waveType, track.volume);
      _bgmStep++;
      _bgmTimer = setTimeout(step, dur * 1000);
    };
    step();
  }catch(e){ /* 不支援就沒背景音樂，不影響遊戲 */ }
}
function stopGameMusic(){
  if(_bgmTimer){ clearTimeout(_bgmTimer); _bgmTimer = null; }
}

// ---- 共用：結算畫面 ----
function rewardMeta(coinReward){
  if(coinReward>=3) return {title:'太棒了！', stars:'⭐⭐⭐', mascot:'🎉'};
  if(coinReward===2) return {title:'寫得不錯！', stars:'⭐⭐', mascot:'😊'};
  return {title:'完成了！繼續加油', stars:'⭐', mascot:'💪'};
}
function showResult(coinReward){
  const meta = rewardMeta(coinReward);
  coins += coinReward;
  document.getElementById('result-title').textContent = meta.title;
  document.getElementById('result-stars').textContent = meta.stars;
  document.getElementById('result-mascot').textContent = meta.mascot;
  document.getElementById('result-coin-pop').textContent = `+${coinReward} 🪙`;
  showScreen('screen-result');
  syncCoinDisplay();
  playCoinSound();
  saveCoins();
}
function backToHomeFromResult(){ showScreen('screen-home'); }

// ---- 選字 / 國字練習流程 ----
function openCharSelect(){
  renderCharSelectGrid();
  showScreen('screen-char-select');
}
function renderCharSelectGrid(){
  const grid = document.getElementById('char-select-grid');
  grid.innerHTML = '';
  Object.keys(charData).forEach(c=>{
    const tile = document.createElement('div');
    const mastered = progressMap[c] && progressMap[c].best_reward === 3;
    tile.className = 'char-select-tile';
    if(mastered) tile.style.borderColor = 'var(--green)';
    tile.textContent = mastered ? (c + ' ⭐') : c;
    tile.onclick = () => beginCharacterFlow(c);
    grid.appendChild(tile);
  });
}
function startPractice(){
  const chars = Object.keys(charData);
  const randChar = pickWeightedFrom(chars);
  beginCharacterFlow(randChar);
}
function beginCharacterFlow(char){
  currentChar = char;
  wrongCount = 0;
  hintUsed = false;
  document.getElementById('listen-msg').textContent = '';
  renderListenOptions();
  showScreen('screen-intro');
  setupIntroWriter();
  speak(char);
}

const INTRO_W = 220, INTRO_H = 220, INTRO_PAD = 12;

function setupIntroWriter(){
  const box = document.getElementById('intro-hanzi');
  box.innerHTML = '';
  window._introWriter = HanziWriter.create(box, currentChar, {
    width: INTRO_W, height: INTRO_H, padding: INTRO_PAD,
    strokeAnimationSpeed: 0.4,
    delayBetweenStrokes: 800,
    strokeColor: '#1F2A44'
  });
  window._introWriter.animateCharacter();
  addStrokeNumberLabels(box, currentChar);
}

function addStrokeNumberLabels(box, char){
  HanziWriter.loadCharacterData(char).then(function(data){
    const t = HanziWriter.getScalingTransform(INTRO_W, INTRO_H, INTRO_PAD);
    data.medians.forEach(function(median, i){
      const rawX = median[0][0];
      const rawY = median[0][1];
      const sx = t.x + t.scale * rawX;
      const sy = (INTRO_H - t.y) - t.scale * rawY;
      const badge = document.createElement('div');
      badge.className = 'stroke-num-badge';
      badge.textContent = i + 1;
      badge.style.left = sx + 'px';
      badge.style.top = sy + 'px';
      box.appendChild(badge);
    });
  }).catch(function(){ /* 資料載入失敗就不顯示數字，不影響其他功能 */ });
}
function replayIntro(){
  if(window._introWriter) window._introWriter.animateCharacter();
}

function renderListenOptions(){
  const wrap = document.getElementById('listen-options');
  wrap.innerHTML = '';
  const data = charData[currentChar];
  const shuffled = shuffleArray(data.options.slice());
  shuffled.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    btn.onclick = () => pickAnswer(btn, opt === data.zhuyin);
    wrap.appendChild(btn);
  });
}

function pickAnswer(btn, isCorrect){
  document.querySelectorAll('#listen-options .option-btn').forEach(b=>b.disabled=true);
  if(isCorrect){
    btn.classList.add('correct');
    document.getElementById('listen-msg').textContent = '答對了！';
    setTimeout(()=>{ showScreen('screen-write'); setupWriteScreen(); }, 500);
  } else {
    btn.classList.add('wrong');
    wrongCount++;
    document.getElementById('listen-msg').textContent = '再聽一次試試看';
    setTimeout(()=>{
      document.querySelectorAll('#listen-options .option-btn').forEach(b=>{
        if(!b.classList.contains('correct')){ b.disabled=false; }
      });
      btn.classList.remove('wrong');
    }, 500);
  }
}

// ---- 國字筆順練習（Hanzi Writer） ----
function setupWriteScreen(){
  const box = document.getElementById('hanzi-target');
  box.innerHTML = '';
  document.getElementById('write-msg').textContent = '';
  writer = HanziWriter.create(box, currentChar, {
    width: 260, height: 260, padding: 14,
    showOutline: true,
    strokeColor: '#1F2A44',
    outlineColor: '#C7D2E0',
    drawingColor: '#FF8A5B',
    strokeWidth: 22,
    drawingWidth: 34,
    highlightColor: '#FFD23F',
    leniency: 2,
    acceptBackwardsStrokes: true,
    showHintAfterMisses: 2,
    highlightCompleteColor: '#4CAF7D',
    strokeAnimationSpeed: 0.4,
    delayBetweenStrokes: 800,
    strokeHighlightSpeed: 0.5
  });
  startQuiz();
}

function startQuiz(){
  writer.quiz({
    onCorrectStroke: function(strokeData){
      playStrokeSound(strokeData.strokeNum);
      const msg = document.getElementById('write-msg');
      msg.style.color = '#3C9265';
      msg.textContent = `✓ 第 ${strokeData.strokeNum + 1} 筆對了！還剩 ${strokeData.strokesRemaining} 筆`;
      if(strokeData.strokesRemaining > 0){
        writer.highlightStroke(strokeData.strokeNum + 1);
      }
    },
    onMistake: function(strokeData){
      const msg = document.getElementById('write-msg');
      msg.style.color = '#E56A3B';
      msg.textContent = `第 ${strokeData.strokeNum + 1} 筆的方向不太對，再試一次`;
      writer.highlightStroke(strokeData.strokeNum);
    },
    onComplete: function(summaryData){
      playDingDongSound();
      setTimeout(()=> finishWriting(summaryData.totalMistakes), 400);
    }
  });
  writer.highlightStroke(0);
}

function clearCanvas(){
  writer.cancelQuiz();
  document.getElementById('write-msg').textContent = '';
  startQuiz();
}

function showHint(){
  hintUsed = true;
  writer.cancelQuiz();
  document.getElementById('write-msg').textContent = '再看一次筆順...';
  writer.animateCharacter({
    onComplete: function(){ startQuiz(); }
  });
}

function finishWriting(writeMistakes){
  const totalMistakes = wrongCount + writeMistakes + (hintUsed ? 1 : 0);
  let coinReward;
  if(totalMistakes===0) coinReward=3;
  else if(totalMistakes<=3) coinReward=2;
  else coinReward=1;
  recordProgress(currentChar, coinReward);
  showResult(coinReward);
}

// ---- 注音符號練習流程 ----
function startZhuyinPractice(){
  const symbols = zhuyinData.map(z=>z.symbol);
  const picked = pickWeightedFrom(symbols);
  currentZhuyinIndex = zhuyinData.findIndex(z=>z.symbol===picked);
  document.getElementById('zhuyin-symbol-display').textContent = zhuyinData[currentZhuyinIndex].symbol;
  document.getElementById('zhuyin-example-label').textContent = `例字：${zhuyinData[currentZhuyinIndex].example}`;
  showScreen('screen-zhuyin-intro');
  speakZhuyinExample();
}
function speakZhuyinExample(){ speak(zhuyinData[currentZhuyinIndex].example); }

let zCanvas, zCtx, zDrawing=false;
let zhuyinGlyphPoints = [];
let zhuyinUserPoints = [];
let zGuideAlpha = 0.18;

function setupZhuyinWrite(){
  zCanvas = document.getElementById('zhuyin-canvas');
  zCtx = zCanvas.getContext('2d');
  zGuideAlpha = 0.18;
  zhuyinUserPoints = [];
  document.getElementById('zhuyin-write-msg').textContent = '';
  buildZhuyinGlyphMask();
  drawZhuyinGuide();

  zCanvas.onpointerdown = e => {
    e.preventDefault();
    zCanvas.setPointerCapture(e.pointerId);
    zDrawing = true;
    const p = zPos(e);
    zhuyinUserPoints.push(p);
    zCtx.beginPath();
    zCtx.moveTo(p.x,p.y);
  };
  zCanvas.onpointermove = e => {
    if(!zDrawing) return;
    e.preventDefault();
    const p = zPos(e);
    zhuyinUserPoints.push(p);
    zCtx.lineTo(p.x,p.y);
    zCtx.strokeStyle = '#FF8A5B';
    zCtx.lineWidth = 26;
    zCtx.lineCap = 'round';
    zCtx.lineJoin = 'round';
    zCtx.stroke();
  };
  zCanvas.onpointerup = e => { e.preventDefault(); zDrawing=false; };
  zCanvas.onpointercancel = e => { e.preventDefault(); zDrawing=false; };
  zCanvas.ontouchstart = e => e.preventDefault();
  zCanvas.ontouchmove = e => e.preventDefault();
}

function zPos(e){
  const r = zCanvas.getBoundingClientRect();
  return {x:(e.clientX-r.left)*(zCanvas.width/r.width), y:(e.clientY-r.top)*(zCanvas.height/r.height)};
}

function buildZhuyinGlyphMask(){
  const off = document.createElement('canvas');
  off.width = zCanvas.width; off.height = zCanvas.height;
  const octx = off.getContext('2d');
  octx.fillStyle = '#000';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.font = `900 ${Math.floor(zCanvas.width*0.7)}px "Noto Sans TC"`;
  octx.fillText(zhuyinData[currentZhuyinIndex].symbol, off.width/2, off.height/2 + 6);
  const data = octx.getImageData(0,0,off.width,off.height).data;
  const pts = [];
  const step = 6;
  for(let y=0;y<off.height;y+=step){
    for(let x=0;x<off.width;x+=step){
      const idx = (y*off.width+x)*4;
      if(data[idx+3] > 128) pts.push({x,y});
    }
  }
  zhuyinGlyphPoints = pts;
}

function drawZhuyinGuide(){
  zCtx.clearRect(0,0,zCanvas.width,zCanvas.height);
  zCtx.save();
  zCtx.globalAlpha = zGuideAlpha;
  zCtx.fillStyle = '#1F2A44';
  zCtx.textAlign = 'center';
  zCtx.textBaseline = 'middle';
  zCtx.font = `900 ${Math.floor(zCanvas.width*0.7)}px "Noto Sans TC"`;
  zCtx.fillText(zhuyinData[currentZhuyinIndex].symbol, zCanvas.width/2, zCanvas.height/2 + 6);
  zCtx.restore();
}

function clearZhuyinCanvas(){
  zGuideAlpha = 0.18;
  zhuyinUserPoints = [];
  drawZhuyinGuide();
  document.getElementById('zhuyin-write-msg').textContent = '';
}

function hintZhuyin(){
  zGuideAlpha = 0.4;
  zhuyinUserPoints = [];
  drawZhuyinGuide();
  document.getElementById('zhuyin-write-msg').textContent = '提示：照著明顯一點的符號描寫看看！';
}

function finishZhuyinWriting(){
  if(zhuyinUserPoints.length < 10){
    alert('請先照著淡淡的注音符號描一次喔！');
    return;
  }
  const tol = 16 * (zCanvas.width/260);
  let coveredCount = 0;
  for(const gp of zhuyinGlyphPoints){
    let found = false;
    for(const up of zhuyinUserPoints){
      if(Math.hypot(gp.x-up.x, gp.y-up.y) < tol){ found = true; break; }
    }
    if(found) coveredCount++;
  }
  const coverage = zhuyinGlyphPoints.length ? coveredCount/zhuyinGlyphPoints.length : 0;

  let accCount = 0;
  for(const up of zhuyinUserPoints){
    let found = false;
    for(const gp of zhuyinGlyphPoints){
      if(Math.hypot(gp.x-up.x, gp.y-up.y) < tol){ found = true; break; }
    }
    if(found) accCount++;
  }
  const accuracy = zhuyinUserPoints.length ? accCount/zhuyinUserPoints.length : 0;

  const score = coverage*0.6 + accuracy*0.4;
  let coinReward;
  if(score >= 0.55) coinReward = 3;
  else if(score >= 0.3) coinReward = 2;
  else coinReward = 1;
  recordProgress(zhuyinData[currentZhuyinIndex].symbol, coinReward);
  showResult(coinReward);
}

// ---- 詞語練習流程 ----
// 詞語都只用 charData 裡已經有的字組成，所以寫字測驗直接沿用單字的
// HanziWriter 設定，注音也直接查 charData，不用另外維護一份詞語注音。
let currentWord = '', currentWordChars = [], currentWordIndex = 0;
let wordWriter = null, wordTotalMistakes = 0, wordHintUsed = false;

function startWordPractice(){
  currentWord = pickWeightedFrom(wordData);
  currentWordChars = currentWord.split('');
  const wrap = document.getElementById('word-display');
  wrap.innerHTML = '';
  currentWordChars.forEach(c=>{
    const col = document.createElement('div');
    col.className = 'word-char-col';
    const charEl = document.createElement('div');
    charEl.className = 'word-char';
    charEl.textContent = c;
    const zEl = document.createElement('div');
    zEl.className = 'word-char-zhuyin';
    zEl.textContent = charData[c].zhuyin;
    col.appendChild(charEl);
    col.appendChild(zEl);
    wrap.appendChild(col);
  });
  showScreen('screen-word-intro');
  speak(currentWord);
}

function startWordWriting(){
  currentWordIndex = 0;
  wordTotalMistakes = 0;
  wordHintUsed = false;
  showScreen('screen-word-write');
  setupWordWriteStep();
}

function setupWordWriteStep(){
  const char = currentWordChars[currentWordIndex];
  document.getElementById('word-write-progress').textContent = `第 ${currentWordIndex + 1} / ${currentWordChars.length} 字`;
  const box = document.getElementById('word-hanzi-target');
  box.innerHTML = '';
  document.getElementById('word-write-msg').textContent = '';
  wordWriter = HanziWriter.create(box, char, {
    width: 260, height: 260, padding: 14,
    showOutline: true,
    strokeColor: '#1F2A44',
    outlineColor: '#C7D2E0',
    drawingColor: '#FF8A5B',
    strokeWidth: 22,
    drawingWidth: 34,
    highlightColor: '#FFD23F',
    leniency: 2,
    acceptBackwardsStrokes: true,
    showHintAfterMisses: 2,
    highlightCompleteColor: '#4CAF7D',
    strokeAnimationSpeed: 0.4,
    delayBetweenStrokes: 800,
    strokeHighlightSpeed: 0.5
  });
  startWordQuiz();
}

function startWordQuiz(){
  wordWriter.quiz({
    onCorrectStroke: function(strokeData){
      playStrokeSound(strokeData.strokeNum);
      const msg = document.getElementById('word-write-msg');
      msg.style.color = '#3C9265';
      msg.textContent = `✓ 第 ${strokeData.strokeNum + 1} 筆對了！還剩 ${strokeData.strokesRemaining} 筆`;
      if(strokeData.strokesRemaining > 0){
        wordWriter.highlightStroke(strokeData.strokeNum + 1);
      }
    },
    onMistake: function(strokeData){
      const msg = document.getElementById('word-write-msg');
      msg.style.color = '#E56A3B';
      msg.textContent = `第 ${strokeData.strokeNum + 1} 筆的方向不太對，再試一次`;
      wordWriter.highlightStroke(strokeData.strokeNum);
    },
    onComplete: function(summaryData){
      wordTotalMistakes += summaryData.totalMistakes;
      playDingDongSound();
      setTimeout(()=> advanceWordWriting(), 400);
    }
  });
  wordWriter.highlightStroke(0);
}

function advanceWordWriting(){
  currentWordIndex++;
  if(currentWordIndex < currentWordChars.length){
    setupWordWriteStep();
  } else {
    finishWordWriting();
  }
}

function clearWordCanvas(){
  wordWriter.cancelQuiz();
  document.getElementById('word-write-msg').textContent = '';
  startWordQuiz();
}

function showWordHint(){
  wordHintUsed = true;
  wordWriter.cancelQuiz();
  document.getElementById('word-write-msg').textContent = '再看一次筆順...';
  wordWriter.animateCharacter({
    onComplete: function(){ startWordQuiz(); }
  });
}

function finishWordWriting(){
  const totalMistakes = wordTotalMistakes + (wordHintUsed ? 1 : 0);
  let coinReward;
  if(totalMistakes===0) coinReward=3;
  else if(totalMistakes<=3) coinReward=2;
  else coinReward=1;
  recordProgress(currentWord, coinReward);
  showResult(coinReward);
}

// ---- 英文大小寫字母筆順練習 ----
// 跟注音符號一樣，字母的筆順沒有像國字那樣公認的官方筆順資料庫，
// 這裡用自己定義的簡化筆順座標(見 data.js 的 letterData 註解)，
// 描寫評分也沿用注音符號那套「像素覆蓋率」演算法，而不是逐筆比對。
// 額外多做的是：認識畫面會依筆順動畫畫出來，比注音符號多一層引導。
const LETTER_CANVAS_SIZE = 260;
const LETTER_SCALE = (LETTER_CANVAS_SIZE - 30) / 130;
const LETTER_OFFSET_X = (LETTER_CANVAS_SIZE - 100 * LETTER_SCALE) / 2;
const LETTER_OFFSET_Y = 15;
function letterPt(p){ return [LETTER_OFFSET_X + p[0]*LETTER_SCALE, LETTER_OFFSET_Y + p[1]*LETTER_SCALE]; }

let currentLetter = 'A';
let letterIntroCanvas, letterIntroCtx, letterAnimTimer = null;
let letterCanvas, letterCtx, letterDrawing = false;
let letterGlyphPoints = [];
let letterUserPoints = [];
let letterGuideAlpha = 0.18;
let letterAutoFinishTimer = null;
let letterStrokeAttempts = 0;

function startLetterPractice(){
  currentLetter = pickWeightedFrom(Object.keys(letterData));
  showScreen('screen-letter-intro');
  setupLetterIntro();
  speak(currentLetter, 'en-US');
}

function setupLetterIntro(){
  letterIntroCanvas = document.getElementById('letter-intro-canvas');
  letterIntroCtx = letterIntroCanvas.getContext('2d');
  addLetterStrokeNumberLabels();
  replayLetterIntro();
}

function addLetterStrokeNumberLabels(){
  const box = document.getElementById('letter-intro-box');
  box.querySelectorAll('.stroke-num-badge').forEach(b => b.remove());
  letterData[currentLetter].strokes.forEach((stroke, i)=>{
    const [sx, sy] = letterPt(stroke[0]);
    const badge = document.createElement('div');
    badge.className = 'stroke-num-badge';
    badge.textContent = i + 1;
    badge.style.left = sx + 'px';
    badge.style.top = sy + 'px';
    box.appendChild(badge);
  });
}

function replayLetterIntro(){
  clearTimeout(letterAnimTimer);
  letterIntroCtx.clearRect(0, 0, LETTER_CANVAS_SIZE, LETTER_CANVAS_SIZE);
  animateLetterStroke(0, letterData[currentLetter].strokes);
}

function animateLetterStroke(strokeIndex, strokes){
  if(strokeIndex >= strokes.length) return;
  const pts = strokes[strokeIndex].map(letterPt);
  letterIntroCtx.strokeStyle = '#1F2A44';
  letterIntroCtx.lineWidth = 12;
  letterIntroCtx.lineCap = 'round';
  letterIntroCtx.lineJoin = 'round';
  let i = 1;
  function step(){
    if(i >= pts.length){
      letterAnimTimer = setTimeout(()=> animateLetterStroke(strokeIndex + 1, strokes), 350);
      return;
    }
    letterIntroCtx.beginPath();
    letterIntroCtx.moveTo(pts[i-1][0], pts[i-1][1]);
    letterIntroCtx.lineTo(pts[i][0], pts[i][1]);
    letterIntroCtx.stroke();
    i++;
    letterAnimTimer = setTimeout(step, 45);
  }
  step();
}

function setupLetterWrite(){
  clearTimeout(letterAutoFinishTimer);
  letterCanvas = document.getElementById('letter-write-canvas');
  letterCtx = letterCanvas.getContext('2d');
  letterGuideAlpha = 0.18;
  letterUserPoints = [];
  letterStrokeAttempts = 0;
  document.getElementById('letter-write-msg').textContent = '';
  buildLetterGlyphMask();
  drawLetterGuide();

  letterCanvas.onpointerdown = e => {
    e.preventDefault();
    clearTimeout(letterAutoFinishTimer);
    letterCanvas.setPointerCapture(e.pointerId);
    letterDrawing = true;
    const p = letterPos(e);
    letterUserPoints.push(p);
    letterCtx.beginPath();
    letterCtx.moveTo(p.x, p.y);
  };
  letterCanvas.onpointermove = e => {
    if(!letterDrawing) return;
    e.preventDefault();
    const p = letterPos(e);
    letterUserPoints.push(p);
    letterCtx.lineTo(p.x, p.y);
    letterCtx.strokeStyle = '#FF8A5B';
    letterCtx.lineWidth = 26;
    letterCtx.lineCap = 'round';
    letterCtx.lineJoin = 'round';
    letterCtx.stroke();
  };
  letterCanvas.onpointerup = e => {
    e.preventDefault();
    letterDrawing = false;
    letterStrokeAttempts++;
    clearTimeout(letterAutoFinishTimer);
    letterAutoFinishTimer = setTimeout(checkLetterAutoFinish, 900);
  };
  letterCanvas.onpointercancel = e => { e.preventDefault(); letterDrawing = false; };
  letterCanvas.ontouchstart = e => e.preventDefault();
  letterCanvas.ontouchmove = e => e.preventDefault();
}

// 寫完停筆一小段時間後就自動完成，不用特別按「我寫好了」。
// 只看「覆蓋率」不太準：像 A 的兩畫撇捺共用同一個頂點，光寫這兩畫
// 覆蓋率就有九成，會誤判成「已經寫完」但其實還少一橫。所以改成同時
// 檢查「已經抬筆幾次」有沒有達到這個字母該有的筆畫數，比對筆畫數
// 更可靠，覆蓋率只當作「不是隨便點一下」的門檻。
function checkLetterAutoFinish(){
  if(letterUserPoints.length < 10) return;
  if(letterStrokeAttempts < letterData[currentLetter].strokes.length) return;
  const { coverage } = computeLetterScore();
  if(coverage >= 0.4){
    finishLetterWriting();
  }
}

function letterPos(e){
  const r = letterCanvas.getBoundingClientRect();
  return {x:(e.clientX-r.left)*(letterCanvas.width/r.width), y:(e.clientY-r.top)*(letterCanvas.height/r.height)};
}

function buildLetterGlyphMask(){
  const off = document.createElement('canvas');
  off.width = letterCanvas.width; off.height = letterCanvas.height;
  const octx = off.getContext('2d');
  octx.strokeStyle = '#000';
  octx.lineWidth = 26;
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  letterData[currentLetter].strokes.forEach(stroke=>{
    const pts = stroke.map(letterPt);
    octx.beginPath();
    octx.moveTo(pts[0][0], pts[0][1]);
    for(let i=1;i<pts.length;i++) octx.lineTo(pts[i][0], pts[i][1]);
    octx.stroke();
  });
  const data = octx.getImageData(0,0,off.width,off.height).data;
  const pts = [];
  const step = 6;
  for(let y=0;y<off.height;y+=step){
    for(let x=0;x<off.width;x+=step){
      const idx = (y*off.width+x)*4;
      if(data[idx+3] > 128) pts.push({x,y});
    }
  }
  letterGlyphPoints = pts;
}

function drawLetterGuide(){
  letterCtx.clearRect(0,0,letterCanvas.width,letterCanvas.height);
  letterCtx.save();
  letterCtx.globalAlpha = letterGuideAlpha;
  letterCtx.strokeStyle = '#1F2A44';
  letterCtx.lineWidth = 12;
  letterCtx.lineCap = 'round';
  letterCtx.lineJoin = 'round';
  letterData[currentLetter].strokes.forEach(stroke=>{
    const pts = stroke.map(letterPt);
    letterCtx.beginPath();
    letterCtx.moveTo(pts[0][0], pts[0][1]);
    for(let i=1;i<pts.length;i++) letterCtx.lineTo(pts[i][0], pts[i][1]);
    letterCtx.stroke();
  });
  letterCtx.restore();
}

function clearLetterCanvas(){
  clearTimeout(letterAutoFinishTimer);
  letterGuideAlpha = 0.18;
  letterUserPoints = [];
  letterStrokeAttempts = 0;
  drawLetterGuide();
  document.getElementById('letter-write-msg').textContent = '';
}

function hintLetter(){
  clearTimeout(letterAutoFinishTimer);
  letterGuideAlpha = 0.4;
  letterUserPoints = [];
  drawLetterGuide();
  document.getElementById('letter-write-msg').textContent = '提示：照著明顯一點的字母描寫看看！';
}

function computeLetterScore(){
  const tol = 16 * (letterCanvas.width/260);
  let coveredCount = 0;
  for(const gp of letterGlyphPoints){
    let found = false;
    for(const up of letterUserPoints){
      if(Math.hypot(gp.x-up.x, gp.y-up.y) < tol){ found = true; break; }
    }
    if(found) coveredCount++;
  }
  const coverage = letterGlyphPoints.length ? coveredCount/letterGlyphPoints.length : 0;

  let accCount = 0;
  for(const up of letterUserPoints){
    let found = false;
    for(const gp of letterGlyphPoints){
      if(Math.hypot(gp.x-up.x, gp.y-up.y) < tol){ found = true; break; }
    }
    if(found) accCount++;
  }
  const accuracy = letterUserPoints.length ? accCount/letterUserPoints.length : 0;

  return { coverage, accuracy, score: coverage*0.6 + accuracy*0.4 };
}

function finishLetterWriting(){
  clearTimeout(letterAutoFinishTimer);
  if(letterUserPoints.length < 10){
    alert('請先照著淡淡的字母描一次喔！');
    return;
  }
  const { score } = computeLetterScore();
  let coinReward;
  if(score >= 0.55) coinReward = 3;
  else if(score >= 0.3) coinReward = 2;
  else coinReward = 1;
  recordProgress(currentLetter, coinReward);
  showResult(coinReward);
}

// ---- 遊戲大廳 ----
function playGame(game, cost){
  if(coins < cost){
    document.getElementById('arcade-msg').textContent = '金幣不夠喔，回去多練幾個字吧！';
    return;
  }
  coins -= cost;
  syncCoinDisplay();
  saveCoins();
  document.getElementById('arcade-msg').textContent = '';
  if(game==='mole'){ showScreen('screen-mole'); startMole(); }
  else if(game==='memory'){ showScreen('screen-memory'); startMemory(); }
  else if(game==='match'){ showScreen('screen-match'); startMatch(); }
  else if(game==='race'){ showScreen('screen-race'); startRace(); }
}

function shuffleArray(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

// ---- 打地鼠 ----
let moleTimer, moleActive, moleScore, moleUpIndex;
function startMole(){
  const grid = document.getElementById('mole-grid');
  grid.innerHTML = '';
  moleScore = 0;
  moleUpIndex = -1;
  document.getElementById('mole-score').textContent = 0;
  document.getElementById('mole-msg').textContent = '';
  let timeLeft = 15;
  document.getElementById('mole-time').textContent = timeLeft;

  for(let i=0;i<9;i++){
    const hole = document.createElement('div');
    hole.className = 'hole';
    hole.dataset.index = i;
    hole.onclick = () => hitMole(i);
    grid.appendChild(hole);
  }

  clearInterval(moleActive);
  clearInterval(moleTimer);
  moleActive = setInterval(()=>{
    document.querySelectorAll('.hole').forEach(h=>h.classList.remove('up'));
    document.querySelectorAll('.hole').forEach(h=>h.textContent='');
    moleUpIndex = Math.floor(Math.random()*9);
    const h = document.querySelector(`.hole[data-index='${moleUpIndex}']`);
    h.classList.add('up');
    h.textContent = '🐹';
  }, 700);

  moleTimer = setInterval(()=>{
    timeLeft--;
    document.getElementById('mole-time').textContent = timeLeft;
    if(timeLeft<=0){
      clearInterval(moleTimer);
      clearInterval(moleActive);
      document.querySelectorAll('.hole').forEach(h=>{h.classList.remove('up');h.textContent='';});
      document.getElementById('mole-msg').textContent = `時間到！最終分數：${moleScore} 分 🎉`;
      setTimeout(()=> showScreen('screen-arcade'), 2000);
    }
  },1000);
}
function hitMole(i){
  if(i===moleUpIndex){
    playMoleHitSound();
    moleScore++;
    document.getElementById('mole-score').textContent = moleScore;
    const h = document.querySelector(`.hole[data-index='${i}']`);
    h.classList.remove('up');
    h.textContent = '';
    moleUpIndex = -1;
  } else {
    playMoleMissSound();
  }
}

// ---- 翻牌配對 ----
const memoryEmojiSet = ['🐶','🐱','🐰','🐻','🐵','🦊'];
let memoryCards = [], memoryFlipped = [], memoryMoves = 0, memoryMatchedCount = 0, memoryLock = false;

function startMemory(){
  memoryMoves = 0;
  memoryMatchedCount = 0;
  memoryFlipped = [];
  memoryLock = false;
  document.getElementById('memory-moves').textContent = 0;
  document.getElementById('memory-msg').textContent = '';
  const pairSymbols = shuffleArray([...memoryEmojiSet, ...memoryEmojiSet]);
  memoryCards = pairSymbols.map((sym,i)=>({id:i, symbol:sym, flipped:false, matched:false}));
  renderMemoryGrid();
}
function renderMemoryGrid(){
  const grid = document.getElementById('memory-grid');
  grid.innerHTML = '';
  memoryCards.forEach(card=>{
    const div = document.createElement('div');
    div.className = 'memory-card' + (card.flipped?' flipped':'') + (card.matched?' matched':'');
    div.textContent = (card.flipped||card.matched) ? card.symbol : '❓';
    if(!card.matched) div.onclick = () => flipMemoryCard(card.id);
    grid.appendChild(div);
  });
}
function flipMemoryCard(id){
  if(memoryLock) return;
  const card = memoryCards.find(c=>c.id===id);
  if(card.flipped || card.matched) return;
  card.flipped = true;
  memoryFlipped.push(card);
  playFlipSound();
  renderMemoryGrid();
  if(memoryFlipped.length===2){
    memoryLock = true;
    memoryMoves++;
    document.getElementById('memory-moves').textContent = memoryMoves;
    const [a,b] = memoryFlipped;
    if(a.symbol===b.symbol){
      playMatchFoundSound();
      a.matched = true; b.matched = true;
      memoryMatchedCount += 2;
      memoryFlipped = [];
      memoryLock = false;
      renderMemoryGrid();
      if(memoryMatchedCount===memoryCards.length){
        document.getElementById('memory-msg').textContent = `太棒了！用 ${memoryMoves} 次翻牌全部配對成功 🎉`;
        setTimeout(()=> showScreen('screen-arcade'), 2000);
      }
    } else {
      playMismatchSound();
      setTimeout(()=>{
        a.flipped = false; b.flipped = false;
        memoryFlipped = [];
        memoryLock = false;
        renderMemoryGrid();
      }, 700);
    }
  }
}

// ---- 字音配對 ----
let matchPairs = [], matchZhuyinOrder = [], matchSelectedChar = null, matchSelectedZhuyin = null, matchSolvedCount = 0;

function startMatch(){
  const chosenChars = shuffleArray(Object.keys(charData).slice()).slice(0,5);
  matchPairs = chosenChars.map(c=>({char:c, zhuyin:charData[c].zhuyin, solved:false}));
  matchZhuyinOrder = shuffleArray(matchPairs.map(p=>p.zhuyin));
  matchSelectedChar = null;
  matchSelectedZhuyin = null;
  matchSolvedCount = 0;
  document.getElementById('match-msg').textContent = '';
  renderMatchColumns();
}
function renderMatchColumns(){
  const colChar = document.getElementById('match-col-char');
  const colZhuyin = document.getElementById('match-col-zhuyin');
  colChar.innerHTML = '';
  colZhuyin.innerHTML = '';
  matchPairs.forEach(p=>{
    const el = document.createElement('div');
    el.className = 'match-item' + (p.solved ? ' correct' : (matchSelectedChar===p.char ? ' selected' : ''));
    el.textContent = p.char;
    if(!p.solved) el.onclick = () => selectMatchChar(p.char);
    colChar.appendChild(el);
  });
  matchZhuyinOrder.forEach(z=>{
    const pair = matchPairs.find(p=>p.zhuyin===z);
    const el = document.createElement('div');
    el.className = 'match-item' + (pair.solved ? ' correct' : (matchSelectedZhuyin===z ? ' selected' : ''));
    el.textContent = z;
    if(!pair.solved) el.onclick = () => selectMatchZhuyin(z);
    colZhuyin.appendChild(el);
  });
}
function selectMatchChar(c){ matchSelectedChar = c; renderMatchColumns(); tryMatchResolve(); }
function selectMatchZhuyin(z){ matchSelectedZhuyin = z; renderMatchColumns(); tryMatchResolve(); }
function tryMatchResolve(){
  if(matchSelectedChar===null || matchSelectedZhuyin===null) return;
  const pair = matchPairs.find(p=>p.char===matchSelectedChar);
  if(pair.zhuyin===matchSelectedZhuyin){
    pair.solved = true;
    matchSolvedCount++;
    matchSelectedChar = null;
    matchSelectedZhuyin = null;
    renderMatchColumns();
    if(matchSolvedCount===matchPairs.length){
      document.getElementById('match-msg').textContent = '全部配對成功，太厲害了！🎉';
      setTimeout(()=> showScreen('screen-arcade'), 2000);
    }
  } else {
    document.getElementById('match-msg').textContent = '再試試看，配對不對喔';
    setTimeout(()=>{
      matchSelectedChar = null;
      matchSelectedZhuyin = null;
      renderMatchColumns();
      document.getElementById('match-msg').textContent = '';
    }, 600);
  }
}

// ---- 注音賽車 ----
// 玩法：一路上會出現 RACE_QUESTION_COUNT 題二選一的題目(答案分別在左邊/右邊)，
// 用滑鼠點選或鍵盤 ←/→ 作答。答對「衝刺」前進一大步，答錯就跟對手一樣「慢慢開」，
// 對手每一題都固定前進 RACE_SLOW_STEP，所以只要不是每題都答對，最多也只會被追平，
// 不會被對手超車，鼓勵小朋友多答對來拉開差距。
const RACE_QUESTION_COUNT = 9;
const RACE_FINISH = 90; // 車子跑到終點旗子前的百分比位置
const RACE_SLOW_STEP = 10; // 答錯時，我方跟對手都前進的百分比("慢慢開")
const RACE_SPRINT_STEP = 20; // 答對時，我方額外衝刺前進的百分比
let raceQuestionIndex = 0, raceProgress = 0, raceRivalProgress = 0, raceActive = false, raceLocked = false, raceCurrentChar = null, raceCorrectSide = null;

function startRace(){
  raceQuestionIndex = 0;
  raceProgress = 0;
  raceRivalProgress = 0;
  raceActive = true;
  raceLocked = false;
  document.getElementById('race-msg').textContent = '';
  document.getElementById('race-car-player').style.left = '25%';
  document.getElementById('race-hitzone-left').onclick = () => pickRaceAnswer('left');
  document.getElementById('race-hitzone-right').onclick = () => pickRaceAnswer('right');
  document.addEventListener('keydown', handleRaceKeydown);
  updateRaceCars();
  nextRaceQuestion();
}
function handleRaceKeydown(e){
  if(!raceActive || raceLocked) return;
  if(e.key === 'ArrowLeft') pickRaceAnswer('left');
  else if(e.key === 'ArrowRight') pickRaceAnswer('right');
}
function nextRaceQuestion(){
  raceQuestionIndex++;
  document.getElementById('race-qnum').textContent = raceQuestionIndex;
  raceCurrentChar = pickWeightedFrom(Object.keys(charData));
  const data = charData[raceCurrentChar];
  document.getElementById('race-char').textContent = raceCurrentChar;
  const wrongOptions = data.options.filter(o => o !== data.zhuyin);
  const wrongPick = wrongOptions[Math.floor(Math.random()*wrongOptions.length)];
  const pair = shuffleArray([data.zhuyin, wrongPick]);
  raceCorrectSide = pair[0] === data.zhuyin ? 'left' : 'right';
  const leftSign = document.getElementById('race-sign-left');
  const rightSign = document.getElementById('race-sign-right');
  leftSign.className = 'race-answer-sign';
  rightSign.className = 'race-answer-sign';
  leftSign.textContent = pair[0];
  rightSign.textContent = pair[1];
}
function pickRaceAnswer(side){
  if(!raceActive || raceLocked) return;
  raceLocked = true;
  const isCorrect = side === raceCorrectSide;
  const chosenSign = document.getElementById(side === 'left' ? 'race-sign-left' : 'race-sign-right');
  chosenSign.classList.add(isCorrect ? 'correct' : 'wrong');
  if(!isCorrect){
    const correctSign = document.getElementById(raceCorrectSide === 'left' ? 'race-sign-left' : 'race-sign-right');
    correctSign.classList.add('correct');
  }
  document.getElementById('race-car-player').style.left = (side === 'left' ? 25 : 75) + '%';
  raceRivalProgress += RACE_SLOW_STEP;
  raceProgress += isCorrect ? RACE_SPRINT_STEP : RACE_SLOW_STEP;
  if(isCorrect) playRaceMoveSound(); else playRaceBlockedSound();
  updateRaceCars();

  const raceOver = raceProgress >= RACE_FINISH || raceRivalProgress >= RACE_FINISH || raceQuestionIndex >= RACE_QUESTION_COUNT;
  setTimeout(()=>{
    raceLocked = false;
    if(raceOver) finishRace();
    else nextRaceQuestion();
  }, 600);
}
function updateRaceCars(){
  document.getElementById('race-car-player').style.bottom = Math.min(raceProgress, RACE_FINISH) + '%';
  document.getElementById('race-car-rival').style.bottom = Math.min(raceRivalProgress, RACE_FINISH) + '%';
}
function finishRace(){
  raceActive = false;
  document.removeEventListener('keydown', handleRaceKeydown);
  document.getElementById('race-hitzone-left').onclick = null;
  document.getElementById('race-hitzone-right').onclick = null;
  let msg;
  if(raceProgress > raceRivalProgress){
    playRaceWinSound();
    msg = '衝過終點線，你贏了！🏆';
  } else if(raceProgress === raceRivalProgress){
    msg = '你們同時衝線，打成平手！握手言和 🤝';
  } else {
    msg = '差一點點就贏了，再挑戰一次吧！加油！';
  }
  document.getElementById('race-msg').textContent = msg;
  setTimeout(()=> showScreen('screen-arcade'), 2000);
}

initFromSupabase();
