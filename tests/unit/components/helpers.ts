/**
 * Shared test helpers for the player components and the player view: state builders and a fake
 * PlayerController that records calls and lets a test push new states to subscribers.
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { demoEvents } from '../../../src/fixtures/demo-events';
import { createInitialState } from '../../../src/state/model';
import type {
  AppState,
  BootConfig,
  DevControls,
  ListeningMode,
  PlayerCapabilities,
  PlayerController,
  PublicEvent,
  SiteLinks,
} from '../../../src/types';

export const LINKS: SiteLinks = {
  home: 'https://example.test/',
  events: 'https://example.test/live/',
  player: 'https://example.test/live/listen/',
  help: 'https://example.test/live/help/',
  account: 'https://example.test/my-account/',
  store: 'https://example.test/store/',
  contact: 'https://example.test/contact/',
};

export const FULL_CAPS: PlayerCapabilities = {
  playPause: true,
  mute: true,
  volume: true,
  seekToLive: false,
  fullscreen: false,
  remotePlayback: false,
  reliablePlaybackEvents: true,
};

/** The first demo event is `live` with both modes, an audio stream and sourceKind `demo`. */
export function makeEvent(overrides: Partial<PublicEvent> = {}): PublicEvent {
  const base = demoEvents(Date.parse('2026-10-24T12:00:00Z'))[0] as PublicEvent;
  return { ...base, ...overrides };
}

export function makeBoot(overrides: Partial<BootConfig> = {}): BootConfig {
  const event = makeEvent();
  return {
    schema: 1,
    pluginVersion: '0.1.0',
    view: 'player',
    deploymentMode: 'demo',
    timezone: 'Asia/Taipei',
    rest: { root: 'https://example.test/wp-json/wg-live/v1/', nonce: null, nonceUrl: '' },
    assets: { hls: null },
    links: { ...LINKS },
    fixedEventSlug: null,
    featuredEventSlug: null,
    heading: 'h2',
    events: [event],
    help: { faq: [], compatibility: [], supportNote: '' },
    devTools: false,
    ...overrides,
  };
}

export interface StatePatch {
  event?: Partial<AppState['event']>;
  player?: Partial<AppState['player']>;
  entitlement?: AppState['entitlement'];
  notReady?: AppState['notReady'];
  source?: AppState['source'];
  capabilities?: AppState['capabilities'];
  isDemoMedia?: boolean;
  deploymentMode?: AppState['deploymentMode'];
}

/** Initial state for `event` (default: the live demo event) with `patch` applied on top. */
export function makeState(patch: StatePatch = {}, event: PublicEvent = makeEvent(), preselect: ListeningMode | null = null): AppState {
  const base = createInitialState(makeBoot({ events: [event] }), event, preselect);
  return {
    ...base,
    ...(patch.entitlement !== undefined ? { entitlement: patch.entitlement } : {}),
    ...(patch.notReady !== undefined ? { notReady: patch.notReady } : {}),
    ...(patch.source !== undefined ? { source: patch.source } : {}),
    ...(patch.capabilities !== undefined ? { capabilities: patch.capabilities } : {}),
    ...(patch.isDemoMedia !== undefined ? { isDemoMedia: patch.isDemoMedia } : {}),
    ...(patch.deploymentMode !== undefined ? { deploymentMode: patch.deploymentMode } : {}),
    event: { ...base.event, ...patch.event },
    player: { ...base.player, ...patch.player },
  };
}

/** A state in which「開始聆聽」is enabled: live demo event, entitled, descriptor prepared. */
export function readyState(mode: ListeningMode = 'binaural', patch: StatePatch = {}): AppState {
  return makeState(
    {
      entitlement: 'entitled',
      ...patch,
      player: { status: 'selecting', selectedMode: mode, preparedMode: mode, ...patch.player },
    },
  );
}

/** A state while playing `mode` (confirmed). */
export function playingState(mode: ListeningMode = 'binaural', patch: StatePatch = {}): AppState {
  return makeState({
    entitlement: 'entitled',
    capabilities: FULL_CAPS,
    ...patch,
    player: {
      status: 'playing',
      selectedMode: mode,
      preparedMode: mode,
      loadedMode: mode,
      activeMode: mode,
      confirmedPlaying: true,
      lastGoodMode: mode,
      ...patch.player,
    },
  });
}

export interface FakeController extends PlayerController {
  dev: DevControls | null;
  /** Replace the state and notify subscribers. */
  set(next: AppState): void;
  /** Shallow patch of the current state. */
  patch(patch: StatePatch): void;
  listenerCount(): number;
  calls: {
    selectMode: Mock<(mode: ListeningMode) => void>;
    start: Mock<() => Promise<void>>;
    togglePlay: Mock<() => Promise<void>>;
    setMuted: Mock<(muted: boolean) => void>;
    setVolume: Mock<(volume: number) => void>;
    seekToLive: Mock<() => void>;
    prepareSwitch: Mock<(mode: ListeningMode) => void>;
    switchMode: Mock<(mode: ListeningMode) => Promise<void>>;
    retry: Mock<() => Promise<void>>;
    retryEntitlement: Mock<() => Promise<void>>;
    reloadLastGood: Mock<() => Promise<void>>;
    stop: Mock<() => void>;
    updateEvent: Mock<(event: PublicEvent) => void>;
    destroy: Mock<() => void>;
  };
}

export function createFakeController(initial: AppState, dev: DevControls | null = null): FakeController {
  let state = initial;
  const listeners = new Set<(s: AppState) => void>();
  const ok = (): Promise<void> => Promise.resolve();
  const calls: FakeController['calls'] = {
    selectMode: vi.fn<(mode: ListeningMode) => void>(),
    start: vi.fn<() => Promise<void>>(ok),
    togglePlay: vi.fn<() => Promise<void>>(ok),
    setMuted: vi.fn<(muted: boolean) => void>(),
    setVolume: vi.fn<(volume: number) => void>(),
    seekToLive: vi.fn<() => void>(),
    prepareSwitch: vi.fn<(mode: ListeningMode) => void>(),
    switchMode: vi.fn<(mode: ListeningMode) => Promise<void>>(ok),
    retry: vi.fn<() => Promise<void>>(ok),
    retryEntitlement: vi.fn<() => Promise<void>>(ok),
    reloadLastGood: vi.fn<() => Promise<void>>(ok),
    stop: vi.fn<() => void>(),
    updateEvent: vi.fn<(event: PublicEvent) => void>(),
    destroy: vi.fn<() => void>(),
  };

  const controller: FakeController = {
    dev,
    calls,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    selectMode: (mode) => calls.selectMode(mode),
    start: () => calls.start(),
    togglePlay: () => calls.togglePlay(),
    setMuted: (muted) => calls.setMuted(muted),
    setVolume: (volume) => calls.setVolume(volume),
    seekToLive: () => calls.seekToLive(),
    prepareSwitch: (mode) => calls.prepareSwitch(mode),
    switchMode: (mode) => calls.switchMode(mode),
    retry: () => calls.retry(),
    retryEntitlement: () => calls.retryEntitlement(),
    reloadLastGood: () => calls.reloadLastGood(),
    stop: () => calls.stop(),
    updateEvent: (event) => calls.updateEvent(event),
    destroy: () => calls.destroy(),
    set(next) {
      state = next;
      for (const listener of Array.from(listeners)) listener(state);
    },
    patch(patch) {
      controller.set(mergeState(state, patch));
    },
    listenerCount: () => listeners.size,
  };
  return controller;
}

function mergeState(state: AppState, patch: StatePatch): AppState {
  return {
    ...state,
    ...(patch.entitlement !== undefined ? { entitlement: patch.entitlement } : {}),
    ...(patch.notReady !== undefined ? { notReady: patch.notReady } : {}),
    ...(patch.source !== undefined ? { source: patch.source } : {}),
    ...(patch.capabilities !== undefined ? { capabilities: patch.capabilities } : {}),
    ...(patch.isDemoMedia !== undefined ? { isDemoMedia: patch.isDemoMedia } : {}),
    ...(patch.deploymentMode !== undefined ? { deploymentMode: patch.deploymentMode } : {}),
    event: { ...state.event, ...patch.event },
    player: { ...state.player, ...patch.player },
  };
}

export interface FakeDev extends DevControls {
  setEventStatus: Mock<DevControls['setEventStatus']>;
  setEntitlement: Mock<DevControls['setEntitlement']>;
  injectFault: Mock<DevControls['injectFault']>;
}

export function fakeDev(): FakeDev {
  return {
    setEventStatus: vi.fn<DevControls['setEventStatus']>(),
    setEntitlement: vi.fn<DevControls['setEntitlement']>(),
    injectFault: vi.fn<DevControls['injectFault']>(),
  };
}

/** Attach to the document so focus() works in jsdom; returns a disposer via afterEach cleanup. */
export function attach<T extends HTMLElement>(el: T): T {
  document.body.append(el);
  return el;
}
