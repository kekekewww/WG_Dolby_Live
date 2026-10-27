# DEPLOY-RECORD：正式站首次部署 wg-live 0.1.0

依 [DEPLOY-RECORD.md](../DEPLOY-RECORD.md) 模板填寫；部署步驟見 [PRODUCTION.md](../PRODUCTION.md)。

**狀態：M1 正式站部署完成（2026-10-28 00:35）。** 13 個步驟都已執行；未完成與待補項目見第 8 節。交接紀錄：[2026-10-28-handover-m1-production.md](2026-10-28-handover-m1-production.md)。以下為各步驟的過程紀錄。

**過程：** 步驟 1–7：備份、上傳、啟用、建立三個草稿頁面、綁定 Page ID、設定聯絡連結、建立示範活動並切到 `demo`（2026-10-27 22:14–23:00）。步驟 8：草稿預覽，桌面與手機寬度、兩種模式實際播放與切換。步驟 9：發布三頁（23:36）。步驟 10：主選單加入 Live、首頁加入 Live 區塊（23:50 至 2026-10-28 00:05）。步驟 11：快取與資源檢查（00:10–00:25）。步驟 12–13：smoke test 與紀錄（00:10–00:35）。每一步都由部署者在對話中逐步核可。日後更新或回復時，另存新的部署紀錄。

## 0. 進度（PRODUCTION.md 第 4 節）

| # | 步驟 | 狀態 | 時間（Asia/Taipei） |
|---|---|---|---|
| 1 | 備份 | 完成 | 2026-10-27 22:16–22:21 |
| 2 | 上傳同一份 ZIP，核對版本與檢查碼 | 完成 | 2026-10-27 約 22:30 |
| 3 | 啟用，維持 `disabled`，確認首頁、Store、Account 不受影響 | 完成 | 2026-10-27 22:31 |
| 4 | 建立三個草稿頁面，保留原站外框，放入對應 shortcode | 完成（版面做法見第 4 節） | 2026-10-27 22:44–22:50 |
| 5 | 綁定正式站 Page ID | 完成：「建立建議頁面」在原本沒有綁定時自動綁定 | 2026-10-27 22:44 |
| 6 | 重新綁定媒體與連結 | 完成：聯絡連結設為本站 Contact 頁，「部署資訊」網域警告為零；活動海報未設定（沒有核可圖片，見第 8 節）；影片活動使用外掛內建示範影片，不需設定 | 2026-10-27 22:58 |
| 7 | 建立示範活動並切到 `demo`，選取精選活動 | 完成：活動 `interface-demo`（ID 978）已發布；部署模式 `demo`；精選活動 978。部署者在對話中同意公開示範（REST 會公開示範活動的公開欄位） | 2026-10-27 22:55–23:00 |
| 8 | 草稿預覽檢查 | 完成：桌面結構檢查、兩種模式實際播放與切換、569 px 與 390 px 寬度（見第 3 節） | 2026-10-27 23:01–23:15 |
| 9 | 依序發布 Live、Listen、Help，發布後立刻以登出視窗檢查 | 完成：972 → 973 → 974 publish；登出檢查通過（見第 3 節與連結驗收表） | 2026-10-27 23:36–23:42 |
| 10 | 導覽與首頁連結，不覆寫全站選單 | 完成：主選單 MainNav.20240309a 在 Video 與 Blog 之間加入 Live（頁面項目）；首頁在 Music 之後加入 Live 區塊（`[wg_live_featured heading="h3"]`）。修改前已保存首頁範本、版本與截圖（見第 4 節） | 2026-10-27 23:50 – 2026-10-28 00:05 |
| 11 | 清理頁面快取與 CSS／JS 最佳化快取，檢查實際資源網址和版本 | 完成：沒有需要清除的快取（沒有頁面快取；Elementor CSS 不需重建），資源網址與版本正確（見第 3 節） | 2026-10-28 00:10–00:25 |
| 12 | smoke test（登出視窗＋實際手機） | 完成：第 6 節第 1–13 項以登出的自動化檢查完成（見第 3 節各列）；第 14 項實際手機由部署者以 iPhone 操作，回報通過（細節待部署者填入 `manual-devices.md`）；全部步驟後重拍部署前後比對 | 2026-10-28 00:10–00:35 |
| 13 | 保存部署紀錄與已知限制 | 完成：本檔、[交接紀錄](2026-10-28-handover-m1-production.md)、[連結驗收表](../../../evidence/test-results/links-production-2026-10-27.md) | 2026-10-28 00:35 |

## 1. 基本資料

| 欄位 | 內容 |
|---|---|
| 紀錄類型 | ☑ 首次部署　☐ 更新　☐ 回復 |
| 環境 | ☐ staging　☑ 正式站 |
| 網站網址（公開網址） | https://sounds.wgstudiomusic.com/ |
| 部署日期與時間（含時區） | 2026-10-27 22:14 – 2026-10-28 00:35（Asia/Taipei，UTC+8） |
| 部署者 | Kevin Yang（Git：Kevin_Yang_tw；WordPress 管理員帳號 #18）。Claude Code 透過 Claude in Chrome 代為點選，每一個寫入動作都經部署者在權限提示中逐一核可。 |
| 授權人與授權方式（誰、何時、範圍；附連結或檔名） | 部署者 2026-10-27 在對話中確認：沒有 staging，直接安裝到正式站並維持 `disabled`；先做檔案＋資料庫備份。管理員帳號由網站建置者開立。**待補**：錄音室負責人的書面授權（PRODUCTION.md 第 1 節第 1 項）。 |
| 回復負責人 | 待指定 |

## 2. 版本

| 欄位 | 內容 |
|---|---|
| 外掛版本 | 0.1.0 |
| Git commit（完整 40 碼；`build-info.json` 的 `dirty` 必須為 false） | `593dde1d0b130a3e0b7ff0de2d209dd8bcc4a835`（`dirty: false`） |
| ZIP 檔名 | `wg-live-0.1.0.zip`（1,483,433 bytes） |
| ZIP SHA-256 | `db4330c121d8b112392b332db0b7a84e2c328bfef9d2189a8ea3981a1c4f1d2b`（上傳前本機重新計算，與 `.sha256` 檔相同；瀏覽器上傳欄位讀到的大小也是 1,483,433 bytes） |
| `build-info.json` 內三個檔案的 SHA-256（wg-live.js／wg-live.css／wg-live-featured.css） | `45943cb1ef1b4d53b83ca770ee058c99158e9faea39a8f060b64ca0ed1ae6f47`／`c01bf2ff92045aaaead6109acd3f9c2020d3c8bfaed11251f5c5a8ca8815cd7d`／`18eddccf9759ea286a8be6f733c3d67345bce34e2fe47f94c95e3175e6ec6274` |
| 「部署資訊」畫面核對結果 | ☑ 版本相符　☑ SHA-256 相符（外掛版本、建置版本、commit 與三個 SHA-256 都和本機 `build-info.json` 一致） |
| 上一版外掛版本與 ZIP SHA-256（回復用；首次部署寫「無」） | 無（首次部署） |
| 環境版本（PHP／WordPress／主題／Elementor／WooCommerce） | PHP 8.1.34／WordPress 7.1.3／Theme_for_WGM-Studio 1.0.0（父主題 Astra 4.14.1）／Elementor 4.3.5、Elementor Pro 4.3.2／WooCommerce 11.2.1。伺服器 LiteSpeed（A2 Hosting）。本機 wp-env 為 WordPress 7.1.3、PHP 8.2：PHP 次版本不同，外掛需求為 PHP 7.4 以上，PHP 語法檢查通過。 |
| `WP_ENVIRONMENT_TYPE` 實際值 | `wp-config.php` 未定義（網站健康狀態顯示「未定義」），WordPress 回傳 `production`；「部署資訊」顯示 production |
| 部署模式（部署後） | ☐ disabled　☑ demo（步驟 7 起；步驟 1–6 期間為 disabled） |

## 3. 測試結果

| 項目 | 結果 | 記錄位置 |
|---|---|---|
| staging 通過紀錄 | 未執行：沒有 staging 環境。部署者決定直接上正式站並維持 `disabled`（2026-10-27）。 | — |
| 自動化測試（單元／e2e／整合；沒跑的寫「未執行」） | 本機 2026-10-20，對應同一個 commit 與 ZIP：單元 1200 通過；`lint:php` 通過；e2e 735 passed、48 skipped、0 failed；WSL2 wp-env 整合 183 passed、1 skipped；ZIP 乾淨安裝檢查通過。 | [2026-10-13-handover-m1-pre-staging.md](2026-10-13-handover-m1-pre-staging.md) 2026-10-20 節、[e2e-summary.md](../../../evidence/test-results/e2e-summary.md)、[integration-summary.md](../../../evidence/test-results/integration-summary.md) |
| 人工裝置測試 | 部署者 2026-10-28 以實際 iPhone 在正式站完成 smoke test 第 14 項，回報「iPhone test checked」（通過）。裝置型號、iOS 版本與逐項結果尚未記錄；`manual-devices.md` 只能由人填寫，待部署者補上。其他裝置未測 | `evidence/test-results/manual-devices.md`（待填） |
| 全部步驟後的部署前後比對（步驟 12） | 2026-10-28 00:30 重拍 Home、Store、商品頁、Account、Cart、Checkout（登出，1440 與 390 寬）並與 2026-10-27 22:1x 的部署前截圖逐像素比對。Account、Cart、Checkout 桌面版只有頁首選單多一個 Live（17 px 高的區域）；Account、Checkout、Store 手機版 0 差異；Cart 手機版第一次拍攝時背景照片尚未延遲載入（Elementor「延遲載入背景圖片」開啟），等待後重拍 0 差異；商品頁差異為隨機「相關商品」；首頁只多 Live 區塊（桌面 +770 px、手機 +678 px）。Store 桌面版除頁首外，「加入購物車」按鈕與排序選單文字有 2 px 差異：現在量到按鈕 140×46、`"Noto Sans TC"` 16px、padding 15px 30px，與外掛之前的設計基準實測（`design-baseline.md`）完全相同，Store 不載入任何外掛檔案，判定為部署前截圖當下網頁字型尚未載入。 | `evidence/screenshots/production-final-2026-10-28/`（含 `store-desktop-diff.png`） |
| 連結驗收 | 步驟 9、10 後，登出、桌面 1440 與 390 寬手機模擬：第 1–4、6、7、11、14、15 列通過，第 8 列桌面通過；第 8 列手機與第 9 列尚待測試；第 5、10、12、13 列目前不適用。沒有失敗列。 | [links-production-2026-10-27.md](../../../evidence/test-results/links-production-2026-10-27.md) |
| 快取與資源（步驟 11） | **快取外掛與設定**：伺服器 LiteSpeed，但沒有安裝 LiteSpeed Cache 外掛，回應沒有任何頁面快取標頭（沒有 `x-litespeed-cache`、`age`）。A2 Optimized：頁面快取關、物件快取關、Gzip 關，只有「Minify HTML Pages」開（只縮小頁面 HTML，不動 JS／CSS 檔案；三頁與首頁都在它開啟的情況下檢查過）。Elementor：CSS 輸出為外部檔案；「元素快取」全站 1 天，但 Elementor 4.3 原始碼中 Shortcode 元件沒有覆寫 `is_dynamic_content()`（基底回傳 true），且元件的快取設定為預設，所以首頁的 `[wg_live_featured]` 每次請求都重新產生，不會顯示過期狀態（依本機 Elementor 4.3.4 原始碼判斷，正式站為 4.3.5）。沒有 Service Worker。**清除**：沒有頁面快取可清；Elementor「重新產生 CSS」不需要（新區塊在儲存時已產生 CSS，前台顯示正確），為避免全站 CSS 重建的風險而不執行。**資源**：Live 與 Listen 載入 `wg-live.js?ver=45943cb1ef1b`（`defer`）與 `wg-live.css?ver=c01bf2ff9204`；首頁只載入 `wg-live-featured.css?ver=18eddccf9759`、不載入 `wg-live.js`；`ver` 等於「部署資訊」三個 SHA-256 的前 12 碼；正式站提供的三個檔案位元組與本機 build 完全相同（SHA-256 相符）；沒有被合併、改名、延遲載入或移除查詢字串。靜態檔 `Cache-Control: max-age=604800, public`（版本號會隨更新改變，可安全快取）。**API**：`/wp-json/wg-live/v1/events` 為 `public, max-age=30`（設計如此，不含個人資料）；`/wp-json/wg-live/v1/playback` 為 `no-cache, must-revalidate, max-age=0, no-store, private`，示範活動只回傳內建示範影片。 | 本檔 |
| 導覽選單（步驟 10） | 登出：桌面 1440 寬頁首為 Homepage｜Biography｜Video｜Live｜Blog｜Contact｜Store，單行不換行，Logo 寬 180 px 不變；點 Live → `/live/`，Live 標示為目前頁面。390 寬手機：選單按鈕打開側邊選單，Live 在 Video 與 Blog 之間，點擊 → `/live/`；選單可再關閉（`aria-expanded` true → false）。 | `evidence/screenshots/production-nav-2026-10-27/header-desktop.jpg`、`menu-phone-open.jpg` |
| 首頁 Live 區塊（步驟 10） | 登出，桌面與 390 寬：首頁章節順序為 Hero、Biography、Music、**Live**、（Portfolio 隱藏）、Store、Topics、Get in Touch；其他章節高度與修改前完全相同。Live 區塊顯示示範活動卡（日期方塊、「演出中」「介面示範」、標題為 H3、簡介、「體驗播放介面」→ `/live/listen/?wg_event=interface-demo`）。首頁只載入 `wg-live-featured.css?ver=18eddccf9759` 與示範海報 `poster-demo.svg`；沒有 `wg-live.js`、沒有影音請求或影音元素、沒有 console 錯誤、沒有橫向捲動。 | `home-before-*.jpg`、`home-after-*.jpg`、`home-live-section-*.jpg`（同資料夾） |
| 發布後登出檢查（步驟 9） | `/live/`、`/live/listen/`、`/live/help/` 都回應 200（快取沒有留下先前的 404），HTML 中沒有串流或示範影片網址，也沒有 `staging`、`localhost`、`127.0.0.1`、`:5173`。Playwright Chromium 登出、1440 與 390 寬：每頁一個 H1；沒有橫向捲動；沒有開發面板；沒有 console 錯誤；沒有自動播放。活動頁「體驗播放介面」→ `/live/listen/?wg_event=interface-demo`、「登入」→ `/my-account/`；Help「返回活動列表」→ `/live/`、「聯絡我們」→ `/contact/`；所有連結終點 200。不帶參數的 `/live/listen/` 顯示「找不到這場活動」與返回連結。首頁沒有任何指向 `/live/` 的連結（選單沒有被自動加入）。「部署資訊」三頁為 publish，永久連結正確。 | `evidence/screenshots/production-published-2026-10-27/` |
| 部署前後版面比對（Homepage／Store／商品頁／Account／Cart／Checkout／Live） | 登出、1440×1000 與 390×844 全頁截圖，逐像素比對。Cart、Checkout、Account 手機版、Store 手機版完全相同。其餘差異都來自原站動態內容，不是外掛：商品頁的「相關商品」每次隨機挑選（頁面因此高 22 px）；Account 桌面版是原站 Backer Plan 彈出橫幅出現時間不同；Home 與 Store 桌面版頁首 17 px 高的小區域（0.05%／0.08% 像素），Store 不載入任何外掛檔案；Home 手機版有一處 44 px 高的極小差異（低於 0.01%）。Checkout 在購物車為空時轉到 Cart，部署前後相同。`/live/` 部署前後都是 404（頁面尚未建立）。 | `evidence/screenshots/production-before-2026-10-27/`、`evidence/screenshots/production-after-2026-10-27/` |
| smoke test（登出視窗與實際手機） | 部分：登出狀態下 Home、Store、Account、Cart、商品頁回應 200，頁面沒有錯誤文字；`/wp-json/wg-live/v1/events` 回應 200、`{"events":[]}`、`Cache-Control: public, max-age=30`。步驟 4 之後，登出狀態下 `/live/`、`/live/listen/`、`/live/help/`、`/?page_id=972` 都是 404，`/wp-json/wp/v2/pages/972` 回應 401（草稿不公開）。步驟 7 之後（`demo`），登出狀態的 `/wp-json/wg-live/v1/events` 回傳 1 場活動 `interface-demo`（`status: live`、`isDemo: true`、`sourceKind: demo`），欄位只有 id、slug、title、performers、description、startsAt、displayTimezone、status、posterUrl／poster、mediaKind、availableModes、programme、productUrl、replayAvailable、isDemo、sourceKind，沒有任何媒體或來源網址；三個頁面仍是 404。原始碼搜尋 `staging`、`localhost`、`127.0.0.1`、`:5173`：登出首頁與活動 API 都沒有結果；登入管理者看到的頁面有一段 `127.0.0.1/24` 的 IP 範圍說明文字，來自其他外掛的管理工具列，首頁也有，與 wg-live 無關。實際手機未執行（步驟 12）。 | 本檔 |
| 草稿預覽（步驟 4，管理員登入，桌面寬 948 px） | 三頁都是 Elementor Full Width 範本、沒有側欄、保留原站頁首與頁尾、沒有橫向捲動、只有一個 H1（Live／線上音樂會尚未開放／Listening Guide），第一個標題在頁首下方 27 px。`disabled` 模式下 Live 與 Listen 顯示「線上音樂會尚未開放」，Listen 沒有建立任何影音元素；Listening Guide 顯示完整說明。頁首高度（登出、公開頁 `/contact/` 實測）：390 px 寬 80 px、768 px 寬 81 px、1024 px 以上 83 px，因此 110 px 留白在各寬度都留下約 27–30 px 間距。手機寬度的草稿預覽與實際手機尚未看。 | 本檔 |
| 草稿預覽（步驟 8，`demo` 模式，管理員登入，桌面寬 948 px） | Live：精選活動卡顯示「演出中」「介面示範」、2026年10月27日 20:00 台北時間、兩種聆聽模式；草稿預覽中顯示「查看活動資訊」（站內連結要發布後才輸出，符合預期）；只有一個 H1。Listen（`?wg_event=interface-demo`）：有「操作示範音訊，非 Binaural／Atmos 驗證素材」標示、兩個模式面板與「開始聆聽」；頁面只有一個 `<video>`，暫停、沒有載入來源、沒有 autoplay；H1 為活動標題；沒有橫向捲動。三頁都沒有開發面板。 | 本檔 |
| 播放與切換（步驟 8，Brave 桌面版，Windows，管理員登入的草稿預覽） | 選「耳機聆聽 · Binaural」→ 按「開始聆聽」：播放 `demo-video-1.mp4`（960×540），音訊有解碼，播放時間正常前進，頁面只有一個 `<video>`，狀態「播放中」「目前播放：Binaural」，控制列為暫停、靜音、音量、全螢幕、切換模式。按「切換模式」→ 對話框「目前模式為「Binaural」，要切換為「Dolby Atmos 音軌」嗎？」→「確認切換」：改播 `demo-video-2.mp4`，從頭開始（沒有沿用播放時間），仍只有一個 `<video>`，狀態「目前播放：Dolby Atmos 音軌」；畫面燒入字幕「操作示範影片，非 Binaural／Atmos 驗證素材」。按「暫停」後狀態「已暫停」。這是 Playwright 以外的真實瀏覽器，但不是真機 Safari，也不是 Atmos 聽感驗證。 | 本檔 |
| 手機寬度（步驟 8，草稿預覽） | Brave 視窗最小只能縮到 569 px 寬：Astra 改為手機頁首，內容在頁首下方 29 px，沒有橫向捲動。390×844：在頁面內放一個 390×844 的 sandbox iframe 載入三頁草稿預覽（iframe 的 viewport 就是 390 px）。三頁的內容都在頁首下方 30 px、只有一個 H1、文件寬度 390 px 沒有橫向捲動；Listen 只有一個 `<video>`。已知限制：390 px 時 Listen 的「開始聆聽」位於 1148 px（第一個畫面下方），原站的 Backer Plan 橫幅在使用者關閉前會蓋住畫面底部。不是實體手機。 | 本檔 |
| 負載測試（如有；環境與核可人） | 未執行 | — |
| 效能（僅實驗室數據，非真實使用者數據）：部署前基準（外掛啟用前）與部署後，Home 與 `/live/` 的 LCP／CLS／傳輸大小，站本身與外掛增量分開寫 | 基準（Home）：桌面 LCP 3.70 s、CLS 0.0007、4,075 KB、172 個請求；手機 LCP 4.11 s、CLS 0、4,087 KB、172 個請求。部署後：桌面 LCP 4.09 s、CLS 0.0007、4,078 KB、173 個請求；手機 LCP 4.27 s、CLS 0、4,092 KB、173 個請求。增量：多 1 個請求（`wg-live-featured.css`，原始 13,095 bytes），傳輸約多 3–5 KB；CLS 不變。LCP 中位數差異在量測雜訊內：同一頁三次量測相差 0.5–2.5 s（桌面部署前 3.51–4.07 s、部署後 3.75–4.18 s），三次量測無法分出外掛的影響。站本身的伺服器回應約 2 s。`/live/` 尚未建立，未量測。全部步驟完成後（2026-10-28 00:30，首頁含 Live 區塊）：桌面 LCP 3.79 s、CLS 0.0007、4,078 KB、174 個請求；手機 LCP 3.88 s、CLS 0、4,093 KB、174 個請求。外掛對首頁的增量：多 2 個請求（`wg-live-featured.css`、示範海報 `poster-demo.svg`），傳輸約多 3–6 KB，CLS 不變，LCP 差異在量測雜訊內。 | 三個資料夾內的 `baseline.json`（含 `production-final-2026-10-28/`） |

效能量測條件：Playwright Chromium、登出、每次都是空快取、無 CPU／網路節流、部署者電腦的網路，各三次取中位數；不是 Lighthouse，也不是真實使用者數據（CrUX／RUM）。

## 4. 被修改的內容

| 類型 | 名稱／ID | 做了什麼 | 修改前狀態的保存位置 |
|---|---|---|---|
| 外掛 | wg-live | 上傳、啟用（2026-10-27 22:31），模式 `disabled` | 第 6 節備份 |
| 外掛 | UpdraftPlus 1.26.14（WordPress.org 官方目錄，slug `updraftplus`） | 新安裝並啟用（約 22:14），用來做部署前備份。設定精靈未執行（Exit setup）；檔案與資料庫排程維持「手動」；沒有設定遠端儲存。原因：網站沒有備份外掛，部署者沒有主機控制台權限。 | 安裝前的外掛清單：36 個，全部啟用 |
| 頁面 | Live（ID 972，`/live/`） | 用「Live 活動 → 建立建議頁面」建立草稿；範本改為 Elementor Full Width；內容為 110 px Spacer 區塊＋Shortcode 區塊 `[wg_live view="events" heading="h1"]`；2026-10-27 23:36 發布（Listen、Listening Guide 隨後依序發布） | 新頁面，無修改前狀態 |
| 頁面 | Listen（ID 973，`/live/listen/`，父頁 972） | 同上，`[wg_live view="player" heading="h1"]` | 新頁面 |
| 頁面 | Listening Guide（ID 974，`/live/help/`，父頁 972） | 同上，`[wg_live view="help" heading="h1"]` | 新頁面 |
| 首頁 | 首頁（ID 8，設定 → 閱讀為靜態首頁） | 在 Music 章節之後加入 Live 區塊：複製 Music 的錨點容器（新 ID `7f65790`，錨點改為 `h-live`）與 Music 章節（新 ID `6f58692`，高度 75vh、置中），標題改為「Live」（h2，靠右，與相鄰章節一致），刪除音樂播放器那一列，放入一個 Shortcode 元件 `[wg_live_featured heading="h3"]`（快取維持預設），保留指向 `#h-portfolio` 的 ⇊ 箭頭。規格 §4.3 提案位置是 Music 與 Portfolio 之間；Portfolio 章節在三種裝置都隱藏，所以畫面上 Live 在 Music 與 Store 之間。其他章節沒有修改（Music 的 ⇊ 箭頭仍指向 `#h-portfolio`，會跳過 Live） | Elementor 範本「首頁備份 2026-10-28」（ID 980，網站範本，2026-10-28 00:00）；修改前版本為 revision 947（2026-10-11 21:10），修改後為 revision 985（2026-10-28 00:02）；登出全頁截圖 `home-before-desktop.jpg`、`home-before-mobile.jpg`；另有 22:16 UpdraftPlus 備份 |
| 選單 | MainNav.20240309a（menu ID 26，主選單與手機側邊選單共用；Footer 用另一份 menu 27） | 加入頁面項目「Live」（ID 979，指向頁面 972），位置在 Video 與 Blog 之間；其他項目與 Store 子選單順序不變；「自動加入新頂層頁面」維持關閉 | 修改前順序：Homepage(157)、Biography(159)、Video(161)、Blog(158)、Contact(162)、Store(163，子項 Store 511、Cart 164、Checkout 165、Account 166) |
| Header／Footer | 由 Astra Header Builder 管理（`ast-hfb-header`、`ast-builder-menu-1`；沒有 Elementor Theme Builder 的頁首） | 未修改（只改了它使用的選單內容） | — |
| 商品頁 | — | 未修改 | — |
| 活動 | 代稱 `interface-demo`（ID 978） | 建立並發布：標題「線上音樂會介面示範」；簡介說明是介面示範、播放操作示範影片、不是正式演出也不是驗證素材；開始時間 2026-10-27 20:00 Asia/Taipei；狀態「直播中」（模擬狀態，讓示範播放器可操作）；媒體類型影片；兩種聆聽模式；勾選示範活動；來源類型「示範」；演出者、節目單、商品與購票連結留空；無海報 | 新活動 |
| 外掛設定 | wg-live 設定 | 建立頁面時自動綁定三個 Page ID（版本 1 → 2）；聯絡連結設為 `https://sounds.wgstudiomusic.com/contact/`（→ 3）；部署模式 `demo`、精選活動 978（→ 4） | 第 5 節記有各版本的狀態 |

## 5. 設定快照

部署後從「部署資訊」抄錄。

| 設定 | 值 |
|---|---|
| 部署模式 | 示範（demo） |
| 活動頁／播放頁／說明頁 Page ID | 972／973／974，步驟 9 起為 publish，永久連結 https://sounds.wgstudiomusic.com/live/、/live/listen/、/live/help/ |
| 精選活動（代稱） | `interface-demo`（#978） |
| Account／Store／Contact 覆寫（只寫「自動」或網域；Contact 沒有自動值，不可為「自動」） | Account：自動；Store：自動；Contact：sounds.wgstudiomusic.com（`/contact/`） |
| 設定版本號、更新時間、更新者（「部署資訊」） | 版本 4；2026-10-27 14:59:43 UTC；WordPress 帳號 #18。歷程：版本 1（14:31:26 UTC，啟用時寫入）→ 2（14:48:10 UTC，綁定頁面）→ 3（設定聯絡連結）→ 4（`demo`、精選活動） |
| 網域不符警告 | ☑ 無　☐ 有（「所有已儲存的連結都指向 sounds.wgstudiomusic.com」） |
| 開發面板 | 正式站必須是「關閉」；實際：關閉 |
| 解除安裝時刪除資料 | 必須是「未勾選」；實際：否 |

## 6. 備份

| 欄位 | 內容 |
|---|---|
| 部署前備份的時間點與名稱 | UpdraftPlus 手動備份，2026-10-27 22:16 開始、22:21:03 完成。檔名前綴 `backup_2026-10-27-2216__`（完整檔名含隨機碼，不寫進 repository）。共 382.9 MB，記錄「no errors」。 |
| 備份包含 | ☑ 檔案　☑ 資料庫。資料庫 126 個資料表；檔案為外掛、佈景主題、uploads、其他 wp-content。不含 WordPress 核心檔案（可重新安裝）。 |
| 備份存放位置（描述，不寫帳密） | (1) 正式站伺服器，UpdraftPlus 預設的本機目錄。(2) 部署者電腦上的完整下載副本（5 個檔案，401,476,532 bytes）：四個 ZIP 都能開啟，資料庫檔解壓後 39.5 MB、126 個 `CREATE TABLE`。下載副本含會員與訂單個資：不得放進 repository、不得分享。 |
| 還原入口與所需權限 | WordPress 後台「設定 → UpdraftPlus Backups → 現有備份 → 還原」，需要 WordPress 管理員。後台進不去時，需要主機檔案權限（cPanel／SFTP），由網站建置者處理。 |

## 7. 回復方式

| 步驟 | 做法 |
|---|---|
| 第一步 | 「Live 活動 → 設定」把部署模式改回 `disabled` 並儲存（[ROLLBACK.md](../ROLLBACK.md) 步驟 A）。活動 API 立即回傳空列表，三頁改顯示「線上音樂會尚未開放」 |
| 撤回頁面 | 三頁改回草稿（ROLLBACK.md 步驟 B）：頁面 → Live／Listen／Listening Guide → 狀態改為草稿 |
| 撤回入口（停用外掛之前做） | 外觀 → 選單 → MainNav.20240309a → 移除「Live」項目 → 儲存選單。首頁：Elementor 開啟首頁 → 刪除 Live 章節與它上方的 20px 錨點容器 → 更新；或在 History → Revisions 還原 revision 947，或插入範本「首頁備份 2026-10-28」取代整頁內容（ROLLBACK.md 步驟 C） |
| 停用外掛 | 後台「外掛 → WG Studio Live → 停用」（[ROLLBACK.md](../ROLLBACK.md) 步驟 D）。停用後首頁不再載入 `wg-live-featured.css`。 |
| 還原上一版 | 無上一版（首次部署） |
| 緊急（後台進不去） | 把 `wp-content/plugins/wg-live` 改名（ROLLBACK.md 步驟 5）；需要主機檔案權限；執行人：網站建置者（姓名待填） |
| 完整資料庫回復 | 預設不做。必要時用第 6 節 22:16 的備份，但 22:16 之後的新訂單與新會員會遺失，須管理者先確認差異。確認人：待填 |

## 8. 未完成事項與已知限制

| 項目 | 說明 | 阻擋原因／負責人 |
|---|---|---|
| M1 示範音訊不是 Binaural／Atmos 驗證素材 | 如實保留 | — |
| 真實驗票與播放授權 | 未實作（M2） | 尚待外部條件：票券規則與授權機制 |
| 家庭劇院相容表 | 維持「尚待測試」 | 尚待外部條件：設備與實測 |
| `manual-devices.md` | iPhone 測試由部署者回報通過，但裝置型號、iOS 版本與逐項結果尚未填寫（只能由人填寫） | 部署者 |
| 其他裝置 | iPad、Mac Safari、Apple TV、Android、家庭劇院設備未測；相容表維持「尚待測試」 | 尚待外部條件：設備與測試者 |
| 日後修改活動時的快取 | 目前沒有頁面快取，修改活動狀態後首頁、活動頁與播放頁都會立即反映（播放頁每 60 秒輪詢）。若日後開啟 A2 Optimized 的頁面快取或安裝其他快取外掛，必須依 NAV-HOMEPAGE.md 第 5 節設定短存活時間並排除 `wg-live*.js`，且每次改活動狀態後清除 `/live/`、播放頁與首頁的快取 | 管理者 |
| 首頁與選單對所有訪客可見 | 首頁顯示示範活動卡（「演出中」為模擬狀態，標示「介面示範」）。要撤下時見第 7 節 | 部署者 |
| Music 的 ⇊ 箭頭 | 仍指向 `#h-portfolio`，跳過新的 Live 區塊（沒有修改既有章節）。要讓箭頭依序往下，可把 Music 箭頭改為 `#h-live`，屬於修改原章節，需另外決定 | 部署者 |
| 不帶活動參數的播放頁 | `/live/listen/` 沒有 `?wg_event=` 時顯示「找不到這場活動」（附返回活動列表）。選單與首頁應只連到 `/live/` | 設計如此；記錄供步驟 10 參考 |
| 手機上「開始聆聽」在第一個畫面下方 | 390 px 寬時位於 1148 px；原站 Backer Plan 橫幅會蓋住畫面底部直到使用者關閉 | 已知限制（交接紀錄已記）；是否調整版面待決定 |
| 示範活動海報 | 未設定，前台使用無海報版面 | 需要錄音室核可的正式站媒體庫圖片 |
| 示範活動的時間與狀態 | 固定為 2026-10-27 20:00、「直播中」（模擬，標示「介面示範」）。日期不會自動更新，之後要展示時由管理者調整 | 管理者 |
| 頁面沒有用 Elementor 編輯器建置 | 與 STAGING.md 第 5 節（Elementor Shortcode 元件）不同：三頁用區塊編輯器的 Shortcode 區塊，範本仍是 Elementor Full Width。原因：原站是透明頁首（`position:absolute`，80–83 px），外掛本身不留頁首空間，需要每頁加頂部留白；部署者 2026-10-27 選擇「範本＋Spacer」做法。之後要在 Elementor 編輯時，刪掉 Spacer、改用容器上方 padding 即可。 | 部署者決定 |
| 外掛不處理透明頁首 | 頁面頂部留白目前靠每頁的 110 px Spacer。若改由外掛在 Astra 透明頁首下自動留白，需要改程式並重新打包上傳 | 後續版本 |
| staging | 略過 | 沒有 staging 環境；部署者決定 |
| 授權人書面授權、回復負責人 | 待補 | 部署者 |
| UpdraftPlus | 部署期間保留啟用，伺服器上的備份占 383 MB；部署完成後由部署者決定保留或停用 | 部署者 |
| PHP 版本差異 | 正式站 PHP 8.1.34，本機 wp-env 為 PHP 8.2 | 外掛需求 PHP 7.4 以上；部署後無錯誤 |
| 首頁多載入一個樣式檔 | 未放置首頁精選區塊時，首頁仍載入 `wg-live-featured.css`（約 3–5 KB 傳輸） | 設計如此；如要只在有區塊時載入，需另改程式 |

## 9. 簽核

| 角色 | 姓名 | 日期 |
|---|---|---|
| 部署者 | Kevin Yang | 2026-10-27 至 2026-10-28（步驟 1–13；待本人確認簽核） |
| 授權人 | 待填 | |
