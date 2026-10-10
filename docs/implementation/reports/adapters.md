# Report: adapters

## Files (all LF)

- `src/adapters/native-media.ts`: PlaybackAdapter over `host.media`. Exports `createNativeMediaAdapter(host, env, {kind?, loop?})`, `classifyMediaFailure(media, mediaErrorCode, mimeSupported)`, `AdapterLoadError` (has `.detail: AdapterErrorDetail`).
- `src/adapters/demo.ts`: `createDemoAdapter(host, env)` = native-media with kind `demo`, `loop: true`.
- `src/adapters/inert.ts` (extra file inside my folder): `createInertAdapter(kind)`, shared by the two stubs.
- `src/adapters/hls.ts`, `src/adapters/iframe.ts`: inert M1 stubs (`createHlsAdapter()`, `createIframeAdapter()`, no params); M2 contracts in comments.
- `src/adapters/factory.ts`: `createAdapterFactory()`; unknown runtime kinds get an inert adapter (never throws).
- `src/adapters/entitlement-placeholder.ts`: `createEntitlementPlaceholder(events)` with `setOverride()`.
- `src/adapters/providers.ts`: `createBootstrapEventProvider`, `createRestEventProvider`, `createRestPlaybackProvider`; extra exports `ProviderError` (`code`: network|http|invalid_response|invalid_request, `status`) and `parsePlaybackSource`.
- `tests/unit/adapters/{native-media,providers,factory-entitlement}.test.ts`: 147 tests.

## Behaviour the coordinator must know

- **Error reporting happens once per `load()`**: a media `error` event, a pre-load `canPlayType === ''` failure and a `play()` NotSupportedError all go through the same classifier and produce exactly one `error` event (with `AdapterErrorDetail`, `fatal: true` always for native). A still-pending `load()` promise also rejects with `AdapterLoadError` (same detail); the promise has an internal no-op catch, so `void adapter.load()` never causes an unhandled rejection. `play()` itself still rejects with the original DOMException (it returns the element's promise unchanged) so the coordinator can map NotAllowedError to `play_blocked` and ignore AbortError. A new `load()` on the same adapter re-arms reporting.
- Pre-load unsupported: `src` is NOT assigned; a following `play()` rejects `NotSupportedError` without calling the element.
- AbortError (signal abort, superseded load, destroy) rejects `load()` but emits no `error` event.
- `capabilities` is a getter returning a fresh object; `seekToLive` flips to true on `loadedmetadata`/`canplay` only when `duration === Infinity` and `seekable.length > 0`. `remotePlayback` is always false.
- Stale `pause` events (queued by the previous source's reset) are ignored unless `media.paused` is true when they arrive, so `destroy(old) -> load(new) -> play()` in one click cannot produce a bogus `paused`.
- Element ownership: a `WeakMap<element, adapter>` ensures a late `destroy()`/`pause()`/`setMuted()` of a superseded adapter cannot reset or alter the element the new adapter uses; it only removes its own listeners.
- Inert stubs never touch the shared element, never emit and have all capabilities false.
- Entitlement placeholder: override applies to `isDemo` events only; a non-demo or unknown event is never entitled; garbage override falls to `unavailable`. `reason` values: `not_implemented`, `event_not_found`, `simulated`.
- Providers: aborts reject with a plain `DOMException('AbortError')` (never wrapped). `get(slug)` rejects `invalid_request` for a slug failing `isValidSlug` (no request). 404 on `events/{slug}` -> `null`, except body code `rest_no_route` -> `ProviderError('http', 404)`. Answer for a different slug -> `invalid_response`. Playback requests use `cache: 'no-store'`. Playback 2xx with unknown shape, a non-JSON body, `hls`, `iframe`, bad/non-http(s) URL or bad mime type -> `{kind:'not_ready', reason:'source_not_configured'}`; non-2xx and network failures throw `ProviderError`. Demo URLs are returned normalised by `safeUrl` (relative -> this origin). Nothing logs.

## Decisions / interpretations

- `createRestEventProvider(restRoot, fallback)`: the spec did not define `fallback`. I used it only when `restRoot` is empty (behaves like the bootstrap provider). It is never served after a failed request, because stale bootstrap data could revert a status the poller had already learned.
- In M1 `hls`/`iframe` playback responses are downgraded in the provider as well as in the coordinator (defence in depth, no URL leaves the provider).
- Native media accepts source kind `demo` only; `hls`/`iframe` sources given to it fail as `unknown`.

## Gates

| Gate | Result |
|---|---|
| `npx vitest run` (whole repo right now) | pass: 17 files, 463 tests (mine: 3 files, 147) |
| `npx eslint src/adapters tests/unit/adapters` (incl. compat + D12 bans) | pass |
| `check-css-scope` | pass |
| `npx tsc --noEmit` | no errors in my files; 5 errors elsewhere, all `Cannot find module '../state/model'` in `src/components/*` and `src/views/events.ts` (state agent's file not written yet) |

## Requests

- state agent: use `AdapterLoadError`/the `error` event as described above; dedupe by requestId is still sensible but not needed for the NotSupportedError + `error` event pair.
- core/types owner (optional): nothing required.

## Contract issues

- None blocking. `AdapterErrorDetail.fatal` has no defined value for native media; I report `true` for every native failure.
