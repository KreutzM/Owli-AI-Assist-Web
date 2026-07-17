import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const remoteUrl = 'http://127.0.0.1:5173';
const corsHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag',
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOs2HKHgYGBiYGBgYGBAQAYJgIMiYqd0gAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('remote camera and streaming scene', () => {
  test('gates actions and keeps file fallback usable after camera denial', async ({ page }) => {
    await mockReadiness(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        },
      });
    });
    await page.goto(remoteUrl);

    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeEnabled();
    await expect(page.getByLabel('Oder ein Bild auswählen')).toBeEnabled();
    await page.getByRole('button', { name: 'Rückkamera öffnen' }).click();
    await expect(page.getByRole('alert')).toContainText('Kamerazugriff wurde nicht erlaubt');
    await expect(page.getByLabel('Oder ein Bild auswählen')).toBeEnabled();

    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('normalizes a file and sends the exact streaming request', async ({ page }) => {
    await mockReadiness(page);
    let body: Record<string, unknown> | undefined;
    let requestHeaders: Record<string, string> | undefined;
    await page.route('**/api/v1/scene/describe', async (route) => {
      if (await fulfillPreflight(route)) return;
      body = route.request().postDataJSON() as Record<string, unknown>;
      requestHeaders = await route.request().allHeaders();
      await fulfillSse(route, sceneEvents());
    });
    await page.goto(remoteUrl);
    await page.getByLabel('Oder ein Bild auswählen').setInputFiles({
      name: 'scene.png',
      mimeType: 'image/png',
      buffer: png,
    });

    await expect(page.getByRole('button', { name: 'Szene beschreiben' })).toBeEnabled();
    await expect(page.getByText(/Normalisiertes JPEG:/u)).toBeVisible();
    await page.getByRole('button', { name: 'Szene beschreiben' }).click();
    await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toBeVisible();
    await expect(page.getByText('Eine helle Straße.')).toBeVisible();

    expect(Object.keys(body ?? {}).sort()).toEqual(
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
    expect(body).toMatchObject({
      sessionToken: 'session-1',
      imageMimeType: 'image/jpeg',
      sceneMode: 'describe',
      stream: true,
      profileId: 'brief',
      locale: 'de-DE',
    });
    expect(String(body?.imageBase64)).toMatch(/^\/9j\//u);
    expect(String(body?.imageBase64).length).toBeLessThanOrEqual(5_592_408);
    expect(requestHeaders?.accept).toBe('text/event-stream');
    expect(requestHeaders?.['content-type']).toContain('application/json');
    expect(requestHeaders?.authorization).toBeUndefined();
    expect(requestHeaders?.['x-request-id']).toBeUndefined();
  });

  test('retries exactly one pre-stream 401 with a fresh session', async ({ page }) => {
    let bootstrapCalls = 0;
    await mockReadiness(page, {
      bootstrap: () => {
        bootstrapCalls += 1;
        return bootstrap(`session-${bootstrapCalls}`, true);
      },
    });
    let sceneCalls = 0;
    await page.route('**/api/v1/scene/describe', async (route) => {
      if (await fulfillPreflight(route)) return;
      sceneCalls += 1;
      if (sceneCalls === 1) {
        await route.fulfill({ status: 401, headers: corsHeaders });
        return;
      }
      await fulfillSse(route, sceneEvents());
    });
    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toBeVisible();
    expect(bootstrapCalls).toBe(2);
    expect(sceneCalls).toBe(2);
  });

  test('does not retry after SSE headers are accepted', async ({ page }) => {
    let bootstrapCalls = 0;
    await mockReadiness(page, {
      bootstrap: () => {
        bootstrapCalls += 1;
        return bootstrap(`session-${bootstrapCalls}`, true);
      },
    });
    let sceneCalls = 0;
    await page.route('**/api/v1/scene/describe', async (route) => {
      if (await fulfillPreflight(route)) return;
      sceneCalls += 1;
      await fulfillSse(
        route,
        event('metadata', {
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          profileId: 'brief',
          locale: 'de-DE',
        }) + event('unknown', {}),
      );
    });
    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    await expect(page.getByRole('alert')).toContainText('Streaming-Antwort');
    expect(bootstrapCalls).toBe(1);
    expect(sceneCalls).toBe(1);
  });

  test('keeps controls disabled when any readiness signal is false', async ({ page }) => {
    await mockReadiness(page, { configScene: false });
    await page.goto(remoteUrl);
    await expect(page.getByRole('alert')).toContainText('nicht freigegeben');
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeDisabled();
    await expect(page.getByLabel('Oder ein Bild auswählen')).toBeDisabled();
  });
});

async function chooseFileAndDescribe(page: Page): Promise<void> {
  await page.getByLabel('Oder ein Bild auswählen').setInputFiles({
    name: 'scene.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.getByRole('button', { name: 'Szene beschreiben' }).click();
}

interface ReadinessOptions {
  configScene?: boolean;
  bootstrapScene?: boolean;
  streaming?: boolean;
  bootstrap?: () => Record<string, unknown>;
}

async function mockReadiness(page: Page, options: ReadinessOptions = {}): Promise<void> {
  const {
    configScene = true,
    bootstrapScene = true,
    streaming = true,
    bootstrap: bootstrapFactory = () => bootstrap('session-1', bootstrapScene),
  } = options;
  await page.route('**/api/v1/config', (route) =>
    json(route, {
      environment: 'staging',
      features: { sceneDescribe: configScene, followup: false },
      profiles: { backendSupportedProfileIds: ['brief'] },
    }),
  );
  await page.route('**/api/v1/session/bootstrap', async (route) => {
    if (await fulfillPreflight(route)) return;
    await json(route, bootstrapFactory());
  });
  await page.route('**/api/v1/profiles', (route) =>
    json(
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
                supportsStreaming: streaming,
                supportsFollowup: false,
              },
            },
          },
        ],
      },
      { ETag: '"profiles-1"' },
    ),
  );
}

function bootstrap(sessionToken: string, sceneDescribe: boolean): Record<string, unknown> {
  return {
    sessionToken,
    expiresAt: '2030-01-01T00:00:00.000Z',
    featureFlags: { sceneDescribe, followup: false },
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
  };
}

function sceneEvents(): string {
  return (
    event('metadata', {
      mode: 'describe',
      modelAlias: 'scene-describe-v1',
      profileId: 'brief',
      locale: 'de-DE',
    }) +
    event('delta', { textDelta: 'Eine helle Straße.', requestId: 'request-1' }) +
    event('done', {
      answerText: 'Eine helle Straße.',
      mode: 'describe',
      modelAlias: 'scene-describe-v1',
      requestId: 'request-1',
      sceneToken: 'scene-token',
      sceneTokenExpiresAt: '2030-01-01T00:00:00.000Z',
      profileId: 'brief',
      locale: 'de-DE',
    })
  );
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false;
  await route.fulfill({ status: 204, headers: corsHeaders });
  return true;
}

async function fulfillSse(route: Route, body: string): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream; charset=utf-8',
    headers: corsHeaders,
    body,
  });
}

async function json(
  route: Route,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...corsHeaders, ...headers },
    body: JSON.stringify(body),
  });
}
