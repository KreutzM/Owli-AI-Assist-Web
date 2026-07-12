# AGENTS.md

## Goals

- Deliver small, correct, reviewable improvements to the Owli-AI Assist PWA.
- Preserve a camera-first, screen-reader-first user experience.
- Keep web, Android, and backend behavior contract-compatible.
- Prefer measurable progress over broad rewrites.

## Model and role defaults

- Planning and review in the OpenAI web interface normally use `gpt-5.6-sol` with the GitHub connector. This is an orchestration choice, not a repository-local Codex setting.
- Repository-local Codex defaults and all checked-in sub-agents use `gpt-5.4`, matching the current Assist and Backend repositories.
- The optional quick profile uses `gpt-5.4-mini` for narrow low-risk tasks.
- Use medium reasoning by default and high reasoning for architecture, browser-media, streaming, security, concurrency, or difficult refactors.
- Do not migrate this repository alone to the newer model family. Model-family changes must be coordinated across the workspace and runtime repositories.

## Work style

- Planning happens in chat or the child issue; a Builder executes one small thematic run at a time.
- Start each run on a thematic branch. Do not work directly on `main` when a review branch is feasible.
- Inspect relevant code, docs, and API contract first.
- Implement the smallest defensible change.
- Use short loops: implement, verify, commit.
- Push review branches when the run is meant for GitHub review.
- Do not merge or push `main` without explicit maintainer/orchestrator instruction.
- Close every completed branch as merged, superseded, kept for later, or deleted.

## Cross-repository rule

For API request/response, session/bootstrap, profile, rate-limit, CORS, privacy, Audio-Postcard provider, or release compatibility work:

1. Start in `KreutzM/Owli-AI-Assist-WS`.
2. Read workspace `docs/API_CONTRACT.md`.
3. Use matching branch names in affected repositories where feasible.
4. Commit runtime-repository changes first.
5. Update workspace docs and submodule pointers only after the runtime commits exist and are pushed.
6. Do not make the web client appear compatible while the backend still rejects the request.

## Architecture boundaries

- `src/core/`: platform-independent types, configuration, session, and API boundary. It must not import app, feature, platform, or shared UI code.
- `src/platform/`: direct browser API access such as camera, speech, share, and future wake-lock adapters.
- `src/features/`: feature state and UI. One feature must not import another feature directly.
- `src/shared/`: reusable presentational components and pure helpers.
- `src/app/`: composition root only.
- Direct `fetch` belongs in `src/core/api/`.
- Direct `navigator.mediaDevices`, `navigator.share`, clipboard, or speech synthesis access belongs in `src/platform/`.
- Never use `dangerouslySetInnerHTML` for model output.
- Do not grow a source file beyond the guardrail limit; extract a cohesive unit instead.

## Accessibility rules

- Native semantic HTML first; ARIA only where native semantics are insufficient.
- Every control needs an accessible name and visible focus.
- Critical flows must work with keyboard and screen readers without drag, hover, or vision-only gestures.
- Do not announce every streaming token. Use a short progress live region and expose the completed answer as normal content.
- Never autoplay speech. Screen-reader and local TTS output must not compete by default.
- Preserve user zoom, reduced-motion preferences, large text, contrast, and safe-area insets.
- Test important changes in Chromium and Playwright WebKit; real VoiceOver/iPhone testing remains a manual release gate.

## Privacy and security

- Never commit secrets. `VITE_*` values are public.
- Provider keys, quota policy, prompts, and payment state belong in the backend.
- Resize and compress images before upload.
- Do not persist scene images, questions, answers, or Audio-Postcards locally unless the feature explicitly requires it and privacy docs are updated.
- Do not log image data, base64 payloads, tokens, user questions, model answers, or full identifiers.
- Object URLs must be revoked.
- Service-worker caching must stay app-shell-only; never cache API responses, scene data, audio, or video by default.
- Treat CSP, CORS, session binding, idempotency, and rate limits as production-critical.

## Dependency policy

- Prefer browser APIs and small dependencies.
- Do not add or upgrade dependencies without stating the reason and checking bundle/security impact.
- Runtime validation is required at external API boundaries.
- Avoid adding a global state library until reducer/context boundaries demonstrably fail.

## Verification

Run the smallest relevant checks during development:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm guardrails
pnpm test
```

For UI, platform, PWA, build, dependency, or API-boundary changes also run:

```text
pnpm build
pnpm test:e2e
pnpm ai:index:check
```

Before merge, prefer `pnpm check:all`. Browser tests do not replace real iPhone VoiceOver and Android TalkBack smoke tests.

For bug fixes add a regression test. Tests must be deterministic: no real provider calls, no arbitrary sleeps, and no dependence on local browser state.

## Commit policy

- Commit frequently in focused, buildable units.
- Update behavior or architecture docs in the same commit as the corresponding change.
- Commit message format: `area: short summary`.
- Examples: `camera: normalize captured image size`, `api: parse streaming error events`, `a11y: stabilize result announcements`.

## Agent handoff

Follow `docs/AGENT-HANDOFF-WORKFLOW.md`.

- Tracking issue: overall multi-PR objective.
- Child issue: exactly one concrete implementation slice.
- PR: closes the child issue and references the tracking issue.
- Builder handoff: top-level PR conversation comment titled `Builder Handoff / Run Review`.
- Reviewer result: formal review when possible, otherwise top-level PR comment titled `Reviewer result`.
- Builder does not approve its own work. Reviewer does not merge by default.

## Required end-of-run output

```text
RUN REVIEW
Branch: <branch-name>
Remote push: <yes/no>
Compare/PR URL: <url-or-n/a>

Scope summary:
- <one sentence>

Commits:
1. <sha> <subject>

Files changed:
- <path> — <purpose>

Checks run:
- <command> — <pass/fail/not run>

Behavior impact:
- <none / describe>

API/contract impact:
- <none / describe>

Accessibility impact:
- <none / describe>

Privacy/security impact:
- <none / describe>

Risks / review focus:
- <item>

Manual follow-up:
- <item or none>

Open questions:
- <item or none>
```
