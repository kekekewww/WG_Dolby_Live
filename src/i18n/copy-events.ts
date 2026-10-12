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
    lead: '本站提供兩種聆聽方式，請依自己的設備選擇；是否能呈現 Atmos，依裝置與連接方式而定。',
    helpLink: '閱讀完整聆聽說明',
    modes: {
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
    },
  },

  /* ---- FAQ summary (plan 6.1 section 5): used when the admin entered fewer than one FAQ ---- */
  faqHelpLink: '查看更多說明',
  defaultFaq: [
    {
      question: '需要什麼設備才能聆聽？',
      answer: '使用一般耳機即可聆聽 Binaural 版本。家庭劇院模式需要經確認的播放裝置與連接方式，詳見聆聽說明。',
    },
    {
      question: '選了 Dolby Atmos 音軌，就代表我的設備已輸出 Atmos 嗎？',
      answer: '不代表。選用 Atmos 音軌只是選擇音訊版本，系統無法確認最終設備的輸出方式。',
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
