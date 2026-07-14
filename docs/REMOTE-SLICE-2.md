# PWA Slice 2 Web runtime

The Web runtime defaults to mock mode. Remote mode is opt-in and accepts only the approved staging or production API roots. Production deployment remains configured for mock mode during Slice 2.

Remote startup is limited to `/api/v1/config`, `/api/v1/session/bootstrap`, and `/api/v1/profiles`. Session tokens, profile payloads, and ETags remain in memory only. Remote composition does not construct camera, upload, scene, follow-up, song, speech, audio, media, video, or share capabilities.

Build targets generate deployment-specific `dist/_headers` files:

- `pnpm build` creates the mock artifact.
- `pnpm build:staging` creates the staging remote artifact.
- `pnpm build:production` creates production headers while keeping the application in mock mode.

Development and preview use fixed ports 5173 and 4173 with fail-fast strict-port behavior.
