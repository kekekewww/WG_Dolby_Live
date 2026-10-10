import type { PosterImage, PublicEvent } from '../types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const POSTER: PosterImage = {
  url: '/demo/poster-demo.svg',
  width: 1200,
  height: 675,
  alt: '介面示範用海報（非實際活動）',
  srcset: null,
  sizes: null,
};

/**
 * Three demo events for the dev harness and unit tests. Start times are computed
 * relative to `now` at call time so the statuses stay plausible. All titles are
 * marked「介面示範」; none of this is real programme information.
 */
export function demoEvents(now: number = Date.now()): PublicEvent[] {
  const live: PublicEvent = {
    id: 9001,
    slug: 'demo-live-binaural-atmos',
    title: '【介面示範】錄音室現場音樂會 Live',
    performers: ['示範樂手 A', '示範樂手 B'],
    description: '這是介面示範活動，用來確認播放流程與版面。\n內容不是實際演出，也不是真實售票活動。',
    startsAt: iso(now - 20 * MINUTE),
    displayTimezone: 'Asia/Taipei',
    status: 'live',
    posterUrl: POSTER.url,
    mediaKind: 'audio',
    availableModes: ['binaural', 'atmos'],
    programme: ['示範曲目 一', '示範曲目 二', '示範曲目 三'],
    productUrl: null,
    replayAvailable: false,
    isDemo: true,
    poster: POSTER,
    sourceKind: 'demo',
  };

  const scheduled: PublicEvent = {
    id: 9002,
    slug: 'demo-scheduled',
    title: '【介面示範】即將開始的音樂會',
    performers: ['示範樂手 C'],
    description: '這是介面示範活動，演出時間尚未到。\n用來確認「尚未開始」狀態與倒數顯示。',
    startsAt: iso(now + 3 * DAY),
    displayTimezone: 'Asia/Taipei',
    status: 'scheduled',
    posterUrl: POSTER.url,
    mediaKind: 'audio',
    availableModes: ['binaural', 'atmos'],
    programme: ['示範曲目 四', '示範曲目 五'],
    productUrl: null,
    replayAvailable: false,
    isDemo: true,
    poster: POSTER,
    sourceKind: 'demo',
  };

  const ended: PublicEvent = {
    id: 9003,
    slug: 'demo-ended',
    title: '【介面示範】已結束的音樂會',
    performers: ['示範樂手 D', '示範樂手 E'],
    description: '這是介面示範活動，演出已經結束。\n用來確認「已結束」狀態。',
    startsAt: iso(now - 7 * DAY),
    displayTimezone: 'Asia/Taipei',
    status: 'ended',
    posterUrl: null,
    mediaKind: 'audio',
    availableModes: ['binaural'],
    programme: ['示範曲目 六'],
    productUrl: null,
    replayAvailable: false,
    isDemo: true,
    poster: null,
    sourceKind: 'demo',
  };

  return [live, scheduled, ended];
}
