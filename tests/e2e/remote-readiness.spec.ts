import { expect, test, type Page, type Route } from '@playwright/test';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag',
};

test.describe('remote readiness', () => {
  test.use({
    baseURL: 'http://127.0.0.1:5173',
  });

  test('renders no provider-backed product controls', async ({ page }) => {
    await routeRemoteApi(page);

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Backend-Bereitschaft und Profile' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Kamera|Aufnahme|Rückfrage|Postcard/i }),
    ).toHaveCount(0);
  });
});

async function routeRemoteApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    switch (new URL(request.url()).pathname) {
      case '/api/v1/config':
        await fulfillJson(route, {
          environment: 'staging',
          features: { sceneDescribe: false, followup: false },
          profiles: { backendSupportedProfileIds: ['basic'] },
        });
        return;
      case '/api/v1/session/bootstrap':
        await fulfillJson(route, {
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
        await fulfillJson(
          route,
          {
            schemaVersion: '1',
            defaultProfileId: 'basic',
            profiles: [
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
            ],
          },
          { ETag: '"one"' },
        );
        return;
      default:
        await route.abort('failed');
    }
  });
}

async function fulfillJson(route: Route, json: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...headers },
    json,
  });
}
