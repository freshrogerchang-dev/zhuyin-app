# 注音筆順練習 App

給大班/小一學童使用的注音、國字筆順練習原型，內建金幣獎勵與小遊戲。

## 檔案結構

```
zhuyin-app/
├── index.html      畫面結構(所有screen的HTML)
├── style.css       所有樣式
├── config.js       Supabase 連線設定
├── data.js         字庫資料(charData、zhuyinData)
├── app.js          主要邏輯(所有function)
├── practice-plan.js 每日目標與複習日期計算（無網路／儲存副作用）
├── daily-practice.js 今日任務與待複習清單的介面
├── assets/         自製 SVG 長頸鹿與練習圖示
├── tests/          Node 規則測試與隔離瀏覽器測試
└── README.md       這份文件
```

之後要調整：
- **改文字/顏色/版面** → 改 `style.css`
- **加字、改注音、改選項** → 改 `data.js`
- **改遊戲規則、金幣邏輯、Supabase 存取方式** → 改 `app.js`
- **換Supabase專案** → 改 `config.js`

## 部署到 GitHub Pages

1. 在 GitHub 建立一個新的 repository(public，例如叫 `zhuyin-app`)
2. 把網站檔案（根目錄所有 `.html`、`.css`、`.js`、`assets/` 與 `.nojekyll`）一起上傳到 repo
   - 檔名要保持一致，**尤其 `index.html` 這個檔名不能改**，GitHub Pages 會找這個檔案當首頁
3. 到 repo 的 Settings → Pages
4. Source 選擇 `Deploy from a branch`，Branch 選 `main`，資料夾選 `/ (root)`，按 Save
5. 等 1-2 分鐘，GitHub 會給你一個網址，通常長得像：
   `https://你的帳號.github.io/zhuyin-app/`
6. 用 iPad 的 Safari 打開這個網址 → 分享 → 加入主畫面

## 重要安全提醒

`config.js` 裡的 Supabase key 是 **publishable(公開)金鑰**，這是設計上就可以放在前端程式碼裡的，
但因為這個 repo 是 public，代表**任何人都看得到這把 key**，也就能讀寫 `zhuyin_app_state` 和
`zhuyin_app_char_progress` 這兩張表(金幣、練習進度)。

即使只有自己家裡使用，公開資料仍可能被他人讀寫；目前四個小孩檔案只是資料分類，不是帳號／家庭的安全隔離。要改善，需要：
1. 幫每個使用者/裝置加上唯一識別(例如簡單的裝置代碼或正式登入)
2. Supabase 資料表改成依照使用者過濾資料的 RLS 規則，而不是現在的「任何人都能讀寫全部」

## 已知限制

- 筆順偵測：國字用 Hanzi Writer 函式庫(精準)，注音符號用自己寫的簡易描摹比對(只看有沒有描到形狀，不看筆畫順序，因為沒有可信賴的注音筆順公開資料)
- 字庫目前有 109 個國字、37 個注音符號、33 組詞語與 52 個英文字母；尚非完整低年級教材
- 小遊戲（打地鼠、翻牌、字音配對、賽車、氣球、釣魚）的規則在 `app.js`，另有朋友對戰模式
- 複習採用 2／7／14 天的簡單規則，不是完整的自適應 SRS

## 今日小任務（2026-10-02）

- 每天目標：完成 5 個不同的國字、注音、詞語或字母；同一項目重複練習不重算。
- 待複習依最近結果與當地日期安排：未滿分 2 天、滿分一次 7 天、滿分至少兩次 14 天。最近退步會提早到 2 天。
- 優先安排到期項目，再安排未學過的項目；不會為了湊足 5 個而提早安排已學會且未到期的項目。
- 可分種類篩選、直接開始練習，完成後按「下一個練習」。也可隨時回首頁自由練習。
- 任務直接使用目前小孩的既有練習紀錄；不另存任務表、不重設紀錄，也沒有額外金幣扣除或重複發獎。
- 當日完成數依每項最新紀錄計算，沒有逐日任務歷史；時區以裝置為準。既有雲端儲存若失敗，重新整理後可能不保留該次結果。
- 新增載入中／讀取失敗／重試／沒有到期項目的介面。

## 本機驗證

### 注音與遊戲語音（2026-10-02）

注音選項採直式符號排列；37 個單符號使用教育部《國語注音符號手冊》的 CC BY 4.0 原始錄音，單次播放，例字需另外點選。來源與授權見 [錄音標示](assets/audio/zhuyin/ATTRIBUTION.md)。部署時請一併上傳 `learning-media.js` 和整個 `assets/audio/zhuyin/`。

有國字題目的遊戲會朗讀新題，並提供「再聽一次」；翻牌唸動物、打地鼠唸玩法。國字／例字仍使用裝置的 zh-TW 系統語音，實際聲音依 iPad 安裝的語音而異。離頁會停止朗讀，播放失敗可按按鈕重試。氣球由 7 秒放慢到 14 秒，不改計分規則。

不需建置步驟。用靜態 HTTP 伺服器開啟（例如 `python -m http.server 8934 --bind 127.0.0.1`），不要直接開 `file://`。

```sh
node --check app.js
node --check daily-practice.js
node --check practice-plan.js
node --test tests/practice-plan.test.cjs
node --test tests/learning-media.test.cjs
```

瀏覽器驗證：在已提供 `playwright` 套件與 Microsoft Edge 的開發環境執行 `node tests/browser-smoke.cjs`（若套件不在專案，設定 `NODE_PATH` 指向已安裝的 node_modules）。測試自行啟動本機伺服器、替換 `config.js` 為假資料，阻擋正式資料庫請求，並將截圖輸出至系統暫存資料夾。HanziWriter 與字型仍需網路。

本次驗證為 Edge 的手機／平板 viewport 與假資料流程；不是 Safari 實機或真實多人對戰／雲端寫入驗證。
