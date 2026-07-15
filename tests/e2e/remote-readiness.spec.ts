import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request, type Route } from '@playwright/test';

const PROFILE_SCHEMA_VERSION = 'vlm_profile_registry/v1';
const allowedAppOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);

interface RemoteScenario {
  configGate?: Promise<void>;
  configStatuses?: number[];
  profiles?: unknown[];
  profileResponder?: (call: number, route: Route, request: Request) => Promise<void> | void;
}

interface RemoteStats {
  configCalls: number;
  bootstrapBodies: unknown[];
  profileHeaders: Headers[];
  preflightRequestedHeaders: string[];
  origins: string[];
}

test.describe('remote readiness', () => {
  test.use({ baseURL: 'http://127.0.0.1:5173' });

  test('renders the ready state without provider-backed controls', async ({ page }) => {
    const stats = await routeRemoteApi(page);
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Backend-Bereitschaft und Profile' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Kamera|Aufnahme|Rückfrage|Postcard/i }),
    ).toHaveCount(0);
    expect(stats.bootstrapBodies).toHaveLength(1);
    expect(stats.bootstrapBodies[0]).toMatchObject({
      platform: 'web',
      installationId: expect.any(String),
    });
    expect(
      String((stats.bootstrapBodies[0] as { installationId: string }).installationId),
    ).not.toBe('');
    expect(stats.profileHeaders[0]?.get('Authorization')).toBeNull();
    expect(stats.origins.every((origin) => allowedAppOrigins.has(origin))).toBe(true);
    await expectNoSeriousViolations(page);
  });

  test('announces loading and then an empty catalog accessibly', async ({ page }) => {
    let releaseConfig: () => void = () => undefined;
    const configGate = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });
    await routeRemoteApi(page, { configGate, profiles: [] });

    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(
      'Sichere Verbindung und Profilkatalog werden vorbereitet',
    );
    releaseConfig();
    await expect(page.getByRole('status')).toContainText('keine freigegebenen Profile');
    await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeEnabled();
    await expectNoSeriousViolations(page);
  });

  test('shows a rate-limited retry state', async ({ page }) => {
    await routeRemoteApi(page, { configStatuses: [429] });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('vorübergehend ausgelastet');
    await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeEnabled();
    await expectNoSeriousViolations(page);
  });

  test('recovers from an unavailable startup through one user retry', async ({ page }) => {
    const stats = await routeRemoteApi(page, { configStatuses: [503, 200] });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('derzeit nicht verfügbar');
    await page.getByRole('button', { name: 'Erneut versuchen' }).click();
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    expect(stats.configCalls).toBe(2);
  });

  test('keeps the catalog visible, disables refresh while active, and reports refresh failure', async ({
    page,
  }) => {
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await routeRemoteApi(page, {
      profileResponder: async (call, route, request) => {
        if (call === 1) {
          await fulfillProfiles(route, request);
          return;
        }
        await refreshGate;
        await fulfillJson(route, request, { error: 'unavailable' }, 503);
      },
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();

    const refreshButton = page.getByRole('button', { name: 'Profilkatalog aktualisieren' });
    await refreshButton.click();
    await expect(refreshButton).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('wird aktualisiert');
    releaseRefresh();
    await expect(page.getByRole('status')).toContainText('konnte aber nicht aktualisiert werden');
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await expect(refreshButton).toBeEnabled();
    await expectNoSeriousViolations(page);
  });

  test('uses If-None-Match for refresh, accepts 304, and drops the cache on reload', async ({
    page,
  }) => {
    const stats = await routeRemoteApi(page, {
      profileResponder: async (call, route, request) => {
        if (call === 2) {
          await route.fulfill({ status: 304, headers: corsHeaders(request, true) });
          return;
        }
        await fulfillProfiles(route, request);
      },
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await page.getByRole('button', { name: 'Profilkatalog aktualisieren' }).click();
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    expect(stats.profileHeaders[0]?.get('If-None-Match')).toBeNull();
    expect(stats.profileHeaders[1]?.get('If-None-Match')).toBe('"one"');
    expect(stats.preflightRequestedHeaders.some((value) => value.includes('if-none-match'))).toBe(
      true,
    );

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    expect(stats.profileHeaders[2]?.get('If-None-Match')).toBeNull();
  });

  test('serves the remote flow through localhost as well as 127.0.0.1', async ({ page }) => {
    await routeRemoteApi(page);
    await page.goto('http://localhost:5173/');
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
  });
});

test.describe('fail-closed runtime', () => {
  test.use({ baseURL: 'http://127.0.0.1:5174' });

  test('renders the configuration error without making an API request', async ({ page }) => {
    let apiRequests = 0;
    await page.route('**/api/**', async (route) => {
      apiRequests += 1;
      await route.abort('failed');
    });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Online-Konfiguration nicht verfügbar' }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('ohne Netzwerkzugriff angehalten');
    expect(apiRequests).toBe(0);
    await expectNoSeriousViolations(page);
  });
});

async function routeRemoteApi(page: Page, scenario: RemoteScenario = {}): Promise<RemoteStats> {
  const stats: RemoteStats = {
    configCalls: 0,
    bootstrapBodies: [],
    profileHeaders: [],
    preflightRequestedHeaders: [],
    origins: [],
  };
  let profileCalls = 0;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const origin = request.headers().origin;
    if (origin) stats.origins.push(origin);

    if (request.method() === 'OPTIONS') {
      stats.preflightRequestedHeaders.push(
        request.headers()['access-control-request-headers']?.toLowerCase() ?? '',
      );
      await route.fulfill({ status: 204, headers: corsHeaders(request) });
      return;
    }

    switch (new URL(request.url()).pathname) {
      case '/api/v1/config': {
        stats.configCalls += 1;
        await scenario.configGate;
        const status =
          scenario.configStatuses?.[
            Math.min(stats.configCalls - 1, scenario.configStatuses.length - 1)
          ] ?? 200;
        if (status !== 200) {
          await fulfillJson(
            route,
            request,
            { error: status === 429 ? 'rate_limited' : 'unavailable' },
            status,
            status === 429 ? { 'Retry-After': '60' } : {},
          );
          return;
        }
        await fulfillJson(route, request, {
          environment: 'staging',
          features: { sceneDescribe: false, followup: false },
          profiles: { backendSupportedProfileIds: ['basic'] },
        });
        return;
      }
      case '/api/v1/session/bootstrap':
        stats.bootstrapBodies.push(request.postDataJSON());
        await fulfillJson(route, request, {
          sessionToken: 'private',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          featureFlags: { sceneDescribe: false, followup: false },
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
      case '/api/v1/profiles':
        profileCalls += 1;
        stats.profileHeaders.push(new Headers(request.headers()));
        if (scenario.profileResponder) {
          await scenario.profileResponder(profileCalls, route, request);
          return;
        }
        await fulfillProfiles(route, request, scenario.profiles);
        return;
      default:
        await route.abort('failed');
    }
  });

  return stats;
}

async function fulfillProfiles(
  route: Route,
  request: Request,
  profiles: unknown[] = defaultProfiles,
) {
  await fulfillJson(
    route,
    request,
    {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      defaultProfileId: profiles.length ? 'basic' : '',
      profiles,
    },
    200,
    { ETag: '"one"', 'Access-Control-Expose-Headers': 'ETag' },
  );
}

async function fulfillJson(
  route: Route,
  request: Request,
  json: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json', ...headers },
    json,
  });
}

function corsHeaders(request: Request, exposeEtag = false): Record<string, string> {
  const origin = request.headers().origin ?? 'http://127.0.0.1:5173';
  return {
    'Access-Control-Allow-Headers': 'Accept, Content-Type, If-None-Match',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    ...(exposeEtag ? { 'Access-Control-Expose-Headers': 'ETag' } : {}),
    Vary: 'Origin',
  };
}

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
}

const defaultProfiles = [
  {
    id: 'basic',
    label: 'Basic',
    description: 'Readiness profile',
    availability: 'backend',
    transports: {
      backend: {
        available: true,
        supportsStreaming: false,
        supportsFollowup: false,
      },
    },
  },
];
