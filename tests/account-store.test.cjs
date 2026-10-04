const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAccountStore}=require('../account-store.js');
function fixture(){
  const calls=[];
  const query={};
  for(const method of ['select','eq','upsert','insert','update'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
  return {calls,client:{from(table){calls.push(['from',table]);return query;}}};
}
test('reads and updates are scoped to owner',()=>{
  const {calls,client}=fixture();const from=createAccountStore(client,'owner-a');
  from('zhuyin_app_char_progress').select('*');
  from('zhuyin_app_state').update({coins:2,user_id:'victim'});
  assert.deepEqual(calls.filter(c=>c[0]==='eq'),[['eq','user_id','owner-a'],['eq','user_id','owner-a']]);
  assert.deepEqual(calls.find(c=>c[0]==='update'),['update',{coins:2}]);
});
test('bulk writes override forged owner and specify composite conflict keys',()=>{
  const {calls,client}=fixture();const from=createAccountStore(client,'owner-a');
  from('zhuyin_app_char_progress').upsert([{character:'大',user_id:'victim'},{character:'p2_小'}]);
  assert.deepEqual(calls[1],['upsert',[{character:'大',user_id:'owner-a'},{character:'p2_小',user_id:'owner-a'}],{onConflict:'user_id,character'}]);
  from('zhuyin_app_state').insert({id:1,coins:8});
  assert.equal(calls[3][1].user_id,'owner-a');
});
test('anonymous and stale sessions cannot create queries',()=>{
  const {client}=fixture();
  assert.throws(()=>createAccountStore(client,null));
  const from=createAccountStore(client,'owner-a',()=>false);
  assert.throws(()=>from('zhuyin_app_state'));
  assert.throws(()=>createAccountStore(client,'a')('unrelated_table'));
});
