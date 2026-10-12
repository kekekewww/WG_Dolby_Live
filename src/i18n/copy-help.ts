import { DEMO_MEDIA_NOTICE } from './copy-status';

/**
 * Help page copy (plan 6.11, spec 5.5). Taiwan Traditional Chinese.
 *
 * The fixed sections come from here, in this order: modes, Safari-first note, home-theater
 * compatibility table, no sound, reconnecting, switching modes, keyboard, contact. Admin FAQ items
 * (HelpContent.faq) come after them. Nothing here claims a device works: "supported" is only ever
 * shown for a compatibility row the admin saved with a test record (plan 4.3).
 */
export const helpCopy = {
  title: 'Listening Guide', // [spec 2.3]
  subtitle: '聆聽說明',
  intro: '開始聆聽前，可以先了解兩種模式的差異、支援條件與常見問題。',
  backToEvents: '返回活動列表',

  /* ---- 1. the two modes ---- */
  modes: {
    heading: '兩種聆聽模式',
    lead: '兩種模式是不同的音訊版本，請依自己的設備選擇。選擇模式後，按下「開始聆聽」才會載入並播放。',
    binaural: {
      name: '耳機聆聽 · Binaural', // [spec 5.2]
      description: '使用耳機聆聽錄音室製作的雙耳版本。', // [spec 5.2]
      note: '一般耳機即可播放此版本；音訊效果依錄音室交付內容為準。', // [spec 5.2]
    },
    atmos: {
      name: '家庭劇院 · Dolby Atmos', // [spec 5.2]
      description: '適用於經確認的播放裝置、連接方式與 Atmos 家庭劇院。', // [spec 5.2]
      note: '請先閱讀支援條件；選用 Atmos 音軌不等於系統已確認最終設備輸出。', // [spec 5.2]
    },
    labelNote: '畫面上的「已選擇」與「目前播放」只代表所選的音訊版本，不代表已確認裝置的輸出方式。',
  },

  /* ---- 2. Safari-first ---- */
  safari: {
    heading: '瀏覽器與驗收說明',
    paragraphs: [
      '本專案以 Safari（iPhone、iPad 與 Mac）作為優先驗收的瀏覽器；其他瀏覽器不會被擋在 Binaural 模式之外，但尚未全面驗收。',
      '本站依瀏覽器實際提供的功能判斷可用的播放方式，不依瀏覽器名稱限制使用。',
      '家庭劇院模式能否呈現 Atmos，取決於播放裝置、連接方式與瀏覽器的組合，請以下方相容表的實測紀錄為準。',
    ],
  },

  /* ---- 3. compatibility table ---- */
  compat: {
    heading: '家庭劇院連接方式',
    lead: '下表記錄各裝置、連接方式與瀏覽器的實測結果。沒有實測的組合一律標示為「尚待測試」，不代表支援，也不代表不支援。',
    caption: '家庭劇院相容表：裝置、作業系統、瀏覽器、輸出路徑、來源格式與測試結果',
    columns: {
      device: '裝置',
      os: '作業系統',
      browser: '瀏覽器',
      outputPath: '輸出路徑',
      sourceFormat: '來源格式',
      status: '測試結果',
      testedAt: '測試日期',
      notes: '備註',
    },
    status: {
      pending: '尚待測試', // [spec 5.5 / plan 6.11]
      verified: '已驗證',
      not_working: '實測無法使用',
    },
    /** Cell without a value (a pending row the admin has not filled in yet). */
    cellEmpty: '待確認',
    dateEmpty: '尚無紀錄',
    empty: '相容表資料尚未建立，所有連接方式目前都尚待測試。',
    demoNote: `介面示範活動使用的是「${DEMO_MEDIA_NOTICE}」，不能用來判斷您的設備是否能呈現 Atmos。`,
  },

  /* ---- 4. no sound ---- */
  noSound: {
    heading: '沒有聲音時',
    lead: '請依序檢查：',
    steps: [
      '確認已按下「開始聆聽」，且畫面顯示「播放中」。',
      '確認裝置音量沒有調到最小，也沒有開啟靜音；瀏覽器分頁也沒有被靜音。',
      '使用藍牙耳機或喇叭時，確認已連線，並已選為裝置的輸出。',
      '先改用 Binaural 模式，確認一般耳機是否能聽到聲音。',
      '按「重試」，或重新整理本頁後再試一次。',
    ],
  },

  /* ---- 5. reconnecting ---- */
  reconnect: {
    heading: '重新連線',
    paragraphs: [
      '網路不穩時，畫面會顯示「連線暫時中斷，正在重新連線」，並自動重試，最多 3 次。',
      '重試後仍無法播放時，會顯示「無法播放，請重試」。請確認網路連線後，按下「重試」。',
    ],
  },

  /* ---- 6. switching modes ---- */
  switching: {
    heading: '切換模式',
    paragraphs: [
      '播放中可按「切換模式」。確認後會先停止目前的音訊，再載入另一個版本，過程中播放可能短暫中斷。',
      '新模式成功播放後，「目前播放」才會更新。切換失敗時，仍會保留原模式資訊，並可重新載入原模式。',
      '家庭劇院模式失敗時，會明確提示並提供「改用耳機 Binaural」；系統不會在未告知的情況下替您更換音軌。',
    ],
  },

  /* ---- 7. keyboard ---- */
  keyboard: {
    heading: '鍵盤操作',
    lead: '播放器支援鍵盤操作。快捷鍵只在播放器範圍內作用，不會影響頁面上的其他輸入。',
    items: [
      { keys: ['Tab', 'Shift + Tab'], action: '在按鈕、連結與選項之間移動焦點。' },
      { keys: ['Enter', 'Space'], action: '啟動目前聚焦的按鈕。' },
      { keys: ['K'], action: '焦點在播放器內（輸入欄位除外）時，切換播放與暫停。在「暫停」或「繼續播放」按鈕上，也可按 Enter 或 Space。' },
      { keys: ['Esc'], action: '關閉切換模式的對話框，焦點會回到「切換模式」按鈕。' },
    ],
  },

  /* ---- 8. contact ---- */
  contact: {
    heading: '聯絡我們',
    fallback: '如需協助，請透過網站的聯絡方式與我們聯繫。',
    link: '聯絡我們',
  },

  /* ---- admin FAQ (after the fixed sections) ---- */
  faq: {
    heading: '常見問題',
  },
} as const;
