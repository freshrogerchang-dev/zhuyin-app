# S4 Build Log
## 2026-10-04：新 Supabase 專案切換與資料搬移
- 新專案 `pfwszpywdjkxtnnctslp` 建立 owner 複合主鍵資料表與 RLS（匿名無權限；authenticated 只能操作 `auth.uid()` 自己的列；無 delete）。
- 舊專案保留原始資料；新專案私有 schema 保存 state 1 筆／progress 55 筆完整快照，不對前端授權。一次性 claim 僅接受 auth.uid() 對應已驗證 Google identity 與 freshrogerchang@gmail.com，拒絕 caller email/metadata 偽造，重複呼叫不覆蓋新進度。
- config.js 改為新專案 URL／Publishable Key 及獨立 Auth storageKey；不含 Google Secret 或 Supabase Secret Key。
- 完成響應式登入頁、Google 登入／註冊、載入失敗重試、登出換帳號與 session 變更清理；其他家庭首次登入取得自己的空資料。
- PGlite migration/RLS 測試含匿名拒絕、跨帳號讀寫／轉移拒絕、Google identity 驗證、一次性歸戶、快照保留；22/22 測試通過。
- 2026-10-04 管理者完成新專案 Google Provider 與 URL 設定；公開 settings 為 true，authorize 測試 HTTP 302 並正確導向 accounts.google.com。可進入發布與真實登入確認。
## 2026-10-03：Google 登入與家庭帳號隔離（未上線）
- 使用者允許 DB/RLS 變更並指定既有資料歸戶 freshrogerchang@gmail.com。唯讀查詢找到已驗證 email 帳號 UUID，既有進度 55 列；未輸出／讀取 Secret。
- Google Provider 公開設定最初 false，使用者說已有共用專案憑證後重查 true。未取得 dashboard／未更換 OAuth 憑證；轉址白名單仍需確認。
- 新增 account-auth.js 登入閘門、Google OAuth、local 登出、帳號事件鎖定＋reload 清除舊遊戲狀態；account-store.js 為查詢／更新加 owner filter，insert/upsert 強制 user_id 與複合衝突鍵。
- localStorage 小孩名字／目前槽位依 user UUID 分開；只對已確認的舊帳號匯入舊名字。名字仍是本機設定，不宣稱跨裝置同步。
- SDK 固定 2.117.2（npm 查核）、獨立 auth storageKey，避免同網域其他 App 混用登入儲存鍵。既有國字筆順修改保留。
- CLI 2.81.3 下載的執行檔損壞，改用現有 Windows CLI 2.117.0，先讀 help 再建立 migration。SQL 草稿建立私有備份、按 auth.users 已驗證 email 歸戶、owner 複合主鍵與 RLS；**尚未套用或測試 SQL**。
- 驗證：21/21 Node 測試、JS syntax、git diff --check 通過；Edge 隔離 smoke 四個 viewport 通過，pageerror 0，正式資料庫請求 0。登入單元測試使用 mock，不等同真實 Google OAuth。
- 待辦：migration／RLS 負向測試、初始登入期間 account change 競態與資料載入失敗後寫入保護補強、登入畫面實際瀏覽器測試；確認 redirect whitelist；取得發布同意後同步切換 DB/Pages；正式 Google 登入後驗證 owner 舊紀錄與新帳號空資料。
- 最新使用者「我想要增加留一組ID SECRETS」有歧義，先不更動共用 provider、不 commit/push、不改正式權限。

## 2026-10-03：國字筆順示範不疊加數字
- 移除國字介紹畫面一次顯示全部筆順數字的標籤，避免遮住字形；不影響英文字母的筆順標記。
- 國字 writer 初始 `showCharacter: false`，保留既有逐筆動畫、速度與重新播放；完成後仍可看到完整國字。
- 不修改書寫測驗的黃色下一筆提示或學習資料。本次未要求 commit／push。
- 驗證通過：`node --check app.js`、`git diff --check`、隔離瀏覽器 smoke（含國字示範／重播均無數字標籤；pageerror 0、正式資料庫請求 0）。

## 2026-10-02：直式注音、標準錄音與遊戲朗讀
- 每個注音選項內的符號上下排列，聲調在末符右上方，輕聲在上方；保留賽車左右選擇控制。套用聽力、字音配對、單／雙人賽車、氣球、釣魚。
- 37 個符號採教育部《國語注音符號手冊》原始 WAV（CC BY 4.0），每次只播一次；例字另按鈕播放。來源／授權見 `assets/audio/zhuyin/ATTRIBUTION.md` 及注音介紹畫面。
- 音檔順序依官方 Unicode 順序而非 zhuyinData 的排列，特別核對 ㄝ=F25、ㄦ=F34、ㄧ/ㄨ/ㄩ=F35/36/37。未修改音高、速度或內容。
- 系統 TTS 用於國字／例字／玩法，優先選 zh-TW voice。賽車／雙人賽車／氣球／釣魚每題朗讀、字音配對點國字朗讀、翻牌朗讀動物、打地鼠朗讀玩法；遊戲增設重播按鈕，朗讀時降低背景音樂。
- 導頁／切到背景取消音訊，舊 onend 不得續唸；氣球回合與結束跳頁計時器納入清理。
- 氣球由 7 秒改成 14 秒，從底部完整可見的位置開始，保留八題和既有計分。
- 驗證：14/14 Node 規則＋音訊控制測試；隔離 Edge 瀏覽器解碼全部 37 個 WAV、檢查直排布局／14 秒動畫／新題朗讀與重播／離頁取消，正式資料庫請求為零。
- 限制：瀏覽器測試驗證音檔解碼和朗讀觸發，不宣稱已聽辨每個系統 TTS 發音；iPad Safari 的音量、自動播放與聽感仍待實機確認。

## 啟動方式
既有靜態網站，無打包器。`python -m http.server 8934 --bind 127.0.0.1`。
隔離測試會自行啟動 HTTP server，替換 `config.js`；不讀寫真實資料庫。

## Backlog
- [x] 合併遠端 main 的最新雙人對戰、釣魚、注音自動完成更新（45f3dc8），再實作
- [x] SVG 長頸鹿、四類大按鈕、今日任務卡、手機／平板響應式首頁
- [x] 每日 5 項目、到期複習篩選、直接進入四種練習、結果頁繼續
- [x] 規則測試與隔離瀏覽器驗證
- [ ] 實體 iPad Safari 觸控與語音確認

## 2026-10-02：首頁與每日練習
- 保留 HTML/CSS/JS 架構及既有進度表，不新增主要相依套件／API／migration，不改變朋友對戰流程。
- 以 `practice-plan.js` 分離純資料運算，以 `daily-practice.js` 接上既有四種練習；自由練習依然可用。
- 任務從最新 progressMap 推算、當地日期歸零、不重複計數；不另外發獎。已熟練但最近退步以 last_reward 安排較早複習，隨機抽題同步使用同一規則。
- 新增載入、空清單、讀取失敗／重試提示；新增按鈕使用原生 button 與 focus-visible。保留解鎖後的吉祥物。
- iPad safe-area、100dvh、自然垂直捲動，允許頁面縮放；保持書寫 canvas 尺寸與座標不變。導頁回到頂部。
- CSS/JS 查詢版本更新，避免沿用舊快取；自製 SVG 不依賴外部圖片服務。

## 驗證證據
- Node v22.21.0；`node --check` app.js / data.js / daily-practice.js / practice-plan.js；`git diff --check`。
- `node --test tests/practice-plan.test.cjs`：9/9 通過。涵蓋 2/7/14 天到期、最近退步、重複計數、重設列／特殊列、跨日、損壞日期、不同檔案純資料隔離。
- `tests/browser-smoke.cjs`：Edge 320×568、390×844、820×1180、1180×820；首頁／複習頁無橫向溢出，檢視截圖。
- 瀏覽器驗證：類別篩選、真實 HanziWriter 載入國字、四類指定題目入口、既有完成 handler → 結果 → 下一項、5 項目目標、切換檔案、讀取失敗與重試、保留釣魚入口。
- pageerror 0；正式資料庫請求 0。完成 handler 用假資料觸發，不代表完整手寫手勢辨識已實機驗證。
- 初次測試等待隱藏 SVG defs 路徑可見而超時；改為確認路徑已載入及主 SVG 可見，重新執行通過。

## 已知限制
- 未做全站安全稽核、正式雲端写入或雙裝置對戰測試，也未確認 iPad 實機。
- 既有雲端儲存失敗仍只記錄警告；任務顯示先依本機記憶體，跨裝置以成功儲存的紀錄為準。
- 每日任務沒有逐日歷史；不是完整自適應 SRS。
- Supabase 查詢錯誤處理依官方 select 的 `{ data, error }`：https://supabase.com/docs/reference/javascript/select 。未新增 Supabase API，未更動權限。
