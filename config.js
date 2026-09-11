// Supabase 連線設定
// 這個 key 是 publishable(anon)金鑰，設計上就是給前端公開使用，
// 但代表任何拿到這個網站網址、看原始碼的人都能讀寫下面兩張表：
// zhuyin_app_state、zhuyin_app_char_progress
// 之後若要正式給多個家庭/班級使用，務必加上登入機制做資料區隔。
const SUPABASE_URL = 'https://umhwizsnkcphmhwwubhl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qDBuXFg1hy0_qzQ2f_SQdQ_rdXjp4Vj';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
