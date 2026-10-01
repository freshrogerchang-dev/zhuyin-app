# S4 Build Log

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
