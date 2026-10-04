const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../account-auth.js'),'utf8');
function fixture(user=null){
  const elements=new Map();const calls=[];let listener;
  const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:true,hidden:true,classList:{add(){},remove(){}}});return elements.get(id);};
  const auth={
    getSession:async()=>({data:{session:user?{user}:null}}),
    getUser:async()=>({data:{user}}),
    onAuthStateChange(fn){listener=fn;},
    signInWithOAuth:async args=>{calls.push(['oauth',args]);return {};},
    signOut:async args=>{calls.push(['logout',args]);return {};}
  };
  const context=vm.createContext({sb:{auth},document:{getElementById:el,querySelectorAll:()=>[]},location:{href:'https://example.test/zhuyin-app/?redirect_to=https://evil.test',search:'',hash:'',reload(){calls.push(['reload']);}},URL,URLSearchParams,setTimeout:fn=>fn(),confirm:()=>true,createAccountStore:()=>()=>{},loadProfilesFromStorage:()=>calls.push(['profiles']),initFromSupabase:async()=>calls.push(['load']),showScreen:id=>calls.push(['screen',id]),progressLoadFailed:false});
  context.sb.rpc=async()=>({data:false,error:null});
  vm.runInContext(source,context);
  return {context,calls,auth,el,event:(s)=>listener('SIGNED_IN',s),run:code=>vm.runInContext(code,context)};
}
test('anonymous boot never reads learning records and offers sign-in',async()=>{
  const f=fixture();await f.run('startAccountAuth()');
  assert.equal(f.calls.length,0);assert.equal(f.el('google-login').disabled,false);
  assert.equal(f.run('accountLocked'),true);
});
test('validated session loads only after getUser and namespaces profiles',async()=>{
  const f=fixture({id:'parent-a',email:'a@example.test'});await f.run('startAccountAuth()');
  assert.equal(f.run("profileStorageKey('names')"),'names:parent-a');
  assert.deepEqual(f.calls,[['profiles'],['load'],['screen','screen-home']]);
  f.event({user:{id:'parent-a'}});assert.equal(f.calls.length,3);
  f.event({user:{id:'parent-b'}});assert.equal(f.run('accountLocked'),true);
  assert.deepEqual(f.calls.at(-1),['reload']);
});
test('OAuth ignores attacker supplied redirect query and handles provider error',async()=>{
  const f=fixture();await f.run('signInWithGoogle()');
  assert.equal(f.calls[0][1].options.redirectTo,'https://example.test/zhuyin-app/');
  assert.equal(f.calls[0][1].provider,'google');
  f.auth.signInWithOAuth=async()=>({error:{message:'disabled'}});
  await f.run('signInWithGoogle()');assert.equal(f.el('google-login').disabled,false);
  assert.match(f.el('auth-message').textContent,/無法使用/);
});
test('invalid session never loads data; logout is local and reload clears game callbacks',async()=>{
  const f=fixture({id:'a'});f.auth.getUser=async()=>({error:{message:'expired'},data:{user:null}});
  await f.run('startAccountAuth()');assert.equal(f.calls.length,0);assert.equal(f.el('auth-reload').hidden,false);
  await f.run('signOutAccount()');assert.equal(f.calls[0][1].scope,'local');assert.deepEqual(f.calls.at(-1),['reload']);
});
