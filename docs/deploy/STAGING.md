# STAGING：staging 安裝與 Elementor 整合

依據：規格 §14.1–§14.5、M1-PLAN §7.5。範圍：M1（示範介面與後台管理）。這份流程只在 staging 操作；正式站請看 [PRODUCTION.md](PRODUCTION.md)。

做完本文件，你會得到一份 **staging 通過紀錄**（第 9 節）。沒有這份紀錄，不得進入正式部署（規格 §15.2、§19.4）。

## 0. 先讀這些原則

- staging 通過的必須是**之後要上正式站的同一份 ZIP**（同一個 SHA-256）。staging 上改了程式就要重新建置、重新打包、重新驗證。
- staging 只放測試素材與示範活動。不要把正式串流憑證、真實會員資料或私有串流網址放上來（規格 §14.1、§18.3）。
- 不安裝未知的整站搬移工具；用主機既有的 staging 功能，或錄音室正式授權的複製流程。
- 本文件的後台選單名稱可能隨 WordPress、Elementor 版本與語系略有不同（規格 §21）。以實際畫面為準，名稱不同時在紀錄的「備註」欄寫下實際名稱。
- 文中「外掛設定頁」指後台「Live 活動」選單下的「設定」；「部署資訊」與「建立建議頁面」是同一選單下各自獨立的子選單（建立建議頁面不在設定頁內）。

## 1. 前置條件

| 項目 | 確認 | 備註 |
|---|---|---|
| 管理者同意建立／使用 staging（規格 §14.1） | ☐ | 記錄同意人與日期 |
| 已有可用的 staging（主機既有功能或授權複製流程） | ☐ | |
| 本機已建置並檢查通過：`npm run build`、`npm run package`、`npm run check:artifact` | ☐ | |
| 取得 `artifacts/wg-live-<version>.zip` 與 `artifacts/wg-live-<version>.zip.sha256` | ☐ | |
| 能以管理者登入 staging，且看得到「外掛 → 安裝外掛」的上傳功能 | ☐ | 看不到時見 [PRODUCTION.md](PRODUCTION.md) 第 8 節「常見部署情況」 |
| 已知 staging 的 PHP、WordPress、主題、Elementor／Elementor Pro、WooCommerce 版本 | ☐ | 填第 2.6 節 |

## 2. 建立安全的 staging（規格 §14.1）

### 2.1 建立方式

優先順序：主機的 staging 功能 → 錄音室核可的複製流程。若由正式站複製，第 2.4、2.5 節是**必做**，且要在 staging 對外可被存取**之前**完成。

### 2.2 設定環境類型（必做）

外掛用 WordPress 的環境類型決定要不要顯示開發／示範面板（M1-PLAN D17）。staging 必須明確設成 `staging`：

1. 以 SFTP 或主機檔案管理員開啟 staging 的 `wp-config.php`。先備份這個檔案。
2. 在 `/* That's all, stop editing! Happy publishing. */` 這一行**之前**加入：

   ```php
   define( 'WP_ENVIRONMENT_TYPE', 'staging' );
   ```

3. 若 `wp-config.php` 已有 `WP_ENVIRONMENT_TYPE`，改值，不要重複定義。若主機用環境變數設定，確認它的值是 `staging`。
4. 儲存後，在外掛啟用後的「部署資訊」畫面確認環境類型顯示 `staging`（第 3 節）。

> 為什麼：從正式站複製的 staging 若沒設這個值，WordPress 會當成 `production`，開發面板會被關閉，你就無法在 staging 檢查狀態切換與錯誤情境。反過來，正式站**永遠不設**成 `staging`、`local` 或 `development`，也不要加 `WG_LIVE_DEV_TOOLS`。

開發面板的出現規則（驗收時要逐項確認）：

| 環境類型 | 面板 |
|---|---|
| `local`／`development` | 顯示 |
| `staging` | 僅對已登入且具外掛管理權限的使用者顯示；登出訪客與一般會員看不到 |
| `production` 或未設定 | 永遠不顯示，包含管理者預覽 |

### 2.3 存取限制

- staging 要有**實際的存取限制**：HTTP Basic Auth、主機的密碼保護功能，或 IP 白名單，三選一以上。
- 「不允許搜尋引擎索引」（設定 → 閱讀）和 `noindex` 只處理搜尋索引，**不提供存取保護**（規格 §14.1），不能單獨當作限制。
- 存取帳密只交給需要測試的人，不寫進這份文件、部署紀錄或 repository。

### 2.4 關閉會影響真實世界的功能（由正式站複製時必做）

| 項目 | 做法 | 確認 |
|---|---|---|
| 真實交易與付款 | WooCommerce 付款閘道改為測試／sandbox 模式，或停用付款閘道；staging 不接正式金鑰 | ☐ |
| 對外寄信 | 用主機的 staging 郵件攔截，或錄音室核可的方式停止對外寄信；確認訂單通知、會員通知不會寄到真實信箱 | ☐ |
| 付款 webhook | 在金流後台確認 webhook 網址沒有指向 staging；staging 不接收正式 webhook | ☐ |
| 會寫回正式服務的工作 | 停用排程（WP-Cron 的訂閱續扣、同步、備份上傳等）、第三方整合（CRM、庫存、物流、電子報）的寫入 | ☐ |
| 其他外部整合金鑰 | 清除或換成測試金鑰；staging 不放正式 API 金鑰 | ☐ |

做不到的項目就停下來問管理者，不要假設它不會動。

### 2.5 會員與訂單資料

依錄音室規則**移除或去識別化**會員與訂單資料。不要用真實會員帳號做測試。測試用的管理者帳號另建，用完即停用。

### 2.6 記錄版本與原站設定（規格 §14.1）

在「staging 通過紀錄」（第 9 節）頁首填寫。以下都從後台讀取，不要憑記憶：

| 項目 | 值 |
|---|---|
| staging 網址（存取限制的帳密不要寫） | |
| PHP 版本（工具 → 網站健康狀態 → 資訊 → 伺服器） | |
| WordPress 版本 | |
| 主題與版本（原站為 Astra） | |
| Elementor／Elementor Pro 版本 | |
| WooCommerce 版本 | |
| 目前首頁（設定 → 閱讀）與其 Page ID | |
| 目前頁首由誰管理（Astra Header Builder 或 Elementor Theme Builder） | |
| 主要選單名稱與選單位置 | |
| 快取與最佳化外掛／主機快取的名稱與版本 | |
| 已存在的頁面 slug：`live`、`listen`、`help` 是否已被占用 | |

staging 要使用獨立位置。不要把測試素材或除錯資料寫進正式網站。

## 3. 安裝外掛（規格 §14.2）

1. 驗證 ZIP。在本機（ZIP 所在資料夾）執行：

   ```bash
   sha256sum -c wg-live-<version>.zip.sha256
   ```

   Windows PowerShell 沒有 `sha256sum` 時：

   ```powershell
   (Get-FileHash .\wg-live-<version>.zip -Algorithm SHA256).Hash.ToLower()
   Get-Content .\wg-live-<version>.zip.sha256
   ```

   兩個值必須相同。不同就停下，重新取得 ZIP。

2. staging 後台：外掛 → 安裝外掛（新增外掛）→ 上傳外掛 → 選取 ZIP → 立即安裝 → **啟用**。
3. 啟用後先看有沒有 PHP 錯誤（畫面上的 Notice／Warning，或 `wp-content/debug.log`；`WP_DEBUG_DISPLAY` 應為 false，錯誤只寫入日誌）。
4. 一般頁面要能正常瀏覽：首頁、Store、商品頁、Account、Cart、Checkout 逐一打開，確認沒有白頁、沒有版面異動。
5. 開啟「部署資訊」，核對並記錄：

   | 項目 | 預期 | 實際 |
   |---|---|---|
   | 外掛版本 | 與 ZIP 檔名一致 | |
   | build commit 與三個檔案的 SHA-256 | 與本機 `build-info.json` 一致 | |
   | 環境類型 | `staging` | |
   | 部署模式 | `disabled`（外掛初始模式，不自動公開內容、不加選單） | |
   | 開發面板 | 顯示為啟用（僅對登入管理者） | |
   | 已綁定頁面 | 尚未綁定 | |
   | PHP、WordPress 版本；Elementor、WooCommerce、Astra 是否啟用 | 與第 2.6 節相符 | |

6. 在 `disabled` 狀態確認沒有公開內容：登出視窗開啟 `/wp-json/wg-live/v1/events`，應為空的 `events` 清單。

## 4. 建立三個頁面（規格 §14.3）

兩種做法擇一。**做法 A（建議）**：外掛設定頁的「建立建議頁面」會先顯示 slug 衝突預覽，確認後只建立**草稿**，不改既有頁面、選單或首頁。**做法 B**：手動建立。

三個頁面：

| 標題 | slug | 父頁面 | 預期路徑 | 放入的 shortcode（見第 5 節） |
|---|---|---|---|---|
| `Live` | `live` | 無 | `/live/` | `[wg_live view="events"]` |
| `Listen` | `listen` | Live | `/live/listen/` | `[wg_live view="player"]` |
| `Listening Guide` | `help` | Live | `/live/help/` | `[wg_live view="help"]` |

做法 B 步驟：

1. 新增父頁面 `Live`，slug `live`，**保存草稿**。
2. 新增 `Listen`，父頁面選 Live，slug `listen`，保存草稿。
3. 新增 `Listening Guide`，父頁面選 Live，slug `help`，保存草稿。
4. 在外掛設定頁綁定三個實際 Page ID（活動頁、播放頁、說明頁）。**Page ID 不要抄別的環境的值**，從頁面列表或編輯網址取得。
5. 確認產生的連結為預期的父子頁路徑，沒有與既有頁面重複。若 slug 已被占用，WordPress 會自動加 `-2`，要改掉原因而不是接受 `listen-2`。

記錄三個 Page ID 與永久連結。

## 5. Elementor 嵌入操作（規格 §14.4）

對三個頁面**各做一次**：

1. 開啟頁面的 Elementor 編輯器。
2. 頁面版型（Page Settings → Page Layout）選現站相容的 **Elementor Full Width**。它保留主題的頁首與頁尾。**不要選 Elementor Canvas**——Canvas 會移除頁首與頁尾（規格 §14.4）。
3. 若 Elementor 把原本的 shortcode 文字轉成「文字編輯器」元件，刪掉它。
4. 加入**一個 Shortcode 元件**，只放對應的那一行 shortcode：

   ```text
   [wg_live view="events"]
   [wg_live view="player"]
   [wg_live view="help"]
   ```

   每頁只放自己那一行。

5. 該 Shortcode 元件的 Advanced → Cache（部分 Elementor 版本顯示為 Element Cache）保持 **Default 或 Inactive**，不要設成固定快取時間。原因：shortcode 輸出含當下的活動資料與環境判斷，被元件快取後會顯示過期狀態，並可能保留別人的開發面板設定。
6. 不要貼入：整份 HTML 文件、PHP、會員密碼、串流來源 token、打包後的大段 JavaScript。播放器程式由外掛管理。
7. **標題只出現一次**。
   - 主題若自動輸出頁面標題（H1），元件內不要再用 H1，維持預設（`heading="h2"`）。
   - 若只在這三頁隱藏了主題標題，元件的標題要升為 H1：把 shortcode 改成 `[wg_live view="events" heading="h1"]`（`h1` 或 `h2`，預設 `h2`）。
   - 隱藏標題只針對這三頁設定，不改全站標題規則。
8. 版面：Elementor 外層容器與元件內層**不要同時加大幅 padding**，避免內容被雙重縮窄。原站一般內頁的內容寬度約 1140px、外層容器左右 padding 約 10px（量測紀錄見 `docs/implementation/design-baseline.md`）。
9. 原站使用透明頁首：檢查新頁的首屏內容有沒有被頁首蓋住、文字對比是否足夠。只調整新頁的設定（例如頁面頂部留白），不要改 Astra 或 Elementor 的全站設定。
10. 保存（更新）頁面，但**先維持草稿**，用預覽查看。

**不要做的事**：不改 Elementor Site Settings；不為單個按鈕重設整套設定；不複製頁首或頁尾到新頁。

## 6. 建立示範內容並切換模式

1. 在後台 Live 活動新增至少一場**明確標示的示範活動**：填寫標題、**代稱（slug）**、演出者、開始時間與時區、狀態、媒體類型（**影片**，預設值；示範活動會播放外掛內建的示範影片 `demo-video-1.mp4`／`demo-video-2.mp4`）、可用聆聽模式，勾選「示範活動」，來源類型選「示範」。代稱必須符合 `^[a-z0-9]+(?:-[a-z0-9]+)*$`（小寫英數與連字號）。不要讓 WordPress 從中文標題自動產生。
2. 同時建立一場「來源尚未設定」的活動，用來檢查「播放來源尚未開放」的畫面。
3. 外掛設定頁 → 站內連結覆寫：把「聯絡連結」設成本站的聯絡頁（例如 `https://<staging 網域>/contact/`）或核可的 `mailto:`。聯絡連結沒有自動值，不設定的話說明頁、停用畫面、取消活動與「無法確認觀看資格」畫面都不會出現聯絡連結（LINK-CHECKLIST 第 7、9、13 列會失敗）。儲存後到「部署資訊」確認網域警告為零。
4. 外掛設定頁：部署模式改為 `demo`，選取精選活動。
5. 預覽（草稿頁用預覽）三個頁面，逐頁確認。**草稿預覽的連結不完整**：頁面尚未發布時，站內連結不會輸出，所以活動頁顯示「查看活動資訊」而不是「體驗播放介面」連結，也沒有說明頁與返回連結。要測活動列表 → 播放的流程，直接開播放頁草稿的預覽網址並加上 `?wg_event=<代稱>`；連結完整性要等頁面發布後在登出視窗檢查。

> 切到 `demo` 並發布活動後，`/wp-json/wg-live/v1/events` 會公開示範活動的**公開欄位**（不含來源網址）。staging 有存取限制，這沒有風險；正式站要注意這一點（見 PRODUCTION.md 第 5 節步驟 7）。

## 7. 手機與預覽檢查（規格 §14.5）

| 檢查 | 做法 | 結果 |
|---|---|---|
| Elementor 響應式預覽 | 編輯器切換桌面／平板／手機，三頁各看一次 | |
| 真實手機 | 以實體手機開啟三頁的預覽網址（需通過 staging 存取限制） | |
| 編輯器內示範播放預設停止 | 在 Elementor 編輯器與預覽內載入頁面，**不會自動出聲**；來回編輯、重新繪製元件後也沒有重複聲音 | |
| 對話框層級 | 開啟「切換模式」對話框，應高於頁面內容，但不蓋住 WordPress 管理工具列的功能或全站安全介面；手機寬度為底部面板 | |
| 無橫向捲動 | 390px 與 1440px 寬度皆無橫向捲動 | |
| 管理工具列 | 登入與登出各看一次，控制列未被工具列遮住 | |

順序：**先完成活動與聆聽流程的樣式校準，再調整整站連結**；不為單個按鈕重設整個 Elementor Site Settings（規格 §14.5）。

## 8. 功能與整合驗收（staging 版）

自動化測試在開發機執行並留下紀錄；staging 負責只有真實 WordPress 才能驗證的項目。

| 編號 | 項目 | 在 staging 的做法 | 結果／證據 |
|---|---|---|---|
| F01 | 活動清單與無活動 | 有活動時顯示卡片；暫時取消發布全部活動時顯示空狀態 | |
| F02 | 直接開啟播放頁 | 貼上 `/live/listen/?wg_event=<代稱>`；再貼一個不存在的代稱，應顯示「找不到這場活動」與返回列表 | |
| F03／F04 | 選擇 Binaural／Atmos | 兩種模式各播放一次；畫面顯示「操作示範音訊，非 Binaural／Atmos 驗證素材」，不出現任何 Dolby 認證或設備連線宣稱 | |
| F05／F06 | 切換與快速連點 | 播放中切換、連點切換；只有一個聲音來源，「目前播放」在新來源成功後才更新 | |
| F07 | 暫停與恢復 | 狀態與聲音一致 | |
| F08／F09 | 網路失敗、自動播放被阻擋 | 開發面板注入失敗；有上限重試與手動重試，不無限轉圈；顯示「請點擊開始聆聽」 | |
| F10 | 無來源／取消／結束 | 以開發面板或活動狀態切換，各有文案與返回路徑 | |
| F11 | 重整／上一頁／直接貼連結 | 在播放中重整、返回、再前進；沒有 404、沒有殘留播放 | |
| F12 | 未知模式參數 | `?wg_mode=hifi` 被忽略，不載入任意網址 | |
| F13 | 後台編輯 | 修改活動保存成功；代稱留空、重複、格式錯誤時無法發布且有提示；無效時間／來源有驗證 | |
| F14 | Elementor 重新掛載 | 在 Elementor 預覽反覆編輯，只有一個媒體元素、沒有重複事件與聲音 | |
| F15 | 停用外掛 | 見第 8.1 節 | |
| 權限 | 開發面板規則 | 登入管理者可見；登出視窗、一般會員不可見；對照第 2.2 節表格 | |
| 快取 | 個人化資料不被共用快取 | 播放資格請求（`/wp-json/wg-live/v1/playback`）的回應標頭為不可快取 | |
| 回歸 | 整站不受影響（規格 §13.3） | 同一 viewport 比對 Homepage、Store、商品頁、Account、Cart、Checkout 的部署前後截圖；填 `evidence/test-results/manual-devices.md` 的 C 表 | |
| 連結 | 站內連結 | 依 [LINK-CHECKLIST.md](LINK-CHECKLIST.md) 在 staging 逐項檢查 | |

### 8.1 F15：停用外掛不破壞原站

1. 先把部署模式改回 `disabled`，把三個頁面改回草稿。
2. 外掛 → 停用 `wg-live`。
3. 開啟首頁、Store、商品頁、Account、Cart、Checkout，確認都正常。
4. 確認活動與頁面仍在（停用不刪內容）。
5. 重新啟用外掛，確認設定仍在。

> 若已在首頁或選單放了入口，停用前先移除，否則會殘留原始 shortcode 文字（見 [ROLLBACK.md](ROLLBACK.md)）。

## 9. staging 通過紀錄

複製這一節填寫，存成 `evidence/test-results/staging-pass-<日期>.md`（此目錄不進 ZIP）。

| 欄位 | 內容 |
|---|---|
| 外掛版本 | |
| Git commit | |
| ZIP 檔名與 SHA-256 | |
| 測試日期與測試者 | |
| staging 網址（不含帳密） | |
| 環境版本（PHP／WordPress／主題／Elementor／WooCommerce） | |
| `WP_ENVIRONMENT_TYPE` 實際值 | |
| 三個 Page ID 與永久連結 | |
| 通過項目（引用第 8 節編號） | |
| 未通過或有保留的項目 | |
| 自動化測試紀錄位置（單元／e2e／整合；未跑的要寫「未執行」） | |
| 人工裝置測試紀錄位置 | `evidence/test-results/manual-devices.md` |
| 已知限制 | M1 為示範音訊，非 Binaural／Atmos 驗證；不含真實驗票與播放授權 |
| 判定 | ☐ 通過，可進入正式部署　☐ 不通過 |
| 簽核人與日期 | |

通過標準：第 8 節所有「權限」「快取」「回歸」與 F01–F15 皆通過，或每個未通過項目有書面說明且管理者接受。
