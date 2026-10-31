/**
 * Ticket holders' stream link for an external player (decision 2026-11-01, DECISION-2026-11-01-atmos-only.md).
 * Proposed copy, for approval.
 */
export const externalCopy = {
  heading: '用其他播放器收聽',
  unsupported: '這個瀏覽器無法播放 Dolby Atmos 串流。請用下方的個人播放連結收聽。',
  failed: '播放發生問題時，可以改用下方的個人播放連結收聽。',
  get: '取得我的播放連結',
  getAgain: '重新取得播放連結',
  loading: '正在取得播放連結…',
  linkLabel: '我的播放連結',
  copy: '複製連結',
  copied: '已複製',
  copyFailed: '無法自動複製，請手動選取連結複製。',
  open: '在新分頁開啟',
  unavailable: '暫時無法取得播放連結，請稍後再試。',
  private: '這個連結只供你本人使用，請勿分享。',
  stepsHeading: '播放方式',
  stepVlc: 'Windows：安裝 VLC，選「媒體 → 開啟網路串流」，貼上連結後按「播放」。',
  stepSafari: 'Mac、iPhone、iPad：用 Safari 開啟連結即可播放。',
} as const;
