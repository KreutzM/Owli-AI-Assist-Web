# First PWA MVP Implementation Plan

## Product goal

Deliver an installable, accessible Owli-AI Assist web client at `https://assist.owli-ai.com` that works on iPhone/iPad, Android browsers, Windows, Linux, and macOS without a mandatory account.

The first release must support:

1. rear-camera capture and file fallback,
2. backend profile selection,
3. streaming scene description,
4. follow-up questions about the captured scene,
5. local browser speech on explicit request,
6. Audio-Postcard generation and playback,
7. server-provided shareable video when the backend renderer exists,
8. anonymous installation-scoped, IP-assisted, and global rate limits,
9. clear privacy and AI limitations,
10. PWA installation and update behavior.

## Explicit non-goals

- direct BYOK provider access from the browser,
- local Gemma/LiteRT inference,
- background camera analysis while the screen is locked,
- full Android camera expert controls,
- mandatory user accounts or billing,
- long-term storage of scene images or generated media,
- replacing the native Android app.

## Repository layout

- `KreutzM/Owli-AI-Assist-WS` — cross-stack coordination and canonical API contract.
- `KreutzM/Owli-AI-Assist` — native Android client at workspace path `app/`.
- `KreutzM/Owli-AI-Assist-Web` — PWA at workspace path `web/`.
- `KreutzM/OwliAI-BackEnd` — shared Worker backend at workspace path `backend/`.
- `KreutzM/owli-ai-landing` — marketing and SEO site; linked but not a workspace runtime submodule.

## Delivery workflow

Create one tracking issue in the workspace. Each slice below gets one child issue and normally one small PR per affected runtime repository. Runtime PRs merge before the workspace pointer/documentation PR.

Suggested aligned branch prefix: `pwa-mvp/<slice-name>`.

## Slice 0 — repository bootstrap

**Repository:** Web

Delivered by this starter:

- React/Vite/PWA scaffold,
- mock vertical slice,
- camera, speech, share, API, and state boundaries,
- unit and browser tests,
- accessibility smoke tests,
- architecture guardrails,
- agent role configuration,
- CI and issue/PR templates,
- Cloudflare Pages and workspace integration docs.

**Exit criteria**

- `pnpm check:all` passes.
- Repository is created in GitHub.
- Initial review confirms model names and runner policy.

## Slice 1 — workspace and backend web foundation

**Repositories:** Backend, Workspace

Backend work:

- replace Android-only platform literals with a shared `android | web` platform type,
- include the platform in signed session payloads,
- define explicit web placeholder/trust posture without pretending browser attestation exists,
- add a public-client CORS allowlist for `https://assist.owli-ai.com` and local development origins,
- handle `OPTIONS` centrally,
- apply CORS to success, JSON error, and SSE responses,
- keep admin endpoints on their separate admin CORS policy,
- add tests for allowed/disallowed origins and preflight behavior.

Workspace work:

- add `web/` submodule,
- update `.gitmodules`, `README.md`, `CHATGPT.md`, `AGENTS.md`, repo maps, and API contract,
- document web platform bootstrap and CORS semantics.

**Exit criteria**

- Web bootstrap succeeds from an allowed origin.
- A disallowed origin does not receive permissive CORS headers.
- Android contract and tests remain green.

## Slice 2 — remote profile/bootstrap vertical slice

**Repositories:** Web, Workspace

- switch a staging build to remote API mode,
- load `/api/v1/profiles` with ETag-friendly behavior,
- bootstrap with `platform: "web"`,
- keep the session only in memory and refresh before expiry,
- map common JSON errors to user-safe messages,
- add contract fixtures and tests.

**Exit criteria**

- Staging PWA loads profiles and obtains a session without a real scene upload.
- No secret or session value appears in logs or persistent browser storage.

## Slice 3 — scene capture and streaming description

**Repositories:** Web, Backend if contract defects are found, Workspace

- capture rear-camera frames,
- normalize rotation through browser decoding and canvas output,
- resize to a bounded maximum side and compress to JPEG before upload,
- submit `scene/describe` with `stream: true`,
- parse metadata/delta/done/error events,
- abort obsolete requests on reset/navigation,
- announce progress without announcing every token,
- display final text as normal selectable content.

**Exit criteria**

- Real iPhone Safari, Android Chrome, desktop Chromium, and desktop Safari/WebKit smoke tests pass.
- Uploads stay inside the documented byte target.
- A network abort leaves the UI recoverable.

## Slice 4 — follow-up questions and local speech

**Repositories:** Web

- re-send the original normalized snapshot with follow-ups,
- enforce the 280-character client boundary without relying on it for backend security,
- provide explicit local TTS controls,
- ensure TTS never starts automatically and can be stopped,
- preserve the original scene result when a follow-up fails.

**Exit criteria**

- Follow-up works in staging against a valid scene token.
- VoiceOver focus remains stable after result updates.

## Slice 5 — Audio-Postcard core

**Repositories:** Web, Backend, Workspace

- load backend song options,
- generate a 30-second Audio-Postcard from the normalized scene image,
- expose progress, ready, provider failure, and rate-limit states,
- play and download backend audio,
- add idempotency keys before paid or costly rollout,
- return structured quota metadata or a documented 429/reset contract.

**Exit criteria**

- A failed provider call does not consume a product quota unit when quota reservation/commit is introduced.
- The UI states remaining anonymous limits before starting expensive work when backend data is available.

## Slice 6 — server-rendered share video

**Repositories:** Backend, Web, Workspace

- create asynchronous render job contract,
- combine source image, generated audio, accessible branding, and Owli URL into MP4/H.264/AAC,
- store the result temporarily in R2,
- return short-lived authorized or unguessable download URLs,
- delete expired artifacts automatically,
- expose video share/download in the PWA with audio fallback.

This slice may use Cloudflare Containers or an external renderer. The implementation decision requires a measured FFmpeg prototype and cost data; it must not be guessed in the client.

**Exit criteria**

- MP4 plays on iPhone, WhatsApp import, Instagram import, Android, Windows, and Linux.
- Shared media contains visible Owli attribution without exposing user identity.

## Slice 7 — anonymous quota hardening

**Repositories:** Backend, Web, Workspace

- installation-scoped product limits,
- IP-hash technical burst limits,
- global hourly/daily provider budget,
- idempotent generation requests,
- optional risk-triggered Turnstile challenge,
- transparent `limit`, `remaining`, and `resetAt` data,
- no mandatory email account.

Initial policy should be configuration-driven. Example candidate, not a committed product default:

- scenes: 20/hour and 50/day per installation,
- Audio-Postcards: 1/hour, 3/day, and 10/month per installation,
- stricter global emergency budget.

**Exit criteria**

- Deleting browser storage is documented as a known limitation, not presented as a solved identity problem.
- Shared IP addresses are not treated as a single user quota.

## Slice 8 — release, privacy, and discoverability

**Repositories:** Web, Landing, Backend, Workspace

- deploy production PWA to `assist.owli-ai.com`,
- confirm HTTPS, manifest, service worker, icons, headers, and cache policy,
- update landing-page metadata and CTA for web/iPhone/desktop availability,
- add product analytics that avoid scene content and fingerprinting,
- finalize privacy notice, accessibility statement, support path, and incident controls,
- disable or tightly scope production debug captures before public traffic.

**Release gates**

- CI green in each runtime repository.
- Planner acceptance criteria satisfied.
- `gpt-5.6-sol` web-interface review documented in each PR; repository-local Codex configurations remain on `gpt-5.4`.
- Manual iPhone VoiceOver, Android TalkBack, keyboard, and screen-reader smoke tests.
- Backend budget alerts and kill switches tested.
- Workspace pointers reference exactly the reviewed commits.

## Recommended first tracking issue children

1. Add Web submodule and cross-stack contract placeholders.
2. Add backend web platform and public-client CORS.
3. Connect PWA remote profiles/bootstrap.
4. Implement real scene streaming.
5. Implement follow-ups and explicit TTS.
6. Connect Audio-Postcard audio flow.
7. Prototype and choose server video renderer.
8. Add anonymous product quotas and idempotency.
9. Run accessibility/security release hardening.
10. Update landing site and launch production PWA.
