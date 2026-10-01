// Pure planning helpers. No network calls or storage writes; safe to test in isolation.
(function(root){
  'use strict';
  const DAILY_TARGET = 5;
  function dateKey(value){
    const date = new Date(value);
    if(!Number.isFinite(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function reviewInterval(row){
    // Use the latest result when available: a recent struggle needs earlier review.
    const reward = row.last_reward == null ? row.best_reward : row.last_reward;
    return reward < 3 ? 2 : (row.perfect_count >= 2 ? 14 : 7);
  }
  function build(catalog, progress, now = new Date()){
    const today = dateKey(now);
    const completed = [];
    const due = [];
    for(const item of catalog){
      const row = progress[item.key];
      if(!row || !(row.attempt_count > 0)) continue;
      if(dateKey(row.updated_at) === today) completed.push(item.key);
      const last = new Date(row.updated_at);
      if(!row.updated_at || !Number.isFinite(last.getTime())) continue;
      const reviewDate = new Date(last);
      reviewDate.setDate(reviewDate.getDate() + reviewInterval(row));
      reviewDate.setHours(0,0,0,0);
      if(dateKey(last) !== today && reviewDate <= now){
        due.push({...item, dueAt:reviewDate.getTime()});
      }
    }
    due.sort((a,b)=> a.dueAt - b.dueAt || a.key.localeCompare(b.key));
    const completedSet = new Set(completed);
    const dueSet = new Set(due.map(item=>item.key));
    const remaining = Math.max(0, DAILY_TARGET - completed.length);
    const newItems = catalog.filter(item=> !completedSet.has(item.key) && !dueSet.has(item.key) && !(progress[item.key]?.attempt_count > 0));
    // Practised-but-not-due items are intentionally not scheduled early just to fill a quota.
    const suggestions = [...due, ...newItems].slice(0, remaining);
    return {target:DAILY_TARGET, completed, due, suggestions, remaining};
  }
  const api = {DAILY_TARGET, dateKey, reviewInterval, build};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PracticePlan = api;
})(globalThis);
