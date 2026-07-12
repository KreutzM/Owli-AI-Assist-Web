# Change Type Map

| Change                 | Start with                                             | Also inspect                                              |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Camera capture/quality | `src/platform/camera/browserCamera.ts`                 | `docs/ACCESSIBILITY.md`, scene workflow tests             |
| Scene streaming        | `src/core/api/remoteOwliApi.ts`, `src/core/api/sse.ts` | workspace API contract, backend route/schema              |
| Follow-up behavior     | `src/features/scene/useSceneWorkflow.ts`               | remote API, scene token contract                          |
| Audio-Postcard         | `src/features/postcard/AudioPostcardPanel.tsx`         | backend song routes, quota/idempotency contract           |
| Rate-limit UI          | API error mapping, postcard/scene feature              | backend limiter and workspace contract                    |
| PWA install/cache      | `vite.config.ts`, `public/_headers`                    | Cloudflare deployment doc, offline privacy                |
| Accessibility          | affected component                                     | `docs/ACCESSIBILITY.md`, Playwright axe, real-device gate |
| Architecture           | `docs/ARCHITECTURE.md`                                 | `tools/check-architecture.mjs`                            |
| CI/tooling             | `.github/workflows/ci.yml`, `package.json`             | scripts, runner cost, existing repo conventions           |
