# ADR 0002: Backend-first product logic

Status: accepted.

The browser keeps camera, image normalization, accessibility, speech, and share integration. The backend owns prompts, provider selection, sessions, quotas, rate limits, Audio-Postcard generation, and future MP4 rendering. This reduces platform duplication without uploading unnecessarily large raw camera data or weakening native accessibility behavior.
