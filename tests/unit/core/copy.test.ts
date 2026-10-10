import { describe, expect, it } from 'vitest';
import {
  DEMO_EVENT_BADGE,
  DEMO_MEDIA_NOTICE,
  errorCopy,
  eventsCopy,
  failedCopy,
  helpCopy,
  notReadyCopy,
  playerCopy,
  statusCopy,
} from '../../../src/i18n/copy';
import type { EventStatus, ListeningMode, NotReadyReason, PlayerErrorCode } from '../../../src/types';

const ERROR_CODES: PlayerErrorCode[] = [
  'network',
  'decode',
  'unsupported',
  'not_configured',
  'not_entitled',
  'entitlement_unavailable',
  'play_blocked',
  'unknown',
];

const NOT_READY: NotReadyReason[] = [
  'disabled',
  'event_not_found',
  'mode_unavailable',
  'not_entitled',
  'entitlement_unavailable',
  'source_not_configured',
  'event_not_playable',
];

const STATUSES: EventStatus[] = ['scheduled', 'doors_open', 'live', 'intermission', 'ended', 'cancelled'];

describe('copy aggregation', () => {
  it('re-exports every copy group and the demo constants', () => {
    expect(statusCopy).toBeDefined();
    expect(eventsCopy).toBeDefined();
    expect(playerCopy).toBeDefined();
    expect(helpCopy).toBeDefined();
    expect(DEMO_EVENT_BADGE).toBe('介面示範');
    expect(DEMO_MEDIA_NOTICE).toBe('操作示範音訊，非 Binaural／Atmos 驗證素材');
    expect(statusCopy.demo.badge).toBe(DEMO_EVENT_BADGE);
    expect(statusCopy.demo.mediaNotice).toBe(DEMO_MEDIA_NOTICE);
  });
});

describe('errorCopy / notReadyCopy are total', () => {
  it.each(ERROR_CODES)('errorCopy(%s) is a non-empty string without URLs or stacks', (code) => {
    const text = errorCopy(code);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/https?:|\bat \w+\.|Error:/);
  });

  it.each(NOT_READY)('notReadyCopy(%s) is a non-empty string', (reason) => {
    const text = notReadyCopy(reason);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('maps the spec strings verbatim (plan 6.7, spec 6)', () => {
    expect(notReadyCopy('disabled')).toBe('線上音樂會尚未開放');
    expect(notReadyCopy('source_not_configured')).toBe('播放來源尚未開放');
    expect(notReadyCopy('event_not_found')).toBe('找不到這場活動');
    expect(notReadyCopy('mode_unavailable')).toBe('目前環境無法播放這個音訊版本');
    expect(notReadyCopy('not_entitled')).toBe('尚未取得觀看資格');
    expect(notReadyCopy('entitlement_unavailable')).toBe('暫時無法確認觀看資格');
    expect(errorCopy('play_blocked')).toBe('請點擊開始聆聽');
    expect(errorCopy('unsupported')).toBe('目前環境無法播放這個音訊版本');
    expect(errorCopy('network')).toBe('連線暫時中斷，正在重新連線');
  });

  it('failedCopy: a network failure that used up its retries is not "reconnecting" (help page copy)', () => {
    expect(failedCopy('network')).toBe('無法播放，請重試');
    expect(failedCopy('network')).toBe(statusCopy.player.failed);
    for (const code of ERROR_CODES.filter((c) => c !== 'network')) expect(failedCopy(code)).toBe(errorCopy(code));
    expect(helpCopy.reconnect.paragraphs.join('')).toContain(`「${failedCopy('network')}」`);
  });
});

describe('statusCopy', () => {
  it('holds the spec section 6 table strings', () => {
    expect(statusCopy.gate.scheduled.title).toBe('演出尚未開始');
    expect(statusCopy.gate.doorsOpen.title).toBe('即將開放聆聽');
    expect(statusCopy.player.loading).toBe('正在連接音訊');
    expect(statusCopy.player.playBlocked).toBe('請點擊開始聆聽');
    expect(statusCopy.player.reconnecting).toBe('連線暫時中斷，正在重新連線');
    expect(statusCopy.player.unsupported).toBe('目前環境無法播放這個音訊版本');
    expect(statusCopy.gate.sourceNotConfigured.title).toBe('播放來源尚未開放');
    expect(statusCopy.gate.intermission.title).toBe('演出中場休息');
    expect(statusCopy.gate.ended.title).toBe('本場演出已結束');
    expect(statusCopy.gate.cancelled.title).toBe('本場活動已取消');
    expect(statusCopy.entitlement.unavailable.message).toBe('暫時無法確認觀看資格');
  });

  it('has a label for every event status and both modes', () => {
    for (const s of STATUSES) expect(statusCopy.eventStatus[s].length).toBeGreaterThan(0);
    const modes: ListeningMode[] = ['binaural', 'atmos'];
    for (const m of modes) expect(statusCopy.modeName[m].length).toBeGreaterThan(0);
  });

  it('builds the 已選擇 / 目前播放 labels', () => {
    expect(statusCopy.selectedMode(statusCopy.modeName.atmos)).toBe('已選擇：Dolby Atmos 音軌');
    expect(statusCopy.currentMode(statusCopy.modeName.binaural)).toBe('目前播放：Binaural');
  });

  it('pins the entitlement panel, CTA and action strings', () => {
    expect(statusCopy.entitlement.guest.message).toBe('請先登入');
    expect(statusCopy.entitlement.notEntitled.message).toBe('尚未取得觀看資格');
    expect(statusCopy.cta).toMatchObject({
      viewDetails: '查看活動資訊',
      demo: '體驗播放介面',
      enter: '進入聆聽',
      viewEvent: '查看活動',
    });
    expect(statusCopy.action.start).toBe('開始聆聽');
    expect(statusCopy.action.fallbackBinaural).toBe('改用耳機 Binaural');
    expect(statusCopy.bootError).toBe('Live 介面暫時無法載入');
  });

  it('never claims certification, device output or fake liveness', () => {
    const everything = JSON.stringify(statusCopy, (_k, v: unknown) => (typeof v === 'function' ? v('X', 'Y') : v));
    expect(everything).not.toMatch(/認證|已連線|7\.1\.4|Dolby 認證|觀看人數|同步/);
  });
});
