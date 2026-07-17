# Remote Assist Slice 3

This feature owns only remote readiness, intentional camera/file input, local scene-image preparation, the streamed Scene Describe state machine, and accessible user feedback.

Allowed collaborators:

- `RemoteAssistClient` for config, memory-only session, profiles, and `/api/v1/scene/describe`
- `RemoteCamera` for explicit rear-camera access without audio
- `BrowserSceneImageNormalizer` for signature inspection, EXIF orientation, deterministic JPEG output, and preview-URL cleanup

The remote composition must not import or expose follow-up, song, audio-postcard, speech, playback, sharing, provider-model, prompt, or debug-capture capabilities. Mock mode remains a separate application composition.
