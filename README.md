# Owli-AI Assist Web

Accessible progressive web client for Owli-AI Assist. The project is intended to be checked out as `web/` in `KreutzM/Owli-AI-Assist-WS` and deployed to `https://assist.owli-ai.com` through Cloudflare Pages.

## MVP scope

- installable PWA shell
- rear-camera capture with client-side JPEG resizing
- backend profile feed
- web bootstrap session
- streaming scene description
- text follow-up questions
- local browser speech output
- Audio-Postcard generation, playback, download, and share entry points
- anonymous installation-scoped rate limits enforced by the backend
- VoiceOver, TalkBack, keyboard, and desktop screen-reader support

The checked-in starter runs in `mock` mode because the backend still needs `platform: "web"` and public PWA CORS support. See `docs/MVP-IMPLEMENTATION-PLAN.md`.

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

- `VITE_OWLI_API_MODE=mock` keeps development independent from pending backend work.
- `VITE_OWLI_API_MODE=remote` uses `VITE_OWLI_API_BASE_URL`.
- Values prefixed with `VITE_` are public build-time configuration and must never contain secrets.

## Agent entry points

1. Read `CHATGPT.md`.
2. Read `AGENTS.md`.
3. Read `docs/REPO_MAP.md` and `.ai/web-guide.md`.
4. For cross-stack work, start in the workspace repository and read its `docs/API_CONTRACT.md`.
5. Follow `docs/AGENT-HANDOFF-WORKFLOW.md` for Planner / Builder / Reviewer work.

## Deployment

Cloudflare Pages build configuration:

- Build command: `pnpm build`
- Output directory: `dist`
- Node.js: 22
- Production domain: `assist.owli-ai.com`

See `docs/CLOUDFLARE-PAGES-SETUP.md` for the complete checklist.
