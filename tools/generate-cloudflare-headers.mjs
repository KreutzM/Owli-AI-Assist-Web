import { mkdir, writeFile } from 'node:fs/promises';

const target = process.argv[2] ?? process.env.OWLI_WEB_DEPLOY_TARGET;
const declaredTarget = process.env.OWLI_WEB_DEPLOY_TARGET;
const origins = {
  mock: { connect: '', media: '' },
  staging: {
    connect: ' https://api-staging.owli-ai.com',
    media: ' https://api-staging.owli-ai.com',
  },
  production: {
    connect: ' https://api.owli-ai.com',
    media: ' https://api.owli-ai.com',
  },
};

if (!target || !Object.hasOwn(origins, target)) {
  throw new Error('OWLI_WEB_DEPLOY_TARGET must be exactly mock, staging, or production.');
}
if (declaredTarget !== undefined && declaredTarget !== target) {
  throw new Error(`Runtime build target ${declaredTarget} does not match header target ${target}.`);
}

const selected = origins[target];
const content = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:${selected.media}; connect-src 'self'${selected.connect}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests

/index.html
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/manifest.webmanifest
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache
`;

await mkdir('dist', { recursive: true });
await writeFile('dist/_headers', content, 'utf8');
