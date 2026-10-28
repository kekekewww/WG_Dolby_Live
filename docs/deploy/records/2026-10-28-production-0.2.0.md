# DEPLOY-RECORD：正式站更新 wg-live 0.1.0 → 0.2.0

依 [DEPLOY-RECORD.md](../DEPLOY-RECORD.md) 模板填寫。上一份紀錄：[2026-10-27-production-0.1.0.md](2026-10-27-production-0.1.0.md)。

**狀態：已部署到正式站（2026-10-28 22:40，Asia/Taipei）。** 第 4 節步驟 1–5 完成並核對；步驟 6（老闆以自己的帳號確認）待老闆回報。部署者 Kevin Yang 在對話中核可「先備份再上傳」，Claude Code 透過 Claude in Chrome 代為點選。

## 1. 為什麼更新

老闆的帳號（Editor + Shop Manager）在 0.1.0 不能管理活動：0.1.0 的活動、設定、部署資訊全部要求 `manage_options`。0.2.0 把活動與設定分開：

- **活動**：`Plugin::events_cap()`，篩選器 `wg_live_events_capability`，預設 `publish_pages`。Editor、Shop Manager、Administrator 都有這個權限，可以新增、編輯、發布、刪除活動。
- **設定、部署資訊、建立建議頁面**：仍是 `Plugin::cap()`（`manage_options`），只有 Administrator。
- **首頁精選**：活動頁新增「設為首頁精選」勾選框，只改 `featured_event` 一個設定（需要活動權限與該活動的 `edit_post`；設定版本號加一）。活動列表新增「首頁精選」欄。
- 外掛不寫入任何角色；使用者角色不需要改。

M1-PLAN D13 已同步更新。

## 2. 版本

| 欄位 | 內容 |
|---|---|
| 外掛版本 | 0.2.0 |
| Git commit | `4fc83256051fbc4a02d3746f8e8be434465d7c4c`（`build-info.json` 的 `dirty: false`） |
| ZIP | `wg-live-0.2.0.zip`，1,484,773 bytes |
| SHA-256 | `0b76b4b364bdd7a632bce52564fa603f2012f8fa4e9c5985dafb42d3df751cce` |
| 回復用 ZIP | `wg-live-0.1.0.zip`，SHA-256 `db4330c121d8b112392b332db0b7a84e2c328bfef9d2189a8ea3981a1c4f1d2b`（仍在 `artifacts/`） |

## 3. 測試（2026-10-28，本機）

| 檢查 | 結果 |
|---|---|
| `npm run check`（typecheck、lint、單元測試、build、package、check:artifact） | 通過，單元測試 1200/1200 |
| `npm run lint:php`（php -l 7.4 與 8.3、PHPCS + PHPCompatibilityWP 7.4-） | 通過，17 個檔案 |
| 乾淨 checkout 打包 + `check:artifact` | 通過（版本 0.2.0、commit 4fc8325、ZIP 1.42/1.75 MiB） |
| `npm run test:zip-install` | 通過（安裝、啟用、REST、資產、解除安裝，沒有 PHP 警告） |
| 整合測試（WSL wp-env）完整一輪 | 169 通過、1 失敗、18 未執行。失敗的是 `webkit-state-disabled`：WebKit 在導向後當掉（同時主機回報資源不足），後面串接的 WebKit 狀態專案因此沒有執行。 |
| 整合測試補跑（含隱藏標記修正） | `chromium` admin-events 27/27；`webkit` admin-events 通過（權限兩項補跑 2/2）；`chromium-state-settings` 14/14；`webkit-state-disabled` 1/1；`webkit-state-settings` 14/14；`webkit-state-deactivate` 3/3 |

新的整合測試：

- Editor 可以開活動列表與新增頁、發布活動、開別人建立的活動；設定、部署資訊、建立頁面三個畫面 403，建立頁面的 POST 也 403；選單裡沒有設定類子選單。
- Author 對所有 wg-live 畫面都是 403。
- Editor 勾選「設為首頁精選」：設定只有 `featured_event` 改變、設定版本加一、首頁顯示該活動、列表顯示「首頁精選」；0.2.0 之前開啟的編輯畫面（沒有勾選框）儲存時不會清掉精選；取消勾選後首頁回到「線上音樂會資訊即將公布」。

隱藏標記修正之後沒有重跑的：`chromium`／`webkit` 其他唯讀測試檔、`chromium-state-disabled`、`chromium-state-deactivate`。這次修正只動到活動編輯畫面的勾選框與儲存，那些測試不會經過這段程式。

## 4. 部署步驟

| # | 步驟 | 結果 | 時間 |
|---|---|---|---|
| 1 | UpdraftPlus 立即備份（只備份資料庫；檔案與 10-27 22:16 的完整備份相同，外掛檔案的回復用 0.1.0 ZIP） | 完成：資料庫備份 2026-10-28 22:37（約 5.96 MB），「備份成功且已完成」。部署者另存一份到本機 `WP_BackUp/v1/`（已加入 `.gitignore`；含客戶資料，不得提交或分享）；gzip 檢查通過，126 個資料表 | 22:37 |
| 2 | 外掛 → 安裝外掛 → 上傳外掛 → `wg-live-0.2.0.zip` → 立即安裝 →「使用已上傳版本取代現有版本」 | 完成：上傳前在瀏覽器內核對檔案 1,484,773 bytes、SHA-256 `0b76b4b3…751cce` 相符；WordPress 顯示目前 0.1.0、上傳 0.2.0，取代後「外掛已成功更新」 | 22:39–22:40 |
| 3 | 核對外掛與部署資訊 | 外掛列表：WG Studio Live 0.2.0，啟用中。部署資訊：外掛與建置版本 0.2.0、commit `4fc83256051fbc4a02d3746f8e8be434465d7c4c`、三個資產 SHA-256 與 `build-info.json` 相同；環境 production、模式 `demo`；頁面 972／973／974 publish；首頁精選 #978；設定版本 4（未變） | 22:40 |
| 4 | 管理員檢視活動列表與活動 978（未儲存） | 列表新增「首頁精選」欄，標示 978；978 的編輯畫面有「設為首頁精選」且已勾選，隱藏標記存在 | 22:40 |
| 5 | 登出檢查 | 首頁 200，Live 區塊顯示示範活動；/live/、/live/listen/?wg_event=interface-demo、/live/help/ 皆 200 並掛載，資源版本 `6369b7c7254d`（JS）、`c01bf2ff9204`（CSS）、`18eddccf9759`（首頁 CSS）與新建置相符；REST 只列出 `interface-demo`，沒有媒體網址 | 22:41 |
| 6 | 老闆以自己的帳號確認看得到「Live 活動」、看不到「設定」 | 待老闆回報。已以管理員唯讀查詢：具 Editor + Shop Manager 角色的帳號只有一個，具備 `publish_pages`、`upload_files`，沒有 `manage_options`。網站有 Admin Menu Editor，需由老闆實際登入確認選單 | — |

## 5. 回復

上傳 `wg-live-0.1.0.zip` 並選「以上傳的版本取代目前版本」。設定與活動資料不受外掛檔案替換影響。0.1.0 會忽略 0.2.0 加的勾選框，精選活動照設定值顯示。
