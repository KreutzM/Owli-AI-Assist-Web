# Testing

## Fast local checks

`pnpm check:fast` runs formatting, ESLint, TypeScript, architecture guardrails, workflow-policy checks, the lightweight atomic-publisher API regression test, and Vitest. During draft development, run the smallest relevant command first and complete `check:fast` before declaring a logical patch ready for review.

## Final aggregate check

`pnpm check:all` runs the fast checks once, builds the mock PWA, verifies the Vite port policy, and runs both isolated and built-staging Playwright matrices. It is the final Linux aggregate check; CI must not run the same suites again in parallel jobs.

## CI tiers

- **Quick CI** runs for draft PR events and explicit quick dispatches. It executes `check:fast` plus one Linux mock build. Superseded runs are canceled through workflow concurrency.
- **Full CI** runs for non-draft PR heads, merge queue entries, explicit full dispatches, and `main`. It executes `check:all` once, Safari diagnostic syntax/harness checks, optional agent-index artifact generation, and Windows builds.
- **Apple CI** skips drafts and broad test-only changes. It runs only for non-draft Apple-, browser-, image-, camera-, speech-, or platform-sensitive heads and starts only after the exact-head Full Linux and Full Windows jobs both succeed.

## Connector-publication tests

`pnpm atomic:publish:test` uses a local temporary Git repository and mock HTTP API. It verifies additions, modifications, deletions, executable and symlink tree entries, exact remote-tree identity, stale-parent failure, and non-force ref updates without contacting GitHub.

The Git Data publisher is a specialized path for binary, byte-critical, mode-critical, high-volume, reproducible-tree, or explicitly atomic publication. Ordinary UTF-8 connector edits use the faster Contents API workflow documented in `docs/AGENT-REPOSITORY-WORKFLOW.md`.

## Optional agent index

`pnpm ai:index` writes `file-tree.md` and `repo-index.json` to `artifacts/agent-index/`. The directory is ignored and the output is uploaded for one day by full CI. The generated files are not committed and do not gate ordinary PR updates.

## Coverage report

`pnpm test:coverage` produces a diagnostic report. The starter intentionally has no global percentage gate: browser adapters and the initial composition layer are validated primarily through browser tests, and a low-quality line-coverage target would reward shallow tests. Every behavior change still requires focused regression tests. Introduce or ratchet scoped thresholds once the corresponding pure logic exists.

## Browser checks

`pnpm test:e2e` builds the production bundle and runs Playwright in Chromium and WebKit. Install them once with `pnpm exec playwright install chromium webkit`. Tests must use mocked browser/backend boundaries; CI must never call real AI or music providers.

## Manual release matrix

- current iPhone Safari with VoiceOver,
- installed iPhone Home Screen PWA,
- Android Chrome with TalkBack,
- Windows Chromium with NVDA or Narrator,
- macOS Safari with VoiceOver,
- desktop keyboard-only,
- slow/offline transition and expired session,
- denied camera permission,
- reached rate limit,
- Audio-Postcard download/share fallback.

Record device/browser versions in the release issue rather than hard-coding them in source.

For managed Linux environments with a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium` and run the Chromium project explicitly. CI always uses Playwright-managed browsers.
