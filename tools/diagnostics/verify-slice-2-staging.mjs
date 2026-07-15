import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';

const STAGING_URL = 'https://assist-staging.owli-ai.com/';
const BACKEND_ORIGIN = 'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev';
const PRODUCTION_ORIGIN = 'https://api.owli-ai.com';
const ALLOWED_PATHS = new Set([
  '/api/v1/config',
  '/api/v1/session/bootstrap',
  '/api/v1/profiles',
]);
const ARTIFACT_DIR = 'staging-diagnostics-artifacts';

await mkdir(ARTIFACT_DIR, { recursive: true });

const report = {
  stagingUrl: STAGING_URL,
  backendOrigin: BACKEND_ORIGIN,
  http: {},
  browsers: {},
  failures: [],
};

function check(condition, message, failures = report.failures) {
  if (!condition) failures.push(message);
}

function backendUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === BACKEND_ORIGIN ? url : null;
  } catch {
    return null;
  }
}

function safeHeaders(headers) {
  const allowed = [
    'accept',
    'cache-control',
    'content-type',
    'etag',
    'if-none-match',
    'pragma',
  ];
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => allowed.includes(key.toLowerCase()))
      .map(([key, value]) => [key.toLowerCase(), value]),
  );
}

async function verifyHttp() {
  const response = await fetch(STAGING_URL, {
    cache: 'no-store',
    redirect: 'follow',
  });
  const csp = response.headers.get('content-security-policy') ?? '';
  const html = await response.text();
  const headers = {
    'content-security-policy': csp,
    'x-content-type-options': response.headers.get('x-content-type-options'),
    'referrer-policy': response.headers.get('referrer-policy'),
    'permissions-policy': response.headers.get('permissions-policy'),
  };

  report.http = {
    status: response.status,
    finalUrl: response.url,
    headers,
    remoteShellDetected:
      html.includes('Online-Vorbereitung') || html.includes('Backend-Bereitschaft und Profile'),
  };

  check(response.ok, `HTTP staging request failed with ${response.status}.`);
  check(csp.length > 0, 'Live staging response has no Content-Security-Policy header.');
  check(
    csp.includes(`connect-src 'self' ${BACKEND_ORIGIN}`),
    'Live staging CSP does not allow exactly the staging backend origin.',
  );
  check(!csp.includes(PRODUCTION_ORIGIN), 'Live staging CSP contains the production API origin.');
  check(!csp.includes('pages.dev'), 'Live staging CSP contains a Pages preview origin.');
  check(!/connect-src[^;]*\*/u.test(csp), 'Live staging connect-src contains a wildcard.');
  check(
    headers['x-content-type-options'] === 'nosniff',
    'Live staging response is missing X-Content-Type-Options: nosniff.',
  );
  check(Boolean(headers['referrer-policy']), 'Live staging response is missing Referrer-Policy.');
  check(Boolean(headers['permissions-policy']), 'Live staging response is missing Permissions-Policy.');
}

async function verifyBrowser(browserName, browserType) {
  const failures = [];
  const network = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'de-DE',
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    globalThis.__owliCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.__owliCspViolations.push({
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective,
      });
    });
  });

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push({
      method: request.method(),
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown',
    });
  });
  page.on('request', (request) => {
    const url = backendUrl(request.url());
    if (!url) return;
    let bodyShape = null;
    if (url.pathname === '/api/v1/session/bootstrap' && request.method() === 'POST') {
      try {
        const body = request.postDataJSON();
        bodyShape = {
          platform: body?.platform,
          installationIdPresent:
            typeof body?.installationId === 'string' && body.installationId.trim().length > 0,
        };
      } catch {
        bodyShape = { parseFailed: true };
      }
    }
    network.push({
      kind: 'request',
      method: request.method(),
      path: url.pathname,
      headers: safeHeaders(request.headers()),
      bodyShape,
    });
  });
  page.on('response', (response) => {
    const url = backendUrl(response.url());
    if (!url) return;
    network.push({
      kind: 'response',
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
      headers: safeHeaders(response.headers()),
      fromServiceWorker: response.fromServiceWorker(),
    });
  });

  try {
    await page.goto(STAGING_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByText('Online-Vorbereitung', { exact: true }).first().waitFor({ timeout: 20_000 });
    await page
      .getByRole('heading', { name: 'Backend-Bereitschaft und Profile' })
      .waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Profilkatalog aktualisieren' }).waitFor({
      timeout: 20_000,
    });
    await page.getByText('Scene kurz', { exact: true }).waitFor({ timeout: 20_000 });

    check(
      (await page.getByText('Demo-Modus', { exact: true }).count()) === 0,
      `${browserName}: Demo mode is visible on staging.`,
      failures,
    );
    const interactiveNames = await page
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim() ?? ''));
    check(
      interactiveNames.every(
        (name) => !/(kamera|aufnahme|upload|rückfrage|audio|video|teilen|song)/iu.test(name),
      ),
      `${browserName}: a forbidden product control is present: ${interactiveNames.join(', ')}`,
      failures,
    );
    check(
      (await page.locator('input[type="file"], video, audio').count()) === 0,
      `${browserName}: file, video, or audio elements are present in remote mode.`,
      failures,
    );

    const initialPaths = new Set(
      network.filter((entry) => entry.kind === 'request').map((entry) => entry.path),
    );
    for (const path of initialPaths) {
      check(ALLOWED_PATHS.has(path), `${browserName}: unexpected backend route ${path}.`, failures);
    }
    for (const requiredPath of ALLOWED_PATHS) {
      check(initialPaths.has(requiredPath), `${browserName}: missing backend route ${requiredPath}.`, failures);
    }

    const bootstrapRequest = network.find(
      (entry) =>
        entry.kind === 'request' &&
        entry.path === '/api/v1/session/bootstrap' &&
        entry.method === 'POST',
    );
    check(Boolean(bootstrapRequest), `${browserName}: bootstrap POST was not observed.`, failures);
    check(
      bootstrapRequest?.bodyShape?.platform === 'web',
      `${browserName}: bootstrap platform is not web.`,
      failures,
    );
    check(
      bootstrapRequest?.bodyShape?.installationIdPresent === true,
      `${browserName}: bootstrap installationId is missing or empty.`,
      failures,
    );

    const initialProfileRequest = network.find(
      (entry) => entry.kind === 'request' && entry.path === '/api/v1/profiles',
    );
    const initialProfileResponse = network.find(
      (entry) =>
        entry.kind === 'response' &&
        entry.path === '/api/v1/profiles' &&
        entry.status === 200,
    );
    const initialEtag = initialProfileResponse?.headers?.etag;
    check(Boolean(initialProfileRequest), `${browserName}: initial profiles request missing.`, failures);
    check(
      !Object.hasOwn(initialProfileRequest?.headers ?? {}, 'authorization'),
      `${browserName}: public profiles request contains Authorization.`,
      failures,
    );
    check(
      Boolean(initialProfileRequest?.headers?.accept),
      `${browserName}: profiles request is missing Accept.`,
      failures,
    );
    check(Boolean(initialEtag), `${browserName}: initial profiles response has no ETag.`, failures);

    const refreshRequestPromise = page.waitForRequest(
      (request) => backendUrl(request.url())?.pathname === '/api/v1/profiles',
      { timeout: 20_000 },
    );
    const refreshResponsePromise = page.waitForResponse(
      (response) => backendUrl(response.url())?.pathname === '/api/v1/profiles',
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Profilkatalog aktualisieren' }).click();
    const refreshRequest = await refreshRequestPromise;
    const refreshResponse = await refreshResponsePromise;
    const refreshHeaders = refreshRequest.headers();
    check(
      refreshHeaders['if-none-match'] === initialEtag,
      `${browserName}: refresh If-None-Match does not equal the initial ETag.`,
      failures,
    );
    check(
      refreshResponse.status() === 304,
      `${browserName}: refresh returned ${refreshResponse.status()} instead of 304.`,
      failures,
    );
    await page.getByText('Scene kurz', { exact: true }).waitFor({ timeout: 10_000 });

    const serviceWorker = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const registration = await navigator.serviceWorker.ready;
      return {
        supported: true,
        active: Boolean(registration.active),
        controller: Boolean(navigator.serviceWorker.controller),
      };
    });
    check(
      serviceWorker.supported && serviceWorker.active,
      `${browserName}: service worker did not become active.`,
      failures,
    );

    const reloadStart = network.length;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByText('Scene kurz', { exact: true }).waitFor({ timeout: 20_000 });
    const reloadNetwork = network.slice(reloadStart);
    const reloadRequests = reloadNetwork.filter((entry) => entry.kind === 'request');
    const reloadResponses = reloadNetwork.filter((entry) => entry.kind === 'response');
    const reloadPaths = new Set(reloadRequests.map((entry) => entry.path));
    for (const requiredPath of ALLOWED_PATHS) {
      check(
        reloadPaths.has(requiredPath),
        `${browserName}: reload did not request ${requiredPath} over the network.`,
        failures,
      );
    }
    const reloadProfileRequest = reloadRequests.find(
      (entry) => entry.path === '/api/v1/profiles',
    );
    check(
      !reloadProfileRequest?.headers?.['if-none-match'],
      `${browserName}: first profiles request after reload reused an old ETag.`,
      failures,
    );
    check(
      reloadResponses.every((entry) => entry.fromServiceWorker === false),
      `${browserName}: a backend response was served by the service worker.`,
      failures,
    );

    const storage = await page.evaluate(async (backendOrigin) => {
      const summarize = (storageObject) => {
        const keys = Object.keys(storageObject);
        const suspicious = keys.some((key) =>
          /(token|session|etag|profile|installation)/iu.test(key),
        );
        const suspiciousValue = keys.some((key) => {
          const value = storageObject.getItem(key) ?? '';
          return /(^|\.)eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(value);
        });
        return { keys, suspicious, suspiciousValue };
      };

      const cacheEntries = [];
      if ('caches' in globalThis) {
        for (const cacheName of await caches.keys()) {
          const cache = await caches.open(cacheName);
          const requests = await cache.keys();
          cacheEntries.push({
            cacheName,
            urls: requests.map((request) => request.url),
          });
        }
      }

      let indexedDbNames = [];
      if (typeof indexedDB.databases === 'function') {
        indexedDbNames = (await indexedDB.databases())
          .map((database) => database.name)
          .filter(Boolean);
      }

      return {
        localStorage: summarize(localStorage),
        sessionStorage: summarize(sessionStorage),
        cacheEntries,
        indexedDbNames,
        controller: Boolean(navigator.serviceWorker?.controller),
        backendOrigin,
      };
    }, BACKEND_ORIGIN);
    const cookies = (await context.cookies()).map(({ name, domain }) => ({ name, domain }));

    check(
      !storage.localStorage.suspicious && !storage.localStorage.suspiciousValue,
      `${browserName}: suspicious Local Storage state exists.`,
      failures,
    );
    check(
      !storage.sessionStorage.suspicious && !storage.sessionStorage.suspiciousValue,
      `${browserName}: suspicious Session Storage state exists.`,
      failures,
    );
    check(
      storage.cacheEntries.every(({ urls }) =>
        urls.every((url) => !url.startsWith(BACKEND_ORIGIN)),
      ),
      `${browserName}: backend response exists in Cache Storage.`,
      failures,
    );
    check(
      storage.indexedDbNames.every(
        (name) => !/(owli|token|session|etag|profile|installation)/iu.test(name),
      ),
      `${browserName}: suspicious IndexedDB database exists.`,
      failures,
    );
    check(
      cookies.every(
        ({ name, domain }) =>
          !/(token|session|installation)/iu.test(name) && !domain.includes('workers.dev'),
      ),
      `${browserName}: suspicious session cookie exists.`,
      failures,
    );

    const cspViolations = await page.evaluate(() => globalThis.__owliCspViolations ?? []);
    check(cspViolations.length === 0, `${browserName}: CSP violation observed.`, failures);
    check(consoleErrors.length === 0, `${browserName}: console errors observed.`, failures);
    check(pageErrors.length === 0, `${browserName}: page errors observed.`, failures);
    check(failedRequests.length === 0, `${browserName}: failed requests observed.`, failures);

    await page.screenshot({
      path: `${ARTIFACT_DIR}/${browserName.toLowerCase()}-staging.png`,
      fullPage: true,
    });

    report.browsers[browserName] = {
      passed: failures.length === 0,
      failures,
      backendNetwork: network,
      serviceWorker,
      storage: {
        localStorageKeys: storage.localStorage.keys,
        sessionStorageKeys: storage.sessionStorage.keys,
        cacheEntries: storage.cacheEntries,
        indexedDbNames: storage.indexedDbNames,
        controller: storage.controller,
        cookies,
      },
      consoleErrors,
      pageErrors,
      failedRequests,
      cspViolations,
    };
  } catch (error) {
    failures.push(`${browserName}: ${error instanceof Error ? error.message : String(error)}`);
    report.browsers[browserName] = {
      passed: false,
      failures,
      backendNetwork: network,
      consoleErrors,
      pageErrors,
      failedRequests,
    };
  } finally {
    report.failures.push(...failures);
    await browser.close();
  }
}

await verifyHttp();
await verifyBrowser('Chromium', chromium);
await verifyBrowser('WebKit', webkit);

const markdown = [
  '# Slice 2 staging diagnostics',
  '',
  `- Staging URL: ${STAGING_URL}`,
  `- Backend origin: ${BACKEND_ORIGIN}`,
  `- HTTP status: ${report.http.status ?? 'unknown'}`,
  `- Chromium: ${report.browsers.Chromium?.passed ? 'PASS' : 'FAIL'}`,
  `- WebKit: ${report.browsers.WebKit?.passed ? 'PASS' : 'FAIL'}`,
  '',
  '## Failures',
  '',
  ...(report.failures.length > 0 ? report.failures.map((failure) => `- ${failure}`) : ['- None']),
  '',
].join('\n');

await writeFile(`${ARTIFACT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(`${ARTIFACT_DIR}/report.md`, markdown, 'utf8');

if (report.failures.length > 0) {
  throw new Error(`Staging diagnostics failed:\n${report.failures.map((item) => `- ${item}`).join('\n')}`);
}

console.log('Slice 2 staging diagnostics passed in Chromium and WebKit.');
