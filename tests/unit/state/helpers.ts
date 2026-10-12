/**
 * Test doubles for the state layer: a fake PlaybackAdapter (implements the real interface), fake
 * providers with per-call control, and a harness that wires a PlayerController around them.
 */
import { vi } from 'vitest';
import type {
  AdapterErrorDetail,
  AdapterEvent,
  AdapterFactory,
  AppState,
  BootConfig,
  EntitlementProvider,
  EntitlementResult,
  ListeningMode,
  MediaHost,
  NotReadyReason,
  PlaybackAdapter,
  PlaybackSource,
  PlayerCapabilities,
  PlayerController,
  PublicEvent,
  DevControls,
} from '../../../src/types';
import { createPlayerController } from '../../../src/state/coordinator';
import type { CoordinatorDeps } from '../../../src/state/coordinator';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

export function makeEvent(patch: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: 101,
    slug: 'demo-live',
    title: '【介面示範】測試音樂會',
    performers: ['示範樂手'],
    description: '',
    startsAt: '2026-10-24T11:30:00Z',
    displayTimezone: 'Asia/Taipei',
    status: 'live',
    posterUrl: null,
    mediaKind: 'audio',
    availableModes: ['binaural', 'atmos'],
    programme: [],
    productUrl: null,
    replayAvailable: false,
    isDemo: true,
    poster: null,
    sourceKind: 'demo',
    ...patch,
  };
}

export function makeBoot(patch: Partial<BootConfig> = {}): BootConfig {
  return {
    schema: 1,
    pluginVersion: '0.1.0',
    view: 'player',
    deploymentMode: 'demo',
    timezone: 'Asia/Taipei',
    rest: { root: '/wp-json/wg-live/v1/' },
    links: {
      home: '/',
      events: '/live/',
      player: '/live/listen/',
      help: '/live/help/',
      account: '/my-account/',
      store: null,
      contact: null,
    },
    fixedEventSlug: null,
    featuredEventSlug: null,
    heading: 'h2',
    events: [],
    help: { faq: [], compatibility: [], supportNote: '' },
    devTools: false,
    ...patch,
  };
}

/* ------------------------------------------------------------------ */
/* Deferred                                                            */
/* ------------------------------------------------------------------ */

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function domError(name: string, message = name): DOMException {
  return new DOMException(message, name);
}

/* ------------------------------------------------------------------ */
/* Fake adapter                                                        */
/* ------------------------------------------------------------------ */

type Listener = (detail?: AdapterErrorDetail) => void;
type LoadableSource = Exclude<PlaybackSource, { kind: 'not_ready' }>;

export const FULL_CAPS: PlayerCapabilities = {
  playPause: true,
  mute: true,
  volume: true,
  seekToLive: false,
  fullscreen: false,
  remotePlayback: false,
  reliablePlaybackEvents: true,
};

export interface AdapterScript {
  /** What load() returns. Default: resolves. A Deferred lets the test settle it later. */
  load?: 'resolve' | Deferred<void> | Error | DOMException;
  /** What play() returns. Default: resolves. */
  play?: 'resolve' | 'blocked' | 'abort' | 'unsupported' | Deferred<void>;
}

/** A recorded adapter call, in call order, across all adapters (for the start-invariant tests). */
export type CallLogEntry = string;

export class FakeAdapter implements PlaybackAdapter {
  readonly kind: PlaybackAdapter['kind'] = 'demo';
  capabilities: PlayerCapabilities = { ...FULL_CAPS };
  sources: LoadableSource[] = [];
  playCalls = 0;
  pauseCalls = 0;
  mutedCalls: boolean[] = [];
  volumeCalls: number[] = [];
  seekCalls = 0;
  destroyed = false;
  destroyCount = 0;
  loadSignal: AbortSignal | null = null;
  private readonly listeners = new Map<AdapterEvent, Set<Listener>>();

  constructor(
    readonly id: number,
    private readonly script: AdapterScript,
    private readonly log: CallLogEntry[],
    private readonly alive: Set<FakeAdapter>,
  ) {
    alive.add(this);
  }

  load(source: LoadableSource, signal: AbortSignal): Promise<void> {
    this.log.push(`load#${this.id}`);
    this.sources.push(source);
    this.loadSignal = signal;
    const mode = this.script.load ?? 'resolve';
    if (mode === 'resolve') return Promise.resolve();
    if ('promise' in mode) return mode.promise;
    return Promise.reject(mode);
  }

  play(): Promise<void> {
    this.log.push(`play#${this.id}`);
    this.playCalls += 1;
    const mode = this.script.play ?? 'resolve';
    if (mode === 'resolve') return Promise.resolve();
    if (mode === 'blocked') return Promise.reject(domError('NotAllowedError'));
    if (mode === 'abort') return Promise.reject(domError('AbortError'));
    if (mode === 'unsupported') return Promise.reject(domError('NotSupportedError'));
    return mode.promise;
  }

  pause(): void {
    this.pauseCalls += 1;
  }
  setMuted(muted: boolean): void {
    this.mutedCalls.push(muted);
  }
  setVolume(volume: number): void {
    this.volumeCalls.push(volume);
  }
  seekToLive(): void {
    this.seekCalls += 1;
  }

  destroy(): void {
    this.log.push(`destroy#${this.id}`);
    this.destroyCount += 1;
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.alive.delete(this);
  }

  on(event: AdapterEvent, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Dispatch an adapter event to the coordinator, like the real adapter would. */
  emit(event: AdapterEvent, detail?: AdapterErrorDetail): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(detail);
  }

  /** True when the coordinator still listens to this adapter (it removes its listeners on teardown). */
  get hasListeners(): boolean {
    return [...this.listeners.values()].some((set) => set.size > 0);
  }
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export interface PlaybackCall {
  eventId: number;
  mode: ListeningMode;
  signal: AbortSignal | undefined;
}

export class FakePlaybackProvider {
  calls: PlaybackCall[] = [];
  /** Per-mode fixed answers; unset modes resolve to a demo source. */
  answers = new Map<ListeningMode, PlaybackSource>();
  /** Per-mode hold: the next resolve() for that mode waits for the deferred. */
  holds = new Map<ListeningMode, Deferred<PlaybackSource>>();
  failWith: Error | null = null;

  resolve = (eventId: number, mode: ListeningMode, signal?: AbortSignal): Promise<PlaybackSource> => {
    this.calls.push({ eventId, mode, signal });
    const hold = this.holds.get(mode);
    const result = (): Promise<PlaybackSource> => {
      if (this.failWith) return Promise.reject(this.failWith);
      return Promise.resolve(this.answers.get(mode) ?? { kind: 'demo', url: `/media/${mode}.mp3`, mimeType: 'audio/mpeg' });
    };
    const settle = hold ? hold.promise : result();
    if (hold) this.holds.delete(mode);
    if (!signal) return settle;
    return new Promise<PlaybackSource>((resolve, reject) => {
      if (signal.aborted) return reject(domError('AbortError'));
      signal.addEventListener('abort', () => reject(domError('AbortError')), { once: true });
      settle.then(resolve, reject);
    });
  };

  hold(mode: ListeningMode): Deferred<PlaybackSource> {
    const d = deferred<PlaybackSource>();
    this.holds.set(mode, d);
    return d;
  }

  notReady(mode: ListeningMode, reason: NotReadyReason): void {
    this.answers.set(mode, { kind: 'not_ready', reason });
  }

  callsFor(mode: ListeningMode): PlaybackCall[] {
    return this.calls.filter((c) => c.mode === mode);
  }
}

export class FakeEntitlementProvider {
  calls: Array<{ eventId: number; signal: AbortSignal | undefined }> = [];
  answer: EntitlementResult = { status: 'entitled' };
  hold: Deferred<EntitlementResult> | null = null;
  failWith: Error | null = null;

  get = (eventId: number, signal?: AbortSignal): Promise<EntitlementResult> => {
    this.calls.push({ eventId, signal });
    if (this.failWith) return Promise.reject(this.failWith);
    if (this.hold) {
      const h = this.hold;
      this.hold = null;
      return h.promise;
    }
    return Promise.resolve(this.answer);
  };
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

export interface Harness {
  controller: PlayerController & { dev: DevControls | null };
  playback: FakePlaybackProvider;
  entitlement: FakeEntitlementProvider;
  adapters: FakeAdapter[];
  alive: Set<FakeAdapter>;
  log: CallLogEntry[];
  host: MediaHost;
  root: HTMLElement;
  remembered: ListeningMode[];
  scripts: AdapterScript[];
  /** The newest adapter. */
  last(): FakeAdapter;
  setTime(seconds: number): void;
  state(): AppState;
  /** Let promise callbacks run (fake timers stay fake). */
  flush(): Promise<void>;
  /** Advance the fake clock and flush promises. */
  advance(ms: number): Promise<void>;
  destroy(): void;
}

export interface HarnessOptions {
  event?: PublicEvent | null;
  boot?: Partial<BootConfig>;
  preselect?: ListeningMode | null;
  entitlement?: EntitlementResult;
  /** Replace the fake entitlement provider (for example with the real client placeholder). */
  entitlementProvider?: EntitlementProvider;
  /** Scripts consumed in order by created adapters; later adapters use the last (or the default). */
  scripts?: AdapterScript[];
  /** Skip the initial prefetch/entitlement flush (to observe the in-flight state). */
  noFlush?: boolean;
}

/** Create a controller around fakes. Call inside a test that has vi.useFakeTimers() active. */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const event = options.event === undefined ? makeEvent() : options.event;
  const playback = new FakePlaybackProvider();
  const entitlement = new FakeEntitlementProvider();
  if (options.entitlement) entitlement.answer = options.entitlement;

  const adapters: FakeAdapter[] = [];
  const alive = new Set<FakeAdapter>();
  const log: CallLogEntry[] = [];
  const scripts = [...(options.scripts ?? [])];
  const remembered: ListeningMode[] = [];

  const media = document.createElement('audio');
  let time = 0;
  Object.defineProperty(media, 'currentTime', { get: () => time, set: (v: number) => (time = v), configurable: true });
  Object.defineProperty(media, 'readyState', { get: () => 0, configurable: true });
  media.canPlayType = () => 'maybe';
  const host: MediaHost = { media, frameSlot: document.createElement('div') };

  const root = document.createElement('div');
  root.className = 'wg-live wg-live--player';
  document.body.append(root);

  const adapterFactory: AdapterFactory = () => {
    const script = scripts[adapters.length] ?? scripts[scripts.length - 1] ?? {};
    // Single-adapter invariant: the previous adapter must be gone before a new one is made.
    log.push(`create#${adapters.length}:alive=${alive.size}`);
    const adapter = new FakeAdapter(adapters.length, script, log, alive);
    adapters.push(adapter);
    return adapter;
  };

  const deps: CoordinatorDeps = {
    boot: makeBoot(options.boot),
    event,
    host,
    env: { volumeSettable: true },
    adapterFactory,
    playbackProvider: { resolve: playback.resolve },
    entitlementProvider: options.entitlementProvider ?? { get: entitlement.get },
    eventProvider: { list: () => Promise.resolve([]), get: () => Promise.resolve(null) },
    root,
    preselect: options.preselect ?? null,
    onModeRemembered: (mode) => remembered.push(mode),
  };

  const controller = createPlayerController(deps);

  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };
  const advance = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
  };
  if (!options.noFlush) await flush();

  return {
    controller,
    playback,
    entitlement,
    adapters,
    alive,
    log,
    host,
    root,
    remembered,
    scripts,
    last: () => {
      const a = adapters[adapters.length - 1];
      if (!a) throw new Error('no adapter was created');
      return a;
    },
    setTime: (s) => {
      time = s;
    },
    state: () => controller.getState(),
    flush,
    advance,
    destroy: () => {
      controller.destroy();
      root.remove();
    },
  };
}

/** Select a mode and wait until its descriptor is prepared. */
export async function prepare(h: Harness, mode: ListeningMode = 'binaural'): Promise<void> {
  h.controller.selectMode(mode);
  await h.flush();
}

/** Prepare, start, and make the adapter report `playing`. */
export async function startPlaying(h: Harness, mode: ListeningMode = 'binaural'): Promise<FakeAdapter> {
  await prepare(h, mode);
  const started = h.controller.start();
  await h.flush();
  await started;
  const adapter = h.last();
  adapter.emit('playing');
  return adapter;
}

export function statusOf(h: Harness): string {
  return h.state().player.status;
}
