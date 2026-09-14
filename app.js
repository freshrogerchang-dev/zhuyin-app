// App 狀態與主要邏輯
let coins = 8;
let wrongCount = 0;
let hintUsed = false;
let currentChar = '大';
let writer = null;
let progressMap = {}; // key: 字/注音符號 -> {best_reward, perfect_count, attempt_count}

let currentZhuyinIndex = 0;

// 賽車贏的次數沒有對應到任何一個字/詞/符號，所以借用 zhuyin_app_char_progress
// 表存成一筆特殊 key 的紀錄(attempt_count 當成勝場數)，避免另外建一張表。
const STAT_RACE_WINS_KEY = '__stat_race_wins__';
let raceWinCount = 0;

// 連續打卡天數也借用同一張表存成特殊 key：
// best_reward 當「目前連續天數」、perfect_count 當「歷史最高連續天數」、
// updated_at 當「最後一次練習的時間」，一樣不用另外建表或改欄位。
const STAT_STREAK_KEY = '__stat_streak__';
let currentStreak = 0;
let bestStreak = 0;
let lastPracticeDateStr = null; // 'YYYY-MM-DD'，用裝置本地時間，不是 UTC

function localDateStr(d){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// ---- 多小孩檔案 ----
// zhuyin_app_state 只能存 id=1 那一列(資料庫有 CHECK (id=1) 的限制)，
// 所以完全不動那張表的結構：檔案 1 繼續用原本的 zhuyin_app_state，
// 跟以前的資料完全相容；檔案 2~4 是新加的，金幣也借用
// zhuyin_app_char_progress 表存成一筆特殊 key(跟賽車勝場、連續天數
// 一樣的做法)。每個非預設檔案的所有 key 都會加上 "p2_"/"p3_"/"p4_"
// 前綴，讀取時再依前綴分流、還原成一般的 key，其他程式碼完全不用
//知道現在是哪個檔案，只要讀寫 progressMap 就好。
const PROFILE_SLOTS = [1, 2, 3, 4];
const STAT_COINS_KEY = '__stat_coins__';
let activeProfileId = 1;
let profileNames = {};

function loadProfilesFromStorage(){
  try{
    const savedId = parseInt(localStorage.getItem('zhuyin_active_profile') || '1', 10);
    activeProfileId = PROFILE_SLOTS.includes(savedId) ? savedId : 1;
  }catch(e){ activeProfileId = 1; }
  try{
    profileNames = JSON.parse(localStorage.getItem('zhuyin_profile_names') || '{}');
  }catch(e){ profileNames = {}; }
}
function saveProfileNames(){
  try{ localStorage.setItem('zhuyin_profile_names', JSON.stringify(profileNames)); }
  catch(e){ /* 存不進去就算了，不影響當次使用 */ }
}
function setActiveProfileId(id){
  activeProfileId = id;
  try{ localStorage.setItem('zhuyin_active_profile', String(id)); }
  catch(e){ /* 忽略，頂多下次開啟要重新選 */ }
}
function profileKey(rawKey){
  return activeProfileId === 1 ? rawKey : `p${activeProfileId}_${rawKey}`;
}
// 判斷資料庫裡這一筆 character 屬不屬於目前使用的檔案，是的話還原成
// 不帶前綴的 key；不是的話回傳 null(代表要忽略，是別的小孩的資料)。
function rawKeyForRow(character){
  if(activeProfileId === 1){
    return /^p[2-4]_/.test(character) ? null : character;
  }
  const prefix = `p${activeProfileId}_`;
  return character.startsWith(prefix) ? character.slice(prefix.length) : null;
}
function currentProfileName(){
  return profileNames[activeProfileId] || '小朋友';
}
function updateActiveProfileLabel(){
  const el = document.getElementById('active-profile-name');
  if(el) el.textContent = currentProfileName();
}

async function switchProfile(id){
  setActiveProfileId(id);
  progressMap = {};
  coins = 8;
  raceWinCount = 0;
  currentStreak = 0;
  bestStreak = 0;
  lastPracticeDateStr = null;
  await initFromSupabase();
  showScreen('screen-home');
}

function renderProfileScreen(){
  const wrap = document.getElementById('profile-list');
  wrap.innerHTML = '';
  PROFILE_SLOTS.forEach(id=>{
    // 檔案 1 是原本就有的資料(還沒改成多檔案之前就存在)，就算還沒特別
    // 取名字，也不能顯示成「空的、可以新增」，不然會看起來像要蓋掉舊資料。
    const name = id === 1 ? (profileNames[1] || '小朋友') : profileNames[id];
    const tile = document.createElement('div');
    tile.className = 'profile-tile' + (id === activeProfileId ? ' active' : '') + (name ? '' : ' empty');

    if(name){
      const info = document.createElement('div');
      info.className = 'profile-tile-info';
      const nameEl = document.createElement('b');
      nameEl.textContent = name;
      info.appendChild(nameEl);
      if(id === activeProfileId){
        const tag = document.createElement('span');
        tag.textContent = '目前使用中';
        info.appendChild(tag);
      }
      tile.appendChild(info);
      tile.onclick = () => { if(id !== activeProfileId) switchProfile(id); };

      const rename = document.createElement('button');
      rename.className = 'profile-rename-btn';
      rename.textContent = '✏️';
      rename.onclick = (e)=>{
        e.stopPropagation();
        const newName = prompt('幫這個小朋友取個名字：', name);
        if(newName && newName.trim()){
          profileNames[id] = newName.trim();
          saveProfileNames();
          renderProfileScreen();
          updateActiveProfileLabel();
        }
      };
      tile.appendChild(rename);
    } else {
      tile.textContent = '➕ 新增小朋友';
      tile.onclick = () => {
        const newName = prompt('這個小朋友叫什麼名字？');
        if(newName && newName.trim()){
          profileNames[id] = newName.trim();
          saveProfileNames();
          switchProfile(id);
        }
      };
    }
    wrap.appendChild(tile);
  });
}

function syncCoinDisplay(){
  document.getElementById('coin-count-home').textContent = coins;
  document.querySelectorAll('.coin-count').forEach(el => el.textContent = coins);
}

// ---- Supabase：讀取/寫入進度與金幣 ----
async function initFromSupabase(){
  if(activeProfileId === 1){
    try{
      const { data: stateRow } = await sb.from('zhuyin_app_state').select('*').eq('id',1).maybeSingle();
      if(stateRow){ coins = stateRow.coins; }
      else{ await sb.from('zhuyin_app_state').insert({id:1, coins:8}); coins = 8; }
    }catch(e){ console.warn('讀取金幣失敗，先用本機預設值', e); }
  }

  try{
    const { data: rows } = await sb.from('zhuyin_app_char_progress').select('*');
    (rows||[]).forEach(r=>{
      const rawKey = rawKeyForRow(r.character);
      if(rawKey === null) return;
      if(activeProfileId !== 1 && rawKey === STAT_COINS_KEY){
        coins = r.best_reward;
        return;
      }
      progressMap[rawKey] = {...r, character: rawKey};
    });
    raceWinCount = (progressMap[STAT_RACE_WINS_KEY] && progressMap[STAT_RACE_WINS_KEY].attempt_count) || 0;
    const streakRow = progressMap[STAT_STREAK_KEY];
    if(streakRow){
      currentStreak = streakRow.best_reward || 0;
      bestStreak = streakRow.perfect_count || 0;
      lastPracticeDateStr = streakRow.updated_at ? localDateStr(new Date(streakRow.updated_at)) : null;
    }
  }catch(e){ console.warn('讀取練習紀錄失敗', e); }

  syncCoinDisplay();
  renderCharSelectGrid();
  updateHomeMascot();
  updateHomeStreakDisplay();
  updateActiveProfileLabel();
}

// 每天第一次完成練習(不管是國字/注音/詞語/字母)才會累加一次，同一天內
// 重複練習不會一直加。連續兩天都有練習(昨天有、今天也有)才算連續，
// 中間斷過一天以上就從 1 重新算，最高紀錄(bestStreak)則永遠不會下降。
function updateDailyStreak(){
  const todayStr = localDateStr(new Date());
  if(lastPracticeDateStr === todayStr) return;
  const yesterdayStr = localDateStr(new Date(Date.now() - 86400000));
  currentStreak = (lastPracticeDateStr === yesterdayStr) ? currentStreak + 1 : 1;
  if(currentStreak > bestStreak) bestStreak = currentStreak;
  lastPracticeDateStr = todayStr;
  const logical = { character: STAT_STREAK_KEY, best_reward: currentStreak, perfect_count: bestStreak, attempt_count: 0, updated_at: new Date().toISOString() };
  progressMap[STAT_STREAK_KEY] = logical;
  sb.from('zhuyin_app_char_progress').upsert({...logical, character: profileKey(STAT_STREAK_KEY)})
    .then(({error})=>{ if(error) console.warn('連續天數儲存失敗', error); });
  updateHomeStreakDisplay();
}

function updateHomeStreakDisplay(){
  const el = document.getElementById('home-streak');
  if(!el) return;
  if(!lastPracticeDateStr){
    el.textContent = '';
    el.className = 'sub streak-line';
    return;
  }
  const daysSince = Math.round((new Date(localDateStr(new Date())) - new Date(lastPracticeDateStr)) / 86400000);
  if(daysSince <= 0){
    el.textContent = `🔥 連續練習 ${currentStreak} 天，今天已經練習囉！`;
    el.className = 'sub streak-line active';
  } else if(daysSince === 1){
    el.textContent = `🔥 連續練習 ${currentStreak} 天，今天還沒練習，繼續保持吧！`;
    el.className = 'sub streak-line active';
  } else {
    el.textContent = `😴 已經 ${daysSince} 天沒來練習囉，快回來玩吧！`;
    el.className = 'sub streak-line cold';
  }
}

function incrementRaceWins(){
  raceWinCount++;
  const logical = { character: STAT_RACE_WINS_KEY, best_reward:0, perfect_count:0, attempt_count: raceWinCount, updated_at: new Date().toISOString() };
  progressMap[STAT_RACE_WINS_KEY] = logical;
  sb.from('zhuyin_app_char_progress').upsert({...logical, character: profileKey(STAT_RACE_WINS_KEY)})
    .then(({error})=>{ if(error) console.warn('賽車勝場儲存失敗', error); });
}

function saveCoins(){
  if(activeProfileId === 1){
    sb.from('zhuyin_app_state').update({coins: coins, updated_at: new Date().toISOString()}).eq('id',1)
      .then(({error})=>{ if(error) console.warn('金幣儲存失敗', error); });
  } else {
    const dbRow = { character: profileKey(STAT_COINS_KEY), best_reward: coins, perfect_count:0, attempt_count:0, updated_at: new Date().toISOString() };
    sb.from('zhuyin_app_char_progress').upsert(dbRow)
      .then(({error})=>{ if(error) console.warn('金幣儲存失敗', error); });
  }
}

function recordProgress(key, coinReward){
  const existing = progressMap[key] || {best_reward:0, perfect_count:0, attempt_count:0};
  const logical = {
    character: key,
    best_reward: Math.max(existing.best_reward||0, coinReward),
    perfect_count: (existing.perfect_count||0) + (coinReward===3 ? 1 : 0),
    attempt_count: (existing.attempt_count||0) + 1,
    last_reward: coinReward,
    updated_at: new Date().toISOString()
  };
  progressMap[key] = logical;
  sb.from('zhuyin_app_char_progress').upsert({...logical, character: profileKey(key)})
    .then(({error})=>{ if(error) console.warn('進度儲存失敗', error); });
  updateDailyStreak();
}

// 已經寫得很熟(滿分次數多)的字，被抽到的權重越低，這是基本盤。
// 在這之上再做一層簡單的間隔複習：字練過一段時間沒再複習，權重就
// 慢慢加回來，練得越熟的字可以「撐」比較久才需要複習(模擬遺忘曲線)，
// 這樣才不會練到滿分之後就再也不會被抽到、結果隔了很久反而忘記。
function pickWeightedFrom(keys){
  const now = Date.now();
  const weighted = [];
  keys.forEach(k=>{
    const p = progressMap[k];
    let weight;
    if(!p || !p.attempt_count) weight = 5;        // 還沒練過：最容易被抽到
    else if(p.best_reward < 3) weight = 4;         // 練過但沒滿分過
    else if(p.perfect_count === 1) weight = 2;     // 滿分過一次
    else weight = 1;                               // 滿分很多次：仍會出現，但機率最低

    if(p && p.updated_at){
      const daysSince = (now - new Date(p.updated_at).getTime()) / 86400000;
      const dueAfterDays = p.best_reward < 3 ? 2 : (p.perfect_count >= 2 ? 14 : 7);
      const overdueRatio = daysSince / dueAfterDays;
      if(overdueRatio > 1) weight += Math.min(6, Math.floor(overdueRatio * 2));
    }
    for(let i=0;i<weight;i++) weighted.push(k);
  });
  return weighted[Math.floor(Math.random()*weighted.length)];
}

const GAME_SCREEN_MUSIC = { 'screen-mole': 'mole', 'screen-memory': 'memory', 'screen-match': 'match', 'screen-race': 'race', 'screen-race-multi': 'race', 'screen-balloon': 'balloon' };
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(GAME_SCREEN_MUSIC[id]) startGameMusic(GAME_SCREEN_MUSIC[id]);
  else stopGameMusic();
  if(id === 'screen-home'){ updateHomeMascot(); updateHomeStreakDisplay(); }
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
function playBalloonPopSound(){
  try{
    const ctx = getAudioCtx();
    [880, 1174.66].forEach((freq, i)=> playTone(ctx, freq, ctx.currentTime + i*0.06, 0.18, 'sine', 0.22));
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
  },
  // 打氣球：正弦波但節奏輕盈、旋律一路往上飄再往下收，模擬氣球浮起來的感覺
  balloon: {
    waveType: 'sine',
    volume: 0.05,
    notes: [
      [392.0, 0.3], [440.0, 0.25], [523.25, 0.3], [659.25, 0.4],
      [523.25, 0.25], [440.0, 0.25], [392.0, 0.35], [349.23, 0.4]
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
  renderComponentHint(char);
  speak(char);
}

// 部件識字：只有 componentData 裡有資料的字才會顯示這個提示區塊，
// 象形字(大、小、山、水...)沒有硬拆，直接隱藏整塊不顯示。
function renderComponentHint(char){
  const wrap = document.getElementById('component-hint');
  const row = document.getElementById('component-row');
  const note = document.getElementById('component-note');
  const data = componentData[char];
  if(!data){
    wrap.classList.remove('show');
    return;
  }
  wrap.classList.add('show');
  row.innerHTML = '';
  data.parts.forEach((part, i)=>{
    if(i > 0){
      const plus = document.createElement('span');
      plus.className = 'component-plus';
      plus.textContent = '+';
      row.appendChild(plus);
    }
    const tile = document.createElement('div');
    tile.className = 'component-tile';
    tile.textContent = part;
    row.appendChild(tile);
  });
  note.textContent = data.hint || '';
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
let letterOffsetX = 0, letterOffsetY = 0;
function letterPt(p){ return [letterOffsetX + p[0]*LETTER_SCALE, letterOffsetY + p[1]*LETTER_SCALE]; }

// 每個字母實際用到的座標範圍不一樣(o 只在下半部、l 只有中間一條線)，
// 置中要看這個字母自己筆畫的範圍，而不是整個格線的範圍，這樣不管哪個
// 字母都會端正地置中在框框正中間，比例(大寫比小寫高)還是保留原樣。
function updateLetterCentering(letter){
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  letterData[letter].strokes.forEach(stroke=>{
    stroke.forEach(([x,y])=>{
      if(x<minX) minX=x; if(x>maxX) maxX=x;
      if(y<minY) minY=y; if(y>maxY) maxY=y;
    });
  });
  const midX = (minX+maxX)/2, midY = (minY+maxY)/2;
  letterOffsetX = LETTER_CANVAS_SIZE/2 - midX*LETTER_SCALE;
  letterOffsetY = LETTER_CANVAS_SIZE/2 - midY*LETTER_SCALE;
}

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
  speakLetterWithCase(currentLetter);
}

// 英文字母大小寫唸起來發音是一樣的(例如 D/d 都唸「dee」)，光聽聲音沒辦法
// 分辨是要練大寫還是小寫，所以先用中文唸一次「大寫/小寫」，再唸字母本身。
// 兩段分開唸(用 onend 接下一段)，是因為 speak() 每次呼叫都會 cancel 前一句，
// 混著中英文放進同一句 utterance 也常常會被單一語言的語音引擎唸錯或跳過。
function speakLetterWithCase(letter){
  if(!('speechSynthesis' in window)) return;
  const isUpper = letter === letter.toUpperCase() && letter !== letter.toLowerCase();
  const u1 = new SpeechSynthesisUtterance(isUpper ? '大寫' : '小寫');
  u1.lang = 'zh-TW';
  u1.rate = 0.6;
  u1.onend = () => {
    const u2 = new SpeechSynthesisUtterance(letter);
    u2.lang = 'en-US';
    u2.rate = 0.6;
    speechSynthesis.speak(u2);
  };
  speechSynthesis.cancel();
  speechSynthesis.speak(u1);
}

function setupLetterIntro(){
  updateLetterCentering(currentLetter);
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

// 原本是照 letterData 裡定義的座標點直接一段一段畫，遇到只有 2 個點的
// 直線筆畫(例如 I、l 的那一豎)就會整條線一格畫完，感覺像是瞬間跳過去，
// 不像用筆在寫字。改成先按固定的小間距把每一段補出很多中間點，
// 再一小步一小步畫，這樣不管筆畫長短，畫的「速度」都差不多，
// 線越長自然畫越久，比較像真的拿筆慢慢寫。
function densifyStrokePoints(pts, stepPx){
  const dense = [pts[0]];
  for(let i=1;i<pts.length;i++){
    const [x1,y1] = pts[i-1], [x2,y2] = pts[i];
    const dist = Math.hypot(x2-x1, y2-y1);
    const steps = Math.max(1, Math.round(dist/stepPx));
    for(let s=1;s<=steps;s++){
      dense.push([x1+(x2-x1)*s/steps, y1+(y2-y1)*s/steps]);
    }
  }
  return dense;
}

function animateLetterStroke(strokeIndex, strokes){
  if(strokeIndex >= strokes.length) return;
  const pts = densifyStrokePoints(strokes[strokeIndex].map(letterPt), 3);
  letterIntroCtx.strokeStyle = '#1F2A44';
  letterIntroCtx.lineWidth = 12;
  letterIntroCtx.lineCap = 'round';
  letterIntroCtx.lineJoin = 'round';
  let i = 1;
  function step(){
    if(i >= pts.length){
      letterAnimTimer = setTimeout(()=> animateLetterStroke(strokeIndex + 1, strokes), 480);
      return;
    }
    letterIntroCtx.beginPath();
    letterIntroCtx.moveTo(pts[i-1][0], pts[i-1][1]);
    letterIntroCtx.lineTo(pts[i][0], pts[i][1]);
    letterIntroCtx.stroke();
    i++;
    letterAnimTimer = setTimeout(step, 28);
  }
  step();
}

function setupLetterWrite(){
  clearTimeout(letterAutoFinishTimer);
  updateLetterCentering(currentLetter);
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

// ---- 成就徽章牆 / 造型解鎖 ----
// 徽章的進度都是從現有的 progressMap(國字/注音/詞語/字母)跟 raceWinCount
// 算出來的，不需要另外存一份「達成了哪些成就」，重新整理也不會跑掉。
function masteredCount(keys){
  return keys.filter(k => progressMap[k] && progressMap[k].best_reward === 3).length;
}

const BADGES = [
  { id:'char5', title:'字詞新手', icon:'🌱', desc:'國字寫對 5 個', target:5, compute:()=> masteredCount(Object.keys(charData)) },
  { id:'char10', title:'字詞達人', icon:'📖', desc:'國字寫對 10 個', target:10, compute:()=> masteredCount(Object.keys(charData)) },
  { id:'char25', title:'字詞高手', icon:'🏅', desc:'國字寫對 25 個', target:25, compute:()=> masteredCount(Object.keys(charData)) },
  { id:'charAll', title:'識字大師', icon:'👑', desc:`國字全部寫對(${Object.keys(charData).length} 個)`, target:Object.keys(charData).length, compute:()=> masteredCount(Object.keys(charData)) },
  { id:'zhuyin10', title:'注音小尖兵', icon:'🔤', desc:'注音符號寫對 10 個', target:10, compute:()=> masteredCount(zhuyinData.map(z=>z.symbol)) },
  { id:'zhuyinAll', title:'注音全滿貫', icon:'🎯', desc:`注音符號全部寫對(${zhuyinData.length} 個)`, target:zhuyinData.length, compute:()=> masteredCount(zhuyinData.map(z=>z.symbol)) },
  { id:'word10', title:'詞語小達人', icon:'📚', desc:'詞語寫對 10 個', target:10, compute:()=> masteredCount(wordData) },
  { id:'wordAll', title:'詞語全滿貫', icon:'🏆', desc:`詞語全部寫對(${wordData.length} 個)`, target:wordData.length, compute:()=> masteredCount(wordData) },
  { id:'letter15', title:'字母小達人', icon:'🔠', desc:'英文字母寫對 15 個', target:15, compute:()=> masteredCount(Object.keys(letterData)) },
  { id:'letterAll', title:'字母全滿貫', icon:'🌟', desc:`英文字母全部寫對(${Object.keys(letterData).length} 個)`, target:Object.keys(letterData).length, compute:()=> masteredCount(Object.keys(letterData)) },
  { id:'race1', title:'賽車新手', icon:'🚦', desc:'注音賽車贏 1 次', target:1, compute:()=> raceWinCount },
  { id:'race5', title:'賽車好手', icon:'🏁', desc:'注音賽車贏 5 次', target:5, compute:()=> raceWinCount },
  { id:'race15', title:'賽車冠軍', icon:'👑', desc:'注音賽車贏 15 次', target:15, compute:()=> raceWinCount },
  { id:'streak3', title:'堅持不懈', icon:'✨', desc:'連續練習 3 天', target:3, compute:()=> bestStreak },
  { id:'streak7', title:'連續打卡一週', icon:'🔥', desc:'連續練習 7 天', target:7, compute:()=> bestStreak },
  { id:'streak30', title:'打卡王', icon:'💎', desc:'連續練習 30 天', target:30, compute:()=> bestStreak }
];

function isBadgeUnlocked(badgeId){
  if(!badgeId) return true;
  const badge = BADGES.find(b=>b.id===badgeId);
  return badge ? badge.compute() >= badge.target : false;
}

// 造型解鎖的門檻對應到上面的徽章，達成越多門檻，長頸鹿/賽車顏色就換得越好看。
const MASCOT_UNLOCKS = [
  { emoji:'🦒', badgeId:null },
  { emoji:'🦁', badgeId:'char5' },
  { emoji:'🐯', badgeId:'char10' },
  { emoji:'🦄', badgeId:'char25' },
  { emoji:'🐉', badgeId:'charAll' }
];
const CAR_COLOR_UNLOCKS = [
  { color:'#FF8A5B', badgeId:null },
  { color:'#4C86E8', badgeId:'race1' },
  { color:'#B25FE0', badgeId:'race5' },
  { color:'#F2B705', badgeId:'race15' }
];
function currentMascotEmoji(){
  let chosen = MASCOT_UNLOCKS[0].emoji;
  MASCOT_UNLOCKS.forEach(m=>{ if(isBadgeUnlocked(m.badgeId)) chosen = m.emoji; });
  return chosen;
}
function currentCarColor(){
  let chosen = CAR_COLOR_UNLOCKS[0].color;
  CAR_COLOR_UNLOCKS.forEach(c=>{ if(isBadgeUnlocked(c.badgeId)) chosen = c.color; });
  return chosen;
}
function updateHomeMascot(){
  const el = document.getElementById('home-mascot');
  if(el) el.textContent = currentMascotEmoji();
}

function renderBadges(){
  const wrap = document.getElementById('badges-list');
  wrap.innerHTML = '';
  BADGES.forEach(b=>{
    const current = Math.min(b.compute(), b.target);
    const unlocked = current >= b.target;

    const card = document.createElement('div');
    card.className = 'badge-card' + (unlocked ? ' unlocked' : '');

    const icon = document.createElement('div');
    icon.className = 'badge-icon';
    icon.textContent = b.icon;

    const info = document.createElement('div');
    info.className = 'badge-info';
    const title = document.createElement('b');
    title.textContent = b.title;
    const desc = document.createElement('span');
    desc.textContent = b.desc;
    const barWrap = document.createElement('div');
    barWrap.className = 'badge-progress-bar';
    const bar = document.createElement('div');
    bar.className = 'badge-progress-fill';
    bar.style.width = (current/b.target*100) + '%';
    barWrap.appendChild(bar);
    const progText = document.createElement('span');
    progText.className = 'badge-progress-text';
    progText.textContent = `${current} / ${b.target}`;
    info.appendChild(title);
    info.appendChild(desc);
    info.appendChild(barWrap);
    info.appendChild(progText);

    const status = document.createElement('div');
    status.className = 'badge-status';
    status.textContent = unlocked ? '✅' : '🔒';

    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(status);
    wrap.appendChild(card);
  });
}

// ---- 家長專區：練習狀況總覽 + 設定 ----
function renderParentSection(container, title, keys){
  const mastered = keys.filter(k => progressMap[k] && progressMap[k].best_reward === 3);
  const needsWork = keys.filter(k => progressMap[k] && progressMap[k].attempt_count > 0 && progressMap[k].best_reward < 3);
  const untried = keys.length - mastered.length - needsWork.length;

  const section = document.createElement('div');
  section.className = 'parent-section';

  const h3 = document.createElement('h3');
  h3.textContent = title;
  section.appendChild(h3);

  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.textContent = `已熟練 ${mastered.length} 個・待加強 ${needsWork.length} 個・還沒練過 ${untried} 個(共 ${keys.length} 個)`;
  section.appendChild(summary);

  if(mastered.length){
    const label = document.createElement('div');
    label.className = 'chip-label';
    label.textContent = '已熟練';
    section.appendChild(label);
    const list = document.createElement('div');
    list.className = 'chip-list';
    mastered.forEach(k=>{
      const chip = document.createElement('span');
      chip.className = 'chip mastered';
      chip.textContent = k;
      list.appendChild(chip);
    });
    section.appendChild(list);
  }

  if(needsWork.length){
    const label = document.createElement('div');
    label.className = 'chip-label';
    label.textContent = '待加強(常常寫錯或還不夠熟)';
    section.appendChild(label);
    const list = document.createElement('div');
    list.className = 'chip-list';
    needsWork.forEach(k=>{
      const chip = document.createElement('span');
      chip.className = 'chip needs-work';
      chip.textContent = k;
      list.appendChild(chip);
    });
    section.appendChild(list);
  }

  container.appendChild(section);
}

function renderParentView(){
  const wrap = document.getElementById('parent-progress');
  wrap.innerHTML = '';
  renderParentSection(wrap, '國字', Object.keys(charData));
  renderParentSection(wrap, '注音符號', zhuyinData.map(z=>z.symbol));
  renderParentSection(wrap, '詞語', wordData);
  renderParentSection(wrap, '英文字母', Object.keys(letterData));
  document.getElementById('parent-settings-msg').textContent = '';
}

function resetCoins(){
  if(!confirm(`確定要把「${currentProfileName()}」的金幣歸零嗎？`)) return;
  if(!confirm('再次確認：金幣歸零後沒辦法復原，確定要繼續嗎？')) return;
  coins = 0;
  syncCoinDisplay();
  saveCoins();
  document.getElementById('parent-settings-msg').textContent = `「${currentProfileName()}」的金幣已經歸零了。`;
}

function resetProgress(){
  if(!confirm(`確定要把「${currentProfileName()}」的所有練習紀錄跟成就進度都歸零嗎？`)) return;
  if(!confirm('再次確認：這樣會清除所有已熟練的字、詞、注音、字母紀錄，還有賽車勝場、連續打卡天數，沒辦法復原，確定要繼續嗎？')) return;
  // 資料庫目前只開放 insert/select/update 的權限(沒有 delete)，所以用「把每一筆
  // 都歸零」取代「刪除」。而且現在有多個檔案共用同一張表，不能再像以前一樣
  // 用「篩選全部的列」來歸零(那樣會連其他小孩的紀錄都一起清空)，改成只針對
  // 目前 progressMap 裡「這個檔案自己」的 key 一筆一筆歸零。
  const keys = Object.keys(progressMap);
  const finishReset = () => {
    progressMap = {};
    raceWinCount = 0;
    currentStreak = 0;
    bestStreak = 0;
    lastPracticeDateStr = null;
    renderCharSelectGrid();
    updateHomeMascot();
    updateHomeStreakDisplay();
    document.getElementById('parent-settings-msg').textContent = `「${currentProfileName()}」的練習紀錄跟成就進度都已經歸零了。`;
  };
  if(keys.length === 0){ finishReset(); return; }
  const rows = keys.map(k => ({
    character: profileKey(k), best_reward:0, perfect_count:0, attempt_count:0, last_reward:0,
    updated_at: new Date().toISOString()
  }));
  sb.from('zhuyin_app_char_progress').upsert(rows)
    .then(({error})=>{
      if(error){
        console.warn('進度歸零失敗', error);
        document.getElementById('parent-settings-msg').textContent = '歸零失敗，請稍後再試一次。';
        return;
      }
      finishReset();
    });
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
  else if(game==='balloon'){ showScreen('screen-balloon'); startBalloon(); }
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
  document.getElementById('race-car-player').style.setProperty('--race-player-color', currentCarColor());
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
    incrementRaceWins();
    msg = '衝過終點線，你贏了！🏆';
  } else if(raceProgress === raceRivalProgress){
    msg = '你們同時衝線，打成平手！握手言和 🤝';
  } else {
    msg = '差一點點就贏了，再挑戰一次吧！加油！';
  }
  document.getElementById('race-msg').textContent = msg;
  setTimeout(()=> showScreen('screen-arcade'), 2000);
}

// ---- 注音賽車：跟朋友對戰 ----
// 玩法跟單人版一樣(答對衝刺、答錯慢慢開)，差別是「對手」換成真的朋友，
// 用 Supabase Realtime 的 broadcast 頻道即時同步兩邊的進度，不需要額外的資料表。
// 房間用一組 4 位數邀請碼當頻道名稱：主機先建立房間等待，朋友輸入邀請碼加入後，
// 主機收到 join 就用同一個起跑時間(goAt)廣播 start，兩邊各自倒數、同時開始比賽。
const MP_RACE_COST = 5;
const MP_JOIN_TIMEOUT_MS = 15000;
let mpChannel = null, mpRoomCode = null, mpWaitTimeout = null;
let mpQuestionIndex = 0, mpProgress = 0, mpOpponentProgress = 0;
let mpActive = false, mpLocked = false, mpResultShown = false;
let mpCurrentChar = null, mpCorrectSide = null;

function openMultiRaceLobby(){
  document.getElementById('mp-lobby-choose').style.display = '';
  document.getElementById('mp-lobby-waiting').style.display = 'none';
  document.getElementById('mp-lobby-countdown').style.display = 'none';
  document.getElementById('mp-join-code').value = '';
  document.getElementById('mp-lobby-msg').textContent = '';
  showScreen('screen-race-multi-lobby');
}
function randomRoomCode(){
  return String(Math.floor(1000 + Math.random()*9000));
}
function connectMultiChannel(code, { onJoin, onSubscribed } = {}){
  if(mpChannel){ sb.removeChannel(mpChannel); mpChannel = null; }
  mpOpponentProgress = 0;
  mpChannel = sb.channel('zhuyin_race_' + code, { config: { broadcast: { self:false } } });
  if(onJoin) mpChannel.on('broadcast', {event:'join'}, onJoin);
  mpChannel.on('broadcast', {event:'start'}, ({payload}) => startMultiCountdown(payload && payload.goAt));
  mpChannel.on('broadcast', {event:'progress'}, ({payload}) => receiveMpOpponentProgress(payload));
  mpChannel.on('broadcast', {event:'finish'}, ({payload}) => receiveMpOpponentFinish(payload));
  mpChannel.on('broadcast', {event:'leave'}, () => handleMpOpponentLeave());
  mpChannel.subscribe(status => { if(status === 'SUBSCRIBED' && onSubscribed) onSubscribed(); });
}
function hostMultiRace(){
  if(coins < MP_RACE_COST){
    document.getElementById('mp-lobby-msg').textContent = '金幣不夠喔，回去多練幾個字吧！';
    return;
  }
  coins -= MP_RACE_COST; syncCoinDisplay(); saveCoins();
  mpRoomCode = randomRoomCode();
  document.getElementById('mp-code-display').textContent = mpRoomCode;
  document.getElementById('mp-wait-msg').textContent = '等待朋友加入中...🕐';
  document.getElementById('mp-lobby-choose').style.display = 'none';
  document.getElementById('mp-lobby-waiting').style.display = '';
  connectMultiChannel(mpRoomCode, {
    onJoin(){
      const goAt = Date.now() + 3000;
      mpChannel.send({type:'broadcast', event:'start', payload:{goAt}});
      startMultiCountdown(goAt);
    }
  });
}
function joinMultiRace(){
  const code = document.getElementById('mp-join-code').value.trim();
  if(!/^\d{4}$/.test(code)){
    document.getElementById('mp-lobby-msg').textContent = '請輸入朋友給你的 4 位數邀請碼';
    return;
  }
  if(coins < MP_RACE_COST){
    document.getElementById('mp-lobby-msg').textContent = '金幣不夠喔，回去多練幾個字吧！';
    return;
  }
  coins -= MP_RACE_COST; syncCoinDisplay(); saveCoins();
  mpRoomCode = code;
  document.getElementById('mp-lobby-msg').textContent = '';
  document.getElementById('mp-wait-msg').textContent = '正在連線到朋友的房間...🕐';
  document.getElementById('mp-lobby-choose').style.display = 'none';
  document.getElementById('mp-lobby-waiting').style.display = '';
  connectMultiChannel(mpRoomCode, {
    onSubscribed(){
      mpChannel.send({type:'broadcast', event:'join', payload:{}});
      mpWaitTimeout = setTimeout(()=>{
        document.getElementById('mp-wait-msg').textContent = '找不到朋友的房間，請確認邀請碼，或請朋友重新建立房間';
      }, MP_JOIN_TIMEOUT_MS);
    }
  });
}
function cancelMultiRace(){
  coins += MP_RACE_COST; syncCoinDisplay(); saveCoins();
  leaveMultiRaceLobby();
}
function leaveMultiRaceLobby(){
  if(mpChannel) mpChannel.send({type:'broadcast', event:'leave', payload:{}});
  cleanupMultiChannel();
  showScreen('screen-race-mode');
}
function handleMpOpponentLeave(){
  if(document.getElementById('screen-race-multi-lobby').classList.contains('active')){
    document.getElementById('mp-wait-msg').textContent = '朋友離開了，請重新開始';
  } else if(document.getElementById('screen-race-multi').classList.contains('active') && mpActive){
    mpActive = false;
    document.removeEventListener('keydown', handleMpRaceKeydown);
    document.getElementById('mp-race-msg').textContent = '朋友離開了比賽 😢';
    setTimeout(()=>{ cleanupMultiChannel(); showScreen('screen-arcade'); }, 2000);
  }
}
function cleanupMultiChannel(){
  if(mpWaitTimeout){ clearTimeout(mpWaitTimeout); mpWaitTimeout = null; }
  if(mpChannel){ sb.removeChannel(mpChannel); mpChannel = null; }
}
function startMultiCountdown(goAt){
  if(!goAt) return;
  if(mpWaitTimeout){ clearTimeout(mpWaitTimeout); mpWaitTimeout = null; }
  document.getElementById('mp-lobby-waiting').style.display = 'none';
  document.getElementById('mp-lobby-countdown').style.display = '';
  const numEl = document.getElementById('mp-countdown-num');
  (function tick(){
    const remain = Math.ceil((goAt - Date.now()) / 1000);
    if(remain <= 0){
      showScreen('screen-race-multi');
      startMultiRaceMatch();
      return;
    }
    numEl.textContent = remain;
    setTimeout(tick, 200);
  })();
}
function startMultiRaceMatch(){
  mpQuestionIndex = 0;
  mpProgress = 0;
  mpOpponentProgress = 0;
  mpActive = true;
  mpLocked = false;
  mpResultShown = false;
  document.getElementById('mp-race-msg').textContent = '';
  document.getElementById('mp-race-car-player').style.left = '25%';
  document.getElementById('mp-race-car-player').style.setProperty('--race-player-color', currentCarColor());
  document.getElementById('mp-race-hitzone-left').onclick = () => pickMpRaceAnswer('left');
  document.getElementById('mp-race-hitzone-right').onclick = () => pickMpRaceAnswer('right');
  document.addEventListener('keydown', handleMpRaceKeydown);
  updateMpRaceCars();
  nextMpRaceQuestion();
}
function handleMpRaceKeydown(e){
  if(!mpActive || mpLocked) return;
  if(e.key === 'ArrowLeft') pickMpRaceAnswer('left');
  else if(e.key === 'ArrowRight') pickMpRaceAnswer('right');
}
function nextMpRaceQuestion(){
  mpQuestionIndex++;
  document.getElementById('mp-race-qnum').textContent = mpQuestionIndex;
  mpCurrentChar = pickWeightedFrom(Object.keys(charData));
  const data = charData[mpCurrentChar];
  document.getElementById('mp-race-char').textContent = mpCurrentChar;
  const wrongOptions = data.options.filter(o => o !== data.zhuyin);
  const wrongPick = wrongOptions[Math.floor(Math.random()*wrongOptions.length)];
  const pair = shuffleArray([data.zhuyin, wrongPick]);
  mpCorrectSide = pair[0] === data.zhuyin ? 'left' : 'right';
  const leftSign = document.getElementById('mp-race-sign-left');
  const rightSign = document.getElementById('mp-race-sign-right');
  leftSign.className = 'race-answer-sign';
  rightSign.className = 'race-answer-sign';
  leftSign.textContent = pair[0];
  rightSign.textContent = pair[1];
}
function pickMpRaceAnswer(side){
  if(!mpActive || mpLocked) return;
  mpLocked = true;
  const isCorrect = side === mpCorrectSide;
  const chosenSign = document.getElementById(side === 'left' ? 'mp-race-sign-left' : 'mp-race-sign-right');
  chosenSign.classList.add(isCorrect ? 'correct' : 'wrong');
  if(!isCorrect){
    const correctSign = document.getElementById(mpCorrectSide === 'left' ? 'mp-race-sign-left' : 'mp-race-sign-right');
    correctSign.classList.add('correct');
  }
  document.getElementById('mp-race-car-player').style.left = (side === 'left' ? 25 : 75) + '%';
  mpProgress += isCorrect ? RACE_SPRINT_STEP : RACE_SLOW_STEP;
  if(isCorrect) playRaceMoveSound(); else playRaceBlockedSound();
  updateMpRaceCars();
  broadcastMpProgress();

  const selfDone = mpProgress >= RACE_FINISH || mpQuestionIndex >= RACE_QUESTION_COUNT;
  setTimeout(()=>{
    mpLocked = false;
    if(selfDone) finishMultiRaceSelf();
    else nextMpRaceQuestion();
  }, 600);
}
function updateMpRaceCars(){
  document.getElementById('mp-race-car-player').style.bottom = Math.min(mpProgress, RACE_FINISH) + '%';
  document.getElementById('mp-race-car-opponent').style.bottom = Math.min(mpOpponentProgress, RACE_FINISH) + '%';
}
function broadcastMpProgress(){
  if(mpChannel) mpChannel.send({type:'broadcast', event:'progress', payload:{pct: mpProgress}});
}
function receiveMpOpponentProgress(payload){
  if(!payload) return;
  mpOpponentProgress = Math.max(mpOpponentProgress, payload.pct || 0);
  updateMpRaceCars();
  if(mpActive && mpOpponentProgress >= RACE_FINISH) finishMultiRaceSelf();
}
function finishMultiRaceSelf(){
  if(!mpActive) return;
  mpActive = false;
  document.removeEventListener('keydown', handleMpRaceKeydown);
  document.getElementById('mp-race-hitzone-left').onclick = null;
  document.getElementById('mp-race-hitzone-right').onclick = null;
  if(mpChannel) mpChannel.send({type:'broadcast', event:'finish', payload:{pct: mpProgress}});
  renderMpRaceResult();
}
function receiveMpOpponentFinish(payload){
  if(!payload) return;
  mpOpponentProgress = Math.max(mpOpponentProgress, payload.pct || 0);
  updateMpRaceCars();
  if(mpActive) finishMultiRaceSelf();
  else renderMpRaceResult();
}
function renderMpRaceResult(){
  if(mpResultShown) return;
  mpResultShown = true;
  let msg;
  if(mpProgress > mpOpponentProgress){
    playRaceWinSound();
    incrementRaceWins();
    msg = '衝過終點線，你贏了！🏆';
  } else if(mpProgress === mpOpponentProgress){
    msg = '你們同時衝線，打成平手！握手言和 🤝';
  } else {
    msg = '朋友先衝過終點，差一點點，再挑戰一次吧！';
  }
  document.getElementById('mp-race-msg').textContent = msg;
  setTimeout(()=>{ cleanupMultiChannel(); showScreen('screen-arcade'); }, 2500);
}
function leaveMultiRaceMatch(){
  if(mpActive){
    mpActive = false;
    document.removeEventListener('keydown', handleMpRaceKeydown);
    if(mpChannel) mpChannel.send({type:'broadcast', event:'leave', payload:{}});
  }
  cleanupMultiChannel();
  showScreen('screen-arcade');
}

// ---- 打氣球 ----
// 每回合聽發音、看國字，畫面下方浮出幾顆氣球，各自寫著一個候選注音，
// 要在氣球飄出畫面之前戳破寫著正確答案的那一顆。戳到錯的只是消失，
// 不會扣分也不會結束這一回合，步調比打地鼠寬鬆，適合大班孩子。
const BALLOON_ROUND_COUNT = 8;
const BALLOON_RISE_SECONDS = 7;
const BALLOON_LANES = [10, 35, 60, 85]; // 氣球在天空裡的左邊位置(百分比)
let balloonRound = 0, balloonScore = 0, balloonCurrentChar = null, balloonRoundActive = false;
let balloonTimers = [];

function startBalloon(){
  balloonRound = 0;
  balloonScore = 0;
  document.getElementById('balloon-score').textContent = 0;
  document.getElementById('balloon-msg').textContent = '';
  nextBalloonRound();
}

function nextBalloonRound(){
  balloonTimers.forEach(t=>clearTimeout(t));
  balloonTimers = [];
  const sky = document.getElementById('balloon-sky');
  sky.innerHTML = '';
  balloonRound++;
  document.getElementById('balloon-round').textContent = Math.min(balloonRound, BALLOON_ROUND_COUNT);
  if(balloonRound > BALLOON_ROUND_COUNT){
    finishBalloon();
    return;
  }

  balloonCurrentChar = pickWeightedFrom(Object.keys(charData));
  const data = charData[balloonCurrentChar];
  document.getElementById('balloon-char').textContent = balloonCurrentChar;
  speak(balloonCurrentChar);
  balloonRoundActive = true;

  shuffleArray(data.options.slice()).forEach((opt, i)=>{
    const balloon = document.createElement('div');
    balloon.className = 'balloon';
    balloon.style.left = BALLOON_LANES[i] + '%';
    balloon.style.filter = `hue-rotate(${i * 70}deg)`;
    balloon.style.bottom = '-70px';

    const emoji = document.createElement('div');
    emoji.className = 'balloon-emoji';
    emoji.textContent = '🎈';
    const label = document.createElement('div');
    label.className = 'balloon-label';
    label.textContent = opt;
    balloon.appendChild(emoji);
    balloon.appendChild(label);
    balloon.onclick = () => popBalloon(balloon, opt === data.zhuyin);
    sky.appendChild(balloon);

    // 先讓瀏覽器畫出起始位置，下一輪再改 bottom 才會真的觸發漂浮的過場動畫
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        balloon.style.transition = `bottom ${BALLOON_RISE_SECONDS}s linear`;
        balloon.style.bottom = '380px';
      });
    });

    balloonTimers.push(setTimeout(()=>{
      if(balloon.parentElement) balloon.remove();
    }, BALLOON_RISE_SECONDS * 1000 + 50));
  });

  balloonTimers.push(setTimeout(()=>{
    if(balloonRoundActive){
      balloonRoundActive = false;
      setTimeout(()=> nextBalloonRound(), 400);
    }
  }, BALLOON_RISE_SECONDS * 1000 + 100));
}

function popBalloon(balloon, isCorrect){
  if(!balloonRoundActive) return;
  balloon.onclick = null;
  balloon.classList.add('pop');
  if(isCorrect){
    playBalloonPopSound();
    balloonScore++;
    document.getElementById('balloon-score').textContent = balloonScore;
    balloonRoundActive = false;
    setTimeout(()=> balloon.remove(), 250);
    setTimeout(()=> nextBalloonRound(), 700);
  } else {
    playMismatchSound();
    setTimeout(()=> balloon.remove(), 250);
  }
}

function finishBalloon(){
  document.getElementById('balloon-sky').innerHTML = '';
  document.getElementById('balloon-msg').textContent = `打氣球結束！戳對了 ${balloonScore} / ${BALLOON_ROUND_COUNT} 個 🎈`;
  setTimeout(()=> showScreen('screen-arcade'), 2000);
}

loadProfilesFromStorage();
initFromSupabase();
