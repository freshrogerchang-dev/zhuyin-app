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
└── README.md       這份文件
```

之後要調整：
- **改文字/顏色/版面** → 改 `style.css`
- **加字、改注音、改選項** → 改 `data.js`
- **改遊戲規則、金幣邏輯、Supabase 存取方式** → 改 `app.js`
- **換Supabase專案** → 改 `config.js`

## 部署到 GitHub Pages

1. 在 GitHub 建立一個新的 repository(public，例如叫 `zhuyin-app`)
2. 把這個資料夾裡的檔案(`index.html`、`style.css`、`config.js`、`data.js`、`app.js`)全部上傳到 repo 的根目錄
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

對自己家裡小孩使用沒問題，但如果之後要給不同家庭/班級的小朋友各自使用，需要：
1. 幫每個使用者/裝置加上唯一識別(例如簡單的裝置代碼或正式登入)
2. Supabase 資料表改成依照使用者過濾資料的 RLS 規則，而不是現在的「任何人都能讀寫全部」

## 已知限制

- 筆順偵測：國字用 Hanzi Writer 函式庫(精準)，注音符號用自己寫的簡易描摹比對(只看有沒有描到形狀，不看筆畫順序，因為沒有可信賴的注音筆順公開資料)
- 字庫目前只有 30 個國字 + 4 個注音符號，僅供展示/測試
- 小遊戲(打地鼠、翻牌配對、字音配對)的資料是寫死在 `app.js` 裡，非資料庫驅動
