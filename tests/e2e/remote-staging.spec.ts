import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const API_BASE = 'https://api-staging.owli-ai.com/';
const API_ORIGIN = new URL(API_BASE).origin;
const ALLOWED_ROUTES = new Set([
  '/api/v1/config',
  '/api/v1/session/bootstrap',
  '/api/v1/profiles',
  '/api/v1/scene/describe',
]);
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: https://api-staging.owli-ai.com; connect-src 'self' https://api-staging.owli-ai.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests";
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOs2HKHgYGBiYGBgYGBAQAYJgIMiYqd0gAAAABJRU5ErkJggg==',
  'base64',
);

type HarnessScenario = 'states' | 'cancel' | 'rate-limit' | 'recoverable' | 'contract' | 'live';

interface HarnessOptions {
  configScene?: boolean;
  slowNormalization?: boolean;
}

interface HarnessRequest {
  method: string;
  path: string;
  body: string;
}

interface HarnessSnapshot {
  requests: HarnessRequest[];
  aborts: number;
  sceneCalls: number;
  cspViolations: string[];
  liveAnnouncements: string[];
}

test.describe('built staging artifact and complete remote matrix', () => {
  test('fails closed when readiness is disabled and serves the generated CSP', async ({ page }) => {
    const firstResponse = await openHarnessedStaging(page, 'states', { configScene: false });

    expect(firstResponse.headers()['content-security-policy']).toBe(EXPECTED_CSP);
    await expect(page.getByRole('alert')).toContainText('nicht freigegeben');
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeDisabled();
    await expect(page.getByLabel('Oder ein Bild auswählen')).toBeDisabled();
  });

  test('shows every successful intermediate state through clean EOF', async ({ page }) => {
    await openHarnessedStaging(page, 'states', { slowNormalization: true });

    const fileInput = page.getByLabel('Oder ein Bild auswählen');
    await fileInput.setInputFiles(sceneFile());
    await expect(page.getByText('Das Bild wird lokal geprüft und vorbereitet …')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Szene beschreiben' })).toBeEnabled();

    await page.getByRole('button', { name: 'Szene beschreiben' }).click();
    await expect(page.getByText('Die Anfrage wird gesendet …')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Laufende Beschreibung' })).toBeVisible();
    await expect(page.getByText('Die Beschreibung wird übertragen …')).toBeVisible();
    await expect(page.getByText('Die Antwort wird sicher abgeschlossen …')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Szenenbeschreibung' })).toContainText(
      'Eine helle Straße.',
    );
  });

  test('cancels an accepted stream, aborts transport, and restores focus', async ({ page }) => {
    await openHarnessedStaging(page, 'cancel');
    await chooseFileAndDescribe(page);
    await expect(page.getByRole('heading', { name: 'Laufende Beschreibung' })).toBeVisible();

    await page.getByRole('button', { name: 'Abbrechen' }).click();

    await expect(
      page
        .locator('.live-status[role="status"]')
        .filter({ hasText: 'Der Vorgang wurde abgebrochen.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Erneut senden' })).toBeEnabled();
    await expect.poll(async () => (await readHarness(page)).aborts).toBe(1);
  });

  test('retains the normalized JPEG and waits for explicit Retry-After retry', async ({ page }) => {
    await openHarnessedStaging(page, 'rate-limit');
    await chooseFileAndDescribe(page);

    await expect(page.getByRole('alert')).toContainText('vorübergehend ausgelastet');
    const retry = page.getByRole('button', { name: 'Erneut versuchen, sobald freigegeben' });
    await expect(retry).toBeDisabled();
    await expect(page.getByAltText('Ausgewählte Szene')).toBeVisible();
    await expect(page.getByText(/Erneut möglich in/u)).toBeVisible();

    await page.waitForTimeout(1_100);
    expect((await readHarness(page)).sceneCalls).toBe(1);
    const enabledRetry = page.getByRole('button', {
      name: 'Mit dem vorbereiteten Bild erneut versuchen',
    });
    await expect(enabledRetry).toBeEnabled();
    await enabledRetry.click();
    await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toBeVisible();

    const sceneBodies = (await readHarness(page)).requests
      .filter((request) => request.path === '/api/v1/scene/describe')
      .map((request) => JSON.parse(request.body) as { imageBase64: string });
    expect(sceneBodies).toHaveLength(2);
    expect(sceneBodies[1]?.imageBase64).toBe(sceneBodies[0]?.imageBase64);
  });

  test('recovers focus after a recoverable transport error', async ({ page }) => {
    await openHarnessedStaging(page, 'recoverable');
    await chooseFileAndDescribe(page);

    await expect(page.getByRole('alert')).toContainText('nicht abgeschlossen');
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Mit dem vorbereiteten Bild erneut versuchen' }),
    ).toBeEnabled();
  });

  test('surfaces a contract error without promoting partial text', async ({ page }) => {
    await openHarnessedStaging(page, 'contract');
    await chooseFileAndDescribe(page);

    await expect(page.getByRole('alert')).toContainText('Streaming-Antwort');
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toHaveCount(0);
  });

  test('supports keyboard-only submission and coalesces live-region output', async ({ page }) => {
    await openHarnessedStaging(page, 'live');
    await installLiveRegionObserver(page);

    const fileInput = page.getByLabel('Oder ein Bild auswählen');
    await fileInput.focus();
    await fileInput.setInputFiles(sceneFile());
    await expect(page.getByRole('button', { name: 'Szene beschreiben' })).toBeEnabled();
    await pressNextInteractiveControl(page);
    await expect(page.getByRole('button', { name: 'Szene beschreiben' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toBeVisible();

    const resultRegion = page.getByRole('region', { name: 'Szenenbeschreibung' });
    await expect(resultRegion).not.toHaveAttribute('aria-live');
    const snapshot = await readHarness(page);
    const finalText = 'Ein Tisch am Fenster. Eine Lampe. Danach eine Tür.';
    expect(snapshot.liveAnnouncements.filter((text) => text === finalText)).toHaveLength(1);
    expect(snapshot.liveAnnouncements).toContain('Ein Tisch am Fenster. Eine Lampe.');
    expect(snapshot.liveAnnouncements).toContain(
      'Die Antwort wurde empfangen und wird sicher abgeschlossen.',
    );
    expect(
      snapshot.liveAnnouncements.some((text, index, all) => index > 0 && text === all[index - 1]),
    ).toBe(false);
  });

  test('remains usable at narrow, landscape, and 200 percent equivalent zoom', async ({ page }) => {
    await openHarnessedStaging(page, 'states');

    await page.setViewportSize({ width: 320, height: 800 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 800, height: 320 });
    await expectNoHorizontalOverflow(page);
    // A 320 CSS-pixel viewport represents a 640-pixel layout at 200% browser zoom.
    await page.setViewportSize({ width: 320, height: 450 });
    await expectNoHorizontalOverflow(page);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('uses only approved routes and leaves API data outside service-worker caches', async ({
    page,
  }, testInfo) => {
    const routeLog: string[] = [];
    const requestBodies: Record<string, unknown>[] = [];
    const cspMessages: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/content security policy|refused to (connect|execute|load)/iu.test(text)) {
        cspMessages.push(text);
      }
    });
    await installNetworkRoutes(page, routeLog, requestBodies);
    const firstResponse = await page.goto('/');
    if (!firstResponse) throw new Error('Built staging navigation returned no response.');

    expect(firstResponse.headers()['content-security-policy']).toBe(EXPECTED_CSP);
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeEnabled();
    if (testInfo.project.name === 'chromium-staging') await activateServiceWorker(page);
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeEnabled();
    await chooseFileAndDescribe(page);
    await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toBeVisible();

    expect(new Set(routeLog)).toEqual(ALLOWED_ROUTES);
    expect(routeLog.every((path) => ALLOWED_ROUTES.has(path))).toBe(true);
    expect(requestBodies).toHaveLength(1);
    expect(Object.keys(requestBodies[0] ?? {}).sort()).toEqual(
      [
        'sessionToken',
        'installationId',
        'imageBase64',
        'imageMimeType',
        'sceneMode',
        'stream',
        'profileId',
        'locale',
      ].sort(),
    );

    const browserEvidence = await page.evaluate(async (apiOrigin) => {
      const cachedUrls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        cachedUrls.push(...(await cache.keys()).map((request) => request.url));
      }
      const databaseNames =
        typeof indexedDB.databases === 'function'
          ? (await indexedDB.databases()).flatMap((database) =>
              database.name ? [database.name] : [],
            )
          : [];
      return {
        cachedUrls,
        databaseNames,
        localStorageLength: localStorage.length,
        sessionStorageLength: sessionStorage.length,
        href: location.href,
        hasApiCache: cachedUrls.some(
          (url) => url.startsWith(apiOrigin) || new URL(url).pathname.startsWith('/api/'),
        ),
      };
    }, API_ORIGIN);
    expect(browserEvidence.hasApiCache).toBe(false);
    expect(browserEvidence.localStorageLength).toBe(0);
    expect(browserEvidence.sessionStorageLength).toBe(0);
    expect(browserEvidence.databaseNames).toEqual([]);
    expect(cspMessages).toEqual([]);
    expect(new URL(browserEvidence.href).search).toBe('');
    expect(new URL(browserEvidence.href).hash).toBe('');
  });
});

async function openHarnessedStaging(
  page: Page,
  scenario: HarnessScenario,
  options: HarnessOptions = {},
) {
  await installHarness(page, scenario, options);
  const response = await page.goto('/');
  if (!response) throw new Error('Built staging navigation returned no response.');
  if (options.configScene === false) await expect(page.getByRole('alert')).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeEnabled();
  return response;
}

async function activateServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expectServiceWorkerControl(page);
}

async function expectServiceWorkerControl(page: Page): Promise<void> {
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      scriptUrl: ready.active?.scriptURL ?? '',
    };
  });
  expect(registration.controlled).toBe(true);
  expect(new URL(registration.scriptUrl).pathname).toBe('/sw.js');
}

async function chooseFileAndDescribe(page: Page): Promise<void> {
  await page.getByLabel('Oder ein Bild auswählen').setInputFiles(sceneFile());
  await expect(page.getByRole('button', { name: 'Szene beschreiben' })).toBeEnabled();
  await page.getByRole('button', { name: 'Szene beschreiben' }).click();
}

function sceneFile() {
  return { name: 'scene.png', mimeType: 'image/png', buffer: png };
}

async function pressNextInteractiveControl(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function installLiveRegionObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const liveRegion = document.querySelector<HTMLElement>('[aria-live="polite"]');
    if (!liveRegion) throw new Error('Polite live region missing.');
    const state = (
      globalThis as typeof globalThis & {
        __owliE2e: HarnessSnapshot;
      }
    ).__owliE2e;
    state.liveAnnouncements.length = 0;
    const record = () => {
      const text = liveRegion.textContent.trim();
      if (text && state.liveAnnouncements.at(-1) !== text) state.liveAnnouncements.push(text);
    };
    new MutationObserver(record).observe(liveRegion, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    record();
  });
}

async function readHarness(page: Page): Promise<HarnessSnapshot> {
  return await page.evaluate(() => {
    const state = (
      globalThis as typeof globalThis & {
        __owliE2e: HarnessSnapshot;
      }
    ).__owliE2e;
    return structuredClone(state);
  });
}

async function installHarness(
  page: Page,
  scenario: HarnessScenario,
  options: HarnessOptions,
): Promise<void> {
  await page.addInitScript(
    ({ apiBase, scenarioName, configScene, slowNormalization }) => {
      const state: HarnessSnapshot = {
        requests: [],
        aborts: 0,
        sceneCalls: 0,
        cspViolations: [],
        liveAnnouncements: [],
      };
      Object.defineProperty(globalThis, '__owliE2e', {
        configurable: true,
        value: state,
      });
      document.addEventListener('securitypolicyviolation', (event) => {
        state.cspViolations.push(`${event.violatedDirective}:${event.blockedURI}`);
      });

      if (slowNormalization) {
        const originalToBlob = Object.getOwnPropertyDescriptor(
          HTMLCanvasElement.prototype,
          'toBlob',
        )?.value as HTMLCanvasElement['toBlob'] | undefined;
        if (!originalToBlob) throw new Error('Canvas toBlob is unavailable.');
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
          return originalToBlob.call(
            this,
            (blob) => window.setTimeout(() => callback(blob), 400),
            type,
            quality,
          );
        };
      }

      const nativeFetch = globalThis.fetch.bind(globalThis);
      const encoder = new TextEncoder();
      const event = (name: string, data: unknown) =>
        `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
      const metadata = event('metadata', {
        mode: 'describe',
        modelAlias: 'scene-describe-v1',
        profileId: 'brief',
        locale: 'de-DE',
      });
      const done = (answerText: string) =>
        event('done', {
          answerText,
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          requestId: 'request-1',
          sceneToken: 'scene-token',
          sceneTokenExpiresAt: '2030-01-01T00:00:00.000Z',
          profileId: 'brief',
          locale: 'de-DE',
        });
      const streamResponse = (kind: HarnessScenario) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const timers: number[] = [];
            let settled = false;
            const enqueue = (delay: number, value: string) => {
              timers.push(
                window.setTimeout(() => {
                  if (!settled) controller.enqueue(encoder.encode(value));
                }, delay),
              );
            };
            const close = (delay: number) => {
              timers.push(
                window.setTimeout(() => {
                  if (settled) return;
                  settled = true;
                  controller.close();
                }, delay),
              );
            };
            const abort = () => {
              if (settled) return;
              settled = true;
              state.aborts += 1;
              for (const timer of timers) window.clearTimeout(timer);
              controller.error(new DOMException('aborted', 'AbortError'));
            };
            currentRequestSignal?.addEventListener('abort', abort, { once: true });

            if (kind === 'contract') {
              enqueue(100, metadata);
              enqueue(250, event('unknown', {}));
              close(400);
              return;
            }
            if (kind === 'live') {
              enqueue(100, metadata);
              enqueue(250, event('delta', { textDelta: 'Ein Tisch', requestId: 'request-1' }));
              enqueue(
                450,
                event('delta', { textDelta: ' am Fenster. Eine Lampe.', requestId: 'request-1' }),
              );
              enqueue(
                2_200,
                event('delta', { textDelta: ' Danach eine Tür.', requestId: 'request-1' }),
              );
              enqueue(2_350, done('Ein Tisch am Fenster. Eine Lampe. Danach eine Tür.'));
              close(2_700);
              return;
            }
            enqueue(300, metadata);
            enqueue(
              600,
              event('delta', { textDelta: 'Eine helle Straße.', requestId: 'request-1' }),
            );
            if (kind === 'cancel') return;
            enqueue(900, done('Eine helle Straße.'));
            close(1_500);
          },
          cancel() {
            state.aborts += 1;
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        });
      };

      let currentRequestSignal: AbortSignal | undefined;
      const patchedFetch: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (!url.href.startsWith(apiBase)) return await nativeFetch(input, init);

        const body = request.method === 'GET' ? '' : await request.clone().text();
        state.requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === '/api/v1/config') {
          return jsonResponse({
            environment: 'staging',
            features: { sceneDescribe: configScene, followup: false, audioPostcard: false },
            profiles: { backendSupportedProfileIds: ['brief'] },
          });
        }
        if (url.pathname === '/api/v1/session/bootstrap') {
          return jsonResponse({
            sessionToken: 'session-1',
            expiresAt: '2030-01-01T00:00:00.000Z',
            featureFlags: { sceneDescribe: configScene, followup: false, audioPostcard: false },
            bootstrapInfo: {
              environment: 'staging',
              sessionTtlSeconds: 120,
              sessionSchemaVersion: 2,
              platform: 'web',
              trust: {
                kind: 'browser_public_client',
                status: 'unattested_public_client',
                enforced: false,
                note: 'public browser client',
              },
            },
          });
        }
        if (url.pathname === '/api/v1/profiles') {
          return jsonResponse(
            {
              schemaVersion: 'vlm_profile_registry/v1',
              defaultProfileId: 'brief',
              profiles: [
                {
                  id: 'brief',
                  label: 'Kurz',
                  description: 'Kurze Beschreibung',
                  availability: 'backend',
                  transports: {
                    backend: {
                      available: true,
                      supportsStreaming: true,
                      supportsFollowup: false,
                    },
                  },
                },
              ],
            },
            200,
            { ETag: '"profiles-1"' },
          );
        }
        if (url.pathname !== '/api/v1/scene/describe') {
          return jsonResponse({ code: 'NOT_FOUND' }, 404);
        }

        state.sceneCalls += 1;
        if (scenarioName === 'rate-limit' && state.sceneCalls === 1) {
          return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
        }
        if (scenarioName === 'recoverable') return jsonResponse({ code: 'UNAVAILABLE' }, 503);
        currentRequestSignal = request.signal;
        return streamResponse(scenarioName === 'rate-limit' ? 'states' : scenarioName);
      };
      globalThis.fetch = patchedFetch;

      function jsonResponse(
        value: unknown,
        status = 200,
        headers: Record<string, string> = {},
      ): Response {
        return new Response(JSON.stringify(value), {
          status,
          headers: { 'Content-Type': 'application/json', ...headers },
        });
      }
    },
    {
      apiBase: API_BASE,
      scenarioName: scenario,
      configScene: options.configScene ?? true,
      slowNormalization: options.slowNormalization ?? false,
    },
  );
}

async function installNetworkRoutes(
  page: Page,
  routeLog: string[],
  requestBodies: Record<string, unknown>[],
): Promise<void> {
  await page.context().route(`${API_BASE}**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!ALLOWED_ROUTES.has(pathname)) throw new Error(`Unexpected remote route ${pathname}`);
    routeLog.push(pathname);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders() });
      return;
    }
    if (pathname === '/api/v1/config') {
      await jsonRoute(route, {
        environment: 'staging',
        features: { sceneDescribe: true, followup: false, audioPostcard: false },
        profiles: { backendSupportedProfileIds: ['brief'] },
      });
      return;
    }
    if (pathname === '/api/v1/session/bootstrap') {
      await jsonRoute(route, {
        sessionToken: 'session-1',
        expiresAt: '2030-01-01T00:00:00.000Z',
        featureFlags: { sceneDescribe: true, followup: false, audioPostcard: false },
        bootstrapInfo: {
          environment: 'staging',
          sessionTtlSeconds: 120,
          sessionSchemaVersion: 2,
          platform: 'web',
          trust: {
            kind: 'browser_public_client',
            status: 'unattested_public_client',
            enforced: false,
            note: 'public browser client',
          },
        },
      });
      return;
    }
    if (pathname === '/api/v1/profiles') {
      await jsonRoute(
        route,
        {
          schemaVersion: 'vlm_profile_registry/v1',
          defaultProfileId: 'brief',
          profiles: [
            {
              id: 'brief',
              label: 'Kurz',
              description: 'Kurze Beschreibung',
              availability: 'backend',
              transports: {
                backend: {
                  available: true,
                  supportsStreaming: true,
                  supportsFollowup: false,
                },
              },
            },
          ],
        },
        { ETag: '"profiles-1"' },
      );
      return;
    }

    requestBodies.push(request.postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      headers: corsHeaders(),
      body:
        sseEvent('metadata', {
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          profileId: 'brief',
          locale: 'de-DE',
        }) +
        sseEvent('delta', { textDelta: 'Eine helle Straße.', requestId: 'request-1' }) +
        sseEvent('done', {
          answerText: 'Eine helle Straße.',
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          requestId: 'request-1',
          sceneToken: 'scene-token',
          sceneTokenExpiresAt: '2030-01-01T00:00:00.000Z',
          profileId: 'brief',
          locale: 'de-DE',
        }),
    });
  });
}

async function jsonRoute(
  route: Route,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...corsHeaders(), ...headers },
    body: JSON.stringify(body),
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag',
  };
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
