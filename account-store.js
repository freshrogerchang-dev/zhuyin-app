// Client scoping is defense in depth; database RLS is the security boundary.
(function(root){
  function createAccountStore(client, userId, isCurrent = ()=>true){
    if(!userId) throw new Error('請先登入');
    return function from(table){
      const keys = {zhuyin_app_state:'user_id,id',zhuyin_app_char_progress:'user_id,character'};
      if(!keys[table]) throw new Error('不支援的資料表');
      if(!isCurrent()) throw new Error('登入狀態已變更，請重新整理');
      const query = client.from(table);
      const owned = rows => Array.isArray(rows) ? rows.map(owned) : {...rows,user_id:userId};
      return {
        select(columns){return query.select(columns).eq('user_id',userId);},
        insert(rows){return query.insert(owned(rows));},
        upsert(rows){return query.upsert(owned(rows),{onConflict:keys[table]});},
        update(row){const {user_id:ignored,...values}=row;return query.update(values).eq('user_id',userId);}
      };
    };
  }
  root.createAccountStore=createAccountStore;
  if(typeof module!=='undefined') module.exports={createAccountStore};
})(typeof window==='undefined'?globalThis:window);
