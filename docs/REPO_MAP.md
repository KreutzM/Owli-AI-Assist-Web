# Repository Map

## Start points

- `CHATGPT.md` — stable assistant entry point.
- `AGENTS.md` — mandatory workflow and quality rules.
- `docs/MVP-IMPLEMENTATION-PLAN.md` — phased PWA delivery plan.
- `.ai/web-guide.md` — compact agent navigation.
- `.ai/change-type-map.md` — first files by task type.

## Runtime

- `src/app/App.tsx` — composition root and top-level layout.
- `src/features/scene/` — camera-to-scene and follow-up workflow.
- `src/features/postcard/` — Audio-Postcard UI state.
- `src/core/api/remoteOwliApi.ts` — backend HTTP/SSE adapter.
- `src/core/api/contracts.ts` — runtime response validation.
- `src/core/api/sse.ts` — POST streaming parser.
- `src/core/identity/installationId.ts` — anonymous browser installation ID.
- `src/platform/camera/` — direct browser camera/canvas work.
- `src/platform/speech/` — local browser TTS.
- `src/platform/share/` — native Web Share / clipboard fallback.

## Quality

- `tools/check-architecture.mjs` — architectural boundary checks.
- `tools/generate-repo-index.mjs` — deterministic agent index generation.
- `src/**/*.test.*` — unit/component tests.
- `tests/e2e/` — Chromium/WebKit and axe smoke tests.
- `.github/workflows/ci.yml` — hosted CI.

## Deployment

- `vite.config.ts` — build and PWA manifest.
- `public/_headers` — Cloudflare Pages security/cache headers.
- `public/_redirects` — SPA fallback.
- `docs/CLOUDFLARE-PAGES-SETUP.md` — deployment checklist.
