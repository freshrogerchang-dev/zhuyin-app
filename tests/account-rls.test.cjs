const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const unverified='00000000-0000-4000-8000-000000000003';
test('new project migration preserves legacy data and enforces owner-only RLS',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
      create table auth.identities(user_id uuid,provider text,identity_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to authenticated,anon;`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261003111708_new_project_accounts.sql'),'utf8'));
    await db.query('insert into auth.users values ($1,$2,now(),null),($3,$4,now(),$5),($6,$2,null,null)',[owner,'freshrogerchang@gmail.com',other,'other@example.test',JSON.stringify({email:'freshrogerchang@gmail.com',email_verified:true}),unverified]);
    await db.query('insert into auth.identities values ($1,\'google\',$2),($3,\'google\',$4),($5,\'google\',$2)',[owner,JSON.stringify({email:'freshrogerchang@gmail.com',email_verified:true}),other,JSON.stringify({email:'other@example.test',email_verified:true}),unverified]);
    const snapshot={state:[{id:1,coins:42,updated_at:'2026-09-01T00:00:00Z'}],progress:[{character:'大',best_reward:3,perfect_count:2,attempt_count:4,last_reward:3,updated_at:'2026-09-01T00:00:00Z'},{character:'p2___stat_coins__',best_reward:91,perfect_count:0,attempt_count:0,last_reward:null,updated_at:'2026-09-01T00:00:00Z'}]};
    await db.query('update zhuyin_private.legacy_import set snapshot=$1,ready=true',[JSON.stringify(snapshot)]);
    async function asRole(role,id,fn){
      await db.exec('begin');
      try{
        await db.exec(`set local role ${role}`);
        await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);
        const value=await fn();await db.exec('commit');return value;
      }catch(e){await db.exec('rollback');throw e;}
    }
    for(const table of ['zhuyin_app_state','zhuyin_app_char_progress']){
      await assert.rejects(asRole('anon',null,()=>db.query(`select * from public.${table}`)),e=>e.code==='42501');
    }
    await assert.rejects(asRole('anon',null,()=>db.query('select public.zhuyin_claim_legacy()')),e=>e.code==='42501');
    await assert.rejects(asRole('authenticated',other,()=>db.query('select * from zhuyin_private.legacy_import')),e=>e.code==='42501');
    for(const id of [other,unverified])assert.equal((await asRole('authenticated',id,()=>db.query('select public.zhuyin_claim_legacy() as claimed'))).rows[0].claimed,false);
    assert.equal((await asRole('authenticated',owner,()=>db.query('select public.zhuyin_claim_legacy() as claimed'))).rows[0].claimed,true);
    // Repeating the claim must not restore coins after they have been spent.
    await asRole('authenticated',owner,()=>db.query('update public.zhuyin_app_state set coins=40'));
    await asRole('authenticated',owner,()=>db.query('select public.zhuyin_claim_legacy()'));
    assert.equal((await asRole('authenticated',owner,()=>db.query('select coins from public.zhuyin_app_state'))).rows[0].coins,40);
    assert.equal((await asRole('authenticated',owner,()=>db.query('select * from public.zhuyin_app_char_progress'))).rows.length,2);
    assert.equal((await asRole('authenticated',other,()=>db.query('select * from public.zhuyin_app_char_progress'))).rows.length,0);
    assert.equal((await asRole('authenticated',other,()=>db.query('update public.zhuyin_app_state set coins=999 returning *'))).rows.length,0);
    await assert.rejects(asRole('authenticated',other,()=>db.query('insert into public.zhuyin_app_state(user_id) values ($1)',[owner])),e=>e.code==='42501');
    await assert.rejects(asRole('authenticated',owner,()=>db.query('update public.zhuyin_app_state set user_id=$1',[other])),e=>e.code==='42501');
    await asRole('authenticated',other,()=>db.query('insert into public.zhuyin_app_state(user_id) values ($1)',[other]));
    assert.equal((await asRole('authenticated',other,()=>db.query('select coins from public.zhuyin_app_state'))).rows[0].coins,8);
    await assert.rejects(asRole('authenticated',owner,()=>db.query('delete from public.zhuyin_app_state')),e=>e.code==='42501');
    const preserved=(await db.query('select snapshot from zhuyin_private.legacy_import')).rows[0].snapshot;
    assert.deepEqual(preserved,snapshot,'private snapshot is never consumed or deleted');
  }finally{await db.close();}
});
