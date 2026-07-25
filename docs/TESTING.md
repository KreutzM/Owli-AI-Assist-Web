# Testing

## Fast local checks

`pnpm check:fast` runs formatting, ESLint, TypeScript, architecture guardrails, workflow-policy checks, and Vitest. During draft development, run the smallest relevant command first and complete `check:fast` before publishing a logical patch.

## Final aggregate check

`pnpm check:all` runs the fast checks once, builds the mock PWA, verifies the Vite port policy, and runs both isolated and built-staging Playwright matrices. It is the final Linux aggregate check; CI must not run the same suites again in parallel jobs.

## CI tiers

- **Quick CI** runs on synchronized draft PR heads and explicit quick dispatches. It executes `check:fast` plus one Linux mock build.
- **Full CI** runs when a PR is opened or reopened, becomes ready for review, receives a new commit while non-draft, enters a merge queue, is explicitly dispatched as full, or reaches `main`. It executes `check:all` once, Safari diagnostic syntax/harness checks, optional agent-index artifact generation, and Windows builds.
- **Apple CI** skips drafts and test-only changes. It runs only for ready/non-draft Apple-, browser-, image-, camera-, speech-, or platform-sensitive heads and gates on successful exact-head Web CI.

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
