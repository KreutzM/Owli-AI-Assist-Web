# Cloudflare Pages staging deployment

## Environment classification

The connected Cloudflare Pages project currently deploys the Web `main` branch to **Owli-AI staging**.

Cloudflare Pages uses the terms **production branch** and **Production deployment** for the primary branch of a Pages project. In this repository that provider label does not mean Owli-AI product production:

- Owli-AI environment: staging
- Custom domain: `https://assist-staging.owli-ai.com`
- Backend origin: `https://api-staging.owli-ai.com`
- Product-production domain `https://assist.owli-ai.com`: not targeted by this setup

Do not claim production deployment or production readiness based only on the Cloudflare label.

## Connected Pages project

- Pages project: `owli-ai-assist-web`
- Git repository: `KreutzM/Owli-AI-Assist-Web`
- Cloudflare Pages production branch: `main`
- Deployment trigger: automatic after every accepted push or merge to `main`
- Build command: `pnpm build:staging`
- Output directory: `dist`
- Node.js: 22
- Custom domain: `assist-staging.owli-ai.com`
- Immutable deployment URL: `<deployment-id>.owli-ai-assist-web.pages.dev`

`pnpm build:staging` uses the checked-in target configuration from `tools/build-web.mjs`. It clears inherited `VITE_OWLI_*` values and builds with:

```text
VITE_OWLI_API_MODE=remote
VITE_OWLI_API_BASE_URL=https://api-staging.owli-ai.com/
VITE_OWLI_DEFAULT_LOCALE=de-DE
OWLI_WEB_DEPLOY_TARGET=staging
```

All `VITE_*` values are public build-time configuration. Never place Cloudflare API tokens, provider credentials, session material, capability URLs, or other secrets in them.

## Normal staging rollout

No manual Pages deployment is required for the normal workflow.

1. Independently review and merge the exact Web PR head to `main`.
2. Let the Cloudflare Git integration create the Pages deployment automatically.
3. Locate the deployment associated with the exact merge commit.
4. Record its deployment ID, immutable Pages URL, timestamp, branch and commit.
5. Verify that the custom staging domain and immutable deployment return the same application artifact.
6. Confirm that the generated CSP connects only to the intended staging backend.
7. Run the required browser, accessibility, privacy/storage and functional staging checks.

Do not trigger a second manual deployment merely because Cloudflare labels the automatic deployment as Production.

## Exact-deployment verification

For every accepted Web staging rollout, record:

- exact reviewed Web merge commit;
- Cloudflare Pages deployment ID;
- immutable deployment URL;
- deployment timestamp;
- branch `main`;
- HTTP 200 from both immutable and custom staging origins;
- byte-equivalent HTML and JavaScript assets, or another deterministic artifact fingerprint;
- staging CSP containing `https://api-staging.owli-ai.com` and not the production API;
- presence of the intended feature bundle;
- confirmation that no manual deployment, product-production domain, tag or release was used.

Example verified Slice-5 rollout on 2026-07-31:

```text
Web merge commit: 7ebf80392ea0ad9f5c27a2ff7462a7c5f011963d
Pages deployment ID: 964f700e-58e8-4fc1-9dfb-076f8557ff36
Immutable URL: https://964f700e.owli-ai-assist-web.pages.dev/
Custom staging URL: https://assist-staging.owli-ai.com/
Result: HTTP 200; HTML and JavaScript byte-equivalent; staging CSP and Audio-Postcard bundle present
Deployment initiated manually: no
```

## Post-deployment checklist

After deployment verify:

- manifest and service worker load;
- icons and install metadata are available;
- `_headers` and `_redirects` are active;
- `index.html` is not cached immutably;
- API and audio responses are not stored by the service worker;
- camera access is available only in a secure context;
- the custom staging origin passes backend CORS;
- disallowed origins do not;
- config, bootstrap and options agree on feature readiness;
- no production origin or production API was enabled accidentally.

## Manual or production changes

A manual Cloudflare deployment, a change of the connected branch, or activation of `assist.owli-ai.com` is outside the normal staging workflow. It requires separately reviewed authorization and exact provenance evidence.
