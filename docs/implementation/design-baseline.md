# 原站設計基準（Spec §3.2–§3.5）

- 日期：2026-10-10
- 對象：https://sounds.wgstudiomusic.com/ （正式站，登出狀態，唯讀）
- 規格依據：`WG_Studio_Live_Design_and_WordPress_Deployment_Spec.md` §0.1、§3.2–§3.5
- 量測程式：`scripts/measure-site.mjs`（`npm run measure:site`）；原始證據：`evidence/design-baseline/`

標記規則（嚴格區分，§0.1 / §3.5）：

- **實測**：由瀏覽器 `getComputedStyle`、`document.styleSheets`、`document.fonts` 或圖片像素直接讀到的值，附證據檔。
- **截圖目測 / 截圖像素**：從截圖（WebP）讀到、非 CSS 計算值，精度較低，已單獨標明。
- **新設計值**：本專案為新元件提出的值，**不是**原站數值，須在 staging 驗收後才可定案。
- **待校準**：原站沒有可量測的對應值，或需管理者／後台確認。

---

## 1. 方法與環境

- 工具：Playwright 1.64.0（`@playwright/test` 匯出的 `chromium`、`webkit`），headless。Chromium 156.0.8078.4；WebKit 為 Playwright 內建版本。
- 條件：登出、無 Cookie、不點擊任何連結／表單／購物車／橫幅。**唯一的點擊**是 390／360 寬度下的「選單切換鈕」（只為展開手機選單截圖）。
- 每頁流程：`goto(load)` → `document.fonts.ready` → networkidle（最長 8 秒）→ 1.2 秒 → 逐屏捲動一次（讓 lazy image／Elementor 進場動畫就位）→ 回頂部 → §3.4 量測（含延伸目標）→ 首屏截圖 → （僅桌面 Chromium）Tab 鍵 4 次記錄 focus 樣式、對 5 類元素 hover 前後各讀一次 → 捲到 50% 重讀頁首並截圖 → 捲到底截圖 → 若選單切換鈕可見則點擊一次並截圖。
- 節流：循序執行，每頁之間 2 秒。
- 唯讀範圍：只讀計算樣式、CSS 規則（含 `@font-face`、`@media` 條件）、`:root`／`body` 上的自訂屬性、圖片像素（`fetch` 同源 logo → `OffscreenCanvas`）。不改 DOM、不讀 Cookie、不送出資料。
- 手機視窗使用 `isMobile` + `hasTouch`，DPR 2；桌面 DPR 1。
- 未涵蓋：登入狀態（WordPress 管理工具列是否壓住內容，§3.2 要求）未檢查；本次嚴格登出，須在 staging 另行確認。

### 1.1 實際擷取的頁面 × 視窗

| 頁面 | 1440×1000 Chromium | 1280×900 Chromium | 390×844 Chromium | 360×800 Chromium | 1440×1000 WebKit | 390×844 WebKit |
|---|---|---|---|---|---|---|
| `/` (home) | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取（見限制 3） |
| `/biography/` | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 |
| `/store/` | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 |
| `/my-account/` | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 |
| `/contact/` | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 | 已擷取 |

共 30 組（全部 HTTP 200、無錯誤），每組一個 JSON 與 first／mid／footer 三張 WebP；390／360 寬度另有 `-menu.webp`（共 15 張）。檔名：`evidence/design-baseline/<page>-<w>x<h>-<browser>.json`；頁名為 `home`、`biography`、`store`、`my-account`、`contact`。執行紀錄：`evidence/design-baseline/_run-log.json`。

**限制與誠實揭露**

1. **補跑**：首輪完整跑完 30 組後，發現程式的「區塊」根節點選錯（只列出單一外層容器）、且沒有對「非當前頁」導覽連結做 hover。修正程式後，又重跑了 5 頁 × 1440×1000 Chromium；之後為了確認 logo 為何顯示成白色，再重跑 `home` 的 1440×1000 與 390×844 Chromium。因此這 5＋2 組的檔案為較新版本（覆蓋舊檔），其餘視窗的 `sections` 欄位只有單一外層容器（不可用，區塊間距一律以 1440 版本為準）。這超過「每頁每視窗一次」的原則，對正式站多出約 8 次公開頁面 GET（含補跑前一次只跑 `home` 的試跑），間隔皆 ≥2 秒。
2. **Hover**：只在桌面 Chromium 量測；「當前頁」的導覽連結因已是黃色而看不出變化，改以第二個導覽連結（`primaryNavLink2`）與各頁結果交叉確認。
3. **WebKit 390×844 `home`**：暖身捲動後未回到頂端（`header.scrollY = 3334`），頁首位置幾何欄位不可用；字型、顏色等計算樣式與 Chromium 一致（WebKit 與 Chromium 的 10 組比對（5 頁 × 1440／390），除 `html` 的預設字型名稱與 23.8／23.799999px 的浮點差外無差異）。
4. **Console 程式的 selector**：`h1` 在五頁皆不存在（站上主標題是 `h2`），所以 `h1` 量測為 missing；`link`（內文連結）在 `/`、`/biography/`、`/store/` 不存在。

---

## 2. 實測值（§3.3）

數值皆為 1440×1000 Chromium，除非另註；手機值取 390×844。「證據」欄為 `evidence/design-baseline/` 下的檔名（省略 `.json`）。

### 2.1 技術背景（§3.1 的公開線索，非後台確認）

| 項目 | 值 | 來源 |
|---|---|---|
| 主題 | Astra 4.14.0（body class `astra-4.14.0`、`wp-theme-astra`），子主題 `astra_wgm-studio`；Astra Addon 4.13.10 | `home-1440x1000-chromium` `bodyClasses` |
| Elementor | 4.3.2（`meta generator`）；Kit ID 21（`elementor-kit-21`）；已啟用 `additional_custom_breakpoints`、字型 `font_display: swap` | 同上 `generator`、`bodyClasses` |
| 其他 | Site Kit by Google 1.189.0、WooCommerce、WPForms（表單 ID 188） | 同上 |
| 頁首模式 | `ast-theme-transparent-header`、`ast-primary-sticky-enabled`、`ast-inherit-site-logo-transparent` | 同上 |
| 前台頁尾／頁首由誰管理 | 頁首為 Astra Header Builder（`ast-hfb-header`）；頁尾 `footer#colophon.site-footer`（Astra） | `header`、`footer` 目標 |

### 2.2 頁首

| 項目 | 桌面（1440／1280） | 手機（390／360） | 證據 |
|---|---|---|---|
| 頁首高度 | `header#masthead` 82.86px（內層 `.ast-primary-header-bar` 83px） | 80px | `home-1440x1000-chromium`、`home-390x844-chromium` |
| 定位 | `header#masthead`：`position:absolute; top:0; z-index:99`，疊在內容上（透明頁首） | 同左 | 同上 `header.position` |
| 背景 | masthead 透明；內層 bar `rgba(0, 0, 0, 0.39)`；下方是頁面深色背景圖 | 同左 | 同上 `header.bar.backgroundColor` |
| 捲動後 | 內層 bar 變 `position:fixed`（黏附），仍為 `rgba(0,0,0,0.39)`，加 `box-shadow: rgba(36,50,66,0.075) 0 2px 10px 0`；高度不變 83px（桌面）／80px（手機） | 同左 | `home-1440x1000-chromium` `headerAfterScroll` |
| 邊框 | 無（`border-bottom: 0px`） | 同左 | `header.bar.borderBottom` |
| Logo（桌面） | `img.custom-logo`，檔案 `Logo_H-1536x417.png`，自然尺寸 1439×390（1440 版）／1280×347（1280 版，因 srcset 選圖不同）；HTML `width=1950 height=530`；呈現 **180×48.86px**（`max-width:180px`） | — | `home-1440x1000-chromium` `header.logo` |
| Logo（手機） | — | `img.ast-mobile-header-logo`，檔案 `Logo_WG.png`（另一張方形版），呈現 **45×34.88px** | `home-390x844-chromium` `header.logo` |
| Logo 上下留白 | 上 17px／下 17px | 上 22.56px／下 22.56px | 同上 |
| Logo 左側留白 | 35px | 20px | 同上 |
| Logo 色彩處理 | 檔案本身為黃色，被 Astra 的 SVG 色彩濾鏡 `filter: url(#ast-img-color-filter)` 轉為白色顯示 | 同左 | `header.logo.cssFilter` |
| 導覽 | 7 個可見項（Homepage／Biography／Portfolio／Video／Blog／Contact／Store▾） | 0 個可見；選單切換鈕 49×49px（`button.menu-toggle.main-header-menu-toggle`） | `navigation` |
| 手機選單展開 | — | 全寬白色面板（`rgb(255,255,255)`），自 y=80 起，390×357px，7 列、每列 51px 高；連結 17px／400／`#334155`；當前項 `#c2a903` 字、`#f0f5fa` 底；切換鈕展開後變 ×，邊框 `1px dotted #f0f5fa` | `home-390x844-chromium` `menuOpen`、`-menu.webp` |

注意：站上另有固定在視窗**底部**的「Backer Plan」橫幅（黃底 Poppins 600 標題＋深藍 `#1e293b` 底資訊列，可關閉）。**截圖目測**：桌面約佔底部 80px（y=920–1000），手機約佔 190px。這是原站元件，非頁首；新播放頁的底部固定控制列須避免與它重疊。其計算值未記錄。

### 2.3 字體

| 項目 | font-family | 字級／行高 | 字重 | 其他 | 證據 |
|---|---|---|---|---|---|
| `body`（Astra） | `Karla, sans-serif` | 17px／28.05px（1.65） | 400 | letter-spacing normal | `home-1440x1000-chromium` `values.body` |
| Elementor 段落 `p` | `"Noto Sans TC", sans-serif` | 17px／28.05px | **200** | — | `biography-1440x1000-chromium` `values.paragraph` |
| Elementor 主標題（站上實際用 `h2`，無 `h1`） | `"Noto Sans TC", sans-serif` | 38px／49.4px（桌面）；**28px／36.4px**（390 與 360） | 500 | — | `values.h2`；`*-390x844-chromium`、`*-360x800-chromium` |
| 卡片／文章標題 `h3`（首頁） | `"Noto Sans TC", sans-serif` | 18px／23.4px | 500 | — | `home-1440x1000-chromium` `values.h3` |
| `/my-account/` 標題 `h2`（WooCommerce，非 Elementor） | `Rubik, sans-serif` | 38px／49.4px | 700 | margin-bottom 57px | `my-account-1440x1000-chromium` |
| 導覽連結 | `Karla, sans-serif` | 17px／80px（行高等於 bar 內高） | 400 | 無 text-transform | `values.primaryNavLink` |
| Elementor 按鈕（首頁「Read more ..」） | `"Noto Sans TC", sans-serif` | 15px／15px | 400 | 白字、透明底、邊框 `rgb(255,255,255)`、圓角 3px、尺寸 137×41 | `home-1440x1000-chromium` `values.button` |
| Elementor 按鈕（Biography「介紹資訊」） | `"Noto Sans TC", sans-serif` | 25px（桌面）／18px（手機） | 700 | letter-spacing 8.5px（桌面）／5.1px（手機）；尺寸 201×44 | `biography-1440x1000-chromium` |
| WooCommerce 按鈕（加入購物車） | `"Noto Sans TC", sans-serif` | 16px／16px | 400 | padding 15px 30px；140×46 | `store-1440x1000-chromium` `values.wcAddToCart` |
| 表單送出（WooCommerce 登入／WPForms） | `Karla, sans-serif` | 16px（WC）／17px（WPForms） | 500 | — | `my-account-…`、`contact-…` `values.formSubmit` |
| 商品標題 | `"Noto Sans TC", sans-serif` | 17px／22.1px | 500 | margin-bottom 8.5px | `store-…` `values.wcProductTitle` |
| 價格 | `"Noto Sans TC", sans-serif` | 15.3px／19.89px | 500（`/store/`）；700 且黃色（首頁卡片） | — | `values.wcPrice` |
| 表單輸入 | `Karla, sans-serif` | 16px | 400 | — | `values.formInput` |
| 表單標籤 | `Karla, sans-serif` | 15.3px（WC，600）／18px（WPForms，700） | 600／700 | — | `values.formLabel` |
| 頁尾文字 | `Karla, sans-serif` | 17px／28.05px | 400 | — | `values.footerText` |

Elementor 全域字型（`body.elementor-kit-21` 上的自訂屬性）：primary `"Noto Sans TC"` 500、secondary `"Noto Sans TC"` 300、text `"Noto Sans TC"` 200、accent `"Noto Sans TC"` 400（`home-1440x1000-chromium` `customProperties`）。

### 2.4 顏色

| 項目 | 值 | 證據／說明 |
|---|---|---|
| 正文色 | `rgb(240, 245, 250)` = `#f0f5fa` | `body.color`、`p.color`、`h2.color`；等於 `--e-global-color-text`／`--ast-global-color-4` |
| 次要文字 | **無量測值**（站上多用同一正文色）。僅見：表單內文字（白底輸入框）`#475569` `rgb(71,85,105)`；WC 標籤 `#1e293b` | `my-account-1440x1000-chromium` `formInput`、`formLabel`；深色背景上的次要文字色：待校準 |
| 連結（內文） | `rgb(240, 214, 43)` = `#f0d62b`（`/my-account/` 忘記密碼、`/contact/` 電話連結） | `link.color`；字重隨所在文字（Contact 為 200） |
| 連結 hover | `rgb(194, 169, 3)` = `#c2a903`（同時變 border-color） | `my-account-…`、`contact-…` `hover.link` |
| 導覽連結 | 預設 `#f0f5fa`；hover 與當前項 `#f0d62b`；手機選單面板（白底）內 `#334155`，當前 `#c2a903` | `hover.primaryNavLink2`；`menuOpen.links` |
| 主要按鈕 | 填色 `#f0d62b`：文字 `#1e293b`（Elementor「介紹資訊」）或 `#000000`（WooCommerce 登入、WPForms Submit）；hover：WC 登入 `#c2a903`，WC 加入購物車由 `rgba(240,214,43,0.5)` 變 `#f0d62b` 並加邊框 `#c2a903` | `values.button`、`values.formSubmit`、`hover` |
| 次要（外框）按鈕 | 透明底、白字、1px 白邊、3px 圓角（首頁「Read more ..」） | `home-1440x1000-chromium` `values.button` |
| 頁面底（body） | `background-color` 為 `#ffffff`（`/`、`/biography/`、`/my-account/`、`/contact/`）或 `#f5f5f5`（`/store/`），但**被覆蓋**：`body` 的 `background-image` 為 `linear-gradient(to right, rgba(17,17,17,0.75), rgba(17,17,17,0.75)), url(…/uploads/NicolasMic_01-scaled.webp)`，即 75% 的 `#111111` 疊在麥克風人像照上。`html` 背景透明 | `backgrounds` |
| 實際可見底色（截圖像素） | 中位數約 `#2b2b2b`–`#303030`（`contact`／`biography`／`store`／`my-account`／`home` 截圖的 p50）；最暗約 `#101010`。含少量文字與圖片像素，**不是 CSS 值** | 截圖像素取樣（非 `evidence` 檔；方法：Chromium canvas，每 6px 取樣，排除上下 100px） |
| 內容底 | 內容區無獨立底色，直接透出上述 body 背景（`#primary`、`main`、`.entry-content`、Elementor 容器皆透明） | `containers`、`sections.backgroundColor` |
| 分隔線／邊框 | Astra `--ast-border-color: rgba(208,213,219,0.5)`（WooCommerce 輸入框 1px 實線）；WPForms 輸入框 1px 實線 `#f0f5fa`、透明底、3px 圓角；Elementor 分隔線（divider widget）在標題下方，顏色未單獨記錄 | `customProperties`、`formInput` |
| 品牌黃 | `#f0d62b`（見 §4.2：與 Logo 圖檔像素、Astra `--ast-global-color-0`、Elementor `--e-global-color-accent` 一致） | `logoColors`、`customProperties` |
| Astra 全域色盤 | 0 `#f0d62b`、1 `#c2a903`、2 `#1e293b`、3 `#334155`、4 `#f0f5fa`、5 `#FFFFFF`、6 `#D1D5DB`、7 `#111111`、8 `#111111`（`--ast-global-color-0…8`） | `home-1440x1000-chromium` `customProperties` |
| Elementor 全域色 | primary／secondary／text `#F0F5FA`、accent `#F0D62B`；自訂 `e2daed1` `#334155`、`e57bc13` `#000000`、`e787088` `#1E293B`、`ecee787` `#111111C0`、`375e9c9` `#111111`、`88c2506` `#C2A903`、`9d50273` `#D1D5DB`（這些變數定義在 `body.elementor-kit-21`，`:root` 讀不到值） | 同上 |

### 2.5 容器

| 項目 | 值 | 證據 |
|---|---|---|
| Elementor 內容寬度（一般內頁） | `.e-con-inner`：`max-width: min(100%, 1140px)`，實際寬 **1140px**，1440 時置中（左 150px）、1280 時左 70px | `*-1440x1000-chromium` `containers.elementorEConInner` |
| 外層 Elementor 容器 padding | 10px（左右）；手機 390 時內層 370px、左 10px；360 時 340px | `containers.elementorEConRoot`、`elementorEConInner` |
| 欄間距 | `.e-con-inner` `column-gap/gap: 20px` | `containers.elementorEConInner` |
| Astra 容器 | `--ast-normal-container-width: 1200px`；`/my-account/` 的 `main` 實寬 1200px（1440 時左 120px），手機 390 時 350px、左右各 20px | `my-account-…` `containers.main`、`customProperties` |
| 頁首內容 padding | 左右 35px（桌面）；20px（手機） | `containers.astContainer`、`header.bar.padding` |
| 商品列 | 4 欄、每張卡 270px 寬、卡間約 20px；`.e-con-inner` 1140px 內 | `store-…` `values.wcProductCard`、`store-1440x1000-chromium-mid.webp` |
| 水平溢出 | 所有 20 組 Chromium 視窗皆無水平捲動 | `documentMetrics.horizontalOverflow` |

### 2.6 形狀

| 項目 | 圓角 | 邊框 | 陰影 | 證據 |
|---|---|---|---|---|
| Elementor 按鈕 | 3px | 1px 白（外框款）／無（填色款） | none | `values.button` |
| WooCommerce 按鈕 | 4px | 0（hover 時 1px `#c2a903`） | none | `values.wcAddToCart` |
| WPForms Submit／輸入 | 3px | 輸入框 1px `#f0f5fa` | none | `contact-…` |
| WooCommerce 登入輸入／送出 | 4px | 輸入 1px `rgba(208,213,219,0.5)` | none | `my-account-…` |
| 商品卡（`li.product`） | 6px | 無 | `rgba(0,0,0,0.1) 0 0 0 0`（實質無陰影） | `store-…` `values.wcProductCard`；計算底色為白，但截圖中卡片背景並未呈現白色，**不可直接採用**，待在 staging 目視校準 |
| 圖片（商品封面等） | 0px，`object-fit: fill`，1:1（300×300 自然，274×274 或 270×270 呈現） | 無 | 無 | `images` |
| 頁首 bar | 0 | 無 | 捲動後 `rgba(36,50,66,0.075) 0 2px 10px 0` | `headerAfterScroll` |
| Focus（鍵盤） | — | `1px dotted`，顏色同文字色（`#f0f5fa`；填色黃按鈕上為 `#1e293b`） | — | `home-1440x1000-chromium` `focus` |
| Hover 動態 | Elementor 按鈕 `transform: scale(0.9)`，`transition: transform 0.3s`；導覽／頁尾連結 `0.2s linear` | — | — | `hover`、`values.*.transition` |

### 2.7 區塊

| 項目 | 值 | 證據 |
|---|---|---|
| 頂層區塊結構 | 首頁為 13 個全寬 Elementor 容器：第 1 個（hero）`min-height: 850px`；之後交替出現 20px 高的空白容器與 750px（最後一個 400px）高的內容容器；容器 padding 上下 10px、`gap: 10px 0` | `home-1440x1000-chromium` `sections`（補跑版） |
| 內容起點 | 頁首 83px 之後約 18px，內容自 y≈101 起 | 同上 `sections[0].top` |
| 標題→下一元件間距 | 首頁 10px；Biography／Store／Contact 為 20px（標題後接 divider widget）；`/my-account/` 標題 margin-bottom 57px | `headingGap` |
| 區塊上下間距 | 無獨立的區段 padding；間隔由 20px 空白容器與容器 10px padding 構成 | `sections` |
| 圖片比例 | 商品封面 1:1，不裁切（`object-fit: fill`，自然與呈現比例相同） | `images` |
| 手機標題縮放 | 38px → 28px（行高 49.4px → 36.4px），390 與 360 相同；本次沒有量測 1280 以下、390 以上的中間寬度 | `values.h2` 各視窗 |

### 2.8 響應式

| 項目 | 觀察結果 | 證據 |
|---|---|---|
| 導覽折疊 | 1440／1280 為完整橫向導覽（7 項可見）；390／360 為選單切換鈕（`body.ast-header-break-point`）。**實際折疊點介於 390 與 1280 之間，本次沒有量到確切寬度** | `navigation`、`bodyClasses` |
| CSS 宣告的 `@media` 寬度（出現次數） | `max-width:544px`(61)、`max-width:921px`(57)、`max-width:767px`(49)、`max-width:1024px`(39)、`min-width:922px`(21)、`max-width:768px`(20)、`min-width:768px`(19)、`max-width:921.99px`(13)、`min-width:769px`(8)、`max-width:600px`(8)、`min-width:1201px`(7)、`min-width:1025px`(7)、`max-width:1200px`(6)… | `home-1440x1000-chromium` `declaredMediaWidths`。這是**樣式表中宣告**的條件，不等於實測切換點；921／922 為 Astra 慣例的頁首／版面切換點，Elementor 的行動／平板為 767／1024 |
| 單欄切換 | 390／360 時 Elementor 容器內層為單欄；本次沒有量到確切切換寬度 | `sections.columns`（手機版 JSON，僅外層） |
| 標題 | 見 §2.7（≤390：28px） | — |
| 取樣視窗 | 1440、1280、390、360 為本專案取樣尺寸，**非原站已量測斷點**（§3.2） | — |

### 2.9 字體來源

| 字型 | 來源 | 證據 |
|---|---|---|
| Noto Sans TC（200／300／400／500／700） | **自託管**：Elementor 本地 Google Fonts，`https://sounds.wgstudiomusic.com/wp-content/uploads/elementor/google-fonts/fonts/notosanstc-*.woff2`，依 unicode-range 切成多片；`font-display: swap` | `fontFaceRules`、`fontResources`、`loadedFonts` |
| Karla 400 | Google Fonts 遠端（`fonts.googleapis.com/css?family=Karla:400\|Rubik:600,500&display=swap`，由 Astra 載入）；此樣式表跨來源，規則本身讀不到（`SecurityError`），由 `document.fonts` 與資源列表確認 Karla 400 已載入 | `cssSheets.inaccessible`、`loadedFonts`、`fontLinks` |
| Rubik（600／500；`/my-account/` h2 用 700 實際繪出） | 同上 Google Fonts 遠端請求 | 同上 |
| Poppins 600 | 自託管：`uploads/elementor/google-fonts/fonts/poppins-*.woff2`（疑為 Backer Plan 橫幅標題所用，未逐元素確認） | `fontResources` |
| 圖示字型 | Font Awesome 5 Free／Brands（Elementor 外掛）、dashicons、WooCommerce、`swiper-icons` | `fontFaceRules` |
| 系統字型 | 僅作為 `sans-serif` 後備；未見任何站內明確指定的系統字型堆疊 | `fontFamily` |

交付包不得夾帶字型檔（§3.3）；`.wg-live` 只引用站上已載入的字型名稱，並提供後備堆疊（見 §3）。

---

## 3. 設計變數表（§3.5）

來源欄：**實測** 附 §2 段落／證據；**新設計值** 為本專案提案，非原站數值。所有 `--wg-*` 只定義在 `.wg-live`／`.wg-live-featured` 內。

| 專案變數 | 值 | 類別 | 來源／依據 |
|---|---|---|---|
| `--wg-font-body` | `"Noto Sans TC", sans-serif`（Elementor 內文；Chinese UI 用）。`body` 本身為 `Karla, sans-serif` | 實測（綁定哪一個待確認） | §2.3；Karla 無中文字形，中文會落到系統字型，故建議綁 Noto Sans TC。**待校準**：管理者確認 `.wg-live` 區塊是否可用 Elementor 內文字型 |
| `--wg-font-body-weight` | 內文 **200**（實測）；UI 小字 **400**（新設計值） | 實測／新設計值 | 實測：`p` 字重 200（§2.3）。Noto Sans TC 200 在深色底上偏細，UI 文字建議 400；Noto Sans TC 已載入 200–700（`loadedFonts`） |
| `--wg-font-heading` | `"Noto Sans TC", sans-serif`，字重 500 | 實測 | §2.3 `h2`；標題階層 38px／28px（≤390） |
| `--wg-font-size-body` | 17px，行高 1.65（28.05px） | 實測 | §2.3 |
| `--wg-text` | `#f0f5fa` | 實測 | §2.4 正文色 |
| `--wg-text-muted` | `#c0c8d0` | **新設計值**／待校準 | 原站深色底上無次要文字色。對比：對 `#111111` 為 11.16:1；對理論最亮底 `#4c4c4c` 為 5.08:1（見 §4）。管理者可改用原站某個既有色 |
| `--wg-link` | `#f0d62b`；hover `#c2a903` | 實測 | §2.4（`link`、`hover.link`）。依 §3.5 不直接以 Logo 色取代，但實測連結色恰與品牌黃相同 |
| `--wg-accent` | `#f0d62b` | 實測 | 四處一致：Logo 圖檔像素 79% 為 `#f0d62b`（`home-1440x1000-chromium` `logoColors`）、`--ast-global-color-0`、`--e-global-color-accent`、填色按鈕 `background-color` |
| `--wg-accent-strong`（hover／按下） | `#c2a903` | 實測 | `--ast-global-color-1`；WC 登入 hover、連結 hover |
| `--wg-on-accent` | `#000000` | 實測 | WooCommerce 登入與 WPForms Submit 的文字色；對 `#f0d62b` 為 14.36:1。站上 Elementor 按鈕另用 `#1e293b`（10.00:1），兩者皆通過 |
| `--wg-page-surface` | `transparent`（沿用原站背景圖＋75% `#111111` 疊層） | 新設計值 | 原站內容區無獨立底色（§2.4）。截圖像素中位數約 `#2d2d2d`（非 CSS 值） |
| `--wg-card-surface` | `rgba(17, 17, 17, 0.75)` | 新設計值 | 取自原站 body 疊層的色與透明度（實測 `linear-gradient(rgba(17,17,17,0.75))`）；是否做成卡片底為新設計決定 |
| `--wg-border` | `rgba(208, 213, 219, 0.5)` | 實測 | Astra `--ast-border-color`（WC 輸入框邊框）。疊在 `#111111` 上約 `#717376`，對 `#111111` 為 3.97:1（≥3:1，可作元件邊界） |
| `--wg-content-max` | `1140px`（一般內頁）；`1200px`（Astra 容器，`/my-account/`） | 實測 | §2.5。新頁面為 Elementor Full Width，預期用 1140px；**待確認** |
| `--wg-gutter` | `10px`（Elementor 外層容器左右 padding，手機）；Astra 頁面 `20px`（手機）／`35px`（頁首） | 實測 | §2.5。是否在手機上採更寬的 16px，屬新設計決定，驗收時再議 |
| `--wg-button-radius` | `3px`（Elementor、WPForms）；WooCommerce 為 `4px` | 實測 | §2.6。新頁面預設取 `3px`，**待校準**是否要匹配 WooCommerce 的 `4px` |
| `--wg-card-radius` | `6px` | 實測（待目視確認） | `li.product` 計算值；卡片背景在畫面上不可見（§2.6），故待在 staging 目視校準。§3.6 的 8px 為備用值，目前不採用 |
| `--wg-transition` | `0.2s linear`（連結）；Elementor 按鈕 `transform 0.3s` | 實測 | §2.6。與 §3.6 建議的 160–220ms 相容 |
| `--wg-focus-ring` | `2px solid #f0d62b`，offset 2px | **新設計值** | 原站為 `1px dotted`（同文字色），可見度低。`#f0d62b` 對 `#111111` 為 12.91:1 |
| `--wg-player-surface` | `#111111` | 新設計值（取自原站色盤） | 原站色盤本就有 `#111111`（`--ast-global-color-7`／`8`，也是疊層色）；用在播放舞台為新設計決定，獨立於全站背景（§3.5） |
| `--wg-player-text` | `#f0f5fa` | 新設計值（取自實測正文色） | 對 `#111111` 為 17.22:1 |
| 後備字型堆疊 | `"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif` | 新設計值 | 只引用名稱，不夾帶字型檔（§3.3） |

**待校準清單（需要後台或 staging 目視）**

1. 深色背景上的次要文字色（原站無值）。
2. `.wg-live` 區塊實際繼承到的字型（Karla 或 Noto Sans TC）：取決於 Elementor Shortcode widget 外層的 `font-family`。
3. 商品卡的實際背景（計算為白色，畫面未見）。
4. 導覽折疊與單欄切換的確切寬度（本次只有 4 個取樣寬度）。
5. 登入狀態下的 WordPress 管理工具列與黏附頁首的相對位置。
6. 底部「Backer Plan」橫幅的計算尺寸與 z-index。
7. 非當前頁導覽連結 hover 的過場細節（已確認顏色 `#f0d62b`）。

---

## 4. 對比度（WCAG 2.x，相對亮度公式）

計算：`node scripts/measure-site.mjs --contrast <色1> <色2>`。標準：一般文字 AA ≥ 4.5、AAA ≥ 7、大字／元件邊界 ≥ 3。

背景的**理論最亮值** `#4c4c4c`：body 的 75% `#111111` 疊層蓋在任意像素上，最亮可能為 0.75×17 + 0.25×255 = 76.5。這是推算上限，**不是**量測值；實際截圖像素的中位數約 `#2d2d2d`（p10 `#101010`）。人像／封面圖片本身的高亮區不在疊層背景內，不適用。

### 4.1 新設計的色對

| 前景 | 背景 | 比值 | 判定 |
|---|---|---|---|
| `--wg-accent` `#f0d62b`（作文字／圖示） | `#111111`（player surface） | **12.91** | AAA |
| `--wg-on-accent` `#000000` | `--wg-accent` `#f0d62b` | **14.36** | AAA |
| 備選 on-accent `#1e293b` | `#f0d62b` | 10.00 | AAA |
| `--wg-text` `#f0f5fa` | `#111111` | **17.22** | AAA |
| `--wg-text` `#f0f5fa` | `#2d2d2d`（截圖中位數） | 12.56 | AAA |
| `--wg-text` `#f0f5fa` | `#4c4c4c`（理論最亮） | 7.83 | AAA |
| `--wg-text-muted` `#c0c8d0`（新設計值） | `#111111` | 11.16 | AAA |
| `--wg-text-muted` `#c0c8d0` | `#4c4c4c` | 5.08 | AA |
| `--wg-link` `#f0d62b` | `#111111` | 12.91 | AAA |
| `--wg-link` `#f0d62b` | `#2d2d2d` | 9.42 | AAA |
| `--wg-link` `#f0d62b` | `#4c4c4c` | 5.87 | AA |
| link hover `#c2a903` | `#111111` | 8.07 | AAA |
| link hover `#c2a903` | `#4c4c4c` | **3.67** | 不通過一般文字 AA（僅大字／3:1） |
| `--wg-border` `rgba(208,213,219,0.5)`（疊後約 `#717376`） | `#111111` | 3.97 | 通過元件邊界 3:1 |

### 4.2 原站既有色對（供對照）

| 前景 | 背景 | 比值 | 備註 |
|---|---|---|---|
| `#1e293b`（Elementor 填色按鈕字） | `#f0d62b` | 10.00 | 通過 |
| `#000000`（WC／WPForms 按鈕字） | `#f0d62b` | 14.36 | 通過 |
| `#1e293b`（WC 加入購物車字） | 約 `#8e812c`（按鈕 `rgba(240,214,43,0.5)` 疊在 `#2d2d2d` 上的推算色） | **3.71** | 原站該按鈕在預設狀態下對比不足；hover 變實心 `#f0d62b` 後為 10.00。新頁面不要沿用半透明黃底 |
| `#c2a903`（手機選單當前項字） | `#f0f5fa`（該列底色） | **2.13** | 原站既有的低對比，新設計不沿用 |
| `#334155`（手機選單連結字） | `#ffffff` | 10.35 | 通過 |
| `#ffffff` | `#f0d62b` | 1.46 | 白字不可放在品牌黃上 |

**品牌黃說明（依任務指示僅就量測到的部分陳述）**：`Logo_H-1536x417.png`（首頁 logo 檔案，1536×417）經 canvas 取樣，不透明像素中 79.06% 為 `#f0d62b`、20.47% 為 `#cfbb37`（同色系較暗的色調），其餘為抗鋸齒雜色（`evidence/design-baseline/home-1440x1000-chromium.json` → `top.logoColors`）。畫面上 logo 呈白色，是 Astra 的 `filter: url(#ast-img-color-filter)` 所致，檔案本身為黃色。`#cfbb37` 的角色（陰影色、第二色階或另一元素）未確認，不納入設計變數。

---

## 5. 證據索引

- `evidence/design-baseline/<page>-<w>x<h>-<browser>.json`：每組的完整量測（`top`、`headerAfterScroll`、`menuOpen`、`focus`、`hover`、`meta`）。`top` 內有：`values`（§3.4 目標與延伸目標）、`header`、`backgrounds`、`containers`、`sections`、`headingGap`、`images`、`navigation`、`documentMetrics`、`customProperties`、`wpPresetColors`、`declaredMediaWidths`、`fontFaceRules`、`loadedFonts`、`fontResources`、`bodyClasses`、`logoColors`。
- 截圖：`-first.webp`（首屏）、`-mid.webp`（捲動 50%）、`-footer.webp`（頁尾）、`-menu.webp`（390／360 展開選單）。
- `evidence/design-baseline/_run-log.json`：三次執行紀錄（首輪完整、1440 補跑、home 補跑）。
- 重新執行：`npm run measure:site`（可加 `-- --pages home,store --viewports 1440x1000 --browsers chromium`）。
