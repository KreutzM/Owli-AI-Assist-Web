# Accessibility

## Target

The MVP is designed for VoiceOver on iPhone/iPad, TalkBack on Android, and keyboard/screen-reader use on Windows, Linux, and macOS.

## Interaction rules

- Camera permission is requested only from an explicit button.
- Use native buttons, labels, inputs, headings, audio controls, and links.
- Keep focus visible and predictable.
- Never require drag, hover, color recognition, or a camera preview to understand status.
- Progress is announced with short polite live-region messages.
- Streaming tokens are not individually announced.
- Results remain selectable normal text.
- Local TTS starts only after an explicit action and should be stoppable.
- Preserve browser zoom and text scaling.
- Respect reduced motion.

## Automated checks

- ESLint JSX accessibility rules.
- Testing Library role/name assertions.
- Playwright axe smoke test.
- Chromium and WebKit browser projects.

Automated checks cannot establish good VoiceOver interaction. Real-device review is required before release and after material changes to camera permission, focus, live regions, follow-up input, Audio-Postcard controls, or PWA installation guidance.
