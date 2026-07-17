# Remote Slice 3: camera and streaming scene description

Binding implementation plan: `KreutzM/Owli-AI-Assist-WS/docs/plans/2026-07-15-pwa-slice-3-camera-streaming-scene.md` at merge `0f4ec8d5b4a798a33c6399710618948bdb5e83d4`.

## Scope

Remote mode exposes one task: intentionally capture or choose an image and receive a streamed scene description. Follow-up, songs, audio postcards, playback, sharing, provider selection, prompts, and debug capture remain unreachable. Mock mode is unchanged and structurally separate.

## Readiness and session

Controls are enabled only when all of these are true:

1. public config enables `sceneDescribe`;
2. the memory-only Web bootstrap enables `sceneDescribe`;
3. a backend-approved profile is available and supports streaming;
4. the selected profile supports streaming.

The installation identifier, session token, ETag, normalized image, preview URL, base64 payload, streamed text, and scene token remain in memory only. No local storage, IndexedDB, Cache Storage, file-system API, analytics, or content logging is used.

## Image boundary

Accepted sources are JPEG, PNG, and WebP. Before decode, the client enforces:

- source file at most 20 MiB;
- each side at most 8192 pixels;
- at most 16,000,000 pixels;
- matching file signature and reported MIME type;
- parseable dimensions and JPEG/PNG/WebP container headers.

JPEG EXIF orientation values 1–8 are parsed. Runtime probes determine whether `createImageBitmap(..., { imageOrientation: 'none' })` returns raw pixels and whether the HTML image fallback auto-orients. Orientation is applied exactly once.

Output is an opaque, metadata-minimized JPEG. The fixed attempts are:

1. 1280 px at 0.82;
2. 1280 px at 0.72;
3. 1024 px at 0.72;
4. 1024 px at 0.62;
5. 768 px at 0.62.

Images are never upscaled. The first output at or below 4 MiB is used; otherwise the attempt fails locally. Preview object URLs, decoded surfaces, and canvases have explicit owners and cleanup paths.

## Camera boundary

Camera access is user initiated and requests exactly:

```ts
{
  audio: false,
  video: { facingMode: { ideal: 'environment' } },
}
```

Unsupported, denied, missing, busy, not-ready, and generic failures have separate user-safe messages. Every track is stopped, the video is paused, and `srcObject` is cleared after capture, cancellation, replacement, failure, page hide, and unmount. Native file input remains available as an independent fallback.

## Scene request

The client calls only `POST /api/v1/scene/describe` with custom headers:

```http
Accept: text/event-stream
Content-Type: application/json
```

It does not add `Authorization` or `X-Request-Id`. The strict JSON body contains only:

```json
{
  "sessionToken": "…",
  "installationId": "…",
  "imageBase64": "…",
  "imageMimeType": "image/jpeg",
  "sceneMode": "describe",
  "stream": true,
  "profileId": "…",
  "locale": "…"
}
```

No prompt or source filename is sent. Base64 for a 4 MiB image is capped at 5,592,408 characters.

## Retry and SSE contract

A 401 received before event-stream headers invalidates the memory session and permits one retry with one fresh bootstrap. A second 401 escapes. A 403 is never retried. After event-stream headers are accepted, no automatic retry is allowed.

The required stream sequence is:

1. exactly one `metadata` event first;
2. zero or more `delta` events;
3. exactly one terminal `done` or `error` event;
4. no event after terminal;
5. clean EOF within two seconds after terminal.

The canonical `done.answerText` is not committed as complete until clean EOF. Timeout boundaries are response 15 s, first event 10 s, valid-event idle 20 s, total request 60 s, and terminal-to-EOF 2 s. Cancellation aborts the fetch, cancels/releases the reader, suppresses stale callbacks, and is announced neutrally.

## Accessibility

The visible streamed paragraph is not a live region. A separate polite atomic region coalesces intermediate sentence updates at a minimum two-second interval. Completion is announced once, atomically, only after clean EOF. Failures use an assertive alert; cancellation is not an error. Native labels, keyboard operation, focus recovery, reduced motion, narrow layouts, and 200% zoom are covered by unit and Chromium/WebKit browser tests.

## Staging verification

The implementation targets the required Backend merge `0d5fd3b2c8209fb7d974f738b215eaf02b593ef8` and verified staging version `72f01e14-54b2-48b1-ac39-bf5151be1c4f`. Browser tests mock the exact production contract; the Builder handoff records the live staging smoke result separately.
