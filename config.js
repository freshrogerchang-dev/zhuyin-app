// Supabase 連線設定
// Publishable Key 可公開；資料權限由登入後的 user_id 與資料庫 RLS 控制。
// Google Client Secret 與 Supabase Secret Key 絕不可放在前端。
const SUPABASE_URL = 'https://pfwszpywdjkxtnnctslp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4rb-6bHDyjDVPO7STxyQFA_y6ZyFAUm';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: 'zhuyin-auth-pfwszpywdjkxtnnctslp', persistSession: true, detectSessionInUrl: true }
});
