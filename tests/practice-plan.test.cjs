const test = require('node:test');
const assert = require('node:assert/strict');
const plan = require('../practice-plan.js');
const now = new Date(2026, 9, 2, 12);
const catalog = ['大','ㄅ','大人','A','小','ㄆ','小人'].map((key,i)=>({key,type:['char','zhuyin','word','letter'][i%4]}));
function row(daysAgo, extra={}){
  const date = new Date(now); date.setDate(date.getDate()-daysAgo);
  return {attempt_count:1,best_reward:1,last_reward:1,perfect_count:0,updated_at:date.toISOString(),...extra};
}
test('new profile gets five mixed suggestions, no fake completion or due items',()=>{
  const result = plan.build(catalog, {}, now);
  assert.equal(result.suggestions.length,5);
  assert.deepEqual(result.completed,[]);
  assert.deepEqual(result.due,[]);
  assert.equal(result.remaining,5);
});
test('same item only counts once; special keys, reset and unknown rows never count',()=>{
  const result = plan.build(catalog, {'大':row(0,{attempt_count:20}),'ㄅ':row(0,{attempt_count:0}),'__stat_streak__':row(0),'deleted':row(0)}, now);
  assert.deepEqual(result.completed,['大']);
  assert.equal(result.remaining,4);
  assert.ok(!result.suggestions.some(item=>item.key==='大'));
});
test('2/7/14 calendar-day due dates and oldest-first order',()=>{
  const progress = {'大':row(2), 'ㄅ':row(7,{last_reward:3,perfect_count:1}), 'A':row(13,{last_reward:3,perfect_count:2}), '小':row(20,{last_reward:3,perfect_count:2})};
  assert.deepEqual(plan.build(catalog,progress,now).due.map(item=>item.key),['小','大','ㄅ']);
});
test('recent struggle overrides historical mastery',()=>{
  assert.equal(plan.reviewInterval(row(2,{best_reward:3,perfect_count:12,last_reward:1})),2);
  assert.equal(plan.reviewInterval(row(2,{best_reward:3,perfect_count:1,last_reward:null})),7);
});
test('goal completes after five distinct items, without scheduling more',()=>{
  const progress = Object.fromEntries(catalog.slice(0,5).map(item=>[item.key,row(0)]));
  const result = plan.build(catalog,progress,now);
  assert.equal(result.remaining,0);
  assert.deepEqual(result.suggestions,[]);
});
test('yesterday completed items do not count today and are not scheduled too early',()=>{
  const progress = Object.fromEntries(catalog.map(item=>[item.key,row(1)]));
  const result = plan.build(catalog,progress,now);
  assert.equal(result.completed.length,0);
  assert.equal(result.suggestions.length,0);
  assert.equal(result.due.length,0);
});
test('bad timestamps and future timestamps never become due or completed today',()=>{
  const result = plan.build(catalog, {'大':row(2,{updated_at:'bad'}),'ㄅ':row(-1),'A':row(2,{updated_at:null})},now);
  assert.equal(result.completed.length,0);
  assert.equal(result.due.length,0);
});
test('planning is read-only and profile-specific',()=>{
  const progress = {'大':row(9)};
  const before = JSON.stringify(progress);
  assert.equal(plan.build(catalog,progress,now).due.length,1);
  assert.equal(plan.build(catalog,{},now).due.length,0);
  assert.equal(JSON.stringify(progress),before);
});
test('local midnight boundary resets daily count without UTC shift',()=>{
  const late = new Date(2026,9,1,23,59);
  const progress = {'大':row(0,{updated_at:late.toISOString()})};
  assert.equal(plan.build(catalog,progress,late).completed.length,1);
  assert.equal(plan.build(catalog,progress,new Date(2026,9,2,0,1)).completed.length,0);
});
