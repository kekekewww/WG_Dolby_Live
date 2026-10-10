# WG Studio Live：原站延伸設計、完整開發流程與 WordPress 部署規格

版本：1.0  
整理日期：2026-10-10  
適用網站：https://sounds.wgstudiomusic.com/  
文件用途：提供開發者或 Coding Agent 作為設計、實作、測試、交付與部署依據。  
本次交付：單一 Markdown 規格；本文件不代表已修改、安裝外掛或部署至正式網站。

---

## 0. 專案決策摘要

建立錄音室既有網站內的「Live／線上音樂會」專區。保留現站的品牌、頁首、頁尾、帳號、商店與付款流程；新增活動入口、模式選擇、播放介面、聆聽說明與活動管理。

**主要實作方案：WordPress 客製外掛 `wg-live`，透過 Elementor 的 Shortcode 元件嵌入現站頁面。前端採 TypeScript 與局部作用域 CSS，正式主機只接收編譯好的靜態資源與 PHP，不需要另外執行 Node.js 服務。**

觀眾可選擇「耳機 Binaural」或「家庭劇院 Dolby Atmos」。每次只啟用一個播放來源。錄音室供應內容與串流，你負責介面和平台整合。

目前先完成介面與部署。真正的購票驗證、播放授權、串流存取保護及家庭劇院端到端驗收，保留為下一階段。第一階段能發布活動介紹、操作示範與測試素材；未完成播放授權前，不把正式付費節目的公開來源放上示範頁。

### 0.1 原站觀察範圍與精確度

本次已讀取首頁、Biography、Portfolio、Video、Contact、Store、Account、會員商品頁、官方 Logo，以及 WordPress 公開 REST 根索引。這些資料可確認品牌素材、內容結構、既有站內路徑，以及 Astra、Elementor／Elementor Pro、WooCommerce 相關元件的公開線索。[S01] [S02] [S03] [S04] [S05] [S06] [S07]

**本次沒有取得可靠的完整桌面／手機渲染截圖、CSS 計算值或後台全域樣式設定。因此，文件不將任何未量測的字體、背景色、圓角或像素間距宣稱為現站數值。**第 3 節提供必做的樣式校準流程；實作時直接繼承現站主題與 Elementor 的既有樣式，降低自行猜測造成的落差。

本文件標示的「建議值」「暫定值」屬於新播放器的設計決策；原站已存在的設計設定具有較高優先權。無法立即取得後台時，先用繼承式樣板完成互動，精準視覺驗收在 staging 進行。

### 0.2 兩個完成里程碑

| 里程碑 | 可以宣稱完成的範圍 | 尚不包含 |
|---|---|---|
| M1：介面與站內部署完成 | 完整操作流程、活動後台、外掛安裝、原站整合、測試素材播放、站內連結、回復方案 | 正式驗票、串流防盜連、所有裝置的 Atmos 輸出保證 |
| M2：正式售票直播就緒 | 接入錄音室正式來源、有效票券判斷、播放授權、實機音訊驗收、直播負載與完整彩排 | 本文件不預先指定 DRM 或串流供應商 |

開發者不得因 M2 尚未定案而停下 M1 的工作，也不得把 M1 的完成報告寫成「正式付費直播已安全上線」。

---

## 1. 已知需求與工作邊界

### 1.1 已確定的需求

以下由專案需求提供，並非對網站後台的查核結果。

- 錄音室具備 Dolby 相關認證，以及即時渲染與直播串流能力。
- 錄音室負責現場設備、內容、演出與音樂／回放授權。
- 使用者負責播放平台與軟體整合。
- 觀眾分為耳機 Binaural 與多聲道家庭劇院 Dolby Atmos 兩類。
- 超過半數觀眾預期使用 Apple 系統，Safari 為優先驗收環境。
- 最多約 300 人同時在線；這是規劃目標，尚非容量測試結果。
- 沿用 WordPress 帳號與既有交易流程。
- 優先完成完整介面，之後再處理串流加密、權限與正式驗票。

### 1.2 第一階段必須交付

完整的活動入口、模式選擇、播放頁、FAQ／聆聽說明、活動與播放異常狀態、手機適配、示範音訊播放、WordPress 活動管理、安裝包、staging 驗收流程、正式站部署操作、首頁與導覽整合、回復紀錄。

### 1.3 第一階段暫不實作

不重建會員系統，不重做結帳，不另接新的金流，不開發音訊編碼器，不轉碼正式節目，不在瀏覽器自行解出 Atmos 物件，不製作原生 Apple TV App，不實作 DRM，不承諾家庭劇院設備認證。

聊天室、捐款、直播彈幕、座位圖、推薦演算法、跨頁背景播放器及多房間同時播放均排除在首版之外。

### 1.4 可以先用預設值推進的項目

未知是否有影片時，使用共用的媒體容器，支援「演出海報＋音訊」與「影片＋音訊」兩種布局。未知正式串流服務時，先使用 DemoAdapter；未知活動資料時，使用明確標示為「介面示範」的虛構活動，不挪用既有課程或會員商品當作直播票券。

---

## 2. 原站盤點與設計語言轉譯

### 2.1 可以直接確認的現況

| 原站證據 | 可確認內容 | 本專案採用方式 |
|---|---|---|
| 首頁公開站名 | 陳恩光個人官方網站 Nicolas CHEN Official | 保留站名，不以新平台名稱取代主品牌。 |
| 官方 `Logo_H.png` | 維光音樂／WG STUDIO 識別，使用鮮黃與較深黃金色的字樣 | 沿用既有 Logo 資產；新元件的品牌點綴與它協調。 |
| 主要導覽 | Homepage、Biography、Portfolio、Video、Blog、Contact、Store | 新增 Live，保留原項目及連結。 |
| Store 子選單 | Store、Cart、Checkout、Account | 不重複建立商店與帳號入口。 |
| 首頁內容順序 | 簡介、Music、Portfolio、Store、Topics、聯絡內容 | 延續分區展示與作品優先的資訊編排。 |
| Music 區 | Apple Music 與 Spotify 的嵌入內容 | 新增的直播播放器必須與既有音樂嵌入區清楚分工。 |
| 商店 | 已有音樂、課程、會員等商品 | 直播活動資料與商品連結分開管理。 |
| Account 頁 | 使用者名稱／Email、密碼、保持登入、忘記密碼 | 登入 CTA 連回原站 Account，不另造登入表單。 |
| 頁尾 | 公司資訊、聯絡、服務條款、隱私權政策 | 直接保留現站頁尾與政策連結。 |
| 公開 REST 根索引 | 出現 `astra`、`elementor`、`elementor-pro`、`wc` 等命名空間；站台時區為 Asia/Taipei | 以原站元件整合為主，正式版本與授權狀態仍由管理者確認。 |

資料來源：[S01] [S02] [S03] [S04] [S05] [S06]。公開索引不等於完整外掛盤點，不應從中推定所有付費功能均可使用。

### 2.2 新頁面的視覺方向

採取「專業音樂製作網站的直播專區」定位。以既有品牌、演出主視覺、清楚的中英標題和成熟的操作元件組成頁面。

外層頁面維持原站背景、文字與導覽系統；播放器內部可以使用低干擾的深色媒體舞台，作為功能性的新元件。這個深色區域是本專案的提案，不能延伸成全站換色或宣稱原站本來就是深色主題。

優先順序：**現站實測設計 → 現站全域樣式 → 官方品牌素材 → 本文件的新元件建議。**

### 2.3 必須延續的風格規則

1. Logo 使用原站媒體資產，維持比例，不重畫、不加發光描邊、不自行變更識別。
2. 頁首、頁尾、手機選單直接使用原站版本；客製元件不再製作一份。
3. 英文章節名稱延續原站習慣，例如 `Live`、`Listening Guide`；功能說明以台灣繁體中文為主。
4. 演出照片、封面與作品資訊維持主角位置，播放控制保持清楚而克制。
5. 新增資訊區塊的外緣、標題基線與按鈕尺度，要與原站相鄰區域對齊。
6. 品牌黃用於重點與選取狀態；錯誤、警告、連線狀態另有語意，不把所有提示都染成品牌色。

### 2.4 避免的設計

不套用與原站無關的科技藍紫漸層、霓虹 HUD、玻璃擬態卡片、全螢幕粒子背景、頻繁閃動的音訊動畫或仿影音訂閱平台的大型側邊欄。

不加入虛假的 Atmos 成功指示、假頻譜、假即時觀眾數、假曲目同步、假 Dolby 認證標章。沒有經確認的標章素材時，使用一般文字標籤即可。

---

## 3. 開發第一步：量測原站並建立設計基準

### 3.1 取得最小環境資料

由管理者在後台確認 WordPress、PHP、Astra／子主題、Elementor／Pro、WooCommerce 的實際版本；確認誰管理頁首、頁尾和主要選單；確認是否可安裝外掛、是否有 staging，以及哪些快取／最佳化機制會處理 CSS 和 JavaScript。

只記錄本專案需要的版本與功能，不要求匯出會員資料、訂單資料或密碼。正式部署權限尚未取得時，先完成本機外掛與操作示範。

### 3.2 以相同條件擷取基準畫面

用登出狀態的正常瀏覽器檢視首頁、Store、Account 與一個內頁。桌面至少使用 1440×1000 和 1280×900；手機至少使用 390×844 和 360×800。這些是本專案的取樣尺寸，非原站已量測斷點。

等待圖片與字體載入後，保存首屏、內容中段和頁尾。記錄透明／非透明頁首、捲動後頁首、展開的手機選單、按鈕 hover 和鍵盤 focus。另在登入狀態確認 WordPress 管理工具列不會壓住內容。

### 3.3 量測清單

| 項目 | 必須記錄的值 |
|---|---|
| 頁首 | 桌面／手機高度、Logo 寬高、上下留白、黏附行為、背景。 |
| 字體 | body、主標題、段落、導覽、按鈕的計算後 font-family、字級、字重、行高。 |
| 顏色 | 正文、次要文字、連結、按鈕、hover、頁面底、內容底、分隔線。 |
| 容器 | 實際最大寬度、兩側 padding、欄寬、欄間距。 |
| 形狀 | 按鈕及內容框圓角、邊框、陰影。 |
| 區塊 | 章節上下間距、標題與正文距離、圖片裁切比例。 |
| 響應式 | 導覽折疊點、單欄切換點、手機標題縮放。 |
| 字體來源 | 主題預設、系統字體或已獲授權的自託管字體；不把字體檔加入交付包。 |

### 3.4 可在瀏覽器 Console 執行的唯讀量測程式

以下程式只讀取目前公開頁面的元素樣式，不修改 DOM，不讀 Cookie，不傳出資料。執行前可依原站 DOM 調整 selector。`getComputedStyle()` 可用來取得計算後樣式。[S08]

```javascript
(() => {
  const targets = {
    body: 'body',
    header: '#masthead, header.site-header, [data-elementor-type="header"]',
    heading: '.entry-content h1, .entry-content h2, main h1, main h2',
    paragraph: '.entry-content p, main p',
    button: '.elementor-button, .woocommerce a.button, main button',
    menuLink: '#site-navigation a, header nav a',
    content: '#primary, main, .site-content .ast-container',
    footer: '#colophon, footer.site-footer, [data-elementor-type="footer"]'
  };
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const values = {};
  for (const [name, selector] of Object.entries(targets)) {
    const el = [...document.querySelectorAll(selector)].find(visible);
    if (!el) { values[name] = { missing: true, selector }; continue; }
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    values[name] = {
      selector,
      tag: el.tagName,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      color: s.color,
      backgroundColor: s.backgroundColor,
      padding: s.padding,
      margin: s.margin,
      borderRadius: s.borderRadius,
      border: s.border,
      boxShadow: s.boxShadow,
      maxWidth: s.maxWidth,
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  }
  const result = {
    path: location.pathname,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    values
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
})();
```

透明背景的計算值不代表實際畫面底色；遇到透明元素要檢查祖先背景、背景圖片與遮罩。這個程式只供取樣，不能代替肉眼檢查與手機截圖。

### 3.5 設計變數綁定規則

建立 `theme-bridge.css`，將原站實測樣式整理成 `.wg-live` 專用的變數。Elementor 具備全域色彩與字型機制；實際使用哪個全域項目，須在現站查核，不能假設名稱為 Accent 的項目就是品牌黃。[S09]

| 專案變數 | 值的取得方式 |
|---|---|
| `--wg-font-body` | 原站正文計算後字體。 |
| `--wg-font-heading` | 原站內頁主要標題字體。 |
| `--wg-text` / `--wg-text-muted` | 原站正文與次要文字。 |
| `--wg-link` | 原站正文連結，不直接以 Logo 色取代。 |
| `--wg-accent` | 確認後的品牌強調色；無現成值時另選與 Logo 協調、通過對比測試的色彩。 |
| `--wg-on-accent` | 與強調色配對的高對比文字色。 |
| `--wg-page-surface` / `--wg-border` | 原站內容底與分隔線。 |
| `--wg-content-max` / `--wg-gutter` | 原站內頁容器與兩側留白。 |
| `--wg-button-radius` | 原站主要按鈕圓角。 |
| `--wg-player-surface` / `--wg-player-text` | 新增媒體舞台的功能性色彩，獨立於全站背景。 |

所有 CSS 限制在 `.wg-live` 或 `.wg-live-featured` 中。不得改寫全域 `body`、`h1`、`button`、`a`，不得將 reset 或 Tailwind preflight 注入全站。不要為了讓 shortcode 看起來相似而全站停用 Elementor 預設字體或顏色。

### 3.6 新元件的暫定尺度

以下僅在原站沒有對應元件時使用，之後依實測結果校準。

- 內部間距以 4／8／12／16／24／32／48 px 為基礎。
- 主要播放按鈕觸控區建議 48×48 px 以上；次要操作區建議 44×44 px。
- 新增卡片可先使用 8 px 圓角；原站對應卡片樣式若明顯不同，優先匹配。
- 正文字級先使用 16 px，輔助資訊不低於 14 px；主要標題依原站標題階層調整。
- 過渡動畫建議 160–220 ms，只變更顏色、透明度或少量位移；減少動態偏好下移除非必要動畫。

**本節完成條件：有原站基準截圖、可追溯的取樣紀錄，以及「實測值／新設計值」分開的設計變數表。**

---

## 4. 站內架構、頁面與導覽

### 4.1 首版路徑

以下為建議的新路徑，尚未建立。建立前先檢查相同 slug 是否已被使用。

| 路徑 | WordPress 頁面 | 嵌入內容 |
|---|---|---|
| `/live/` | Live／線上音樂會 | `[wg_live view="events"]` |
| `/live/listen/` | Listen／直播聆聽 | `[wg_live view="player"]` |
| `/live/help/` | Listening Guide／聆聽說明 | `[wg_live view="help"]` |

播放頁使用 `?wg_event=活動代稱` 選擇活動，可選用 `wg_mode=binaural` 或 `wg_mode=atmos` 作為聆聽偏好。這些參數不包含帳號、票券、串流來源或播放授權，也不能更改權限。

使用普通 WordPress 頁面與子頁面，首版不增加 SPA 路由，也不讓 `/live/` 同時作為自訂文章類型 archive。重新整理、直接貼網址與瀏覽器上一頁都要正常。

程式內使用儲存的 Page ID 配合 `get_permalink()` 產生站內連結。部署到 staging 時不應仍連向正式網域。指定的 Page ID 在不同環境需重新綁定，不能沿用資料庫中的數字假設。

### 4.2 主要觀看流程

原站首頁或導覽 Live → 活動入口 → 選擇活動 → 選擇耳機／家庭劇院 → 點擊開始聆聽 → 播放或等待演出 → 必要時切換模式／重連 → 演出結束。

已購票、未購票和登入狀態在原型中可以模擬。正式購票前往既有商品頁；登入返回既有 Account。M1 不新建交易或變更商品的售價與付款狀態。

### 4.3 與現站連結的位置

主要導覽新增 `Live`。建議放在 Video 與 Blog 附近，最終依實際導覽可用空間決定。手機選單必須同步可達；保留 Store 子選單既有項目。

首頁新增精簡 `Live` 區塊，建議放在 Music 區與 Portfolio 區之間，讓現場活動與音樂展示相連。此位置是新設計提案，需用原站截圖確認節奏。可使用 `[wg_live_featured]`，避免在首頁載入完整播放器。

活動商品頁可新增「查看活動與聆聽說明」連結。尚未完成驗票時，不顯示「你已獲得觀看權」或把所有會員贊助者視為持票者。

Account 初期只需沿用原站入口；可增加指向 Live 的一般連結。具備實際票券查詢前，不建立看似有資料的「我的票券」假頁面。

---

## 5. 畫面逐頁規格

### 5.1 A：活動入口 `/live/`

依序顯示原站頁首、頁面標題、精選活動、聆聽方式說明、其他活動、FAQ 摘要與原站頁尾。

標題建議：`Live`，副標題「線上音樂會」。內文：「以耳機或家庭劇院，聆聽維光音樂的現場演出。」文案不得宣稱所有設備都可呈現 Atmos。

精選活動包含海報、標題、演出者、日期、時區、活動狀態、支援的聆聽模式與主要 CTA。只有一場活動時，不刻意補上多張假卡片；沒有活動時顯示完整空狀態。

主要 CTA 隨狀態調整：未開放時為「查看活動」、開放示範時為「體驗播放介面」、可進場時為「進入聆聽」、結束時為「查看活動資訊」。無回放來源時不顯示可點擊的回放按鈕。

初期活動簡介在本頁展開或以活動區塊呈現，不需要另外開發一套活動詳情路由。

### 5.2 B：模式選擇

在播放頁的第一步顯示兩個平等清楚的選項，桌面並排，窄螢幕直排。

**耳機聆聽 · Binaural**  
說明：「使用耳機聆聽錄音室製作的雙耳版本。」  
輔助說明：「一般耳機即可播放此版本；音訊效果依錄音室交付內容為準。」  
操作：「選擇耳機模式」。

**家庭劇院 · Dolby Atmos**  
說明：「適用於經確認的播放裝置、連接方式與 Atmos 家庭劇院。」  
輔助說明：「請先閱讀支援條件；選用 Atmos 音軌不等於系統已確認最終設備輸出。」  
操作：「選擇家庭劇院模式」。

用單選群組或等價的可及性語意呈現選擇，選取不能只靠顏色。確認後才載入所選來源。瀏覽器識別只能提供提示，不替使用者改變聆聽模式。

初次不自動開始播放。可在本機保存上次模式作為偏好，但不得保存票券資格或播放 token。

### 5.3 C：主要播放頁 `/live/listen/`

桌面由「主要媒體舞台」與「必要活動資訊」組成。活動說明較長時可使用側欄；播放控制保持在媒體舞台下方，不能分散在遠端角落。

手機依序為活動名稱與狀態、媒體舞台、主要播放控制、目前模式、切換模式、曲目／活動資訊、協助入口。

媒體區：有影片時使用影片容器；純音訊時使用海報、演出資訊與靜態視覺。純音訊不必強迫維持大片 16:9 空白，可改採封面與文字的緊湊布局。

必備控制：開始／暫停、可用時的靜音與音量、目前模式、切換模式、正在直播或等待中的狀態、可用時的返回直播、重試、播放說明。音量、全螢幕與投放按鈕由目前 adapter 能力決定；無法操作時不要做出假的控制。

文字狀態建議使用「已選擇：Dolby Atmos 音軌」或「目前播放：Binaural」。只有來源和實際播放狀態已確認時，才使用「目前播放」。禁止顯示未經驗證的「Atmos 已認證輸出」「7.1.4 已連線」或耳機／擴大機型號。

未提供曲目事件時只顯示靜態節目單，不將排程中的曲目稱為「正在演出」。未取得可靠時間資訊時，不顯示虛構的毫秒延遲。

### 5.4 D：播放中切換模式

點擊切換模式 → 開啟對話框或手機底部面板 → 顯示目前模式與另一個選項 → 說明切換可能短暫中斷 → 使用者確認 → 暫停舊來源並釋放資源 → 載入新來源 → 成功後更新目前模式。

切換失敗時保留舊模式資訊，允許重新載入原模式；不能把尚未成功的模式寫入「目前播放」。兩個來源使用不同時間軸時，不將舊的 `currentTime` 數字直接套到新來源。先以直播邊緣或供應方可用的共同時間資訊對齊。

家庭劇院模式失敗時明確提示，再提供「改用耳機 Binaural」選項；不在維持 Atmos 標籤的情況下默默更換音軌。

### 5.5 E：聆聽說明 `/live/help/`

內容至少包含兩種模式的差異、Safari 優先驗收說明、家庭劇院待驗證／已驗證連接方式、沒有聲音時的檢查、重新連線、模式切換，以及原站 Contact 入口。

家庭劇院相容表初始狀態為「尚待測試」，記錄裝置、作業系統、瀏覽器、輸出路徑、來源格式與測試日期。沒有實測就不填「支援」。Apple 的 HLS 範例可以用來驗證來源播放，但不能替代錄音室正式串流與觀眾硬體的端到端驗收。[S10]

### 5.6 F：示範狀態面板

本機與 staging 提供開發用面板，切換活動、播放與資格狀態，讓錄音室可以檢查整個操作流程。

正式站不輸出開發面板、模擬已購票選項或任意來源欄位。不能以公開的 `?paid=true`、`?admin=true` 或 `?debug=1` 改變真實播放條件。開發工具只在伺服器確認的開發環境／有權限預覽中啟用。

---

## 6. 狀態模型與錯誤文案

活動、播放器與觀看資格分開管理，避免一個大型旗標同時代表三件事情。

| 狀態軸 | 建議狀態 |
|---|---|
| 活動 | `scheduled`、`doors_open`、`live`、`intermission`、`ended`、`cancelled` |
| 播放器 | `idle`、`selecting`、`loading`、`playing`、`paused`、`switching`、`reconnecting`、`failed` |
| 觀看資格 | `unknown`、`guest`、`not_entitled`、`entitled`、`unavailable`；M1 原型可模擬，正式值由後端決定。 |
| 來源 | `not_configured`、`demo`、`hls`、`iframe` |

倒數到零只表示排定時間已到；是否正在直播，要由活動設定或後續串流狀態判定。介面不以觀眾本機時間直接宣告直播已開始。

| 情境 | 主要文案 | 操作 |
|---|---|---|
| 尚未開始 | 演出尚未開始 | 查看時間、聆聽說明。 |
| 等待入場 | 即將開放聆聽 | 保留模式選擇。 |
| 載入 | 正在連接音訊 | 不重複產生播放器。 |
| 播放被瀏覽器阻擋 | 請點擊開始聆聽 | 等待使用者操作，不無限自動重試。 |
| 斷線 | 連線暫時中斷，正在重新連線 | 有上限的重試、手動重試。 |
| 不支援來源 | 目前環境無法播放這個音訊版本 | 切換模式、查看說明。 |
| 尚未設定 | 播放來源尚未開放 | 查看活動資訊。 |
| 中場休息 | 演出中場休息 | 保留播放連線與目前模式。 |
| 活動結束 | 本場演出已結束 | 返回活動；只有確認有回放時才提供回放。 |
| 取消 | 本場活動已取消 | 活動公告、聯絡窗口。 |
| 後端資格不可用 | 暫時無法確認觀看資格 | 重試或聯絡；不自動放行正式來源。 |

重試策略由單一協調器管理。串流函式庫已有重試時，介面層不再同時建立另一組無限計時器。錯誤訊息可帶一般錯誤代碼，不能顯示原始憑證、完整私有 URL 或系統堆疊。

---

## 7. 響應式、可及性與動態

### 7.1 響應式規則

主要外層斷點繼承原站。新元件暫以 768 px 與 1024 px 作為布局調整候選，完成原站取樣後再決定最終值。

手機不依賴 hover，不把重要控制藏在滑鼠懸停才出現的區域。長活動名稱可自然換行，不能撐出橫向捲軸。模態面板使用動態視窗高度與安全區留白，測試橫向、軟體鍵盤及瀏覽器工具列變化。

不在每次畫面更新、倒數或開關說明面板時重建 `<audio>`／`<video>`，避免中斷播放。離開播放頁時明確停止播放；首版不承諾跨 WordPress 頁面的持續播放。

### 7.2 可及性目標

以 WCAG 2.2 AA 為驗收方向。一般文字對比至少 4.5:1；大型文字至少 3:1；必要的控制辨識與 focus 也要有足夠對比。44×44 px 是本專案偏向觸控的設計目標，不將它誤寫成所有 WCAG 2.2 AA 情境的統一最低尺寸。[S11]

使用語意化 button、fieldset／legend、標題階層、表單 label 與適當的狀態播報。對話框可用 Escape 關閉，關閉後焦點回原操作按鈕。狀態以文字配合視覺呈現，不能只使用紅綠燈。

播放器支援鍵盤；空白鍵捷徑只在合理的播放器焦點範圍作用，不能劫持整個網站的輸入。螢幕閱讀器不應每秒朗讀倒數或播放時間。

### 7.3 動態限制

採短時間的顏色、透明度與小幅位移過渡；不旋轉 Logo，不讓版面隨播放節奏跳動。需要載入動畫時保留穩定高度，支援 `prefers-reduced-motion`。沒有真實音訊分析資料時，不使用假頻譜當作播放成功證據。

---
## 8. 技術架構與程式邊界

### 8.1 固定採用的主方案

WordPress 負責頁面、網站外框、活動設定和既有帳號；`wg-live` 外掛提供 shortcode、前端設定及後台管理；前端元件負責觀眾操作；播放 adapter 負責媒體來源。未來的票券與授權 adapter 獨立接入。

Elementor 官方支援透過 Shortcode 元件呈現外掛內容；WordPress shortcode 適合把功能邏輯與頁面內容分開。[S12] [S13]

**本專案不需要先建立獨立網域、Vercel 專案、外部帳號資料庫或 headless WordPress。**這是根據目前範圍作出的架構選擇，並非否定將來擴充。

### 8.2 前端選型

使用 TypeScript、Vite、原生 DOM／HTML 與局部 CSS。互動以清楚的狀態模型與小型元件管理；首版不強制引入 React、全站 UI 框架或大型全域狀態函式庫。

Vite 用於本機開發及產生部署資源；可採 Library Mode 產出單一入口的 IIFE JavaScript 與 CSS，由外掛載入。建置設定應依實際鎖定版本的官方文件撰寫，不能假設不同主版的底層 bundler 設定完全一致。[S25]

部署產物不得引用 localhost、開發伺服器、未編譯 TypeScript 或不存在的 Node.js endpoint。

### 8.3 建議資料夾

```text
wg-live-project/
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ vite.config.ts
├─ .wp-env.json
├─ .gitignore
├─ src/
│  ├─ main.ts
│  ├─ components/
│  │  ├─ event-list.ts
│  │  ├─ mode-selector.ts
│  │  ├─ player-shell.ts
│  │  ├─ player-controls.ts
│  │  ├─ status-panel.ts
│  │  ├─ listening-guide.ts
│  │  └─ dialog.ts
│  ├─ state/
│  │  ├─ model.ts
│  │  ├─ reducer.ts
│  │  └─ transitions.ts
│  ├─ adapters/
│  │  ├─ demo.ts
│  │  ├─ native-media.ts
│  │  ├─ hls.ts
│  │  ├─ iframe.ts
│  │  └─ entitlement-placeholder.ts
│  ├─ styles/
│  │  ├─ theme-bridge.css
│  │  ├─ components.css
│  │  ├─ responsive.css
│  │  └─ accessibility.css
│  └─ fixtures/
│     └─ demo-events.ts
├─ plugin/
│  └─ wg-live/
│     ├─ wg-live.php
│     ├─ includes/
│     │  ├─ class-plugin.php
│     │  ├─ class-shortcodes.php
│     │  ├─ class-assets.php
│     │  ├─ class-events.php
│     │  ├─ class-settings.php
│     │  ├─ class-public-data.php
│     │  ├─ class-site-links.php
│     │  └─ class-playback-provider.php
│     ├─ templates/
│     │  ├─ events.php
│     │  ├─ player.php
│     │  ├─ help.php
│     │  └─ featured.php
│     ├─ assets/
│     │  ├─ dist/
│     │  └─ demo/
│     ├─ readme.txt
│     └─ uninstall.php
├─ scripts/
│  ├─ package.mjs
│  ├─ check-artifact.mjs
│  └─ seed-demo.php
├─ tests/
│  ├─ unit/
│  ├─ e2e/
│  └─ integration/
├─ evidence/
│  ├─ design-baseline/
│  ├─ screenshots/
│  └─ test-results/
└─ artifacts/
   └─ wg-live-<version>.zip
```

這是應完成的專案結構，並非聲稱本規格已附帶所有程式。資料夾可依實作合理合併，但三個 adapter 邊界、建置產物與部署包必須保留。

### 8.4 Shortcode 與資源載入

`[wg_live view="events|player|help"]` 只接受白名單中的 view。需要固定活動時可增加 `event` 屬性，值必須驗證為既有活動；不能從 shortcode 任意注入 script 或 iframe HTML。

PHP callback 回傳 HTML，不直接 `echo` 整頁文件；輸出包含元件容器與必要的非敏感設定。使用 WordPress 的 escaping 與 sanitization，避免直接輸出後台輸入。[S12]

以 `wp_enqueue_scripts` 註冊和載入資源，使用 `plugins_url()` 等方式產生檔案位置。只在已綁定的 Live 頁面、需要精選區塊的首頁，以及相關編輯預覽載入必要資源。[S15]

**不要只依賴 `has_shortcode($post->post_content)` 判斷 Elementor 頁面是否需要載入程式。**以外掛儲存的 Page ID 作為主要條件，並驗證 Elementor 編輯／預覽流程；若需要 widget render hook，再依現場版本補上。不要等到頁尾才發現 CSS 沒有載入，造成首屏閃爍。

首頁精選區塊只需要卡片與連結，不載入完整 HLS 函式庫。前端掛載應具冪等性，Elementor 預覽重繪時不重複建立事件監聽器或媒體實例。

### 8.5 三個必要接點

```typescript
type ListeningMode = 'binaural' | 'atmos';
type EventStatus =
  | 'scheduled' | 'doors_open' | 'live'
  | 'intermission' | 'ended' | 'cancelled';

interface PublicEvent {
  id: number;
  slug: string;
  title: string;
  performers: string[];
  description: string;
  startsAt: string;              // ISO 8601，含時區或以 UTC 儲存。
  displayTimezone: string;       // 預設 Asia/Taipei。
  status: EventStatus;
  posterUrl: string | null;
  mediaKind: 'audio' | 'video';
  availableModes: ListeningMode[];
  programme: string[];
  productUrl: string | null;
  replayAvailable: boolean;
  isDemo: boolean;
}

type PlaybackSource =
  | { kind: 'not_ready'; reason: string }
  | { kind: 'demo'; url: string; mimeType: string }
  | { kind: 'hls'; url: string; mode: ListeningMode }
  | { kind: 'iframe'; url: string; allowedOrigin: string };

interface EventProvider {
  list(signal?: AbortSignal): Promise<PublicEvent[]>;
  get(slug: string, signal?: AbortSignal): Promise<PublicEvent | null>;
}

interface PlaybackSourceProvider {
  resolve(eventId: number, mode: ListeningMode,
          signal?: AbortSignal): Promise<PlaybackSource>;
}

type EntitlementResult =
  | { status: 'guest' }
  | { status: 'not_entitled' }
  | { status: 'entitled' }
  | { status: 'unavailable'; reason: string };

interface EntitlementProvider {
  get(eventId: number, signal?: AbortSignal): Promise<EntitlementResult>;
}

interface PlayerCapabilities {
  playPause: boolean;
  volume: boolean;
  seekToLive: boolean;
  fullscreen: boolean;
  remotePlayback: boolean;
  reliablePlaybackEvents: boolean;
}
```

`PublicEvent` 不包含正式來源或憑證。`PlaybackSource` 是執行階段的資料契約；未來正式來源應在後端完成資格判斷後取得，不能跟公開活動清單一起送出。

M1 的 entitlement 實作在獨立示範情境可回傳固定假資料；正式播放 provider 尚未接入時回傳 `not_ready`，不可把「查不到結果」當作放行。

---

## 9. 播放 adapter 與 iframe 的實作規則

### 9.1 DemoAdapter：第一階段必做

使用錄音室提供且允許公開測試的素材，或可合法使用的自製測試音訊。必須有真正可操作的播放／暫停及錯誤狀態，不只用動畫假裝播放。

尚無 binaural 測試檔時可以使用一般立體聲，介面清楚標示「操作示範音訊，非 Binaural／Atmos 驗證素材」。切換到 Atmos 示例時仍須保留示範標記，不能把同一條普通音訊稱為已實現 Atmos。

### 9.2 原生 HLS 與 hls.js：接到來源後實作

Safari 路徑優先測試原生 HLS。其他瀏覽器可在原生不適用時評估 hls.js；hls.js 官方列出 EC-3 於 fMP4 容器的支援，但仍受執行環境解碼能力限制，因此前端函式庫存在不等於 Atmos 可用。[S20]

播放節點維持穩定；使用者操作後才播放，處理 `play()` 的拒絕結果。M1 可先完成 native test-media 路徑；HLS 和 iframe adapter 可保留清楚的未配置狀態，不能讓沒有供應商文件的整合阻擋其他介面完成。

同一頁同時最多一個活動中的 adapter。切換時停止舊媒體、釋放 HLS instance、移除不用的事件；網路面板確認另一條音軌沒有持續下載。短暫切換緩衝不代表全程接收雙音軌。

直播時間軸與 DVR 控制依來源能力顯示；無 DVR 時不提供任意拖曳回放。Media Session、AirPlay 或全螢幕按鈕均採功能漸進增強，不把無法驗證的能力寫成必然可用。

Atmos 路徑不為了繪製頻譜或增加效果而強制接入 Web Audio 混音／下混管線。先維持原生媒體路徑，額外處理需經音訊工程驗證。

### 9.3 iframe adapter：供應商已有完整播放器時使用

只允許管理者設定已核可的 HTTPS 播放器頁面，不提供觀眾任意貼網址的欄位。建立具 `title` 的 iframe，設定確實需要且經測試的權限；sandbox 與 permissions 不套用未驗證的通用字串。[S21]

如果供應商沒有 SDK 或 postMessage 控制介面，就使用 iframe 原有的播放控制；外層只能顯示活動資訊、來源選擇與說明。不能疊一套實際上無法控制 iframe 的播放鍵、音量或「播放中」狀態。

供應商有訊息協定時，檢查 `event.origin`、`event.source` 與訊息 schema，發送時使用明確的 target origin，不能使用不受限制的 `*`。[S26]

**嵌入能力有兩個不同檢查：**外部頁面是否允許被 frame 嵌入，以及播放器對影音來源的跨來源請求是否允許。CSP `frame-ancestors`／X-Frame-Options 與 CORS 是不同問題；開啟 CORS 並不會自動解除頁面拒絕嵌入。[S21] [S27]

iframe 的 `load` 事件只能表示框架載入流程，不能單獨證明供應商頁面可播放或 Atmos 已成功輸出。

### 9.4 能力偵測的產品原則

瀏覽器名稱作引導，功能偵測作選路，真實裝置測試決定支援清單。無法判斷時使用「尚未確認」，不要把未知顯示成「不支援」或「完全支援」。

耳機模式不因非 Safari 而擋入場；Atmos 模式顯示驗證範圍。連線錯誤、媒體解碼錯誤、權限錯誤分開處理，不能所有失敗都自動切換音軌。

---

## 10. WordPress 後台與內容模型

### 10.1 後台項目

新增「WG Live／直播活動」管理入口，包含活動清單、新增活動、平台設定與部署資訊。後台沿用 WordPress 管理風格，首版不另製作一套商業儀表板。

活動可使用自訂文章類型 `wg_live_event`，設定為後台可管理、沒有公開 archive，也不直接以 query var 暴露為另一條觀看路由。公開顯示由 Live 頁面讀取核可欄位。`register_post_type()` 支援分別控制管理介面、前台查詢與 rewrite 等行為。[S17]

### 10.2 活動欄位

| 欄位 | 必填與規則 |
|---|---|
| 活動標題、代稱 | 必填；代稱唯一。 |
| 演出者與簡介 | 可編輯；空值時不顯示空白標籤。 |
| 海報／影片 poster | 使用 WordPress 媒體選擇器與附件 ID；輸出相應尺寸。 |
| 開始時間、時區 | 日期時間需驗證；顯示明確時區，預設 Asia/Taipei。 |
| 活動狀態 | 採第 6 節的白名單。 |
| 媒體類型 | audio／video。 |
| 可用聆聽模式 | Binaural／Atmos；未配置來源可顯示即將開放。 |
| 節目單 | 項目清單；不自動視為即時曲目資料。 |
| 商品連結／商品 ID | 選填；確定是該場商品後才綁定，不改動商品或金流。 |
| 聆聽說明與聯絡入口 | 可使用共用設定。 |
| 回放資訊 | 預設關閉；開放前確認內容與有效期間。 |
| 示範標記 | 明確區分測試與正式內容。 |
| 來源類型與來源設定 | 僅後台可讀寫；M1 只啟用核可的示範素材。 |

### 10.3 全域設定

記錄活動列表／播放／說明頁面的 Page ID、首頁精選活動、原站帳號與商店連結、品牌樣式覆寫、部署模式與支援資訊。

首版部署模式只有 `disabled` 與 `demo`；正式來源接入在 M2 新增並經驗收啟用。所有變更都需管理權限與 nonce；後台表單驗證仍是 M1 的基本品質要求，與觀眾票券授權不同。[S18] [S19]

關鍵設定保留版本與更新時間。編輯活動不需要重新編譯前端，修改海報與節目單也不需要改程式。

### 10.4 資料輸出與整合原則

公開 API 僅傳回已發布、准許公開的活動欄位。私有來源、憑證與個人資料不透過公開 REST、HTML data attribute、JSON-LD 或前端建置變數輸出。

可以使用伺服器輸出的非敏感 JSON 啟動設定搭配明確範圍的 REST API。不得直接把完整 post meta 或所有 options 一次傳給前端。

登入連結優先使用既有 WooCommerce Account URL；WooCommerce 不可用時使用管理者設定的有效帳號頁。M1 無需存取訂單資料，更不以 Email 字串或會員角色推定已購票。

---

## 11. 本機環境與可重現建置

### 11.1 本機開發

採 Docker Desktop 配合 WordPress 官方 `@wordpress/env`，用來運行外掛整合環境。它適合建立可重現的 WordPress 開發環境；精確設定以實際鎖定版本文件為準。[S16]

建立乾淨 Git repository，先完成 package scripts、lockfile、PHP bootstrap 和最小可啟用外掛。Node、PHP 和 WordPress 的版本由環境盤點決定並記錄，不在正式站隨意升級來配合新程式。

以下是開發者需要落實的指令介面；必須先建立對應 scripts，不能在沒有 `package.json` 的資料夾宣稱可直接執行。

```bash
npm ci
npm run wp:start
npm run dev
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:e2e
npm run package
npm run check:artifact
```

`wp:start` 對應安裝在專案內的 wp-env；開發環境中安裝可合法取得的 Astra、Elementor、WooCommerce 相容版本。付費元件只使用錄音室授權提供的版本，不抓取未知來源。沒有 Pro 的本機環境仍可先完成 shortcode 與播放器功能，完整視覺在實際 staging 校準。

`.wp-env.json` 可以從最小配置開始：

```json
{
  "plugins": ["./plugin/wg-live"],
  "port": 8888,
  "config": {
    "WP_DEBUG": true,
    "WP_DEBUG_DISPLAY": false
  }
}
```

此範例未鎖定 WordPress／PHP，僅供功能起步。進入整合驗收前，必須依正式環境補齊相容版本與所需主題／外掛配置；不可把預設環境當作正式環境等價物。

### 11.2 PHP 與程式基本品質

所有 PHP 先通過語法檢查；採命名空間或 `wg_live_` 前綴，防止函式與外掛衝突。進入檔案檢查 `ABSPATH`。後台寫入具權限檢查、nonce、型別驗證及輸出 escaping。

無法載入建置資源時顯示管理提示與可讀的觀眾錯誤，不讓整站產生 fatal error。未知 shortcode 屬性、找不到活動、圖片失效、設定缺漏都要有明確結果。

外掛啟用只執行必要初始化，不自動修改主題、不自動加入公開選單，也不自動發布示範活動。需建頁時使用後台「建立建議頁面」按鈕，先預覽並確認既有 slug 衝突。

### 11.3 測試素材

使用檔案小、授權明確、音量適當的示範素材，不預設使用會嚇到觀眾的全音量測試音。測試用音訊及圖片要列來源，不夾帶正式演出母帶或字體檔。

示範活動的開始時間與狀態由 fixture 控制，避免幾天後展示時所有活動都過期。fixture 不寫入正式訂單或使用者資料。

---

## 12. 實作順序與每一步的交付

### 第 1 步：盤點與設計取樣

完成第 3 節。先記錄主題與全域樣式，再決定播放器新元件的設計變數。交付基準截圖、版本表、取樣紀錄及站內路徑清單。

### 第 2 步：建立可安裝外掛骨架

建立 bootstrap、shortcode、設定頁、資源載入和三個頁面容器。先在 WordPress 中看見空的 Live 專區，確認原站頁首／頁尾保留、一般頁面不受影響。

### 第 3 步：完成桌面與手機版靜態布局

建立活動頁、模式選擇、播放舞台、FAQ 與首頁精選區塊。使用相同元件與 CSS，不另做一份無法回接 WordPress 的靜態展示站。

### 第 4 步：完成全部互動與狀態

串起第 6 節狀態模型、鍵盤流程、對話框、切換模式、重試、空狀態、活動結束及演出取消。製作受限的示範狀態面板。

### 第 5 步：接入真正的示範媒體

讓 DemoAdapter 播放核可素材。確認只有一個來源活動、切換有釋放資源、離頁會停止、失敗不會造成無限重試。未有真 Atmos 測試素材時保留明確示範說明。

### 第 6 步：完成後台內容管理

活動新增／編輯、頁面綁定、海報、時間、節目單、FAQ、精選活動、示範模式都能保存。管理者修改內容後，前端能更新而無須重建程式。

### 第 7 步：staging 與原站樣式整合

將外掛安裝到相容 staging，使用 Elementor Full Width 或原站已使用的同等版型。完成設計取樣校準與 responsive 調整，逐頁確認登入／登出狀態。[S14]

### 第 8 步：測試與修正

執行單元、E2E、PHP、可及性與人工測試。先修復功能與整合問題，再處理非必要動畫。把已測與未測環境分開記錄。

### 第 9 步：建立發布包

產生 `wg-live-<version>.zip`，在乾淨 WordPress 測試安裝一次。確認包內只有執行所需檔案、合法示範素材與授權聲明。

### 第 10 步：正式站部署與站內連結

按第 15、16 節完成備份、安裝、頁面建立、原站導覽／首頁連結、快取處理與 smoke test。缺少正式站權限時交付已驗證 ZIP 與部署紀錄，不虛報完成。

### 第 11 步：M1 驗收與交接

管理者自行建立一場示範活動、修改封面與時間、從首頁進入並完成耳機／家庭劇院兩種模式的示範操作。交付版本、部署 URL、回復包、未完成事項與下一階段串流接點。

不需每完成一個按鈕都要求使用者確認；設計、UI 和本機測試可以連續完成。涉及正式站寫入、覆蓋既有頁面、公開發布和變更交易流程，必須具有對應授權。

---
## 13. 測試矩陣與品質要求

### 13.1 功能測試

| 編號 | 測試 | 通過條件 |
|---|---|---|
| F01 | 活動清單與無活動 | 有資料時正確呈現；無資料時有清楚空狀態。 |
| F02 | 直接開啟播放頁 | 有效活動可顯示；缺少活動或代稱錯誤可返回列表。 |
| F03 | 選擇 Binaural | 確認後載入單一示範來源，模式標籤正確。 |
| F04 | 選擇 Atmos | 正確顯示模式；示範素材保持標記，不宣稱真實 Atmos 輸出。 |
| F05 | 模式切換 | 舊來源停止，新來源成功後才更新「目前播放」。 |
| F06 | 快速連點／連續切換 | 不建立多個媒體實例；過期非同步結果不覆蓋最新選擇。 |
| F07 | 暫停與恢復 | 保留選定模式；操作與實際媒體狀態一致。 |
| F08 | 網路失敗 | 有上限重試與手動操作，不無限轉圈。 |
| F09 | 自動播放被阻擋 | 顯示開始按鈕，使用者可恢復操作。 |
| F10 | 無來源／活動取消／結束 | 各自有適當文案與返回路徑。 |
| F11 | 重整／上一頁／直接貼連結 | WordPress 路徑正常，沒有 SPA 404 或遺留播放。 |
| F12 | 未知模式參數 | 忽略或回模式選擇，不載入任意 URL。 |
| F13 | 後台編輯 | 修改資料可保存，無效時間／來源有驗證。 |
| F14 | 同頁重新掛載 | Elementor 預覽不造成重複事件與聲音。 |
| F15 | 移除或停用外掛 | 不破壞原站登入、商品、購物車與結帳。 |

### 13.2 瀏覽器與裝置

優先人工測試 iPhone Safari、iPad Safari、Mac Safari；再測 Windows Chrome／Edge／Firefox、Android Chrome 的介面與示範播放。記錄實際版本與日期，不以瀏覽器名稱代替測試紀錄。

Playwright 的 Chromium、Firefox、WebKit 用於自動化流程與布局回歸。**Playwright WebKit 並不是品牌 Safari 本身，也不能在 Linux 自動化環境中證明 Apple 硬體與 Atmos 輸出已正常。**官方文件對 WebKit 與 Safari 的關係有明確說明。[S28]

M2 家庭劇院測試表需要另記錄播放裝置、OS、瀏覽器、HDMI／AirPlay 等路徑、接收器、相關設定、來源格式及實際聽測結果。M1 此表可以保留空白或待測，不得補成全數通過。

手機測試至少包含鎖屏、切換 App、回到網頁、耳機連接變更、橫向，以及有／無 WordPress 管理工具列。M1 記錄真實行為，不保證所有系統都能背景播放。

### 13.3 設計與整合回歸

同一個 viewport 下比對部署前後的 Homepage、Store、商品頁、Account、Cart、Checkout 和 Live。除了刻意新增的入口，不應出現字體、按鈕或容器被外掛全域 CSS 改寫。

不要直接改動正式帳戶、真的付款或以正式訂單進行自動測試。測試交易只在錄音室核可的 staging／sandbox 流程中執行；M1 大多數回歸可不建立訂單。

### 13.4 效能目標

目標為新增元件不拖慢既有網站。首版核心 UI JavaScript 壓縮傳輸量暫以 100 KB 內、CSS 30 KB 內為工程預算，不包含後續才需要的 HLS 函式庫與媒體資料；超過時應提出實際量測和原因。

首屏海報依顯示尺寸輸出，不直接載入原始大圖；圖片有 width／height 或明確比例，避免布局跳動。播放器在使用者選擇並開始播放前不下載兩份媒體。

Core Web Vitals 目標採 LCP ≤2.5 秒、INP ≤200 毫秒、CLS ≤0.1；這些是 Google 公布的良好範圍，實際站點表現必須量測。原站既有負載與新增元件的增量分開報告，不能把實驗室一次測試當成真實使用者長期數據。[S24]

### 13.5 300 人的驗收界線

M1 測試頁面、靜態資源與活動資料請求。負載測試只在管理者核可的環境執行，逐步提升，不直接對正式站同時開 300 條串流。

M2 再確認供應商容量、每種音軌碼率、完整直播長度、播放器錯誤率與授權請求。300 人網頁載入成功不能證明 300 人 Atmos 直播已可承載。

---

## 14. staging 安裝與 Elementor 整合

### 14.1 建立安全的 staging

取得管理者同意後，使用主機既有 staging 功能或正式授權的複製流程。避免為了建立 staging 而直接安裝未知的整站搬移工具。

若由正式站複製，關閉測試站的真實交易、對外寄信、付款 webhook 和會寫回正式服務的工作；會員與訂單資料應依錄音室規則移除或去識別化。staging 需有實際存取限制，`noindex` 只處理搜尋索引，不提供存取保護。

記錄版本、原站導覽與頁面設定。staging 使用獨立位置，不把測試素材或除錯資料寫進正式網站。

### 14.2 安裝外掛

先在本機完成建置與檢查，產生 ZIP。在 staging 後台選「外掛 → 安裝外掛／新增外掛 → 上傳外掛」，選取 ZIP、安裝並啟用。WordPress 官方提供 ZIP 上傳與必要時的 SFTP 安裝方式。[S22]

啟用後先查看是否有 PHP 錯誤，再確認一般頁面能正常瀏覽。外掛初始模式為 disabled，不自動公開內容或加入選單。

### 14.3 建立三個頁面

1. 新增父頁面 `Live`，slug 為 `live`，先保存草稿。
2. 新增 `Listen`，父頁面指定 Live，slug 為 `listen`。
3. 新增 `Listening Guide`，父頁面指定 Live，slug 為 `help`。
4. 在外掛設定中綁定三個實際 Page ID。
5. 確認產生的連結為預期的父子頁路徑，不與既有頁面重複。

### 14.4 Elementor 嵌入操作

開啟指定頁面的 Elementor 編輯器。在 Page Layout 優先使用現站相容的 full-width 版型；若使用 `Elementor Full Width`，官方說明其保留主題頁首與頁尾。`Elementor Canvas` 會移除這些外框，本專案預設不使用。[S14]

每頁加入一個 Shortcode 元件，分別放入：

```text
[wg_live view="events"]
[wg_live view="player"]
[wg_live view="help"]
```

不要將整份 HTML 文件貼進 HTML 元件，也不要把 PHP、會員密碼、來源 token 或打包後的大段 JavaScript 貼入頁面內容。播放器程式由外掛管理。

確認頁面標題只出現一次；主題若自動輸出 H1，元件內配合調整。隱藏重複標題只針對這三頁設定，不變更全站標題規則。

Elementor 外層容器與元件內層不要同時加大幅 padding，避免內容被雙重縮窄。若原站使用透明頁首，檢查新頁首屏內容對比與避讓距離，只調整新頁設定。

### 14.5 手機與預覽檢查

在 Elementor 響應式預覽與真實手機都檢查一次。編輯器中的示範播放預設停止，避免編輯頁面時自動出聲。對話框的層級需高於元件內容，但不能任意蓋掉全站安全或管理介面。

先完成活動與聆聽流程的樣式校準，再調整整站連結；不要為單個按鈕重設整個 Elementor Site Settings。

---

## 15. 發布包、備份與正式站部署

### 15.1 ZIP 必須包含與排除的內容

ZIP 只有一層 `wg-live/` 根目錄，根目錄下直接有 `wg-live.php`。必須包含 PHP、templates、已建置的 JS／CSS、確實需要的合法示範素材，以及使用的第三方授權聲明。

排除 `node_modules`、`.git`、`.env`、原始資料庫、會員資料、正式串流憑證、測試錄影、Playwright 報告、內部截圖、字體檔與主機備份。來源碼與測試證據留在開發 repository，和可安裝 ZIP 分開。

建置時產生版本資訊與 SHA-256 檢查碼。前端資源使用版本或內容 hash 避免快取混用；不要在活動播放中任意刪除仍可能被舊頁引用的檔案。

### 15.2 正式部署前的清單

先確認有管理者授權、外掛安裝能力、可回復的檔案／資料庫備份、上一版外掛、staging 通過紀錄、部署時段及回復負責人。正式網站涉及持續新增訂單，部署應以最小變更進行。

**不要將 staging 的整份資料庫覆蓋正式站。**這次只部署外掛、核可的新頁面及必要設定，避免覆寫部署期間的新會員與新訂單。

記錄目前首頁、選單、Header／Footer template 和頁面版本。首頁目前的公開 API 指向 page ID 8，但部署時仍要在後台確認當前首頁，不能只依這份文件硬編碼。[S06]

### 15.3 正式部署順序

1. 建立並確認可使用的部署前備份，保存目前外掛及相關頁面／選單狀態。
2. 在核可時段上傳已於 staging 驗證的同一份 ZIP，核對版本和檢查碼。
3. 啟用外掛，保持 disabled；確認首頁、Store 與 Account 不受影響。
4. 建立三個草稿頁面，保留原站外框，放入對應 shortcode。
5. 將正式站的三個 Page ID 綁入外掛設定，不沿用 staging ID。
6. 選取正式站媒體庫中的核可圖片，重綁附件；確認沒有指向 staging 的圖片、FAQ 或商品連結。
7. 建立至少一筆明確示範活動，部署模式切為 demo，仍不放入正式付費來源。
8. 在草稿預覽完成管理者檢查，確認 desktop／mobile 及登入／登出效果。
9. 核可後發布 Live、Listen、Help 三頁；發布內容仍明確標示示範或尚未開放。
10. 執行第 16 節的導覽與首頁連結，不覆寫全站選單。
11. 清理相關頁面快取與 CSS／JS 最佳化快取，檢查實際資源網址和版本。
12. 使用登出視窗與實際手機完成 smoke test，確認所有 URL 使用 HTTPS。
13. 保存部署紀錄與已知限制，完成 M1 交付。

只有發布頁面時，不需重新部署整個 WordPress，也不需要切換主題。如果需要重建永久連結規則，只在確有路由變更時進行；不得在每次請求執行 rewrite flush。外掛的啟用／停用生命週期應依 WordPress 官方 hooks 管理。[S23]

### 15.4 常見部署情況

| 情況 | 正確處理 |
|---|---|
| 看不到「上傳外掛」 | 由具有適當權限的管理者安裝；不繞過權限，也不把 PHP 塞進文章。 |
| PHP 不相容 | 在 staging 修正程式或協商環境升級；不在正式站臨時升級試運氣。 |
| CSS 未更新 | 檢查版本、載入路徑、快取與 Elementor 生成資源；不先改全站樣式。 |
| 有雙重頁首 | 確認沒有自行複製 Header，檢查頁面版型與 Theme Builder 條件。 |
| shortcode 原樣顯示 | 檢查外掛是否啟用、名稱是否正確、是否用了 Shortcode 元件。 |
| 內容過窄 | 檢查 Elementor 外層容器與元件內層的雙重寬度／padding。 |
| 手機模式面板被遮住 | 檢查 stacking context、overflow 與安全區，不盲目加極大 z-index。 |
| iframe 空白 | 檢查供應商嵌入許可、框架限制與頁面狀態，不將問題一律歸因 CORS。 |
| HLS 在部分瀏覽器無法播 | 分辨來源封裝、編碼支援、跨來源請求、憑證及網路錯誤。 |
| 靜態頁面成功但正式站無聲 | 檢查是否實際載入正確 adapter、來源及使用者操作流程；不能只以畫面正常判定成功。 |

---

## 16. 導覽、首頁與商店連結操作

### 16.1 主要選單

先在後台確認目前頁首由 Astra 主題還是 Elementor Theme Builder 管理，並辨識它實際使用的選單。

若頁首採 WordPress 選單，於既有主要選單加入 Live 頁面的頁面項目，維持原有項目順序與 Store 子選單。若 Elementor 導覽使用同一份選單，確認它讀到更新；若是個別連結式導覽，只新增對應項目，不重建整份 Header。

桌面項目變多時先檢查是否換行或擠壓 Logo。手機選單另行測試點擊、返回與焦點。主題已設定的選單位置不要重新指派到另一份空選單。

### 16.2 首頁 Live 區塊

先保存首頁版本。使用原站相鄰章節的容器寬度、標題層級和上下留白，新增 `Live` 區塊，放入 `[wg_live_featured]` 或外掛提供的精選活動輸出。

區塊內容限制為一場精選活動、海報、時間、簡短說明和主要 CTA。沒有精選活動時，顯示「線上音樂會資訊即將公布」並連到 Live；不能留下空白播放器或壞圖。

首頁不自動播放，不載入完整 Atmos／Binaural 串流，不重複嵌入整個播放頁的 iframe。若尚未公開本功能，先不在正式首頁放入口，只保留核可的內部預覽。

### 16.3 商品頁

商品與活動的對應由錄音室確認。M1 可在商品說明加入「活動資訊與聆聽說明」連結，或由外掛在已綁定商品的適當位置呈現連結。

不修改購買按鈕、商品價格、付款流程、WooCommerce 訂單狀態或所有商品共用模板。已有商品不是本場票券時，不建立假對應。

### 16.4 Account 與登入

所有登入 CTA 回到現站 Account 頁。必要時在同源範圍內安全保存返回活動的路徑；不要直接相信任意 `redirect_to` 網址。

第一階段可讓登出訪客在公開示範中完整操作，但這只是 demo 的規則。正式驗票介面接入後，再根據後端結果顯示真正的購票與入場狀態。

### 16.5 連結驗收表

| 起點 | 終點 | 應檢查 |
|---|---|---|
| 桌面主導覽 Live | 活動列表 | 不換域、不 404、不開錯 staging。 |
| 手機選單 Live | 活動列表 | 點擊可達，選單能關閉，焦點合理。 |
| 首頁精選 CTA | 正確活動 | 活動代稱正確，沒有空來源自動播放。 |
| 活動頁登入 CTA | Account | 使用原站登入頁，不導向新會員系統。 |
| 活動頁商品 CTA | 正確商品 | 商品存在且已由錄音室確認。 |
| 播放頁聆聽說明 | Help | 保留清楚的返回活動方式。 |
| Help 聯絡入口 | Contact | 使用原站聯絡流程，不洩漏個人管理者資料。 |
| 全站 Logo／首頁項目 | 原站首頁 | 沿用原先行為，不被插件改寫。 |

---

## 17. 快取、基本安全與後續整合保留

這一階段不設計完整售票安全系統，但上線的基本網站安全與資料分離仍要完成。

活動公開介紹可以快取；個人化資格與未來播放授權不可被共用頁面快取。正式個人化功能接入時，需明確檢查快取例外，不只在 JavaScript 畫面上藏起資訊。

WordPress 不作為影音分片的 PHP 代理。核可示範或正式串流由適當的媒體服務提供；網站處理活動、頁面和後續少量授權請求。

不註冊會攔截整站請求的 Service Worker，不把 HLS 分片、憑證或會員資料放進自製離線快取。不把 WooCommerce 秘密金鑰放入 `VITE_*` 或其他會被編譯進前端的環境變數。[S25]

若 iframe／播放器需要跨網域權限，按實際來源設定白名單與必要政策；不全站放寬所有來源。未來 REST Cookie 驗證仍須處理 WordPress 的登入、nonce 與權限，不以存在某個前端旗標作依據。[S19]

M2 要接入的接點只有四類：錄音室播放 provider、票券 entitlement provider、播放 session／授權 provider，以及實際裝置驗證紀錄。介面應能接收其狀態，不需要為此重新設計頁面。

---

## 18. 回復、維運與日常操作

### 18.1 回復順序

若新版造成問題，先停用新增的公開入口或將播放模式切回 disabled；必要時暫時撤回新播放頁。若影響全站功能，停用 `wg-live` 並還原上一版已測試外掛，再檢查原站主要流程。

只回復這次修改的首頁區塊、選單與外掛設定。不要直接用舊的整份資料庫覆蓋正在產生新訂單的正式網站。只有經管理者確認資料差異與還原影響後，才考慮完整資料庫回復。

外掛停用不刪除活動與頁面；解除安裝也不預設刪除網站內容。需要清除本插件資料時另提供明確的管理者操作，不動原有會員、商品與訂單。

### 18.2 管理者日常操作

建立活動 → 填寫時間／演出者／海報 → 設定示範或待開放 → 選擇可用聆聽模式 → 預覽手機與桌面 → 選為首頁精選 → 發布活動資訊。

演出狀態可由管理者調整；介面若輪詢公開活動狀態，採合理間隔與失敗退避，不每秒向 WordPress 請求。計時顯示在前端更新即可，活動真實狀態以後端資料為準。

活動結束後，回放開放需由錄音室確認。沒有回放時仍保留活動紀錄與結束訊息，不顯示無效播放連結。

### 18.3 每次更新必留的紀錄

版本、Git commit、ZIP 檢查碼、staging 測試結果、正式部署時間、被修改的頁面／選單、部署者、備份位置、回復方式及未完成事項。公開報告中不列主機帳密或完整私有串流網址。

---

## 19. 最終驗收與交付清單

### 19.1 視覺

- [ ] 保留現站 Logo、頁首、頁尾與導覽行為。
- [ ] 使用已量測的原站文字、顏色、按鈕及內容寬度；未量測項目明確列為待校準。
- [ ] 新的播放器舞台與原站外框協調，沒有全站改色或樣式汙染。
- [ ] 桌面／手機都有完整布局，重要操作可達，沒有橫向溢出。
- [ ] 全部文字為台灣繁體中文，技術名稱保留正確英文。

### 19.2 功能

- [ ] 活動列表、模式選擇、播放、切換、斷線、取消、結束及空狀態完整。
- [ ] 示範媒體是真正可播放的素材，與實際 Atmos／Binaural 驗證分開。
- [ ] 未配置來源不造成錯誤循環或空白畫面。
- [ ] 同一時間只有一個實際播放來源。
- [ ] 沒有無法操作的假按鈕、假曲目同步或假設備能力資訊。

### 19.3 WordPress 整合

- [ ] ZIP 可以在乾淨環境安裝並啟用。
- [ ] 三個頁面、首頁精選與站內連結運作。
- [ ] 活動內容可透過後台更新。
- [ ] 已測試現有商店、商品、Account、Cart、Checkout 不被破壞。
- [ ] 既有頁首／頁尾沒有被複製出第二份。
- [ ] 正式站無 localhost、staging 路徑或開發面板。

### 19.4 部署與文件

- [ ] 已有 staging 通過紀錄和可回復的發布包。
- [ ] 正式站修改具有授權，且每一項實際操作都有紀錄。
- [ ] 已完成首頁、桌面選單、手機選單和相關活動連結。
- [ ] 尚未正式驗票時，發布內容維持示範／待開放，不暴露付費來源。
- [ ] 已提供版本、頁面 URL、管理操作、已測環境、回復方式及待接事項。

**M1 的完成定義：錄音室管理者能在既有 WordPress 後台管理活動；觀眾能從原站入口進入同風格的完整示範體驗；開發者能重現建置、部署與回復，並清楚區分尚未接入的正式直播能力。**

### 19.5 尚需補齊的資料及阻擋範圍

| 資料 | 未取得時可先做 | 真正阻擋的階段 |
|---|---|---|
| 原站完整截圖與精確樣式 | 依本文件作繼承式布局與全部互動 | 最終視覺一致性驗收。 |
| 外掛版本與 staging | 本機插件、示範與單元測試 | 原站整合及版本相容驗收。 |
| 正式站安裝與發布授權 | 完成 ZIP、部署步驟與本機／staging 結果 | 實際正式站寫入與公開。 |
| 活動海報、節目與時間 | 明確標示的示範內容 | 真實活動內容發布。 |
| HLS 或 iframe 測試來源／文件 | DemoAdapter、完整播放器殼與模式切換 | 真實串流 adapter 驗收。 |
| 票券規則與授權機制 | 資格狀態 UI、provider 邊界 | 正式付費節目開放。 |
| 家庭劇院設備與測試 | 說明頁、待驗證相容表 | 對外宣告特定 Atmos 路徑支援。 |

---

## 20. 給 Coding Agent 的執行指示

請以本文件為專案規格，先完成 M1。實際檢查原站與既有 repository，依第 3 節記錄可驗證的視覺數值；無法取得的項目使用繼承式樣板並明確記錄，不捏造觀察結果。依序建立可安裝的 `wg-live` WordPress 外掛、TypeScript 前端、局部 CSS、活動管理、完整狀態流程與 DemoAdapter。使用原站頁首／頁尾及 Elementor Shortcode 整合，不重新建立會員或金流，不修改父主題，不自行變更既有交易流程。完成桌面／手機布局、真實示範音訊播放、可及性與 WordPress 整合測試後，產生已包含建置資源的 ZIP 與可重現的安裝包檢查。具備授權時再部署 staging／正式站，建立 Live、Listen、Help 頁面，完成首頁與選單連結，保存回復資料。權限或來源尚未取得時，繼續完成不受阻擋的實作，不停留在計畫或靜態首頁；最終報告以「已實作」「已測試」「已部署」「尚待外部條件」分開列出，不能把計畫寫成已完成的操作。

---

## 21. 來源、查核日期與適用範圍

查核日期：2026-10-10。以下連結支援本文件的原站觀察與平台能力說明；畫面布局、路徑、架構、工程預算和執行步驟中的專案取捨，則為本規格的設計決策。WordPress／Elementor 的後台名稱可能隨實際版本與語系不同而略有差異。

| 代號 | 來源 | 用途 |
|---|---|---|
| S01 | [錄音室網站首頁][S01] | 公開站名、導覽、首頁內容順序及既有音樂嵌入。 |
| S02 | [官方 Logo 資產][S02] | 維光音樂／WG Studio 識別與可見品牌色；不代表已量測全站 CSS。 |
| S03 | [原站 Store][S03] | 既有商品與商店路徑。 |
| S04 | [原站 Account][S04] | 既有登入頁面與欄位。 |
| S05 | [原站會員商品][S05] | 已有會員商品；不等於已確認直播票券機制。 |
| S06 | [WordPress 公開 REST 根索引][S06] | 元件命名空間、首頁設定與時區的公開線索。 |
| S07 | [原站 Biography][S07] | 內頁內容、共用導覽、Logo 與頁尾連結。 |
| S08 | [MDN：getComputedStyle][S08] | 取得元素計算後樣式的能力。 |
| S09 | [Elementor：Global Style][S09] | 全域樣式機制。 |
| S10 | [Apple：HLS Examples][S10] | HLS 與音訊測試來源範例。 |
| S11 | [W3C：WCAG 2.2][S11] | 可及性驗收依據。 |
| S12 | [WordPress：Shortcodes][S12] | Shortcode 行為與輸入／輸出基本原則。 |
| S13 | [Elementor：Shortcode Widget][S13] | 頁面中嵌入外掛 shortcode。 |
| S14 | [Elementor：Full Width][S14] | 保留頁首／頁尾與 Canvas 的差異。 |
| S15 | [WordPress：wp_enqueue_script][S15] | 資源載入、版本與依賴。 |
| S16 | [WordPress：wp-env][S16] | 本機 WordPress 開發環境。 |
| S17 | [WordPress：register_post_type][S17] | 活動後台的自訂文章類型。 |
| S18 | [WordPress：Settings API][S18] | 管理設定機制。 |
| S19 | [WordPress REST：Authentication][S19] | 既有登入 Cookie、nonce 與權限。 |
| S20 | [hls.js 官方 repository][S20] | HLS 播放、容器／編碼支援及執行環境限制。 |
| S21 | [MDN：iframe][S21] | 嵌入、權限與跨來源限制。 |
| S22 | [WordPress：Manage Plugins][S22] | ZIP／SFTP 安裝、更新與備份注意。 |
| S23 | [WordPress：Activation / Deactivation Hooks][S23] | 外掛生命週期與初始化。 |
| S24 | [Google web.dev：Web Vitals][S24] | LCP、INP、CLS 指標範圍。 |
| S25 | [Vite：Building for Production][S25] | 正式建置、Library Mode 與靜態環境變數。 |
| S26 | [MDN：postMessage][S26] | 跨框架訊息與來源驗證。 |
| S27 | [MDN：CORS][S27] | 跨來源 HTTP 請求與存取條件。 |
| S28 | [Playwright：Browsers][S28] | 自動化瀏覽器與 Safari／WebKit 的差異。 |

另已讀取的原站公開頁面：[Portfolio](https://sounds.wgstudiomusic.com/portfolio/)、[Video](https://sounds.wgstudiomusic.com/video/)、[Contact](https://sounds.wgstudiomusic.com/contact/)。本次未登入後台、未更改選單、未新增頁面、未操作購物車或訂單。

[S01]: https://sounds.wgstudiomusic.com/
[S02]: https://sounds.wgstudiomusic.com/wp-content/uploads/Logo_H.png
[S03]: https://sounds.wgstudiomusic.com/store/
[S04]: https://sounds.wgstudiomusic.com/my-account/
[S05]: https://sounds.wgstudiomusic.com/product/%E6%9C%83%E5%93%A1%E8%B3%87%E6%A0%BC%E8%B4%8A%E5%8A%A9%EF%BC%88%E4%B8%80%E5%B9%B4%EF%BC%89/
[S06]: https://sounds.wgstudiomusic.com/wp-json/
[S07]: https://sounds.wgstudiomusic.com/biography/
[S08]: https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle
[S09]: https://developers.elementor.com/docs/editor-controls/global-style/
[S10]: https://developer.apple.com/streaming/examples/
[S11]: https://www.w3.org/TR/WCAG22/
[S12]: https://developer.wordpress.org/plugins/shortcodes/
[S13]: https://elementor.com/help/shortcode-widget/
[S14]: https://elementor.com/help/full-width-not-working/
[S15]: https://developer.wordpress.org/reference/functions/wp_enqueue_script/
[S16]: https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/
[S17]: https://developer.wordpress.org/reference/functions/register_post_type/
[S18]: https://developer.wordpress.org/plugins/settings/settings-api/
[S19]: https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/
[S20]: https://github.com/video-dev/hls.js
[S21]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
[S22]: https://wordpress.org/documentation/article/manage-plugins/
[S23]: https://developer.wordpress.org/plugins/plugin-basics/activation-deactivation-hooks/
[S24]: https://web.dev/articles/vitals
[S25]: https://vite.dev/guide/build
[S26]: https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
[S27]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
[S28]: https://playwright.dev/docs/browsers
