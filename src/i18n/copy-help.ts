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
  intro: '開始聆聽前，可以先了解播放方式、支援條件與常見問題。',
  backToEvents: '返回活動列表',

  /* ---- 1. how to listen (one Dolby Atmos stream) ---- */
  modes: {
    // Decision 2026-11-01: one Dolby Atmos stream per concert (proposed copy, for approval).
    heading: '播放方式',
    lead: '每場音樂會提供一個 Dolby Atmos 串流，不需要選擇聆聽模式。按下「開始聆聽」才會載入並播放。',
    apple: {
      name: 'Mac、iPhone、iPad · Safari',
      description: '用 Safari 開啟播放頁，按「開始聆聽」即可播放 Dolby Atmos 串流。',
      note: '耳機或家庭劇院能否呈現 Atmos 效果，依裝置與連接方式而定，請以聆聽說明的相容表為準。',
    },
    windows: {
      name: 'Windows 與其他瀏覽器 · VLC',
      description: '瀏覽器無法播放 Dolby Atmos 時，已購票的觀眾可在播放頁取得個人播放連結，用 VLC 開啟。',
      note: 'VLC 能否輸出 Atmos 效果，依 VLC 的設定與設備而定。',
    },
    labelNote: '畫面上的「已選擇」與「目前播放」只代表播放的音訊版本，不代表已確認裝置的輸出方式。',
  },

  /* ---- 2. Safari-first ---- */
  safari: {
    heading: '瀏覽器與驗收說明',
    paragraphs: [
      '本專案以 Safari（iPhone、iPad 與 Mac）作為優先驗收的瀏覽器；其他瀏覽器尚未全面驗收。',
      '本站依瀏覽器實際提供的功能判斷能否播放，不依瀏覽器名稱限制使用。瀏覽器無法播放 Dolby Atmos 時（例如 Windows 上的 Chrome、Edge），播放頁會說明，並讓已購票的觀眾取得個人播放連結，改用 VLC 開啟。',
      '能否呈現 Atmos 效果，取決於播放裝置、連接方式與瀏覽器的組合，請以下方相容表的實測紀錄為準。',
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
      '使用 Windows 或播放失敗時，在播放頁按「取得我的播放連結」，改用 VLC 開啟。',
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

  /* ---- 6. external player (decision 2026-11-01; proposed copy, for approval) ---- */
  external: {
    heading: '用 VLC 收聽',
    paragraphs: [
      '已購票並登入的觀眾，在演出中若瀏覽器無法播放 Dolby Atmos，或播放失敗，播放頁會出現「用其他播放器收聽」。',
      '按「取得我的播放連結」後複製連結。Windows 請在 VLC 選「媒體 → 開啟網路串流」，貼上連結後按「播放」；Mac、iPhone、iPad 可直接用 Safari 開啟連結。',
      '每次按下都會取得新的連結。連結只供本人使用，請勿分享。',
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
