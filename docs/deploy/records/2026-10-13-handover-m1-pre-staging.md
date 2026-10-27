# HANDOVER：M1 交接紀錄（staging 前的中期版本）

依 [HANDOVER.md](../HANDOVER.md) 模板填寫。這是 **staging 之前** 的狀態：程式與本機測試已完成，尚未部署到任何站台。取得 staging 與正式站授權後，複製本檔、更新「已部署」與第 5 節，並另外存成新的紀錄。

四組分開列出，不能混寫：已實作、已測試、已部署、尚待外部條件。**M1 不是「付費直播已安全上線」**：沒有真實票券檢查、播放授權、串流保護，也沒有真實設備上的 Binaural／Atmos 驗證（M2）。

## 2026-10-27 更新：正式站部署步驟 1–3

- **已部署**：正式站 https://sounds.wgstudiomusic.com/ 已安裝並啟用 wg-live 0.1.0（下方 10-20 節的 ZIP，SHA-256 `db4330c1…1c4f1d2b`），部署模式 `disabled`，前台沒有頁面、選單或區塊。部署前用 UpdraftPlus 做了檔案＋資料庫備份（2026-10-27 22:16）。沒有 staging，部署者決定直接上正式站。
- **已測試**：「部署資訊」的版本、commit 與三個 SHA-256 和本機 `build-info.json` 一致；環境 `production`、開發面板關閉；登出狀態的公開活動 API 回應空列表；部署前後版面與效能比對沒有發現外掛造成的變化。
- **尚待外部條件**：部署步驟 4–13（逐步等部署者核可）、授權人書面授權、回復負責人、實際手機 smoke test。
- 完整紀錄：[2026-10-27-production-0.1.0.md](2026-10-27-production-0.1.0.md)。

## 2026-10-20 更新：Atmos 無聲防護、版面跳動、筆電首屏（commit `593dde1`）

本節**取代下方各節的版本、commit 與 ZIP**；下方內容保留為歷史紀錄。這是第一次上傳 staging 要用的版本。

- **已實作**：
  - 無法解碼 Dolby Digital Plus（Atmos 常用格式）的瀏覽器（Chrome、Brave、Firefox）選擇 Atmos 模式時，顯示規格 §6「目前環境無法播放這個音訊版本」與「改用耳機 Binaural」「聆聽說明」，不再只有畫面沒有聲音。
  - 播放頁與 Live 頁載入時不再跳動。
  - 1366x768 與 1280x800 筆電上，兩個模式選項與開始按鈕都在首屏。
  - 錯誤代碼只顯示一次。
  - 開發展示頁可用 `WG_DEV_ATMOS_FILE` 在本機播放錄音室的 Atmos 測試檔（檔案不進 repository、不進 ZIP）。
- **ZIP**：`wg-live-0.1.0.zip`，1,483,433 bytes，SHA-256 `db4330c121d8b112392b332db0b7a84e2c328bfef9d2189a8ea3981a1c4f1d2b`，由乾淨 checkout 的 `593dde1` 產生。**上傳這一份。**
- **已測試（2026-10-20，本機）**：
  - `npm run check` 1200 個單元測試通過。
  - `lint:php` 通過。
  - e2e 735 passed、48 skipped（預期）、0 failed。
  - WSL2 wp-env 整合測試 183 passed、1 skipped。
  - ZIP 乾淨安裝檢查以上述 SHA-256 的 ZIP 通過。
  - 實驗室 CLS 在首頁、Live 頁、播放頁都是 0。
  - 證據：[e2e-summary.md](../../../evidence/test-results/e2e-summary.md)、[integration-summary.md](../../../evidence/test-results/integration-summary.md)、[atmos-browser-probe.md](../../../evidence/test-results/atmos-browser-probe.md)。
- **Atmos 測試檔（實驗室，非真實裝置聆聽）**：錄音室提供的 `11-NightClub 1960_WG_DolbyAtmos_MP4.mp4` 是有效的 Dolby Digital Plus + Atmos（JOC，複雜度指數 16，5.1 基底），整段解碼無錯誤，各聲道都有訊號且沒有削波。Edge 可播放並解碼聲音；Chrome、Brave、Firefox 無法解碼，現在會顯示不支援訊息。Atmos 物件是否正確以空間方式呈現，必須在真實裝置上聽測；家庭劇院相容表維持「尚待測試」。
- **已知限制**：
  - 手機與 1366x768／1280x800 上，原站固定在底部的 Backer Plan 橫幅會蓋住部分模式選項或開始按鈕，直到使用者關閉橫幅；橫幅實際高度要在 staging 確認。
  - 真機 Safari 的影片內嵌播放、全螢幕、Atmos 聽感與主機端 Range 請求尚待測試。
- **已部署**：未執行。**尚待外部條件**：同下方第 4 節。

## 2026-10-17 更新：稽核修正後的重建（commit `6757e6c`）

本節的 ZIP（e1464d9e）已由上方 10-20 的版本取代。

- **已實作**：全螢幕改為影像連同控制列一起進入全螢幕（暫停、靜音、音量、目前播放、切換模式都可操作；iPhone 仍用 Safari 內建影片播放器）；`<video>` 有無障礙名稱；示範影片重新編碼（每段約 410 KiB）；外掛說明、後台活動列表與設定文字依媒體類型顯示「示範影片／示範音訊」；未使用的方形海報移出 ZIP；`check:artifact` 新增 ZIP 總大小上限 1.75 MiB（PHP 預設上傳上限 2 MiB）。部署文件新增影片檢查、上傳大小檢查、效能基準步驟；真機測試模板新增影片項目（結果全部維持「尚待測試」）。
- **ZIP**：`wg-live-0.1.0.zip`，1,482,788 bytes，SHA-256 `e1464d9e49b40063aeb62357d2284715605183f140dc34eebe9cee4ebd3f9944`，由乾淨 checkout 的 `6757e6c` 產生。（已被 10-20 的 ZIP 取代，不要上傳。）
- **已測試（2026-10-17，本機）**：`npm run check` 1176 個單元測試通過；`lint:php` 通過；e2e 711 passed、48 skipped（預期）、0 failed；WSL2 wp-env 整合測試 183 passed、1 skipped（效能量測只在 Chromium）；ZIP 乾淨安裝檢查以上述 SHA-256 的 ZIP 通過。新增的整合測試：購物車有商品時的 Cart 與 Checkout（外掛啟用與停用）、示範音訊覆寫只套用於音訊活動、wp-env 實驗室 LCP／CLS。證據：[e2e-summary.md](../../../evidence/test-results/e2e-summary.md)、[integration-summary.md](../../../evidence/test-results/integration-summary.md)、[audit-fixes-code.md](../../implementation/reports/audit-fixes-code.md)。
- **效能（實驗室數據，wp-env，Chromium，非真實使用者）**：外掛啟用時首頁 LCP 260 ms、CLS 0；Live 頁 LCP 584 ms、CLS 0.071；播放頁 LCP 620 ms、CLS 0.056。都在規格 §13.4 的 LCP ≤2.5 秒、CLS ≤0.1 內。Live 頁與播放頁的 CLS 來自前端掛載時取代 PHP 預留區塊，是否在 staging 前消除待使用者決定。
- **已知限制**：360x800 手機上，模擬的 Backer Plan 橫幅（頂端 610 px）會完全蓋住第一個模式選項（628–871 px）；390x844 只露出約 9 px。開始按鈕在手機與 1280x800 都在首屏下方。橫幅實際高度是依截圖估計，要在 staging 確認。真機 Safari 的影片內嵌播放、全螢幕與主機端 Range 請求尚待測試。
- **已部署**：未執行。**尚待外部條件**：同下方第 4 節。

## 同日更新：影片成為預設活動類型（commit `4d55486`）

使用者確認每場音樂會都有影像，因此本節**取代下方第 0 節的版本、commit 與 ZIP**；下方其餘內容保留為上午的紀錄。

- **已實作**：活動的媒體類型預設為「影片」；示範活動播放外掛內建的兩段示範影片（`demo-video-1.mp4`、`demo-video-2.mp4`，H.264／AAC，各約 630 KiB，畫面標示「操作示範影片，非 Binaural／Atmos 驗證素材」）；音訊活動仍可選，播放示範音訊。影片播放頁從 1024 px 起改為影像在左、標題在右，模式選擇與開始按鈕在其下方。
- **ZIP**：`wg-live-0.1.0.zip`，約 2.0 MB，SHA-256 `318b5fd73611a4a80b6c6d2b4827287d60c6e085986802fd3811b98bc981a86d`，由乾淨 checkout 的 `4d55486` 產生。（已被取代，不要上傳。）
- **已測試（2026-10-13，本機）**：`npm run check` 1164 個單元測試通過；`lint:php` 通過；e2e 703 passed、44 skipped（預期）、0 failed；WSL2 wp-env 整合測試 178 passed；ZIP 乾淨安裝檢查通過。版面量測與截圖見 [HYBRID.md](../../design/HYBRID.md)「Player: video layout」與 `evidence/screenshots/video/`：1440x1000 時兩個模式選項在 573–798 px、開始按鈕在 871–919 px。
- **已知限制**：1280x800 時開始按鈕在首屏下方（只要求 1440x1000，與音訊版相同）；390x844 手機上第一個模式選項從 645 px 開始，會被原站固定在底部、可關閉的 Backer Plan 橫幅遮住一部分。Playwright WebKit 不等於 Safari：真機 Safari 的影片內嵌播放、全螢幕與主機端 Range 請求尚待測試。
- **已部署**：未執行。**尚待外部條件**：同下方第 4 節；另外真實影像串流的形式（HLS 或嵌入式播放器）尚未決定（M2）。

## 0. 版本與位置

| 項目 | 內容 |
|---|---|
| 外掛版本 | 0.1.0 |
| Git commit | `4ba0f99`（ZIP 的建置來源）。自動化測試在 `a1152e4` 執行；兩者之間只改了打包腳本、測試與文件，`plugin/` 與 `src/` 沒有差異。本檔與測試紀錄在之後的文件 commit 加入 |
| ZIP 檔名與 SHA-256 | `wg-live-0.1.0.zip`，`0513088e1368e732f46fadd247ef965b98fc3f5b0b2cd9e44004d667d1a7c556`（ZIP 不放進 git。在 `4ba0f99` 的另一個全新 checkout，以同一份 `package-lock.json` 的依賴執行 `npm run build && npm run package`，得到相同的 SHA-256） |
| repository 位置 | https://github.com/kekekewww/WG_Dolby_Live（`main`） |
| 交接日期與交接人 | 2026-10-13，Kevin_Yang_tw（本檔由 Claude Code 依 repository 與測試紀錄整理，待交接人確認） |
| 接手人 | 尚未指定 |
| 對應部署紀錄 | 無：尚未部署到 staging 或正式站 |

## 1. 已實作

| 項目 | 已實作 | 位置／備註 |
|---|---|---|
| `wg-live` 外掛（活動 CPT、設定、REST、shortcode、資源載入） | ☑ | `plugin/wg-live/`；REST `wg-live/v1/events`、`events/{slug}`、`playback`（伺服器端先跑 `Entitlement::check`） |
| TypeScript 前端（活動列表、模式選擇、播放、切換、錯誤與空狀態、說明頁） | ☑ | `src/`；事件、播放器、資格三個狀態軸與來源類型分開（`src/state/`） |
| DemoAdapter 與真實示範音訊 | ☑ | `plugin/wg-live/assets/demo/`、`src/adapters/`；兩種模式都標示「操作示範音訊，非 Binaural／Atmos 驗證素材」 |
| 精選活動區塊 `[wg_live_featured]`（純 PHP，不載入 JS） | ☑ | `plugin/wg-live/templates/featured.php`、`src/featured.ts`（只輸出 CSS） |
| 後台活動管理與代稱驗證；設定頁；部署資訊；建立建議頁面 | ☑ | `plugin/wg-live/includes/`；代稱必填且符合 `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| 可及性（鍵盤、螢幕閱讀器公告、reduced-motion） | ☑ | `src/components/`；目標 WCAG 2.2 AA |
| 局部 CSS 與原站主題橋接 | ☑ | `src/styles/`；視覺規格 [docs/design/HYBRID.md](../../design/HYBRID.md)（使用者選定的 A + C 混合方向；文字顏色繼承主題） |
| 建置、打包與 ZIP 檢查（`npm run build`／`package`／`check:artifact`） | ☑ | `scripts/` |
| 部署文件（STAGING／PRODUCTION／NAV-HOMEPAGE／LINK-CHECKLIST／ROLLBACK／DEPLOY-RECORD／HANDOVER） | ☑ | `docs/deploy/` |
| 負載測試工具（頁面、靜態資源、events 請求；不含播放） | ☑ | `scripts/load-test.mjs`；需要 `--target` 與 `--approved`，永不請求 `/playback` 或媒體 |
| 其他 | ☑ | WSL2 內執行 wp-env（`npm run wp:start:wsl`，見 [WSL.md](../../implementation/WSL.md)）；ZIP 乾淨安裝檢查（`npm run test:zip-install`）；開發展示頁與原站外框模擬（`dev/`） |

## 2. 已測試

只列有紀錄的測試。Playwright WebKit 不等於 Safari。

| 測試 | 環境與版本 | 日期 | 結果 | 證據位置 |
|---|---|---|---|---|
| `npm run typecheck` | Windows 11、Node 22.17.0 | 2026-10-13 | 通過 | `npm run check` 輸出 |
| `npm run lint` | 同上 | 2026-10-13 | 通過 | 同上 |
| `npm run lint:php`（PHP 7.4／8.3 與 PHPCompatibility） | Docker php:7.4-cli、php:8.3-cli，PHPCompatibilityWP 7.4- | 2026-10-13 | 通過：17 個 PHP 檔 | 指令輸出 |
| `npm run test:unit` | Vitest 5.0.3、Node 22.17.0 | 2026-10-13 | 通過：1156 個測試 | `npm run check` 輸出 |
| `npm run build` | Vite 8 | 2026-10-13 | 通過；gzip 後 JS 31.7／100 KiB、CSS 8.6／30 KiB、首頁卡片 CSS 2.7／30 KiB | 同上 |
| `npm run test:e2e`（Chromium／Firefox／WebKit；WebKit 不等於 Safari） | Playwright 1.64.0，開發展示頁與建置後的 bundle | 2026-10-13 | 通過：668 passed，44 skipped（預期的跳過，原因見 summary），0 failed | [e2e-summary.md](../../../evidence/test-results/e2e-summary.md) |
| `npm run test:integration`（wp-env） | WSL2 內 wp-env：WordPress 7.1.3、PHP 8.2.34、Astra 4.14.0、Elementor 4.3.4、WooCommerce 11.2.1；Chromium 與 WebKit | 2026-10-13 | 通過：174 passed，0 failed（18.2 分鐘） | [integration-summary.md](../../../evidence/test-results/integration-summary.md) |
| `npm run package` + `npm run check:artifact` | 乾淨 checkout，`4ba0f99` | 2026-10-13 | 通過：單一 `wg-live/` 根目錄、allowlist、必要檔案、LF 行尾、CSS 範圍、大小預算、版本、建置 commit、SHA-256 | `artifacts/wg-live-0.1.0.zip` 與 `.sha256` |
| ZIP 在乾淨 WordPress 安裝並啟用 | 本機拋棄式 WordPress 7.1.3、PHP 8.2.34、Twenty Twenty-Five，只裝 wg-live（`npm run test:zip-install`） | 2026-10-13 | 通過 | 本檔第 2.1 節 |
| 規格 §13.1 功能測試 F01–F15 | F01–F12 開發展示頁（e2e）；F11、F13–F15 wp-env（integration） | 2026-10-13 | 通過（包含在上面兩列） | 兩份 summary 的「What the specs prove」 |
| staging 通過紀錄 | 未執行 | | 未執行：尚無 staging | |
| 真機瀏覽器與裝置（Safari 優先） | 未執行 | | 未執行：`manual-devices.md` 仍為空白模板 | `evidence/test-results/manual-devices.md` |
| 連結驗收 | 未執行 | | 未執行：需要 staging | |
| 部署前後整站比對（§13.3） | 只在 wp-env：外掛啟用與停用，7 頁桌面與 3 頁手機全頁截圖；正式站的比對要等 staging | 2026-10-13 | wp-env 內通過：Chromium 與 WebKit 每頁 0 像素差異 | `evidence/screenshots/integration/regression-*.json` |
| 效能實驗室量測（LCP／CLS；實驗室數據，非真實使用者） | Chromium、本機、未節流 | 2026-10-10 | 活動頁與播放頁 LCP 約 0.1 s、CLS 0（視覺重新設計之前的量測；staging 上要重新量） | [e2e-summary.md](../../../evidence/test-results/e2e-summary.md) |
| 負載測試（頁面、靜態資源、events；管理者核可的環境） | 未執行 | | 未執行：沒有核可的目標環境（工具本身有單元測試） | |

2026-10-13 使用者用 Windows 上的 Brave 透過臨時 tunnel 試用了開發展示頁，沒有回報問題。這是非正式試用，不是 staging，也沒有依 `manual-devices.md` 的規則填寫版本與逐項結果，所以不列入上表。

### 2.1 ZIP 乾淨安裝檢查

2026-10-13，`npm run test:zip-install`（`scripts/zip-install-check.sh`），對象是上面 SHA-256 `0513088e…a7c556` 的 ZIP（`a1152e4` 的建置也跑過一次，結果相同）。在執行中的 wp-env 旁邊建一個拋棄式 WordPress：複製開發站的核心檔（不下載），使用自己的資料庫，佈景主題 Twenty Twenty-Five，沒有其他外掛。檢查完成後刪除整個安裝與資料庫。這是本機的乾淨環境，不等於 staging。

| 檢查 | 結果 |
|---|---|
| `wp plugin install wg-live-0.1.0.zip`（與後台上傳 ZIP 相同的安裝流程），再啟用 | 通過，版本 0.1.0 |
| 啟用不改動頁面、已發布頁面、選單、佈景主題與首頁設定 | 通過：啟用前後相同 |
| 啟用後的部署模式 | `disabled` |
| 活動 CPT、兩個 shortcode、REST `events`、`events/<代稱>`、`playback` | 全部已註冊 |
| `[wg_live_featured]` 輸出不含 `<script>` | 通過 |
| 透過 Apache 存取網站、`?rest_route=/wg-live/v1/events`（disabled 模式回傳 `{"events":[]}`）、`wg-live.js`、`wg-live-featured.css` | 全部 200 |
| 停用並解除安裝 | 外掛資料夾已刪除；設定保留（`delete_data_on_uninstall` 預設關閉） |
| 整個過程的 `WP_DEBUG_LOG` | 空白：沒有 notice、warning、deprecation 或 error |

## 3. 已部署

未執行。沒有部署到 staging 或正式站，也沒有建立或修改任何站台頁面、選單或設定。

| 環境 | 日期 | 版本與 SHA-256 | 部署了什麼 | 目前部署模式 | 部署紀錄 |
|---|---|---|---|---|---|
| staging | 未執行 | | | | |
| 正式站 | 未執行 | | | | |

## 4. 尚待外部條件

| 資料／條件 | 未取得時可先做 | 真正阻擋的階段 | 目前狀態 |
|---|---|---|---|
| 原站完整截圖與精確樣式 | 繼承式布局與全部互動 | 最終視覺一致性驗收 | 可先做的已完成（HYBRID.md、原站外框模擬、亮色與暗色背景的對比檢查）；需要 staging 做最終校準 |
| 外掛版本與 staging | 本機插件、示範與單元測試 | 原站整合及版本相容驗收 | 等待正式站版本盤點（§3.1）。取得後要重新固定 `.wp-env.json` 的 WordPress、PHP 與外掛版本並重跑整合測試 |
| 正式站安裝與發布授權 | 完成 ZIP、部署步驟與本機／staging 結果 | 實際正式站寫入與公開 | ZIP 與部署文件已備妥；尚未取得授權 |
| 活動海報、節目與時間 | 明確標示的示範內容 | 真實活動內容發布 | 目前只有示範活動 |
| HLS 或 iframe 測試來源／文件 | DemoAdapter、完整播放器殼與模式切換 | 真實串流 adapter 驗收 | 尚未取得（M2） |
| 票券規則與授權機制 | 資格狀態 UI、provider 邊界 | 正式付費節目開放 | 尚未取得（M2）；目前找不到資格結果時一律拒絕播放 |
| 家庭劇院設備與測試 | 說明頁、待驗證相容表 | 對外宣告特定 Atmos 路徑支援 | 相容表全部維持「尚待測試」 |
| 真機 Safari（iPhone、iPad、Mac） | Playwright WebKit（不等於 Safari） | 瀏覽器與裝置驗收（§13.2） | 未測；由測試者在 staging 依 `manual-devices.md` 填寫 |

M2 範圍（M1 不做，也不宣稱）：真實票券檢查與播放授權；串流保護／DRM；真實設備上的 Binaural／Atmos 端到端驗證；供應商容量與 300 人同時串流。300 人網頁載入成功**不能**證明 300 人 Atmos 直播可承載（§13.5）。

## 5. 最終驗收清單（規格 §19）

只勾有證據的項目。需要 staging 或正式站的項目維持 ☐，證據欄寫目前只在本機證明到哪裡。

### 5.1 視覺

| 項目 | 完成 | 證據 |
|---|---|---|
| 保留現站 Logo、頁首、頁尾與導覽行為 | ☐ | wp-env（Astra）：外掛不輸出頁首或頁尾，停用前後截圖 0 像素差異；現站待 staging |
| 使用已量測的原站文字、顏色、按鈕及內容寬度；未量測項目明確列為待校準 | ☐ | `docs/implementation/design-baseline.md`、HYBRID.md；最終校準待 staging |
| 新的播放器舞台與原站外框協調，沒有全站改色或樣式汙染 | ☐ | e2e：CSS 隔離與敵意主題測試、亮暗主題 axe 對比檢查；現站待 staging |
| 桌面／手機都有完整布局，重要操作可達，沒有橫向溢出 | ☐ | e2e：360 與 390 px 無橫向溢出；1440x1000 首屏可見兩個模式選項與開始按鈕；手機上第一個模式選項的頂端在首屏內，但可能被原站底部橫幅遮住，開始按鈕需捲動（見最上方 10-17 更新）；真機待測 |
| 全部文字為台灣繁體中文，技術名稱保留正確英文 | ☑ | 規格 §5–§6 文案；單元測試鎖定狀態與錯誤文案 |

### 5.2 功能

| 項目 | 完成 | 證據 |
|---|---|---|
| 活動列表、模式選擇、播放、切換、斷線、取消、結束及空狀態完整 | ☑ | e2e F01–F10、F12；integration `pages.spec.ts` |
| 示範媒體是真正可播放的素材，與實際 Atmos／Binaural 驗證分開 | ☑ | e2e F03／F04（`currentTime` 前進）、兩種模式都顯示示範聲明 |
| 未配置來源不造成錯誤循環或空白畫面 | ☑ | integration `pages.spec.ts`（非示範且無來源的活動）；e2e F08 有上限的重試 |
| 同一時間只有一個實際播放來源 | ☑ | e2e F05、F06；integration F14（Elementor 重新渲染仍只有一個媒體元素） |
| 沒有無法操作的假按鈕、假曲目同步或假設備能力資訊 | ☑ | 依 adapter 能力隱藏控制項（單元測試）；沒有頻譜、人數或 Atmos 認證標示 |

### 5.3 WordPress 整合

| 項目 | 完成 | 證據 |
|---|---|---|
| ZIP 可以在乾淨環境安裝並啟用 | ☐ | 本機乾淨 WordPress 已通過（第 2.1 節）；staging 安裝後才勾選 |
| 三個頁面、首頁精選與站內連結運作 | ☐ | wp-env：`pages.spec.ts`、`featured.spec.ts`、`settings.state.spec.ts`；現站連結驗收待 staging |
| 活動內容可透過後台更新 | ☐ | wp-env：`admin-events.spec.ts`（F13）；現站待 staging |
| 已測試現有商店、商品、Account、Cart、Checkout 不被破壞 | ☐ | wp-env：`deactivate.state.spec.ts`（F15）啟用與停用都能正常顯示；現站待 staging |
| 既有頁首／頁尾沒有被複製出第二份 | ☐ | wp-env（Astra）截圖比對；現站待 staging |
| 正式站無 localhost、staging 路徑或開發面板 | ☐ | `check:artifact` 檢查 ZIP 不含開發字串；wp-env production 環境不顯示開發面板（`dev-tools.spec.ts`）；正式站待部署後檢查 |

### 5.4 部署與文件

| 項目 | 完成 | 證據 |
|---|---|---|
| 已有 staging 通過紀錄和可回復的發布包 | ☐ | 發布包已備妥；staging 未執行 |
| 正式站修改具有授權，且每一項實際操作都有紀錄 | ☐ | 尚未取得授權，沒有任何正式站操作 |
| 已完成首頁、桌面選單、手機選單和相關活動連結 | ☐ | 步驟見 NAV-HOMEPAGE.md；未執行 |
| 尚未正式驗票時，發布內容維持示範／待開放，不暴露付費來源 | ☐ | 程式面已保證（REST 白名單、伺服器端資格檢查、找不到資格時拒絕）；實際發布待 staging |
| 已提供版本、頁面 URL、管理操作、已測環境、回復方式及待接事項 | ☐ | 本檔提供版本、管理操作、已測環境、回復方式與待接事項；頁面 URL 待部署後補上 |

## 6. 管理者日常操作

見 [HANDOVER.md](../HANDOVER.md) 第 6 節。

## 7. 回復方式

摘要：先切 `disabled` → 移除首頁區塊與選單項目 → 停用外掛並視需要還原上一版 ZIP → 不覆蓋資料庫。細節見 [ROLLBACK.md](../ROLLBACK.md)。

| 項目 | 內容 |
|---|---|
| 上一版 ZIP 位置與 SHA-256 | 無：0.1.0 是第一版。正式站目前沒有安裝 `wg-live`，回復即停用並刪除外掛 |
| 備份位置與還原入口 | 部署前由站台管理者確認（STAGING.md、PRODUCTION.md 的前置步驟） |
| 回復負責人 | 尚未指定 |

## 8. 已知限制與未完成事項

| 項目 | 說明 |
|---|---|
| M1 示範音訊 | 自製測試音，不是 Binaural／Atmos 驗證素材 |
| 開發面板 | 只在 `local`／`development`，或 `staging` 的登入管理者；`production` 永遠不顯示。wp-env 沒有 `staging` 環境類型，staging 加管理者的條件要到 staging 才能實測 |
| 登入按鈕 | 連到現站 Account 頁，不帶返回路徑 |
| 整合測試範圍 | 沒有 Elementor Pro、其他 Elementor 版本、快取或最佳化外掛、multisite；Firefox 只跑 e2e |
| 連結 hover | 為了在亮色背景上可讀，連結 hover 改為加粗底線，不變黃色（HYBRID.md「Host colours」） |
