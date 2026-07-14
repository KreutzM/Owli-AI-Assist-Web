import { expect, test } from '@playwright/test';

test.describe('remote readiness', () => {
  test.use({
    baseURL: 'http://127.0.0.1:5173',
  });

  test('renders no provider-backed product controls', async ({ page }) => {
    await page.route('**/api/v1/config', (route) =>
      route.fulfill({
        json: {
          environment: 'staging',
          features: { sceneDescribe: false, followup: false },
          profiles: { backendSupportedProfileIds: ['basic'] },
        },
      }),
    );
    await page.route('**/api/v1/session/bootstrap', (route) =>
      route.fulfill({
        json: {
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
        },
      }),
    );
    await page.route('**/api/v1/profiles', (route) =>
      route.fulfill({
        headers: { ETag: '"one"' },
        json: {
          schemaVersion: '1',
          defaultProfileId: 'basic',
          profiles: [
            {
              id: 'basic',
              label: 'Basic',
              description: 'Readiness profile',
              availability: 'backend',
              transports: {
                backend: { available: true, supportsStreaming: false, supportsFollowup: false },
              },
            },
          ],
        },
      }),
    );

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
