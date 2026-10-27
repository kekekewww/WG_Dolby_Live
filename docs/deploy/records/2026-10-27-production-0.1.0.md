# DEPLOY-RECORD：正式站首次部署 wg-live 0.1.0

依 [DEPLOY-RECORD.md](../DEPLOY-RECORD.md) 模板填寫；部署步驟見 [PRODUCTION.md](../PRODUCTION.md)。

**狀態：進行中。** 第 4 節的 13 個部署步驟中，步驟 1–3 已完成（備份、上傳、啟用並維持 `disabled`）。步驟 4 起每一步都要部署者在對話中逐步核可；完成後更新本檔，不另開新檔。

## 0. 進度（PRODUCTION.md 第 4 節）

| # | 步驟 | 狀態 | 時間（Asia/Taipei） |
|---|---|---|---|
| 1 | 備份 | 完成 | 2026-10-27 22:16–22:21 |
| 2 | 上傳同一份 ZIP，核對版本與檢查碼 | 完成 | 2026-10-27 約 22:30 |
| 3 | 啟用，維持 `disabled`，確認首頁、Store、Account 不受影響 | 完成 | 2026-10-27 22:31 |
| 4 | 建立三個草稿頁面 | 未執行（下一步） | |
| 5–13 | 綁定 Page ID、圖片、示範活動與 `demo` 模式、預覽、發布、導覽、清快取、smoke test、紀錄 | 未執行 | |

## 1. 基本資料

| 欄位 | 內容 |
|---|---|
| 紀錄類型 | ☑ 首次部署　☐ 更新　☐ 回復 |
| 環境 | ☐ staging　☑ 正式站 |
| 網站網址（公開網址） | https://sounds.wgstudiomusic.com/ |
| 部署日期與時間（含時區） | 2026-10-27 22:14–22:40（Asia/Taipei，UTC+8） |
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
| 部署模式（部署後） | ☑ disabled　☐ demo |

## 3. 測試結果

| 項目 | 結果 | 記錄位置 |
|---|---|---|
| staging 通過紀錄 | 未執行：沒有 staging 環境。部署者決定直接上正式站並維持 `disabled`（2026-10-27）。 | — |
| 自動化測試（單元／e2e／整合；沒跑的寫「未執行」） | 本機 2026-10-20，對應同一個 commit 與 ZIP：單元 1200 通過；`lint:php` 通過；e2e 735 passed、48 skipped、0 failed；WSL2 wp-env 整合 183 passed、1 skipped；ZIP 乾淨安裝檢查通過。 | [2026-10-13-handover-m1-pre-staging.md](2026-10-13-handover-m1-pre-staging.md) 2026-10-20 節、[e2e-summary.md](../../../evidence/test-results/e2e-summary.md)、[integration-summary.md](../../../evidence/test-results/integration-summary.md) |
| 人工裝置測試 | 未執行（由人工填寫） | `evidence/test-results/manual-devices.md` |
| 連結驗收 | 未執行：頁面尚未建立（步驟 4 之後） | — |
| 部署前後版面比對（Homepage／Store／商品頁／Account／Cart／Checkout／Live） | 登出、1440×1000 與 390×844 全頁截圖，逐像素比對。Cart、Checkout、Account 手機版、Store 手機版完全相同。其餘差異都來自原站動態內容，不是外掛：商品頁的「相關商品」每次隨機挑選（頁面因此高 22 px）；Account 桌面版是原站 Backer Plan 彈出橫幅出現時間不同；Home 與 Store 桌面版頁首 17 px 高的小區域（0.05%／0.08% 像素），Store 不載入任何外掛檔案；Home 手機版有一處 44 px 高的極小差異（低於 0.01%）。Checkout 在購物車為空時轉到 Cart，部署前後相同。`/live/` 部署前後都是 404（頁面尚未建立）。 | `evidence/screenshots/production-before-2026-10-27/`、`evidence/screenshots/production-after-2026-10-27/` |
| smoke test（登出視窗與實際手機） | 部分：登出狀態下 Home、Store、Account、Cart、商品頁回應 200，頁面沒有錯誤文字；`/wp-json/wg-live/v1/events` 回應 200、`{"events":[]}`、`Cache-Control: public, max-age=30`。實際手機未執行（步驟 12）。 | 本檔 |
| 負載測試（如有；環境與核可人） | 未執行 | — |
| 效能（僅實驗室數據，非真實使用者數據）：部署前基準（外掛啟用前）與部署後，Home 與 `/live/` 的 LCP／CLS／傳輸大小，站本身與外掛增量分開寫 | 基準（Home）：桌面 LCP 3.70 s、CLS 0.0007、4,075 KB、172 個請求；手機 LCP 4.11 s、CLS 0、4,087 KB、172 個請求。部署後：桌面 LCP 4.09 s、CLS 0.0007、4,078 KB、173 個請求；手機 LCP 4.27 s、CLS 0、4,092 KB、173 個請求。增量：多 1 個請求（`wg-live-featured.css`，原始 13,095 bytes），傳輸約多 3–5 KB；CLS 不變。LCP 中位數差異在量測雜訊內：同一頁三次量測相差 0.5–2.5 s（桌面部署前 3.51–4.07 s、部署後 3.75–4.18 s），三次量測無法分出外掛的影響。站本身的伺服器回應約 2 s。`/live/` 尚未建立，未量測。 | 兩個資料夾內的 `baseline.json` |

效能量測條件：Playwright Chromium、登出、每次都是空快取、無 CPU／網路節流、部署者電腦的網路，各三次取中位數；不是 Lighthouse，也不是真實使用者數據（CrUX／RUM）。

## 4. 被修改的內容

| 類型 | 名稱／ID | 做了什麼 | 修改前狀態的保存位置 |
|---|---|---|---|
| 外掛 | wg-live | 上傳、啟用（2026-10-27 22:31），模式 `disabled` | 第 6 節備份 |
| 外掛 | UpdraftPlus 1.26.14（WordPress.org 官方目錄，slug `updraftplus`） | 新安裝並啟用（約 22:14），用來做部署前備份。設定精靈未執行（Exit setup）；檔案與資料庫排程維持「手動」；沒有設定遠端儲存。原因：網站沒有備份外掛，部署者沒有主機控制台權限。 | 安裝前的外掛清單：36 個，全部啟用 |
| 頁面 | Live（`/live/`） | 未建立（步驟 4） | — |
| 頁面 | Listen（`/live/listen/`） | 未建立（步驟 4） | — |
| 頁面 | Listening Guide（`/live/help/`） | 未建立（步驟 4） | — |
| 首頁 | 首頁 | 內容未修改。外掛啟用後，首頁會自動載入 `wg-live-featured.css?ver=18eddccf9759`（設計如此，不論部署模式）。 | 部署前截圖 `home-*.png` |
| 選單 | — | 未修改 | — |
| Header／Footer | 由 ＿＿ 管理（步驟 10 前確認） | 未修改 | — |
| 商品頁 | — | 未修改 | — |
| 活動 | — | 未建立 | — |

## 5. 設定快照

部署後從「部署資訊」抄錄。

| 設定 | 值 |
|---|---|
| 部署模式 | 停用（disabled） |
| 活動頁／播放頁／說明頁 Page ID | 尚未綁定（步驟 5） |
| 精選活動（代稱） | 未指定 |
| Account／Store／Contact 覆寫（只寫「自動」或網域；Contact 沒有自動值，不可為「自動」） | 未核對：設定頁尚未開啟，步驟 5 時核對 |
| 設定版本號、更新時間、更新者（「部署資訊」） | 版本 1；2026-10-27 14:31:26 UTC；WordPress 帳號 #18 |
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
| 第一步 | 目前已是 `disabled`，前台沒有任何頁面或區塊 |
| 撤回入口 | 目前沒有首頁區塊或選單項目，不需要 |
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
| 部署步驟 4–13 | 未執行 | 每一步等部署者核可 |
| staging | 略過 | 沒有 staging 環境；部署者決定 |
| 授權人書面授權、回復負責人 | 待補 | 部署者 |
| UpdraftPlus | 部署期間保留啟用，伺服器上的備份占 383 MB；部署完成後由部署者決定保留或停用 | 部署者 |
| PHP 版本差異 | 正式站 PHP 8.1.34，本機 wp-env 為 PHP 8.2 | 外掛需求 PHP 7.4 以上；部署後無錯誤 |
| 首頁多載入一個樣式檔 | 未放置首頁精選區塊時，首頁仍載入 `wg-live-featured.css`（約 3–5 KB 傳輸） | 設計如此；如要只在有區塊時載入，需另改程式 |

## 9. 簽核

| 角色 | 姓名 | 日期 |
|---|---|---|
| 部署者 | Kevin Yang | 2026-10-27（步驟 1–3） |
| 授權人 | 待填 | |
