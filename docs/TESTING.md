# Testing

## Fast checks

`pnpm check:fast` runs formatting, ESLint, TypeScript, architecture guardrails, and Vitest.

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
