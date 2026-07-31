# Remote Slice 5: Audio-Postcard and quota

Web issue: `KreutzM/Owli-AI-Assist-Web#48`

Normative Workspace slice: `KreutzM/Owli-AI-Assist-WS#84`

Backend contract reference:

- commit `46aef9b6c5b09060c84e68da4afb725c1d2807ee`
- staging version `ea438ff8-13eb-47bb-9f04-1ee63a00dfb6`
- Backend issues `KreutzM/OwliAI-BackEnd#120` and `#123`

## Web flow

The remote UI discovers Audio-Postcard availability only after config and bootstrap both expose
`audioPostcard: true`, a completed scene still owns its normalized in-memory JPEG, and the strict
`GET /api/v1/song/options` response reports synchronous generation as available.

One explicit user action serializes the retained JPEG into the exact browser request accepted by the
Backend. The Web subset always sends `image/jpeg`, `vocals: "instrumental"`, the Backend-selected
profile and mode, and `shareVideo: false`. It omits `stylePreset`, credentials, authorization, and
client-generated request IDs.

Generation uses one synchronous `POST /api/v1/song/generate`. Provider streaming remains internal
to the Backend. The Web accepts only terminal `ready`, `stub`, `not_available`, or `failed` values.
Unknown, queued, processing, and pending values are contract errors.

## Request lifecycle

Audio-Postcard state is independent of scene and follow-up state. Exactly one postcard request can be
active, and scene/follow-up controls cannot start conflicting work. Each request has an incrementing
memory-only guard, an abort controller, and the options-provided full-response timeout.

A stable pre-admission session-token `401` permits one session refresh and one retry. No automatic
retry occurs for any other status, timeout, disconnect, cancellation, provider failure, quota limit,
or contract error. Timeout and post-dispatch cancellation explain that the outcome can be ambiguous
and that an explicit retry may count again.

Reset, a new image, navigation, `pagehide`, and unmount abort work and invalidate callbacks. Expiry
removes the media element while retaining the textual scene caption and musical mapping.

## Playback and quota

A player is rendered only after strict result validation and a successful anonymous, no-store,
redirect-rejecting `HEAD` request. Capability URLs must use HTTPS, the configured Backend origin,
the exact song-audio route, sufficient opaque capability material, a bounded future expiry, and an
allowlisted audio MIME type. Playback uses native `<audio controls preload="metadata">` without
autoplay, download, share, or video actions.

Quota UI renders only the version-1 windows returned by the Backend. It identifies fixed windows by
scope and never invents daily or monthly allowances. Charged state, remaining count, limit, and reset
time are presented exactly from the received snapshot.

## Privacy boundary

The normalized JPEG, base64 body, installation and session identifiers, options, selections, quota,
result identifiers, capability URL, accessibility text, player state, and errors remain in memory.
The Slice does not write them to Local Storage, Session Storage, IndexedDB, cookies, navigation state,
analytics, logs, or Cache Storage.

The existing service worker remains app-shell-only with an API navigation denylist and no runtime
cache rules. Options, generation, playback, ranges, and prior remote API responses are never
service-worker cached.

## Preserved scope

Slice-3 scene capture/normalization/streaming and Slice-4 follow-up/local speech behavior remain
unchanged. The accepted iPhone Safari/VoiceOver follow-up gap and Web `#37` remain open. This change
does not modify Backend, Android, Workspace Runtime, deployments, tags, releases, production access,
video sharing, final Slice-7 quota policy, or idempotency.
