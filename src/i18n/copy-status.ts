/**
 * Status, error, gating and notice copy (Taiwan Traditional Chinese).
 *
 * Source of every string: spec section 5.2/5.3/5.4 and the section 6 table, plan 6.1/6.2/6.5/6.6/6.7/6.10.
 * Strings that the spec pins verbatim are marked [spec]. Others are short working copy that makes
 * no capability claim (no "Atmos certified", no device names, no fake liveness).
 */
import type { EventStatus, ListeningMode } from '../types';

/** Text badge for demo events: PHP has its own copy and a test keeps both in sync (plan 6.10). */
export const DEMO_EVENT_BADGE = '介面示範';
/** Shown wherever demo media can play, in both modes (CLAUDE.md, plan D7). */
export const DEMO_MEDIA_NOTICE = '操作示範音訊，非 Binaural／Atmos 驗證素材';

const eventStatusLabels = {
  scheduled: '尚未開始',
  doors_open: '即將開放',
  live: '演出中',
  intermission: '中場休息',
  ended: '已結束',
  cancelled: '已取消',
} satisfies Record<EventStatus, string>;

export const statusCopy = {
  /* ---- event gating (plan 6.2) ---- */
  gate: {
    disabled: { title: '線上音樂會尚未開放', detail: '請稍後再回來查看，或前往首頁。' }, // [plan 6.2 gate 0]
    eventNotFound: { title: '找不到這場活動', detail: '這場活動可能已下架，或連結有誤。' }, // [plan 6.2 gate 1]
    cancelled: { title: '本場活動已取消', detail: '詳細資訊請見活動公告，或聯絡我們。' }, // [spec 6]
    ended: { title: '本場演出已結束', detail: '可返回活動列表查看其他活動。' }, // [spec 6]
    sourceNotConfigured: { title: '播放來源尚未開放', detail: '這場活動的播放來源尚未開放，請稍後再查看。' }, // [spec 6]
    scheduled: { title: '演出尚未開始', detail: null }, // [spec 6] detail = startsAt(...)
    doorsOpen: { title: '即將開放聆聽', detail: '開放後即可按「開始聆聽」。' }, // [spec 6]; decision 2026-11-01: no mode to choose
    intermission: { title: '演出中場休息', detail: '播放連線與目前模式會保留。' }, // [spec 6]
    live: { title: '演出進行中', detail: null },
  },
  /** "開始時間：2026年10月24日（六）19:30 台北時間" */
  startsAt: (full: string): string => `開始時間：${full}`,

  /* ---- player (spec 6 table, plan 6.4/6.5) ---- */
  player: {
    idle: '請先選擇聆聽模式',
    /** The event offers no listening mode yet (availableModes is empty): there is nothing to choose. */
    modesPending: '聆聽模式即將公布',
    selecting: '按下「開始聆聽」即可播放',
    loading: '正在連接音訊', // [spec 6]
    playing: '播放中',
    paused: '已暫停',
    switching: '正在切換聆聽模式',
    reconnecting: '連線暫時中斷，正在重新連線', // [spec 6]
    playBlocked: '請點擊開始聆聽', // [spec 6]
    unsupported: '目前環境無法播放這個音訊版本', // [spec 6]
    failed: '無法播放，請重試',
    checkingSource: '正在確認播放來源',
  },

  /* ---- mode labels (plan 6.10, spec 5.3) ---- */
  modeName: {
    binaural: 'Binaural',
    atmos: 'Dolby Atmos 音軌',
  } satisfies Record<ListeningMode, string>,
  /** 已選擇：Dolby Atmos 音軌 */
  selectedMode: (modeName: string): string => `已選擇：${modeName}`,
  /** M2-PLAN D2 (proposed copy, for approval): a provider player frame cannot confirm playback. */
  providerSelectedMode: (modeName: string): string => `已選擇：${modeName}（由串流服務播放器播放）`,
  /** 目前播放：Binaural — only after the adapter confirmed playing. */
  currentMode: (modeName: string): string => `目前播放：${modeName}`,
  /** Help text for the label (never claims device output). */
  modeLabelNote: '模式標示只代表所選的音訊版本，不代表已確認裝置的輸出方式。',

  /* ---- event status badges ---- */
  eventStatus: eventStatusLabels,

  /* ---- entitlement panel (plan 6.2) ---- */
  entitlement: {
    guest: { message: '請先登入', action: '登入' }, // [plan 6.2]
    notEntitled: { message: '尚未取得觀看資格', action: '購票' }, // [plan 6.2]
    unavailable: { message: '暫時無法確認觀看資格', retry: '重試', contact: '聯絡我們' }, // [spec 6]
    checking: '正在確認觀看資格',
    note: '觀看資格由伺服器端確認；介面上的顯示不代表已取得權限。',
  },

  /* ---- actions (button / link labels) ---- */
  action: {
    start: '開始聆聽', // [spec 6 / plan 6.3]
    pause: '暫停',
    resume: '繼續播放',
    retry: '重試',
    switchMode: '切換模式', // [plan 6.6]
    fallbackBinaural: '改用耳機 Binaural', // [spec 5.4]
    reloadLastGood: (modeName: string): string => `重新載入${modeName}`, // [plan 6.6] 重新載入〈舊模式〉
    viewEvent: '查看活動資訊', // [spec 5.1]
    backToEvents: '返回活動列表',
    backHome: '回首頁',
    help: '聆聽說明',
    contact: '聯絡我們',
    login: '登入',
    buy: '購票',
    close: '關閉',
    confirmSwitch: '確認切換',
    cancel: '取消',
  },

  /* ---- primary CTA labels (plan 6.1 table) ---- */
  cta: {
    viewDetails: '查看活動資訊', // cancelled / ended
    demo: '體驗播放介面', // isDemo && sourceKind === 'demo'
    enter: '進入聆聽', // doors_open / live / intermission
    viewEvent: '查看活動', // scheduled
    replayPending: '回放資訊待公布',
  },

  /* ---- switch dialog (plan 6.6) ---- */
  switchDialog: {
    title: '切換聆聽模式',
    body: (currentName: string, otherName: string): string =>
      `目前模式為「${currentName}」，要切換為「${otherName}」嗎？切換時播放可能會短暫中斷。`,
  },

  /* ---- screen reader announcements (plan 6.10: never the countdown, retry counter or time) ---- */
  announce: {
    loading: '正在連接音訊',
    playing: (modeName: string): string => `目前播放：${modeName}`,
    paused: '已暫停',
    reconnecting: '連線暫時中斷，正在重新連線',
    failed: (message: string): string => `播放失敗：${message}`,
    playBlocked: '請點擊開始聆聽',
    switchSuccess: (modeName: string): string => `已切換，目前播放：${modeName}`,
    switchFailed: (modeName: string): string => `切換失敗，仍保留原模式：${modeName}`,
    eventStatus: (status: EventStatus): string => `活動狀態更新：${eventStatusLabels[status]}`,
  },

  /* ---- generic ---- */
  errorCodeLabel: '錯誤代碼',
  bootError: 'Live 介面暫時無法載入', // [task: main.ts mount failure]
  bootErrorHint: '請重新整理頁面，或稍後再試。',
  noscript: '需要啟用 JavaScript 才能使用線上音樂會。',
  time: {
    taipei: '台北時間',
    tbd: '時間待公布',
    units: { day: '天', hour: '小時', minute: '分鐘', lessThanMinute: '不到 1 分鐘' },
  },
  demo: {
    badge: DEMO_EVENT_BADGE,
    mediaNotice: DEMO_MEDIA_NOTICE,
  },
} as const;
