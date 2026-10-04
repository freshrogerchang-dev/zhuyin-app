// No learning records are requested before a validated Supabase session exists.
let accountUser = null;
let accountLocked = true;
let accountFrom = ()=>{throw new Error('請先登入');};
let authStarted = false;
let legacyDataOwner = false;
let authInvalidated = false;
let accountBooting = true;
function profileStorageKey(key){
  if(!accountUser) throw new Error('請先登入');
  return `${key}:${accountUser.id}`;
}
function authMessage(text){document.getElementById('auth-message').textContent=text;}
function lockAccount(){
  accountLocked=true;
  document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active'));
  document.getElementById('screen-login').classList.add('active');
  if(typeof cancelLearningSpeech==='function') cancelLearningSpeech();
  if(typeof stopGameMusic==='function') stopGameMusic();
}
async function signInWithGoogle(){
  const button=document.getElementById('google-login');
  button.disabled=true;
  authMessage('正在前往 Google…');
  try{
    // Never accept a redirect destination from query parameters.
    const redirectTo=new URL('./',location.href).href;
    const {error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo,queryParams:{prompt:'select_account'}}});
    if(error) throw error;
  }catch(error){
    authMessage('Google 登入暫時無法使用，請確認網路；若持續失敗，請由管理者確認 Google 登入設定。');
    button.disabled=false;
  }
}
async function signOutAccount(){
  if(!confirm('確定要登出嗎？已儲存的學習紀錄會保留。')) return;
  lockAccount();
  authMessage('正在登出…');
  try{
    const {error}=await sb.auth.signOut({scope:'local'});
    if(error) throw error;
    location.reload();
  }catch(error){
    authMessage('登出失敗，請重新整理後再試。');
    document.getElementById('auth-reload').hidden=false;
  }
}
async function startAccountAuth(){
  if(authStarted) return;
  authStarted=true;
  lockAccount();
  let expectedId;
  let observedId;
  const invalidate = ()=>{
    if(authInvalidated) return;
    authInvalidated=true;
    lockAccount();
    setTimeout(()=>location.reload(),0);
  };
  try{
    sb.auth.onAuthStateChange((_event,session)=>{
      observedId=session?.user?.id || null;
      if(expectedId !== undefined && observedId !== expectedId) invalidate();
    });
    // SDK handles the OAuth callback. Do not duplicate exchangeCodeForSession.
    const {data,error}=await sb.auth.getSession();
    if(error) throw error;
    expectedId=data.session?.user?.id || null;
    if(observedId !== undefined && observedId !== expectedId){invalidate();return;}
    if(data.session){
      const result=await sb.auth.getUser();
      if(authInvalidated) return;
      if(result.error || !result.data.user) throw result.error || new Error('Session invalid');
      if(result.data.user.id !== expectedId){invalidate();return;}
      accountUser=result.data.user;
      const boundId=accountUser.id;
      accountFrom=createAccountStore(sb,boundId,()=>!accountLocked && !progressLoadFailed && accountUser?.id===boundId);
      authMessage('正在載入你的家庭紀錄…');
      const claim=await sb.rpc('zhuyin_claim_legacy');
      if(authInvalidated) return;
      if(claim.error) throw new Error('無法載入家庭紀錄');
      legacyDataOwner=claim.data===true;
      accountLocked=false;
      document.getElementById('account-email').textContent=accountUser.email || '已登入';
      loadProfilesFromStorage();
      await initFromSupabase();
      if(authInvalidated) return;
      if(progressLoadFailed) throw new Error('無法讀取雲端紀錄');
      accountBooting=false;
      showScreen('screen-home');
    }else{
      const failed=new URLSearchParams(location.hash.slice(1)).has('error') || new URLSearchParams(location.search).has('error');
      authMessage(failed?'登入未完成，請再試一次。':'請家長使用 Google 登入，每個家庭的紀錄會分開保存。');
    }
    // Reload on account changes destroys old timers, channels and child data.
    document.getElementById('google-login').disabled=false;
  }catch(error){
    lockAccount();
    authMessage(accountUser?'登入成功，但家庭紀錄暫時無法載入。請重試，紀錄不會被清除。':'無法確認登入狀態，請確認網路後重新整理。');
    document.getElementById('auth-reload').hidden=false;
    document.getElementById('auth-signout').hidden=!accountUser;
  }
}
