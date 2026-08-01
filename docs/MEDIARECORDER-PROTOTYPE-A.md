# MediaRecorder Prototype A

Web issue: `KreutzM/Owli-AI-Assist-Web#54`

## Isolation

- Route: `/lab/mediarecorder-prototype`
- Explicit staging flag: `VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER=enabled`
- Prototype build target: `pnpm build:staging:mediarecorder-prototype`
- Normal builds stay fail-closed and do not ship `dist/prototypes`.
- Prototype fixture assets are copied only into prototype build artifacts.
- The route is not linked from normal navigation and does not modify the Slice-5 Audio-Postcard flow or `shareVideo: false`.

## What the prototype does

- draws deterministic JPEG fixtures onto a canvas;
- captures the static frame via `canvas.captureStream(30)`;
- decodes deterministic local audio fixtures;
- routes audio through `MediaStreamAudioDestinationNode`;
- probes runtime MIME support and records with `MediaRecorder.start(1000)`;
- validates orientation, aspect ratio, duration drift, container magic, fixture checksums, marker timing, and local memory envelopes;
- exports only local JSON evidence.

## Fixtures

- Manifest: [mediaRecorderFixtureManifest.json](../src/features/labs/mediaRecorderPrototype/generated/mediaRecorderFixtureManifest.json)
- Generator: `pnpm fixtures:mediarecorder`
- Recorded FFmpeg generator version: `ffmpeg version 8.0-full_build-www.gyan.dev`
- Current fixture root in source control: `prototype-fixtures/mediarecorder/fixtures`

## Local Chromium Evidence

Scenario: `scenario-01` on August 1, 2026

- [MP4 / H.264 + AAC](prototypes/mediarecorder/local-chromium-2026-08-01-scenario-01-mp4-h264-aac.json)
- [WebM / VP8 + Opus](prototypes/mediarecorder/local-chromium-2026-08-01-scenario-01-webm-vp8-opus.json)
- [WebM / default](prototypes/mediarecorder/local-chromium-2026-08-01-scenario-01-webm-default.json)
- [WebM / VP9 + Opus](prototypes/mediarecorder/local-chromium-2026-08-01-scenario-01-webm-vp9-opus.json)

Summary of the August 1, 2026 rerun:

- all four candidates produced audible output again under the corrected validator;
- all four detected the start marker;
- all four still missed the end marker and therefore remained `FAIL`;
- measured duration drift stayed within `60-65 ms`;
- backend request count stayed at `0`;
- fixture checksum verification stayed `true` for image and audio;
- cleanup completed for every recorded attempt.

Interpretation:

- the previous July 31, 2026 `audioNonSilent: false` result was a validator issue, not sufficient evidence of silent MediaRecorder output;
- the current remaining blocker is end-marker validation for Scenario 01, not loss of all audio.

## Artifact split

- Normal mock build after the alias fix transformed `146` modules and did not emit `dist/prototypes`.
- Prototype staging build transformed `158` modules and emitted `prototypes/mediarecorder/fixtures`.

## Known limits

- Requested chunk cadence remains nominal only; delivery frequency is not guaranteed by `MediaRecorder`.
- Browser-internal encoder buffering cannot be hard-bounded by application code.
- The prototype remains staging-only and is not a production user flow.
