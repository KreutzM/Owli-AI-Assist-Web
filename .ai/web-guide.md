# Web Agent Guide

## Repository responsibility

Browser client only: camera, image normalization, accessible UI, PWA lifecycle, browser speech/share, and typed backend consumption.

## First reads

1. `CHATGPT.md`
2. `AGENTS.md`
3. `docs/REPO_MAP.md`
4. `docs/ARCHITECTURE.md`
5. workspace `docs/API_CONTRACT.md` for contract work

## High-risk paths

- `src/core/api/remoteOwliApi.ts` — auth, image payload, SSE, error handling.
- `src/platform/camera/browserCamera.ts` — permission, tracks, canvas, memory.
- `src/features/scene/useSceneWorkflow.ts` — aborts, stale updates, lifecycle.
- `public/_headers` — CSP, permissions, media/connect origins.
- `vite.config.ts` — service-worker caching and install metadata.

## Defaults

- Mock provider calls in tests.
- Prefer native HTML.
- Keep the service worker app-shell-only.
- Put browser APIs behind platform interfaces.
- Coordinate contract changes through the workspace.
