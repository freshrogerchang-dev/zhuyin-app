# 注音筆順練習 — Dev-Flow State
最後更新：2026-10-04（S4）

## 一句話目標
新增 Google 登入與帳號隔離，既有紀錄歸戶 freshrogerchang@gmail.com；保留既有學習功能與資料。

## Phase 狀態
- S1：隱含完成（既有原生 HTML/CSS/JS 架構，無框架遷移）
- S2：本次軟體檢查完成（Edge 手機／平板 viewport）；實體 iPad 待確認
- S3：略過（本次不新增教材或宣稱教學成效）
- S4：完成（新專案資料庫、私有舊資料快照、Google 登入頁與帳號隔離均完成）
- S5：本次範圍的規則／隔離瀏覽器測試完成；全站安全與遊戲回歸未執行

## 關鍵決策
| 日期 | Session | 決策 | 理由 | 替代方案 |
| --- | --- | --- | --- | --- |
| 2026-10-01 | 既有 | main/root GitHub Pages、HanziWriter、Supabase | 延續已上線版本 | 不改為其他部署平台 |
| 2026-10-01 | S4 | DOM/CSS 排版、SVG 插圖 | 清晰縮放、保留原生按鈕與無障礙 | 不以 Canvas 重寫整站 |
| 2026-10-01 | S4 | 從現有 progressMap 推算當日完成與複習項目 | 不新增資料庫或重設紀錄 | 不引入新的雲端資料模型 |

## 未決問題 / 風險
- 新專案 pfwszpywdjkxtnnctslp 已建立兩張 RLS 資料表、私有匯入快照與一次性 verified Google 歸戶流程；舊專案保留原始資料。
- 2026-10-04 新專案 Google Provider 已啟用；公開 settings 為 true，OAuth authorize 回應 302 並導向 accounts.google.com。
- 私有快照為 state 1 筆、progress 55 筆；freshrogerchang@gmail.com 首次以 verified Google 登入後才自動歸戶。尚未真實登入，因此公開 owner 表目前可合理為空。
- 現有複習規則為 2／7／14 天啟發式規則，不是完整自適應 SRS。
- 實體 iPad 與 Safari 語音需使用者確認；瀏覽器模擬不等同實機。

## 下一步
push 後驗證 GitHub Pages HTTP 200 與登入資產；使用者首次以 freshrogerchang@gmail.com 完成 Google 登入時，自動領回既有紀錄。實體 iPad 登入與 Safari 操作由使用者確認。
