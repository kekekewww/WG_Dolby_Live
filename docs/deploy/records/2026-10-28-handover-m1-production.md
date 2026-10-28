# HANDOVER：M1 交接紀錄（正式站部署完成）

依 [HANDOVER.md](../HANDOVER.md) 模板填寫。取代 [2026-10-13-handover-m1-pre-staging.md](2026-10-13-handover-m1-pre-staging.md) 成為目前的交接紀錄；舊檔保留為歷史紀錄。部署的每一步細節見 [2026-10-27-production-0.1.0.md](2026-10-27-production-0.1.0.md)。

**2026-10-28 22:40 更新：正式站已升級到 0.2.0**（commit `4fc8325`，ZIP SHA-256 `0b76b4b3…751cce`）。Editor 與 Shop Manager 可以管理活動，活動頁有「設為首頁精選」；設定仍只限 Administrator。詳見 [2026-10-28-production-0.2.0.md](2026-10-28-production-0.2.0.md)。下方第 0 節的版本欄位是 0.1.0 當時的紀錄；回復到 0.1.0 的方式見該檔第 5 節。

四組分開列出，不能混寫：已實作、已測試、已部署、尚待外部條件。**M1 不是「付費直播已安全上線」**：正式站上線的是示範體驗；沒有真實票券檢查、播放授權、串流保護，也沒有真實設備上的 Binaural／Atmos 驗證（M2）。

## 0. 版本與位置

| 項目 | 內容 |
|---|---|
| 外掛版本 | 0.1.0 |
| Git commit | 建置來源 `593dde1d0b130a3e0b7ff0de2d209dd8bcc4a835`（`dirty: false`）。之後的 commit 只有文件、測試紀錄與開發工具（`dev/serve-dist.mjs`），`plugin/` 與 `src/` 沒有變更 |
| ZIP 檔名與 SHA-256 | `wg-live-0.1.0.zip`，1,483,433 bytes，`db4330c121d8b112392b332db0b7a84e2c328bfef9d2189a8ea3981a1c4f1d2b`（ZIP 不放進 git） |
| repository 位置 | https://github.com/kekekewww/WG_Dolby_Live（`main`） |
| 交接日期與交接人 | 2026-10-28，Kevin Yang（Kevin_Yang_tw）。本檔由 Claude Code 依部署紀錄與測試紀錄整理，待交接人確認 |
| 接手人 | 尚未指定 |
| 對應部署紀錄 | `docs/deploy/records/2026-10-27-production-0.1.0.md` |

## 1. 已實作

與 2026-10-13 交接紀錄第 1 節相同，沒有新增程式。摘要：

| 項目 | 已實作 | 位置／備註 |
|---|---|---|
| `wg-live` 外掛（活動 CPT、設定、REST、shortcode、資源載入） | ☑ | `plugin/wg-live/`；REST `wg-live/v1/events`、`events/{slug}`、`playback`（伺服器端先檢查資格，找不到資格時拒絕） |
| TypeScript 前端（活動列表、模式選擇、播放、切換、錯誤與空狀態、說明頁） | ☑ | `src/`；事件、播放器、資格三個狀態軸分開 |
| DemoAdapter 與示範影音（示範影片與示範音訊） | ☑ | `plugin/wg-live/assets/demo/`、`src/adapters/` |
| 精選活動區塊 `[wg_live_featured]`（純 PHP，不載入 JS） | ☑ | `plugin/wg-live/templates/featured.php` |
| 後台活動管理與代稱驗證；設定頁；部署資訊；建立建議頁面 | ☑ | `plugin/wg-live/includes/` |
| 可及性（鍵盤、螢幕閱讀器公告、reduced-motion） | ☑ | `src/components/`；目標 WCAG 2.2 AA |
| 局部 CSS 與原站主題橋接 | ☑ | `src/styles/`、[HYBRID.md](../../design/HYBRID.md) |
| 建置、打包與 ZIP 檢查 | ☑ | `scripts/` |
| 部署文件 | ☑ | `docs/deploy/` |
| 負載測試工具（頁面、靜態資源、events；不含播放） | ☑ | `scripts/load-test.mjs`，需要 `--target` 與 `--approved` |
| Atmos 本機測試掛勾（只在本機開發頁） | ☑ | `WG_DEV_ATMOS_FILE`，見 [ATMOS-LOCAL-TEST.md](../../implementation/ATMOS-LOCAL-TEST.md)；不進 ZIP |
| HLS 與 iframe adapter | 只有 M1 stub | `src/adapters/hls.ts`、`iframe.ts`：M2 合約已寫下，目前不播放任何來源 |

## 2. 已測試

只列有紀錄的測試。Playwright WebKit 不等於 Safari。

| 測試 | 環境與版本 | 日期 | 結果 | 證據位置 |
|---|---|---|---|---|
| `npm run check`（typecheck、lint、unit、build、package、check:artifact） | Windows 11、Node 22，建置 `593dde1` | 2026-10-20 | 通過：1200 個單元測試 | [2026-10-13 交接紀錄](2026-10-13-handover-m1-pre-staging.md) 的 2026-10-20 節 |
| `npm run lint:php`（PHP 7.4／8.3 與 PHPCompatibility） | Docker php:7.4-cli、php:8.3-cli | 2026-10-20 | 通過 | 同上 |
| `npm run test:e2e`（Chromium／Firefox／WebKit） | Playwright，開發展示頁與建置後 bundle | 2026-10-20 | 735 passed、48 skipped（預期）、0 failed | [e2e-summary.md](../../../evidence/test-results/e2e-summary.md) |
| `npm run test:integration`（wp-env） | WSL2 wp-env：WordPress 7.1.3、PHP 8.2、Astra、Elementor 4.3.4、WooCommerce 11.2.1 | 2026-10-20 | 183 passed、1 skipped | [integration-summary.md](../../../evidence/test-results/integration-summary.md) |
| ZIP 在乾淨 WordPress 安裝並啟用（`npm run test:zip-install`） | 本機拋棄式 WordPress | 2026-10-20 | 通過（同一份 ZIP SHA-256） | 同上交接紀錄 |
| 規格 §13.1 功能測試 F01–F15 | e2e（F01–F12）與 integration（F11、F13–F15） | 2026-10-20 | 通過（包含在上兩列） | 兩份 summary |
| Atmos 測試檔解碼（實驗室，非真實裝置聆聽） | 本機開發頁；Edge 156、Brave 156 | 2026-10-19、2026-10-27 | Edge 播放並解碼聲音；Brave／Chrome／Firefox 無法解碼，顯示「目前環境無法播放這個音訊版本」與「改用耳機 Binaural」 | [atmos-browser-probe.md](../../../evidence/test-results/atmos-browser-probe.md) |
| 正式站部署前後檢查 | 正式站，登出，Playwright Chromium 1440 與 390 寬 | 2026-10-27 至 2026-10-28 | 每一步的檢查與結果見部署紀錄第 3 節 | [部署紀錄](2026-10-27-production-0.1.0.md) |
| 草稿預覽的實際播放與切換 | 正式站，Brave 桌面版（管理員登入的草稿預覽） | 2026-10-27 | Binaural 播放示範影片 1；切換到 Dolby Atmos 音軌後從頭播放示範影片 2；頁面只有一個 `<video>`；暫停可用 | 部署紀錄第 3 節 |
| 連結驗收 | 正式站，登出，1440 與 390 寬（手機為模擬） | 2026-10-27 至 2026-10-28 | 第 1–4、6、7、11、14、15 列通過；第 8 列桌面通過；第 8 列手機與第 9 列尚待測試；第 5、10、12、13 列目前不適用；沒有失敗 | [links-production-2026-10-27.md](../../../evidence/test-results/links-production-2026-10-27.md) |
| 部署前後整站比對（§13.3） | 正式站，登出，1440 與 390 寬，Home、Store、商品頁、Account、Cart、Checkout | 2026-10-27 22:1x（部署前）、2026-10-28 00:30（全部步驟完成後） | 通過。Account、Cart、Checkout 與 Store 手機版：除桌面頁首選單多一個 Live（17 px 高的區域）外完全相同。Cart 手機版第一次拍攝時背景照片尚未延遲載入完成，重拍後 0 差異。商品頁：差異來自 WooCommerce 隨機的「相關商品」。Store 桌面版：除頁首外，「加入購物車」按鈕與排序選單文字有 2 px 差異；現在量到按鈕 140×46、`"Noto Sans TC"` 16px、padding 15px 30px，與外掛之前的設計基準實測完全相同，Store 也不載入任何外掛檔案，判定為部署前截圖當下網頁字型尚未載入。首頁：只多了 Live 區塊（桌面高度 +770 px、手機 +678 px），其他章節不變 | `evidence/screenshots/production-before-2026-10-27/`、`production-final-2026-10-28/`（含 `store-desktop-diff.png`） |
| 效能實驗室量測（非真實使用者數據） | 正式站，登出，Playwright Chromium，未節流，各三次取中位數 | 2026-10-27、2026-10-28 | 首頁部署前：桌面 LCP 3.70 s、CLS 0.0007、4,075 KB、172 個請求；手機 LCP 4.11 s、CLS 0、4,087 KB、172 個請求。全部步驟完成後：桌面 LCP 3.79 s、CLS 0.0007、4,078 KB、174 個請求；手機 LCP 3.88 s、CLS 0、4,093 KB、174 個請求。外掛增量：多 2 個請求（`wg-live-featured.css` 與示範海報 `poster-demo.svg`），傳輸約多 3–6 KB，CLS 不變；LCP 差異在三次量測的雜訊範圍內。站本身的伺服器回應約 2 s，是首頁 LCP 的主要成分 | 兩個資料夾內的 `baseline.json` |
| 實際 iPhone smoke test | 正式站，iPhone（部署者操作） | 2026-10-28 | 部署者回報「iPhone test checked」，視為通過；裝置型號、iOS 版本與逐項結果尚未填寫 | 待部署者填入 [manual-devices.md](../../../evidence/test-results/manual-devices.md)（該檔只能由人填寫） |
| staging 通過紀錄 | 未執行 | | 未執行：沒有 staging，部署者決定直接上正式站並先維持 `disabled` | — |
| 負載測試 | 未執行 | | 未執行：沒有核可的目標與時段 | — |

## 3. 已部署

| 環境 | 日期 | 版本與 SHA-256 | 部署了什麼 | 目前部署模式 | 部署紀錄 |
|---|---|---|---|---|---|
| staging | 未執行 | | | | |
| 正式站 https://sounds.wgstudiomusic.com/ | 2026-10-27 22:14 至 2026-10-28 00:35（Asia/Taipei） | 0.1.0，ZIP `db4330c1…1c4f1d2b` | 外掛、三個頁面、一場示範活動、主選單 Live 項目、首頁 Live 區塊；另安裝 UpdraftPlus 作為部署前備份工具 | `demo` | [2026-10-27-production-0.1.0.md](2026-10-27-production-0.1.0.md) |

站內頁面與入口：

| 頁面 | 網址 | Page ID | 狀態 |
|---|---|---|---|
| Live | https://sounds.wgstudiomusic.com/live/ | 972 | 已發布（2026-10-27 23:36） |
| Listen | https://sounds.wgstudiomusic.com/live/listen/ | 973 | 已發布；需帶 `?wg_event=<代稱>`，不帶時顯示「找不到這場活動」 |
| Listening Guide | https://sounds.wgstudiomusic.com/live/help/ | 974 | 已發布 |
| 首頁 Live 區塊 | https://sounds.wgstudiomusic.com/ （Music 之後） | 首頁 ID 8；區塊容器 `6f58692`，錨點容器 `7f65790`（`h-live`） | 已發布（2026-10-28 00:02，revision 985） |
| 選單項目 | 主選單 MainNav.20240309a（桌面與手機共用），Video 與 Blog 之間 | 選單項目 979 → 頁面 972 | 已儲存（2026-10-28） |
| 示範活動 | `/live/listen/?wg_event=interface-demo` | 活動 ID 978，代稱 `interface-demo` | 已發布，標示「介面示範」，狀態「直播中」（模擬），設為精選活動 |

## 4. 尚待外部條件

| 資料／條件 | 未取得時可先做 | 真正阻擋的階段 | 目前狀態 |
|---|---|---|---|
| 原站完整截圖與精確樣式 | 繼承式布局與全部互動 | 最終視覺一致性驗收 | 已在正式站上線並比對；細部視覺由錄音室確認 |
| 外掛版本與 staging | 本機插件、示範與單元測試 | 原站整合及版本相容驗收 | 沒有 staging；正式站版本已盤點（WordPress 7.1.3、PHP 8.1.34、Elementor 4.3.5／Pro 4.3.2、WooCommerce 11.2.1、Astra 4.14.1） |
| 正式站安裝與發布授權 | — | — | 部署者 2026-10-27 在對話中逐步核可；**錄音室負責人的書面授權待補** |
| 活動海報、節目與時間 | 明確標示的示範內容 | 真實活動內容發布 | 只有示範活動；海報未設定（需要核可圖片） |
| HLS 或 iframe 測試來源／文件 | DemoAdapter、完整播放器殼與模式切換 | 真實串流 adapter 驗收 | 尚未取得（M2）。需要錄音室或串流商回答的問題見下方 |
| 票券規則與授權機制 | 資格狀態 UI、provider 邊界 | 正式付費節目開放 | 尚未取得（M2） |
| 家庭劇院設備與測試 | 說明頁、待驗證相容表 | 對外宣告特定 Atmos 路徑支援 | 相容表全部維持「尚待測試」 |
| 真機 Safari 與其他裝置 | Playwright WebKit（不等於 Safari） | 瀏覽器與裝置驗收 | iPhone 由部署者回報通過，細節待填 `manual-devices.md`；iPad、Mac、Apple TV、Android 未測 |
| 回復負責人 | — | 發生問題時的處理 | 尚未指定 |

M2 範圍（M1 不做，也不宣稱）：真實票券檢查與播放授權；串流保護／DRM；真實設備上的 Binaural／Atmos 端到端驗證；供應商容量與 300 人同時串流。

M2 開始前需要錄音室或串流商回答：觀眾拿到的是 HLS（`.m3u8`）還是播放器頁面；每種模式各一個網址或一個串流兩個音軌；網址是否有期限或 token；是否允許從本站播放（CORS、HTTPS、iframe 嵌入許可）；音訊格式（Binaural 為 AAC 立體聲，Atmos 為 Dolby Digital Plus `ec-3`）；容量、碼率與彩排日期。完整流程的說明頁：https://claude.ai/artifact/X9rGK4diSazDZTYMLrDmRp（私人連結，分享需由擁有者在頁面上設定）。

## 5. 最終驗收清單（規格 §19）

只勾有證據的項目。

### 5.1 視覺

| 項目 | 完成 | 證據 |
|---|---|---|
| 保留現站 Logo、頁首、頁尾與導覽行為 | ☑ | 正式站：外掛不輸出頁首頁尾；只在主選單新增 Live；Logo 與 Homepage 項目指向首頁；部署紀錄第 3 節 |
| 使用已量測的原站文字、顏色、按鈕及內容寬度；未量測項目明確列為待校準 | ☑ | `docs/implementation/design-baseline.md`；正式站三頁與首頁截圖 |
| 新的播放器舞台與原站外框協調，沒有全站改色或樣式汙染 | ☑ | 部署前後比對（見第 2 節）：其他頁面只有選單多一個項目 |
| 桌面／手機都有完整布局，重要操作可達，沒有橫向溢出 | ☑ | 1440 與 390 寬無橫向捲動；已知限制：390 寬時「開始聆聽」在第一個畫面下方 |
| 全部文字為台灣繁體中文，技術名稱保留正確英文 | ☑ | 規格 §5–§6 文案 |

### 5.2 功能

| 項目 | 完成 | 證據 |
|---|---|---|
| 活動列表、模式選擇、播放、切換、斷線、取消、結束及空狀態完整 | ☑ | e2e F01–F10、F12；integration；正式站草稿預覽的播放與切換；本機演練的各狀態截圖 |
| 示範媒體是真正可播放的素材，與實際 Atmos／Binaural 驗證分開 | ☑ | 正式站播放示範影片 1／2，畫面與標示都寫明「操作示範」 |
| 未配置來源不造成錯誤循環或空白畫面 | ☑ | 本機演練：非示範且無來源的活動顯示「播放來源尚未開放」 |
| 同一時間只有一個實際播放來源 | ☑ | e2e F05、F06；正式站切換後仍只有一個 `<video>` |
| 沒有無法操作的假按鈕、假曲目同步或假設備能力資訊 | ☑ | 單元測試；正式站沒有頻譜、人數或 Atmos 認證標示 |

### 5.3 WordPress 整合

| 項目 | 完成 | 證據 |
|---|---|---|
| ZIP 可以在乾淨環境安裝並啟用 | ☑ | 本機乾淨 WordPress；正式站以後台上傳安裝並啟用 |
| 三個頁面、首頁精選與站內連結運作 | ☑ | 連結驗收（沒有失敗列） |
| 活動內容可透過後台更新 | ☑ | 正式站以後台表單建立並發布示範活動 978；本機演練以後台表單改變六種狀態 |
| 已測試現有商店、商品、Account、Cart、Checkout 不被破壞 | ☑ | 部署前後比對（見第 2 節） |
| 既有頁首／頁尾沒有被複製出第二份 | ☑ | 三頁使用 Elementor Full Width 範本，頁首頁尾各一份 |
| 正式站無 localhost、staging 路徑或開發面板 | ☑ | 原始碼搜尋與登出檢查；「部署資訊」開發面板為關閉 |

### 5.4 部署與文件

| 項目 | 完成 | 證據 |
|---|---|---|
| 已有 staging 通過紀錄和可回復的發布包 | ☐ | 發布包與回復方式已備妥；沒有 staging（部署者決定） |
| 正式站修改具有授權，且每一項實際操作都有紀錄 | ☐ | 每一項操作都記在部署紀錄，並由部署者在對話中逐步核可；錄音室負責人的書面授權待補後才勾選 |
| 已完成首頁、桌面選單、手機選單和相關活動連結 | ☑ | 部署紀錄步驟 10；連結驗收第 1–3 列 |
| 尚未正式驗票時，發布內容維持示範／待開放，不暴露付費來源 | ☑ | 只有示範活動；活動 API 不含來源網址；播放 API `no-store, private` 且只回傳示範影片 |
| 已提供版本、頁面 URL、管理操作、已測環境、回復方式及待接事項 | ☑ | 本檔 |

## 6. 管理者日常操作（正式站）

通用規則見 [HANDOVER.md](../HANDOVER.md) 第 6 節。正式站的實際入口：

- **建立活動**：後台「Live 活動 → 新增活動」。代稱必填（小寫英數與連字號）；示範活動要勾「示範活動」並把來源類型設為「示範」。正式活動在 M2 之前只能設「尚未設定」，觀眾會看到「播放來源尚未開放」。
- **演出當晚的狀態**：在活動編輯頁改「活動狀態」再按更新：尚未開始 → 等待入場 → 直播中 → 中場休息 → 已結束（或已取消）。狀態不會自動改變。開著的播放頁每 60 秒檢查一次。
- **首頁卡片**：顯示「Live 活動 → 設定 → 精選活動」選的那一場。換活動時改這個設定。
- **快取**：正式站目前沒有頁面快取，修改會立即生效。若日後開啟快取外掛，要排除 `wg-live*.js`、縮短存活時間，並在每次改活動狀態後清除 `/live/`、播放頁與首頁的快取。
- **示範活動 978**：日期固定為 2026-10-27 20:00、狀態「直播中」。要繼續展示時，記得更新日期；不需要時改為「已結束」或取消精選。
- **緊急關閉**：「Live 活動 → 設定 → 部署模式 → 停用（disabled）→ 儲存設定」。三頁改顯示「線上音樂會尚未開放」，活動 API 回傳空列表。

## 7. 回復方式

摘要：先切 `disabled` → 移除首頁區塊與選單項目 → 停用外掛 → 不覆蓋資料庫。細節見 [ROLLBACK.md](../ROLLBACK.md) 與部署紀錄第 7 節。

| 項目 | 內容 |
|---|---|
| 上一版 ZIP 位置與 SHA-256 | 無：0.1.0 是第一版。回復即停用外掛 |
| 首頁與選單的回復 | 選單：外觀 → 選單 → MainNav.20240309a → 移除 Live → 儲存選單。首頁：Elementor 刪除 Live 區塊與它上方的錨點容器；或還原 revision 947；或使用範本「首頁備份 2026-10-28」（ID 980） |
| 備份位置與還原入口 | UpdraftPlus 備份 2026-10-27 22:16（檔案＋資料庫，382.9 MB）：正式站伺服器，以及部署者電腦上的下載副本。還原入口「設定 → UpdraftPlus Backups → 還原」，需要 WordPress 管理員。完整資料庫回復會遺失之後的新訂單與會員，預設不做 |
| 回復負責人 | 尚未指定 |

## 8. 已知限制與未完成事項

| 項目 | 說明 |
|---|---|
| M1 示範影音 | 自製測試影片與測試音，不是 Binaural／Atmos 驗證素材 |
| 正式活動無法播放 | M2 之前，非示範活動在所有狀態都顯示「播放來源尚未開放」 |
| 開發面板 | `production` 永遠不顯示（正式站已確認） |
| 登入按鈕 | 連到現站 Account 頁，不帶返回路徑 |
| 頁面頂部留白 | 三頁用 110 px Spacer 區塊避開透明頁首（不是 Elementor 編輯器建置）；外掛本身不處理透明頁首 |
| 手機版面 | 390 寬時播放頁的「開始聆聽」在第一個畫面下方；原站 Backer Plan 橫幅在關閉前會蓋住畫面底部 |
| 首頁 | Portfolio 章節在所有裝置隱藏；Music 的 ⇊ 箭頭仍指向 `#h-portfolio`，會跳過 Live 區塊（沒有修改既有章節） |
| UpdraftPlus | 部署用的備份外掛仍啟用，伺服器上的備份占 383 MB；保留或停用由部署者決定 |
| 部署者電腦上的備份檔 | 含會員與訂單個資，不得放進 repository 或分享 |
| PHP 版本 | 正式站 PHP 8.1.34；本機 wp-env 為 PHP 8.2 |
