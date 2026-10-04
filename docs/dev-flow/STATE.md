# 注音筆順練習 — Dev-Flow State
最後更新：2026-10-04（S4）

## 一句話目標
新增 Google 登入與帳號隔離，既有紀錄歸戶 freshrogerchang@gmail.com；保留既有學習功能與資料。

## Phase 狀態
- S1：隱含完成（既有原生 HTML/CSS/JS 架構，無框架遷移）
- S2：本次軟體檢查完成（Edge 手機／平板 viewport）；實體 iPad 待確認
- S3：略過（本次不新增教材或宣稱教學成效）
- S4：進行中（新專案資料庫與私有舊資料快照完成；Google Provider 尚未啟用，因此前端未發布）
- S5：本次範圍的規則／隔離瀏覽器測試完成；全站安全與遊戲回歸未執行

## 關鍵決策
| 日期 | Session | 決策 | 理由 | 替代方案 |
| --- | --- | --- | --- | --- |
| 2026-10-01 | 既有 | main/root GitHub Pages、HanziWriter、Supabase | 延續已上線版本 | 不改為其他部署平台 |
| 2026-10-01 | S4 | DOM/CSS 排版、SVG 插圖 | 清晰縮放、保留原生按鈕與無障礙 | 不以 Canvas 重寫整站 |
| 2026-10-01 | S4 | 從現有 progressMap 推算當日完成與複習項目 | 不新增資料庫或重設紀錄 | 不引入新的雲端資料模型 |

## 未決問題 / 風險
- 新專案 pfwszpywdjkxtnnctslp 已建立兩張 RLS 資料表、私有匯入快照與一次性 verified Google 歸戶流程；舊專案保留原始資料。
- 2026-10-04 公開 Auth settings 顯示新專案 Google Provider=false。發布登入閘門前必須由使用者在新專案填入專用 Google Client ID/Secret 並啟用，且加入 Pages redirect URL。
- 私有快照為 state 1 筆、progress 55 筆；freshrogerchang@gmail.com 首次以 verified Google 登入後才自動歸戶。尚未真實登入，因此公開 owner 表目前可合理為空。
- 現有複習規則為 2／7／14 天啟發式規則，不是完整自適應 SRS。
- 實體 iPad 與 Safari 語音需使用者確認；瀏覽器模擬不等同實機。

## 下一步
使用者啟用新專案 Google Provider 後重查 settings；執行瀏覽器／正式 OAuth 驗證，再 commit/push。國字筆順去除數字標籤的先前未提交修改仍保留。
