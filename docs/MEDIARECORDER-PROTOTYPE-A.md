# MediaRecorder Prototype A

Web issue: `KreutzM/Owli-AI-Assist-Web#54`

## Isolation

- Route: `/lab/mediarecorder-prototype`
- Explicit staging flag: `VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER=enabled`
- Prototype build target: `pnpm build:staging:mediarecorder-prototype`
- Clean-tree local measurement: `pnpm measure:mediarecorder`
- Normal builds stay fail-closed and do not ship `dist/prototypes`.
- Prototype fixture assets are copied only into prototype build artifacts.
- The route is not linked from normal navigation and does not modify the Slice-5 Audio-Postcard flow or `shareVideo: false`.

## What the prototype does

- draws deterministic JPEG fixtures onto a canvas;
- captures the static frame via `canvas.captureStream(30)`;
- decodes deterministic local audio fixtures;
- routes audio through `MediaStreamAudioDestinationNode`;
- probes runtime MIME support and records with `MediaRecorder.start(1000)`;
- validates orientation, aspect ratio, duration drift, playback and seeking, exact audio/video track counts, per-track codec families, fixture checksums, input-fixture marker preflight, output marker timing, and local memory envelopes;
- exports only local JSON evidence.

## Fixtures

- Manifest: [mediaRecorderFixtureManifest.json](../src/features/labs/mediaRecorderPrototype/generated/mediaRecorderFixtureManifest.json)
- Generator: `pnpm fixtures:mediarecorder`
- Recorded FFmpeg generator version: `ffmpeg version 8.0-full_build-www.gyan.dev`
- Current fixture root in source control: `prototype-fixtures/mediarecorder/fixtures`
- Marker validation is channel-separated so the right-channel `660 Hz` end marker is no longer treated as its own background floor.

## Measurement Workflow

- `pnpm measure:mediarecorder` requires a clean working tree.
- The measurement build records `gitSha`, `gitDirty`, and `sourceDigest`.
- Local evidence is written outside the repository by default under the system temp directory.
- A `PASS` is a Scenario-Result for all content, playback, seeking, container, and codec gates. It is not a support decision: support still requires a 5/5 series plus an active-cancel and same-tab recovery run.
- Deadline-, admission-, recorder-, container-, validation-, and cancel failures retain the partial attempt timings, chunks, memory high-water, failure phase, deadline, verified fixtures, and final cleanup result.

## Current August 1, 2026 status

- Scenario `01` can be measured locally for all four candidates once the channel-separated end-marker validator is used.
- The previous August 1, 2026 repo-committed evidence files were removed because they were produced from a dirty tree and were therefore not exact-head evidence.
- Exact-head reruns must be generated from a clean tree with `pnpm measure:mediarecorder`.

## Artifact split

- Normal mock build after the alias fix transforms `146` modules and does not emit `dist/prototypes`.
- Prototype staging build transforms `165` modules and emits `prototypes/mediarecorder/fixtures`.

## Known limits

- Requested chunk cadence remains nominal only; delivery frequency is not guaranteed by `MediaRecorder`.
- Browser-internal encoder buffering cannot be hard-bounded by application code.
- A deadline aborts its own attempt context. Non-abortable browser work receives a bounded 500 ms quarantine; the attempt then proceeds to bounded cleanup and late results cannot update that attempt or a replacement run.
- Container inspection reads at most 2 MiB of bounded WebM/MP4 metadata slices. The slice is reserved before allocation and all retained input, PCM, canvas, chunks, output, validation canvas, and inspection bytes are checked against the 64 MiB app-owned budget in every phase.
- User cancellation records DOM-visible cancellation separately from cleanup completion. The visible transition is gated at 250 ms and cleanup at 2 seconds.
- Download capability remains `unknown` until a user-activated download is exercised; file-share capability is derived from `navigator.canShare({ files })` for the actual rendered file.
- The prototype remains staging-only and is not a production user flow.
