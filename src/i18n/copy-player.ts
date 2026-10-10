/**
 * Player view copy (Taiwan Traditional Chinese): mode selector, controls, dialog extras, info
 * section and the dev panel. Status, error, gating and entitlement strings live in copy-status.ts.
 *
 * The mode selector strings are pinned verbatim by spec 5.2. Everything else is short working copy
 * that makes no capability claim (no "Atmos certified", no device names, no fake liveness).
 */
export const playerCopy = {
  /** Accessible name of the `.wg-live__player` role="group". */
  group: {
    label: '音樂會播放器',
  },

  /* ---- mode selector (spec 5.2, verbatim) ---- */
  modeSelector: {
    legend: '選擇聆聽模式',
    binaural: {
      title: '耳機聆聽 · Binaural',
      description: '使用耳機聆聽錄音室製作的雙耳版本。',
      helper: '一般耳機即可播放此版本；音訊效果依錄音室交付內容為準。',
      action: '選擇耳機模式',
    },
    atmos: {
      title: '家庭劇院 · Dolby Atmos',
      description: '適用於經確認的播放裝置、連接方式與 Atmos 家庭劇院。',
      helper: '請先閱讀支援條件；選用 Atmos 音軌不等於系統已確認最終設備輸出。',
      action: '選擇家庭劇院模式',
    },
    /** Visible (not colour-only) marker on the chosen option. */
    selectedMarker: '已選取',
    /** Shown on a mode this event does not offer yet. */
    unavailable: '即將開放',
    helpLink: '閱讀聆聽說明與支援條件',
  },

  /* ---- reasons shown next to a disabled「開始聆聽」 ---- */
  startReason: {
    noMode: '請先選擇聆聽模式',
    notOpenScheduled: '演出開始前無法聆聽，請於演出時間再回來',
    notOpenDoors: '尚未開放聆聽，開放後即可開始',
    noSource: '播放來源尚未開放',
  },

  /* ---- transport controls ---- */
  controls: {
    groupLabel: '播放控制',
    connecting: '正在連接音訊',
    switching: '正在切換聆聽模式',
    mute: '靜音',
    unmute: '取消靜音',
    volume: '音量',
    seekToLive: '返回直播',
    fullscreen: '全螢幕',
    /** aria-keyshortcuts on the play/pause button (documented on the help page). */
    keyShortcuts: 'Space K',
  },

  /* ---- current mode + switch ---- */
  modeBar: {
    groupLabel: '目前聆聽模式',
  },

  /* ---- stage ---- */
  stage: {
    label: '播放舞台',
    posterFallbackAlt: '',
  },

  /* ---- title area + info section ---- */
  header: {
    performers: (names: string): string => `演出者：${names}`,
    performersJoiner: '、',
  },
  info: {
    heading: '活動資訊',
    programmeHeading: '節目單',
    /** Static list only: never claims a track is playing now (spec 5.3). */
    programmeNote: '節目單為預定內容，不代表目前正在播放的曲目。',
    dateLabel: '演出時間',
  },
  helpLink: '聆聽說明',
  /** Accessible name of the entitlement panel region. */
  entitlementLabel: '觀看資格',

  /* ---- switch dialog (extras on top of statusCopy.switchDialog) ---- */
  dialog: {
    currentLabel: '目前模式',
    otherLabel: '切換為',
    labelledByFallback: '切換聆聽模式',
  },

  /* ---- dev/demo panel (spec 5.6): clearly labelled, never shown on production ---- */
  dev: {
    title: '開發用示範面板（正式站不顯示）',
    intro: '僅供錄音室檢查操作流程。這裡的選項只改變畫面顯示，不會改變伺服器上的活動、權限或播放來源。',
    simulatedNotice: '目前顯示的是模擬狀態',
    status: {
      legend: '活動狀態',
      useReal: '使用實際狀態',
    },
    entitlement: {
      legend: '觀看資格（僅畫面顯示）',
      useDefault: '使用預設',
      guest: '未登入',
      not_entitled: '尚未取得資格',
      entitled: '已取得資格',
      unavailable: '無法確認資格',
    },
    fault: {
      legend: '故障注入（下一次播放操作）',
      none: '不注入',
      network: '網路中斷',
      decode: '解碼失敗',
      unsupported: '不支援的來源',
      play_blocked: '播放被瀏覽器阻擋',
    },
    reset: '重設全部',
  },
} as const;
