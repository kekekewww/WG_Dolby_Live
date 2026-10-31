/**
 * Events page copy (plan 6.1, spec 5.1/5.2). Taiwan Traditional Chinese.
 *
 * Strings the spec or plan pin verbatim are marked [spec] / [plan]. The rest is short working copy
 * that makes no capability claim (no "Atmos certified", no device names, no fake liveness).
 * Status badge text, CTA labels and the demo badge live in copy-status.ts (statusCopy).
 */
export const eventsCopy = {
  /* ---- view title (plan 6.1 section 1) ---- */
  title: 'Live', // [spec 5.1]
  subtitle: '線上音樂會', // [spec 5.1]
  intro: '以耳機或家庭劇院，聆聽維光音樂的現場演出。', // [spec 5.1]

  /* ---- section headings ---- */
  featuredHeading: '精選活動',
  othersHeading: '其他活動',
  allHeading: '活動列表',
  faqHeading: '常見問題',

  /* ---- empty state (plan 6.1) ---- */
  empty: {
    title: '目前沒有已公布的線上音樂會', // [plan 6.1]
    detail: '線上音樂會資訊即將公布', // [plan 6.1]
  },

  /* ---- card ---- */
  card: {
    performers: '演出者',
    modes: '聆聽模式',
    modesPending: '聆聽模式即將公布', // [plan 6.1]
    modeChip: {
      binaural: '耳機 Binaural',
      atmos: '家庭劇院 Dolby Atmos',
    },
    /** "距離開始：3 天 4 小時 12 分鐘" - never a live region (plan 6.10). */
    countdown: (quantity: string): string => `距離開始：${quantity}`,
    /** Secondary toggle on cards whose primary CTA is a link: the description stays reachable. */
    toggleInfo: '活動簡介',
    programme: '節目單',
    contactForCancel: '聯絡我們',
  },

  /* ---- date tile (decorative: the card keeps its <time> text, HYBRID.md) ---- */
  tile: {
    month: (year: number, month: number): string => `${year}年${month}月`,
    weekday: (weekday: string): string => `週${weekday}`,
  },

  /* ---- poster placeholder (an event without a poster, HYBRID.md; decorative, aria-hidden) ---- */
  posterPlaceholder: {
    brand: 'WG Studio Live',
    demo: '介面示範',
    demoNote: '操作示範，非正式演出',
  },

  /* ---- 聆聽方式 section (plan 6.1 section 3, spec 5.2) ---- */
  guide: {
    heading: '聆聽方式', // [plan 6.1]
    // Decision 2026-11-01: one Dolby Atmos stream per concert (proposed copy, for approval).
    lead: '每場音樂會提供一個 Dolby Atmos 串流，不需要選擇聆聽模式；能否呈現 Atmos 效果，依裝置與連接方式而定。',
    helpLink: '閱讀完整聆聽說明',
    modes: {
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
    },
  },

  /* ---- FAQ summary (plan 6.1 section 5): used when the admin entered fewer than one FAQ ---- */
  faqHelpLink: '查看更多說明',
  defaultFaq: [
    {
      question: '需要什麼設備才能聆聽？',
      answer: 'Mac、iPhone、iPad 請用 Safari。Windows 或無法播放的瀏覽器，請在播放頁取得個人播放連結，用 VLC 開啟。詳見聆聽說明。',
    },
    {
      question: '播放 Dolby Atmos 串流，就代表我的設備已輸出 Atmos 嗎？',
      answer: '不代表。系統只知道播放的是 Dolby Atmos 串流，無法確認最終設備的輸出方式。',
    },
    {
      question: '沒有聲音時該怎麼辦？',
      answer: '請先確認裝置音量與靜音狀態，再回到播放頁按「重試」。仍無法解決時，請參考聆聽說明。',
    },
  ],

  /* ---- disabled mode (plan D16) ---- */
  disabled: {
    homeLink: '回首頁',
    contactLink: '聯絡我們',
  },
} as const;
