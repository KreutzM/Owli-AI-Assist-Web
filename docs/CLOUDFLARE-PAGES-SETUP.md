# Cloudflare Pages Setup

Create a separate Pages project for the web repository.

- Production branch: `main`
- Build command: `pnpm build`
- Output: `dist`
- Node: 22
- Domain: `assist.owli-ai.com`

Production variables:

```text
VITE_OWLI_API_MODE=remote
VITE_OWLI_API_BASE_URL=https://api.owli-ai.com
VITE_OWLI_APP_VERSION=<release version>
VITE_OWLI_VERSION_CODE=<monotonic integer>
VITE_OWLI_DEFAULT_LOCALE=de-DE
```

These variables are public. Do not place Cloudflare API tokens or provider secrets in `VITE_*` variables.

Before enabling remote mode, the backend must allow the exact production and preview origins that are intentionally supported. Prefer a dedicated staging hostname over wildcarding all Pages preview domains.

After deployment verify:

- manifest and service worker load,
- icons are installable,
- `_headers` and `_redirects` are active,
- `index.html` is not cached immutably,
- API/media are not service-worker cached,
- camera works only on HTTPS,
- production origin passes backend CORS,
- disallowed origins do not.
