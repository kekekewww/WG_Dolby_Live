# DEPLOY-RECORD：正式站更新 wg-live 0.1.0 → 0.2.0

依 [DEPLOY-RECORD.md](../DEPLOY-RECORD.md) 模板填寫。上一份紀錄：[2026-10-27-production-0.1.0.md](2026-10-27-production-0.1.0.md)。

**狀態：已打包並通過測試，等待部署者核可上傳正式站。**

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

## 4. 部署步驟（待核可）

1. UpdraftPlus 立即備份（資料庫；22:16 的完整備份早於頁面、選單與首頁修改）。
2. 外掛 → 安裝外掛 → 上傳外掛 → 選 `wg-live-0.2.0.zip` → 立即安裝 →「以上傳的版本取代目前版本」。
3. 核對：外掛列表版本 0.2.0；「部署資訊」的 commit 與三個資產 SHA-256 與 `build-info.json` 相同；部署模式仍為 `demo`、三頁綁定不變、精選活動仍為 978。
4. 以管理員打開活動 978：看得到「設為首頁精選」且已勾選；活動列表的「首頁精選」欄標示 978。
5. 登出檢查：首頁 Live 區塊、/live/、/live/listen/?wg_event=interface-demo 正常。
6. 老闆以自己的帳號確認看得到「Live 活動」選單、看不到「設定」。

## 5. 回復

上傳 `wg-live-0.1.0.zip` 並選「以上傳的版本取代目前版本」。設定與活動資料不受外掛檔案替換影響。0.1.0 會忽略 0.2.0 加的勾選框，精選活動照設定值顯示。
