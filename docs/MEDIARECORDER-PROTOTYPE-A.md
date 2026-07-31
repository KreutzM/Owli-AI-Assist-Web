# MediaRecorder Prototype A

Web issue: `KreutzM/Owli-AI-Assist-Web#54`

## Isolation

- Route: `/lab/mediarecorder-prototype`
- Explicit staging flag: `VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER=enabled`
- Built deploy target: `pnpm build:staging:mediarecorder-prototype`
- Normal `pnpm build:staging` remains fail-closed on the lab route.
- The route is not linked from normal navigation and does not modify the Slice-5 Audio-Postcard flow.

## What the prototype does

- draws a deterministic JPEG fixture onto a canvas;
- captures the static video track with `canvas.captureStream(30)`;
- decodes deterministic local audio fixtures with Web Audio;
- routes audio through `MediaStreamAudioDestinationNode`;
- records the combined tracks with runtime MIME probing and `MediaRecorder.start(1000)`;
- validates the resulting blob for orientation, aspect ratio, duration drift, pixel samples, and audio-marker heuristics;
- records only local evidence inside the lab route or exported JSON.

## Fixture inventory

- Images: `landscape-jpeg`, `portrait-jpeg`, `square-jpeg`
- Audio: `audio-mpeg`, `audio-wav`, `audio-flac`, `audio-opus` in `10s` and `30s`
- Deterministic manifest: [src/features/labs/mediaRecorderPrototype/generated/mediaRecorderFixtureManifest.json](/abs/path/D:/Codex/Owli-AI-Assist-WS/web/src/features/labs/mediaRecorderPrototype/generated/mediaRecorderFixtureManifest.json)
- Regeneration: `pnpm fixtures:mediarecorder`

## Local evidence

- Current local Chromium evidence: [docs/prototypes/mediarecorder/local-chromium-2026-07-31-scenario-01.json](/abs/path/D:/Codex/Owli-AI-Assist-WS/web/docs/prototypes/mediarecorder/local-chromium-2026-07-31-scenario-01.json)
- Result on July 31, 2026: `FAIL` for `scenario-01` with `video/webm;codecs=vp9,opus`
- Observed failure detail: visual orientation and duration passed, but the current audio-marker validation still classified the output as non-audible.

## Known limits of this slice

- The prototype does not enable any production user flow.
- The harness records only one active render at a time per tab.
- The output measurement remains a staging/lab aid and not a product readiness claim.
