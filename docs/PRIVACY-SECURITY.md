# Privacy and Security

## Data minimization

The browser should retain only the anonymous installation ID and non-sensitive preferences. Scene images, questions, answers, audio, and video are transient unless a reviewed feature explicitly changes that policy.

Images are resized and recompressed before upload. The service worker must not cache API or media responses.

## Anonymous limits

Installation IDs support best-effort free quotas, not strong human identity. Browser data deletion and multiple browsers remain known bypasses. IP-derived controls are technical burst protection only and must not be treated as a personal quota.

## Browser security

- Production requires HTTPS.
- CSP and Permissions-Policy are delivered by Cloudflare Pages headers.
- CORS is an explicit backend origin allowlist.
- No provider key or privileged token is exposed to the PWA.
- Model output is rendered as text, never HTML.
- Temporary media links must be short-lived and unguessable or authorized.

## Logging

Allowed logs are coarse operational categories, durations, status codes, and redacted identifiers. Prohibited logs include raw images, base64, full questions, answers, audio, video, session tokens, provider keys, and authorization headers.
