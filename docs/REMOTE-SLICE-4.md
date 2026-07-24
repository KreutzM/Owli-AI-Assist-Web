# Remote Slice 4: follow-up questions and explicit local speech

Binding implementation plan: `KreutzM/Owli-AI-Assist-WS/docs/plans/2026-07-23-pwa-slice-4-followup-local-speech.md` at merge `893d4706b8217e9e0672c2e34809ac91905c8cec`.

## Scope

Remote mode extends one cleanly completed Scene Describe result with bounded sequential follow-up questions about the same retained in-memory scene. It also exposes explicit browser/operating-system speech for a completed scene description or completed follow-up answer. Mock mode remains structurally separate.

No Backend, Android, Workspace, landing-site, Cloudflare, production, provider, model, prompt, microphone, speech-recognition, Backend-TTS, tag, release, or production-deployment change belongs to this Web slice.

## Scene binding and follow-up request

Follow-up is available only when config, bootstrap, the effective completed-result profile, the non-expired scene token, and the retained normalized JPEG all agree. The completed result profile and locale are frozen until a new scene is selected.

The public browser client calls only `POST /api/v1/scene/followup` with `Accept: text/event-stream` and `Content-Type: application/json`. It resends the retained normalized JPEG and serializes the trimmed current question plus at most four previously completed user/assistant pairs. The initial scene description and current question are not duplicated in history. Cancelled, failed, malformed, incomplete, or partially streamed answers are never committed.

One session-related `401` before SSE acceptance may refresh the memory-only session and retry once. Scene-token invalidity or expiry requires a new scene and never enters that refresh loop. `403` and `429` are not automatically retried, and provider work is never replayed after SSE acceptance.

## Strict completion

Follow-up requires exactly one valid `metadata` event first, zero or more valid `delta` events, exactly one terminal `done` or `error` event, and clean EOF. A visible partial answer remains ordinary non-live document content and is discarded on cancellation or failure. No answer is committed as complete before clean EOF.

## Explicit browser speech

Speech starts only through an explicit action for completed text. It never autostarts and never speaks streamed deltas, partial answers, progress text, errors, or live-region messages. Starting a new utterance replaces the previous one; new requests, reset, navigation, runtime replacement, `pagehide`, unmount, unsupported APIs, and synthesis failures stop it deterministically.

Owli sends no additional speech request to the Owli Backend. The browser or operating system performs synthesis, and platform voice implementations may have their own processing behavior. This does not promise universal offline or fully on-device speech.

## Privacy and accessibility

The normalized JPEG/base64, installation and session material, scene token and expiry, frozen profile/locale, question draft, transcript, partial and completed answers, and speech text remain volatile and memory-only. They are not written to browser storage, Cache Storage, service-worker caches, URLs/history, analytics, logs, or error telemetry.

The follow-up UI uses a native labeled form, keyboard-operable controls, visible validation and focus, coalesced progress feedback, and one atomic completion announcement after clean EOF. Transcript text remains ordinary document content, and speech never competes automatically with assistive technology.

`KreutzM/Owli-AI-Assist-Web#37` remains open. Slice 4 records deterministic improvements without claiming complete physical-device VoiceOver acceptance or production readiness.
