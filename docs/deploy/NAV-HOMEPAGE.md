# NAV-HOMEPAGE：導覽、首頁與商店連結

依據：規格 §16.1–§16.4、M1-PLAN §7.5、§6.10。先在 staging 完整做一遍，再依 [PRODUCTION.md](PRODUCTION.md) 步驟 10 在正式站做。

原則：**只新增、不覆寫**。不重建整份 Header、不重新指派選單位置、不覆蓋首頁、不改 Elementor Site Settings。每一個改動都記進 [DEPLOY-RECORD.md](DEPLOY-RECORD.md) 的「被修改的頁面／選單」。

## 1. 先辨識頁首由誰管理（規格 §16.1）

原站觀察（量測紀錄見 `docs/implementation/design-baseline.md`）：頁首是 Astra Header Builder（`ast-hfb-header`），桌面有 7 個導覽項（Homepage、Biography、Portfolio、Video、Blog、Contact、Store 含子選單），手機為選單切換鈕。**這是 2026-10 的公開頁面觀察，部署時仍要在後台確認。**

| 檢查 | 做法 | 結果 |
|---|---|---|
| 是否有 Elementor Theme Builder 的 Header | Elementor → Templates → Theme Builder → Header，看有沒有啟用中的 Header 與其顯示條件 | |
| 是否為 Astra Header Builder | 外觀 → 自訂 → Header Builder，看 Primary Menu 元件 | |
| 頁首實際使用哪份選單 | Astra：Header Builder 的 Primary Menu 選用的選單；Elementor：Nav Menu 元件的 Menu 欄位 | |
| 選單位置 | 外觀 → 選單 → 管理位置，記下 Primary Menu 對應哪份選單 | |
| 手機選單是否用同一份選單 | 手機寬度檢查，或看 Header Builder 的 Mobile Menu 設定 | |
| 頁首是否為透明頁首 | 原站是透明疊在內容上，新頁首屏要避讓 | |

結論填入部署紀錄：「頁首由 ＿＿ 管理，使用選單 ＿＿」。

## 2. 主要選單：加入 Live 項目（規格 §16.1）

1. 外觀 → 選單，**選到第 1 節確認的那份選單**（不要新建空選單，也不要把主題的選單位置改指到另一份）。
2. 左側「頁面」面板，勾選已發布的 **Live** 頁面，按「加入選單」。用頁面項目，不要用自訂連結，這樣連結會跟著永久連結變動。
3. 選單項目名稱：`Live`。位置由錄音室決定，預設放在既有項目之後、不改動原有順序，也不動 Store 子選單。把位置記進部署紀錄。
4. 儲存選單。
5. 若 Elementor 導覽使用同一份選單，確認它讀到更新（重新整理前台）。若它是個別連結式導覽，只新增一個對應項目，**不重建整份 Header**。
6. 檢查：
   - 桌面：項目變多時沒有換行、沒有擠壓 Logo。
   - 手機：選單可開關，Live 項目點擊可達，返回與焦點合理。
   - Logo 與首頁項目的行為與以前相同（[LINK-CHECKLIST.md](LINK-CHECKLIST.md) 第 8 列）。

## 3. 首頁 Live 區塊（規格 §16.2）

### 3.1 先保存首頁版本

1. 設定 → 閱讀，確認目前的靜態首頁並記下其 Page ID。（公開 API 目前指向 page ID 8，仍以後台為準，不硬編碼。）
2. 在 Elementor 開啟首頁，**先不改任何東西**，建立可回復的版本：
   - 將首頁以目前狀態更新一次，讓 Elementor 在 History → Revisions 留下一筆；記下該版本的時間。
   - 在 Elementor 編輯器底部「更新」按鈕旁的箭頭 → 另存為範本（Save as Template），命名為 `首頁備份 <日期>`。
   - 擷取 1440 與 390 寬度的首頁全頁截圖。
3. 以上三項的位置寫進部署紀錄。

### 3.2 加入區塊

1. 在 Elementor Navigator 找到 **Music** 與 **Portfolio** 兩個相鄰章節。Live 區塊放在這兩個之間。
2. 複製（Duplicate）相鄰章節的容器作為起點，或新增容器並對齊其設定：使用**相鄰章節的容器寬度、標題層級和上下留白**。原站首頁是一連串全寬 Elementor 容器，章節之間有 20px 的空白容器；一般內頁內容寬度約 1140px。實際值以你在 Elementor 看到的相鄰容器為準，不要憑文件數字硬套。
3. 區塊標題 `Live`，層級與相鄰章節標題一致。
4. 加入一個 **Shortcode 元件**，內容：

   ```text
   [wg_live_featured]
   ```

5. 該 Shortcode 元件的 Advanced → Cache（部分版本為 Element Cache）保持 **Default 或 Inactive**，不設固定快取時間。
6. 區塊內容由外掛輸出，限制為：一場精選活動、海報、時間、簡短說明、主要按鈕。**不要**在首頁嵌入播放器、整個播放頁或 iframe；首頁不自動播放，不載入完整 Atmos／Binaural 串流。
7. 不要貼 HTML、PHP 或 JavaScript 到首頁。

### 3.3 沒有精選活動或功能停用時

| 情況 | 首頁應顯示 |
|---|---|
| 有精選活動 | 一張卡片：海報、標題（示範活動有「介面示範」）、時間與時區、簡短說明、主要按鈕 |
| 沒有精選活動 | 「線上音樂會資訊即將公布」並連到 Live |
| 部署模式 `disabled` | 只有文字，沒有按鈕 |

不應出現空白播放器或壞圖。三種情況都在 staging 切換並截圖。

> **若尚未公開本功能，不要在正式首頁放入口**，只保留核可的內部預覽（規格 §16.2）。沒有授權人同意前，這一節在正式站不做。

### 3.4 檢查

- 首頁的 Network：載入 `wg-live-featured.css?ver=…`，**沒有** `wg-live.js`，沒有音訊／影片請求。
- 首頁其他章節的字體、按鈕與容器沒有被改寫（對照第 3.1 節截圖）。
- 按鈕連到正確活動（有活動代稱的播放頁，或活動頁），沒有空來源自動播放。

## 4. 商品頁（規格 §16.3）

商品與活動的對應由**錄音室確認**。已有商品不是本場票券時，不建立假對應。

- M1 可以在該商品的說明加入「活動資訊與聆聽說明」連結（連到 Live 活動頁或 Help 頁），或在活動後台設定關聯商品，讓外掛在活動卡片上提供「購票」連結。
- **不修改**購買按鈕、商品價格、付款流程、WooCommerce 訂單狀態或所有商品共用的模板。
- 活動的商品連結：活動後台填商品 ID（已發布的 `product` 會用其永久連結），或填一個 http/https 商品網址。部署時確認它指向**正式站**商品，不是 staging。

## 5. 快取與最佳化外掛（M1-PLAN §7.5）

在 staging 與正式站都要設定一次，並在步驟 11 驗證。

| 項目 | 設定 |
|---|---|
| Elementor Shortcode 元件的 Advanced → Cache | 每個放 `wg_live` shortcode 的元件都維持 **Default／Inactive** |
| 延遲載入（delay JS）、合併（combine）、壓縮重排 | 將 `wg-live*.js` **排除**。外掛的 JS 以 `defer` 載入並在 DOM 就緒時掛載；被延遲到使用者互動才載入，會讓畫面停在骨架 |
| CSS 最佳化／合併／Critical CSS | 不要移除或改寫 `wg-live.css`、`wg-live-featured.css`；若有「未使用 CSS 移除」功能，把這兩個檔案排除 |
| 查詢字串版本 | **保留 `?ver=<hash>`**。不要啟用「移除資源的查詢字串」。外掛靠它在更新時繞過舊快取 |
| 頁面快取 | 活動公開介紹可以快取，但 `/live/` 活動列表與首頁精選卡是頁面載入時的快照（只有播放頁會輪詢狀態）。快取存活時間請設短（建議 5 分鐘內），並在每次修改活動狀態、時間或取消後手動清除 `/live/`、播放頁與首頁的頁面快取。`/wp-json/wg-live/v1/playback` 與任何含個人資格的回應不可被共用快取；確認快取外掛／CDN 沒有對 REST `playback` 路徑設定快取規則 |
| Service Worker／離線快取 | 不安裝會攔截整站請求的 Service Worker；不把串流分片或憑證放進自製快取 |

驗證方式：開啟 Live 三頁，Network 面板確認 `wg-live.js` 是原檔（未合併、未改名）、有 `?ver=`；關掉快取外掛的延遲功能後行為與開啟時一致。

## 6. Account 與登入（規格 §16.4）

- 所有登入按鈕回到現有的 WooCommerce Account 頁；不導向新的會員系統。
- 外掛啟用 WooCommerce 且 My Account 頁已發布時，一律採用該頁（規格 §10.4）；只有在 WooCommerce 不可用或該頁未發布時，才會使用外掛設定頁填的同網域 Account 網址。Store 連結同理（商店頁優先）。
- M1 的登入按鈕**不帶返回路徑**；不要加 `redirect_to` 網址，也不要為此改動 WooCommerce 登入流程。
- M1 讓登出訪客在公開示範中完整操作。這只是 demo 的規則，不代表有驗票。購票與入場狀態的真實顯示要等 M2 接入後端結果。

## 7. 完成後

1. 逐項執行 [LINK-CHECKLIST.md](LINK-CHECKLIST.md)，桌面與手機各一次。
2. 若出問題，只回復這次改動的部分：[ROLLBACK.md](ROLLBACK.md) 第 3 節。
