// UI adapter for the existing learning flows. Progress stays in the existing profile.
let dailyPracticeSession = false;
let dailyReviewFilter = 'all';
const PRACTICE_LABELS = {char:'國字', zhuyin:'注音', word:'詞語', letter:'英文'};

function practiceCatalog(){
  const groups = [
    Object.keys(charData).map(key=>({key, type:'char'})),
    zhuyinData.map(z=>({key:z.symbol, type:'zhuyin'})),
    wordData.map(key=>({key, type:'word'})),
    Object.keys(letterData).map(key=>({key, type:'letter'}))
  ];
  const catalog = [];
  for(let i=0; i<Math.max(...groups.map(group=>group.length)); i++){
    groups.forEach(group=>{ if(group[i]) catalog.push(group[i]); });
  }
  return catalog;
}
function todayPracticePlan(){ return PracticePlan.build(practiceCatalog(), progressMap); }
function renderDailySummary(){
  const plan = todayPracticePlan();
  const count = Math.min(plan.completed.length, plan.target);
  const status = progressLoading ? '正在讀取練習紀錄…' : progressLoadFailed ? '暫時無法讀取紀錄，請重試' : plan.remaining ? `今天完成 ${count} / ${plan.target} 個` : '今天的任務完成了！';
  document.getElementById('daily-summary').textContent = status;
  document.getElementById('daily-progress').value = count;
  document.getElementById('daily-progress').setAttribute('aria-label', status);
  document.getElementById('daily-review-summary').textContent = progressLoading || progressLoadFailed ? '讀取成功後顯示待複習項目' : plan.due.length ? `${plan.due.length} 個項目可以複習囉` : '沒有到期的項目，慢慢學就好';
  document.getElementById('daily-open').disabled = progressLoading;
  if(document.getElementById('screen-daily').classList.contains('active')) renderDailyPractice();
}
function openDailyPractice(){
  dailyPracticeSession = false;
  dailyReviewFilter = 'all';
  showScreen('screen-daily');
  renderDailyPractice();
}
function practiceTile(item){
  const button = document.createElement('button');
  button.className = 'practice-tile';
  const label = document.createElement('strong');
  label.textContent = item.key;
  const kind = document.createElement('span');
  kind.textContent = PRACTICE_LABELS[item.type];
  button.append(label, kind);
  button.setAttribute('aria-label', `練習${PRACTICE_LABELS[item.type]} ${item.key}`);
  button.onclick = ()=> startPlannedPractice(item);
  return button;
}
function renderDailyPractice(){
  const plan = todayPracticePlan();
  const ready = !progressLoading && !progressLoadFailed;
  const summary = document.getElementById('daily-detail');
  summary.textContent = progressLoading ? '正在讀取紀錄…' : progressLoadFailed ? '練習紀錄讀取失敗，請檢查網路後重試。' : plan.remaining ? `今天完成 ${plan.completed.length} / ${plan.target} 個不同項目，不用趕，隨時可以休息。` : `今天已完成 ${plan.completed.length} 個！可以休息，也可以自由練習。`;
  document.getElementById('daily-retry').hidden = !progressLoadFailed;
  document.getElementById('daily-start').disabled = !ready || !plan.suggestions.length;
  document.getElementById('daily-start').textContent = !plan.remaining ? '今天的任務完成了 ✓' : '開始今日練習 →';
  const suggestions = document.getElementById('daily-suggestions');
  suggestions.replaceChildren();
  if(ready) plan.suggestions.forEach(item=>suggestions.appendChild(practiceTile(item)));
  document.getElementById('daily-plan-note').textContent = ready && plan.remaining && !plan.suggestions.length ? '已學過的項目還沒到複習日，可以自由練習，或明天再來。' : '優先複習到期項目，再認識新朋友；同一項目每天只計一次。';
  const filters = document.getElementById('daily-filters');
  filters.replaceChildren();
  Object.entries({all:'全部', ...PRACTICE_LABELS}).forEach(([key,label])=>{
    const button = document.createElement('button');
    button.className = 'filter-chip';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(dailyReviewFilter === key));
    button.onclick = ()=>{ dailyReviewFilter = key; renderDailyPractice(); };
    filters.appendChild(button);
  });
  const items = plan.due.filter(item=>dailyReviewFilter === 'all' || item.type === dailyReviewFilter);
  const list = document.getElementById('daily-review-list');
  list.replaceChildren();
  if(ready) items.forEach(item=>list.appendChild(practiceTile(item)));
  const empty = document.getElementById('daily-review-empty');
  empty.hidden = !ready || items.length > 0;
  empty.textContent = dailyReviewFilter === 'all' ? '目前沒有到期項目，做得很好！' : '這一類目前沒有到期項目。';
}
function startPlannedPractice(item){
  if(progressLoading || progressLoadFailed) return;
  dailyPracticeSession = true;
  if(item.type === 'char') beginCharacterFlow(item.key);
  else if(item.type === 'zhuyin') startZhuyinPractice(item.key);
  else if(item.type === 'word') startWordPractice(item.key);
  else if(item.type === 'letter') startLetterPractice(item.key);
}
function continueDailyPractice(){
  const item = todayPracticePlan().suggestions[0];
  if(item) startPlannedPractice(item);
  else openDailyPractice();
}
function updateDailyResult(){
  const button = document.getElementById('daily-continue');
  button.hidden = !dailyPracticeSession;
  const plan = todayPracticePlan();
  button.textContent = plan.suggestions.length ? `下一個練習（今天 ${plan.completed.length} / ${plan.target}）` : '看看今天的成果 ✓';
}
// Recompute the calendar date after an iPad resumes, without polling or writing progress.
document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden){ renderDailySummary(); updateHomeStreakDisplay(); }
});
