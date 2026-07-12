# API Integration

The canonical contract lives in the workspace repository at `docs/API_CONTRACT.md`. This document only records web-specific consumption rules.

## Required backend changes before remote mode

- bootstrap platform union includes `web`,
- signed session payload supports `web`,
- explicit public PWA origin allowlist,
- `OPTIONS` preflight for public client routes,
- CORS on JSON errors and SSE responses,
- no widening of protected admin endpoint CORS.

## Client rules

- Every response is runtime-validated at the API boundary.
- Scene and follow-up streaming use `fetch`, not `EventSource`, because requests are POST with JSON bodies.
- A stream is successful only after a valid `done` event.
- `error` events become typed client errors.
- Aborted requests do not produce user-facing failure alerts.
- Session tokens stay in memory; installation ID may be stored locally.
- Image base64 is created only immediately before sending and is never logged or persisted.

## Contract changes

A public request, response, event, header, auth, error, or compatibility change requires coordinated backend, affected client, and workspace documentation PRs.
