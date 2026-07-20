import { expect, test, type Page, type Route } from '@playwright/test';

const remoteUrl = 'http://127.0.0.1:5173';
const corsHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag',
};

test.use({ serviceWorkers: 'block' });

for (const viewport of [
  { name: 'iPhone portrait', width: 390, height: 844, maxGap: 220 },
  { name: 'iPhone landscape', width: 844, height: 390, maxGap: 160 },
]) {
  test(`keeps the camera preview near its trigger in ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockReadiness(page);
    await mockCamera(page);
    await page.goto(remoteUrl);

    const cameraButton = page.getByRole('button', { name: 'Rückkamera öffnen' });
    await expect(cameraButton).toBeEnabled();
    await cameraButton.click();

    const preview = page.getByLabel('Lokale Live-Vorschau der Rückkamera');
    await expect(preview).toBeVisible();

    const [buttonBox, previewBox] = await Promise.all([
      cameraButton.boundingBox(),
      preview.boundingBox(),
    ]);
    expect(buttonBox).not.toBeNull();
    expect(previewBox).not.toBeNull();
    if (!buttonBox || !previewBox) throw new Error('Expected camera layout boxes.');

    const buttonBottom = buttonBox.y + buttonBox.height;
    const previewGap = previewBox.y - buttonBottom;

    expect(previewBox.width).toBeGreaterThan(0);
    expect(previewBox.height).toBeGreaterThan(80);
    expect(previewBox.y).toBeGreaterThan(buttonBottom);
    expect(previewGap).toBeLessThan(viewport.maxGap);
    expect(previewBox.y).toBeLessThan(viewport.height);
  });
}

async function mockCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.resolve(new MediaStream()),
      },
    });

    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 1280,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 960,
    });

    HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('canplay'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = () => undefined;
  });
}

async function mockReadiness(page: Page): Promise<void> {
  await page.route('**/api/v1/config', (route) =>
    json(route, {
      environment: 'staging',
      features: { sceneDescribe: true, followup: false },
      profiles: { backendSupportedProfileIds: ['brief'] },
    }),
  );
  await page.route('**/api/v1/session/bootstrap', async (route) => {
    if (await fulfillPreflight(route)) return;
    await json(route, {
      sessionToken: 'session-1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      featureFlags: { sceneDescribe: true, followup: false },
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
                supportsStreaming: true,
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

async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false;
  await route.fulfill({ status: 204, headers: corsHeaders });
  return true;
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
