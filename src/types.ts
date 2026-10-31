/**
 * Shared contracts for the wg-live front end.
 *
 * The first block mirrors spec §8.5 verbatim (plus documented, non-sensitive
 * extensions). Everything below it is the M1 implementation contract that the
 * PHP plugin, the state layer, the adapters and the components agree on.
 * Change these only together with docs/implementation/M1-PLAN.md.
 */

/* ------------------------------------------------------------------ */
/* Spec §8.5 contracts                                                 */
/* ------------------------------------------------------------------ */

export type ListeningMode = 'binaural' | 'atmos';

/**
 * The one event 代稱 (slug) pattern (plan D14). Must stay byte-identical to
 * WG_Live\Events::SLUG_PATTERN in PHP — a unit test enforces this. Length 1–100.
 */
export const EVENT_SLUG_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
export const EVENT_SLUG_MAX_LENGTH = 100;

export type EventStatus =
  | 'scheduled'
  | 'doors_open'
  | 'live'
  | 'intermission'
  | 'ended'
  | 'cancelled';

/** Which kind of source an event is configured for. M1 only ever emits 'not_configured' | 'demo'. */
export type SourceKind = 'not_configured' | 'demo' | 'hls' | 'iframe';

export interface PosterImage {
  url: string;
  width: number;
  height: number;
  alt: string;
  srcset: string | null;
  sizes: string | null;
}

export interface PublicEvent {
  id: number;
  slug: string;
  title: string;
  performers: string[];
  /** Plain text. Never HTML; render with textContent. Newlines are paragraph breaks. */
  description: string;
  /** ISO 8601 in UTC, e.g. "2026-10-24T11:30:00Z". */
  startsAt: string;
  /** IANA zone used for display. Default 'Asia/Taipei'. */
  displayTimezone: string;
  status: EventStatus;
  posterUrl: string | null;
  mediaKind: 'audio' | 'video';
  availableModes: ListeningMode[];
  programme: string[];
  productUrl: string | null;
  replayAvailable: boolean;
  isDemo: boolean;

  /* --- non-sensitive extensions (not in spec §8.5) --- */
  /** Poster details for width/height (CLS) and responsive images. Null when no poster. */
  poster: PosterImage | null;
  /**
   * Which source kind the backend will try to resolve. Contains NO url or credential.
   * 'not_configured' means the player shows「播放來源尚未開放」without calling the playback endpoint.
   */
  sourceKind: SourceKind;
}

export type PlaybackSource =
  | { kind: 'not_ready'; reason: NotReadyReason }
  | { kind: 'demo'; url: string; mimeType: string }
  | { kind: 'hls'; url: string; mode: ListeningMode }
  | { kind: 'iframe'; url: string; allowedOrigin: string };

/** Server resolution order and UI mapping: plan §5.1 and §6.7. Never auto-retried. */
export type NotReadyReason =
  | 'disabled'
  | 'event_not_found'
  | 'mode_unavailable'
  | 'not_entitled'
  | 'entitlement_unavailable'
  | 'source_not_configured'
  | 'event_not_playable';

export interface EventProvider {
  list(signal?: AbortSignal): Promise<PublicEvent[]>;
  get(slug: string, signal?: AbortSignal): Promise<PublicEvent | null>;
}

export interface PlaybackSourceProvider {
  resolve(eventId: number, mode: ListeningMode, signal?: AbortSignal): Promise<PlaybackSource>;
}

export type EntitlementResult =
  | { status: 'guest' }
  | { status: 'not_entitled' }
  | { status: 'entitled' }
  | { status: 'unavailable'; reason: string };

export interface EntitlementProvider {
  get(eventId: number, signal?: AbortSignal): Promise<EntitlementResult>;
}

export interface PlayerCapabilities {
  playPause: boolean;
  /** Extension (spec §5.3 lists mute separately): mute works even where volume can't be set (iOS). */
  mute: boolean;
  /** False on iOS/iPadOS where HTMLMediaElement.volume is read-only — probed at boot, never UA-sniffed. */
  volume: boolean;
  seekToLive: boolean;
  fullscreen: boolean;
  remotePlayback: boolean;
  reliablePlaybackEvents: boolean;
}

/* ------------------------------------------------------------------ */
/* State axes (spec §6) — kept separate on purpose                     */
/* ------------------------------------------------------------------ */

export type PlayerStatus =
  | 'idle'
  | 'selecting'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'switching'
  | 'reconnecting'
  | 'failed';

export type EntitlementStatus = 'unknown' | 'guest' | 'not_entitled' | 'entitled' | 'unavailable';

/**
 * Error codes surfaced to the UI. Copy lives in src/i18n/copy.ts.
 * Retry policy (coordinator): only 'network' is auto-retried (bounded).
 */
export type PlayerErrorCode =
  | 'network'
  | 'decode'
  | 'unsupported'
  | 'not_configured'
  | 'not_entitled'
  | 'entitlement_unavailable'
  | 'play_blocked'
  | 'unknown';

export interface PlayerError {
  code: PlayerErrorCode;
  /** Mode whose load failed. */
  mode: ListeningMode | null;
  /** Short, generic, user-safe code shown in small print (e.g. "E-NET-02"). Never a URL or stack. */
  publicCode: string;
}

/* ------------------------------------------------------------------ */
/* Playback adapters (spec §9)                                         */
/* ------------------------------------------------------------------ */

export type AdapterEvent =
  | 'playing'
  | 'paused'
  | 'waiting'
  | 'stalled'
  | 'ended'
  | 'error';

export interface AdapterErrorDetail {
  code: Exclude<PlayerErrorCode, 'not_configured' | 'not_entitled' | 'entitlement_unavailable'>;
  /** True when the adapter/library already gave up after its own retries. */
  fatal: boolean;
}

export interface PlaybackAdapter {
  readonly kind: Exclude<SourceKind, 'not_configured'>;
  /**
   * Per-instance capabilities (plan §6.10). Final once load() has resolved;
   * the coordinator copies them into AppState after every load/switch.
   */
  readonly capabilities: PlayerCapabilities;
  /**
   * Load a source into the adapter. For media-element adapters this reuses the
   * single stable <audio>/<video> element owned by the player shell.
   * MUST assign the source synchronously before returning (media.src = …);
   * the returned promise only reports readiness (loadedmetadata / error) —
   * callers must NOT await it before play() (plan §6.3 start invariant).
   * Must not start playback by itself.
   */
  load(source: Exclude<PlaybackSource, { kind: 'not_ready' }>, signal: AbortSignal): Promise<void>;
  /**
   * Start playback. Call synchronously inside the user-gesture call stack (WebKit/iOS).
   * Rejects with DOMException 'NotAllowedError' when blocked, 'AbortError' when a
   * pause()/load() interrupted it (benign — plan §6.4), or 'NotSupportedError'
   * (classified per plan §6.5).
   */
  play(): Promise<void>;
  pause(): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  seekToLive(): void;
  /**
   * Stop playback and release everything. Order: remove own listeners FIRST, then
   * pause(), removeAttribute('src'), load() (or hls.destroy() / remove iframe).
   * After destroy() no network activity may continue. Must be idempotent.
   */
  destroy(): void;
  on(event: AdapterEvent, listener: (detail?: AdapterErrorDetail) => void): () => void;
}

export interface MediaHost {
  /**
   * The single, stable media element (plan D9): created once at mount inside
   * .wg-live__stage, preload="none", no autoplay/controls/<source> children,
   * playsinline for <video>. Never recreated on re-render.
   */
  readonly media: HTMLMediaElement;
  /** Container used by the iframe adapter (M2). */
  readonly frameSlot: HTMLElement;
}

/** Environment facts probed once at boot (plan §6.10). */
export interface AdapterEnv {
  /** Result of probeVolumeControl(); false on iOS/iPadOS. */
  volumeSettable: boolean;
  /** BootConfig.assets.hls: the plugin's own hls.js file (M2-PLAN C2). Absent or null: no hls.js path. */
  hlsScriptUrl?: string | null;
  /** Accessible name of a provider player frame: "<event title>・串流服務播放器" (M2-PLAN D2). */
  frameTitle?: string;
}

/** 'hls' plays through the HLS adapter (M2-PLAN C2); 'iframe' embeds the provider player (D2). */
export type AdapterFactory = (
  kind: PlaybackAdapter['kind'],
  host: MediaHost,
  env: AdapterEnv,
) => PlaybackAdapter;

/* ------------------------------------------------------------------ */
/* PHP -> JS bootstrap (rendered by the shortcode templates)           */
/* ------------------------------------------------------------------ */

export type LiveView = 'events' | 'player' | 'help';
export type DeploymentMode = 'disabled' | 'demo' | 'live';

export interface SiteLinks {
  home: string;
  events: string | null;
  player: string | null;
  help: string | null;
  account: string | null;
  store: string | null;
  contact: string | null;
}

export interface FaqItem {
  question: string;
  /** Plain text; newlines are paragraph breaks. */
  answer: string;
}

export type CompatibilityState = 'pending' | 'verified' | 'not_working';

export interface CompatibilityRow {
  device: string;
  os: string;
  browser: string;
  outputPath: string;
  sourceFormat: string;
  status: CompatibilityState;
  /** ISO date (YYYY-MM-DD) or null when untested. */
  testedAt: string | null;
  notes: string;
}

export interface HelpContent {
  faq: FaqItem[];
  compatibility: CompatibilityRow[];
  /** Optional admin note shown above the contact link. Plain text. */
  supportNote: string;
}

/**
 * JSON inside <script type="application/json" class="wg-live__config">.
 * Non-sensitive only: no source URLs, tokens, user data, order data or raw options.
 */
export interface BootConfig {
  schema: 1;
  pluginVersion: string;
  view: LiveView;
  deploymentMode: DeploymentMode;
  /** Site default display zone (event-level displayTimezone wins). */
  timezone: string;
  rest: {
    /**
     * Output of rest_url('wg-live/v1/'): either the pretty form
     * ".../wp-json/wg-live/v1/" or the plain form ".../index.php?rest_route=/wg-live/v1/".
     * Never concatenate — build request URLs with util/url.ts restUrl().
     */
    root: string;
    /** wp_rest nonce for logged-in viewers (M2-PLAN A2); null for guests. Sent as X-WP-Nonce. */
    nonce: string | null;
    /** admin-ajax.php?action=rest-nonce: returns a fresh nonce for the cookie user (A3 retry). */
    nonceUrl: string;
  };
  /** Separately loaded scripts (M2-PLAN C1). */
  assets: {
    /** Versioned URL of wg-live-hls.js (pinned hls.js, defines window.WGLiveHls); null when the build lacks it. */
    hls: string | null;
  };
  links: SiteLinks;
  /** Slug fixed via shortcode `event` attribute; overrides ?wg_event=. */
  fixedEventSlug: string | null;
  /** Settings featured event when published + public, else null (view falls back, plan §6.1). */
  featuredEventSlug: string | null;
  /** Heading level for the view title (shortcode attr, plan §3.3). */
  heading: 'h1' | 'h2';
  /** Published, publicly visible events (already filtered server-side). */
  events: PublicEvent[];
  help: HelpContent;
  /** True only when the server confirmed a dev environment or an authorized preview. */
  devTools: boolean;
}

/* ------------------------------------------------------------------ */
/* Player controller (coordinator) API consumed by components          */
/* ------------------------------------------------------------------ */

export interface AppState {
  event: {
    data: PublicEvent | null;
    status: EventStatus | null;
    /** True when the dev panel overrode the status (shown in the dev panel only). */
    simulated: boolean;
  };
  player: {
    status: PlayerStatus;
    /** Mode picked in the selector (not yet loaded). */
    selectedMode: ListeningMode | null;
    /** Mode whose source descriptor has been resolved (prefetched) — Start requires preparedMode === selectedMode. */
    preparedMode: ListeningMode | null;
    /** Mode whose source is currently attached to the adapter (may not be playing yet). */
    loadedMode: ListeningMode | null;
    /** Mode confirmed by a 'playing' event; drives「目前播放」together with confirmedPlaying. */
    activeMode: ListeningMode | null;
    /** True only after the adapter reported 'playing' for loadedMode. Drives「目前播放」. */
    confirmedPlaying: boolean;
    /** Target mode while status === 'switching'. */
    pendingMode: ListeningMode | null;
    /** Last mode that actually played; offered as「重新載入」after a failed switch. */
    lastGoodMode: ListeningMode | null;
    error: PlayerError | null;
    /** Present while auto-retrying a network error. */
    retry: { attempt: number; max: number } | null;
    muted: boolean;
    volume: number;
  };
  entitlement: EntitlementStatus;
  /** Last server not_ready reason for the selected mode (plan §6.7), else null. */
  notReady: NotReadyReason | null;
  source: SourceKind;
  capabilities: PlayerCapabilities | null;
  /** Demo media in use — UI must show the demo disclaimer in every mode. */
  isDemoMedia: boolean;
  deploymentMode: DeploymentMode;
}

export interface PlayerController {
  getState(): AppState;
  subscribe(listener: (state: AppState) => void): () => void;
  /** Selects a mode and prefetches its source descriptor (JSON only, no media). */
  selectMode(mode: ListeningMode): void;
  /**
   * Must be called directly from the click handler (user gesture). Invariant:
   * no await before adapter.play() — destroy → load (not awaited) → play, sync.
   */
  start(): Promise<void>;
  /** Pause/resume. Resume after play_blocked calls adapter.play() directly (no re-resolve). */
  togglePlay(): Promise<void>;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  seekToLive(): void;
  /** Called when the switch dialog opens: prefetch the other mode's descriptor. */
  prepareSwitch(mode: ListeningMode): void;
  /** Called synchronously from the dialog's confirm click handler. */
  switchMode(mode: ListeningMode): Promise<void>;
  /** Manual retry of the last attempted mode. */
  retry(): Promise<void>;
  /** Re-fetch entitlement after 'unavailable' (plan §6.2). */
  retryEntitlement(): Promise<void>;
  /** Reload the last mode that worked (after a failed switch). */
  reloadLastGood(): Promise<void>;
  /**
   * Stop playback and release the adapter (pagehide / unmount / status change).
   * Semantics: plan §6.4 — bumps requestId, aborts fetches, clears ALL timers.
   */
  stop(): void;
  /** Apply a new event snapshot from polling (status changes etc.). */
  updateEvent(event: PublicEvent): void;
  destroy(): void;
}

/* ------------------------------------------------------------------ */
/* Dev/demo state panel (spec §5.6) — only wired when devTools === true */
/* ------------------------------------------------------------------ */

export type DevFault = 'network' | 'decode' | 'unsupported' | 'play_blocked';

export interface DevControls {
  /** null = use the real (server) status again. */
  setEventStatus(status: EventStatus | null): void;
  /** Simulated entitlement for demo events only. null = default for the demo. */
  setEntitlement(status: EntitlementResult['status'] | null): void;
  /** Next adapter operation fails with this fault. null clears it. */
  injectFault(fault: DevFault | null): void;
}
