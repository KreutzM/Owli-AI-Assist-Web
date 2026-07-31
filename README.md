# Owli-AI Assist Web

Accessible progressive web client for Owli-AI Assist. The project is intended to be checked out as `web/` in `KreutzM/Owli-AI-Assist-WS`.

The current `main` branch is automatically built and deployed by Cloudflare Pages to the staging site at `https://assist-staging.owli-ai.com`. Product production is not deployed from this repository state.

## MVP scope

- installable PWA shell
- rear-camera capture with client-side JPEG resizing
- backend profile feed
- web bootstrap session
- streaming scene description
- text follow-up questions
- local browser speech output
- Audio-Postcard generation and temporary accessible playback
- anonymous installation-scoped rate limits enforced by the backend
- VoiceOver, TalkBack, keyboard, and desktop screen-reader support

The local default build remains in `mock` mode. The staging build uses the reviewed remote backend at `https://api-staging.owli-ai.com`.

## Stack

- React 19 + TypeScript
- Vite 8
- `vite-plugin-pwa`
- Zod at the network boundary
- Vitest + Testing Library
- Playwright Chromium/WebKit + axe
- ESLint, Prettier, and custom architecture guardrails
- Cloudflare Pages static deployment

## Start

```bash
corepack enable
corepack prepare pnpm@10.12.1 --activate
pnpm install
pnpm dev
```

Unix helper:

```bash
./scripts/setup-dev.sh
```

Windows helper:

```powershell
.\scripts\setup-dev.ps1
```

## Checks

```bash
pnpm check:fast
pnpm build
pnpm test:e2e
pnpm ai:index:check
```

The full local gate is:

```bash
pnpm check:all
```

## Runtime configuration

Copy `.env.example` to `.env.local`.

- `VITE_OWLI_API_MODE=mock` keeps local development independent from remote services.
- `VITE_OWLI_API_MODE=remote` uses `VITE_OWLI_API_BASE_URL`.
- Values prefixed with `VITE_` are public build-time configuration and must never contain secrets.
- Repository build scripts sanitize inherited `VITE_OWLI_*` variables and inject the target-specific values.

## Agent entry points

1. Read `CHATGPT.md`.
2. Read `AGENTS.md`.
3. Read `docs/REPO_MAP.md` and `.ai/web-guide.md`.
4. For cross-stack work, start in the workspace repository and read its `docs/API_CONTRACT.md`.
5. Follow `docs/AGENT-HANDOFF-WORKFLOW.md` for Planner / Builder / Reviewer work.

## Deployment

Cloudflare Pages is connected directly to this GitHub repository.

- Pages project: `owli-ai-assist-web`
- Cloudflare Pages production branch: `main`
- Trigger: automatic after a push or merge to `main`
- Build command: `pnpm build:staging`
- Output directory: `dist`
- Node.js: 22
- Staging custom domain: `assist-staging.owli-ai.com`
- Immutable deployment form: `<deployment-id>.owli-ai-assist-web.pages.dev`

Cloudflare calls the deployment from its configured production branch a **Production deployment**. In Owli-AI environment terminology this project currently serves **staging only**. The label must not be interpreted as a deployment to `assist.owli-ai.com` or as production readiness.

A normal staging rollout requires no manual Cloudflare deployment: merge to `main`, then verify the exact commit and immutable Pages deployment before acceptance testing.

See `docs/CLOUDFLARE-PAGES-SETUP.md` for the complete configuration and verification checklist.
