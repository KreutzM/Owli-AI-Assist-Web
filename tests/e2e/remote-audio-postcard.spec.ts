import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';

const remoteUrl = 'http://127.0.0.1:5173';
const audioUrl =
  'https://api-staging.owli-ai.com/api/v1/song/audio/123e4567-e89b-42d3-a456-426614174000?token=123e4567-e89b-42d3-a456-426614174111';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOs2HKHgYGBiYGBgYGBAQAYJgIMiYqd0gAAAABJRU5ErkJggg==',
  'base64',
);
const corsHeaders = {
  'Access-Control-Allow-Headers': 'Accept, Accept-Language, Content-Type, Range',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers':
    'Accept-Ranges, Cache-Control, Content-Length, Content-Type, ETag, X-Content-Type-Options',
};

test.use({ serviceWorkers: 'allow' });

test.describe('remote Audio-Postcard', () => {
  test.beforeEach(async ({ page }) => {
    await mockReadiness(page);
    await mockDescription(page);
    await mockOptions(page);
  });

  test('generates, validates and exposes a non-autoplay native player with truthful quota', async ({
    page,
  }) => {
    const bodies: Record<string, unknown>[] = [];
    const audioBytes = await readFile('public/demo/postcard-demo.wav');
    await page.route('**/api/v1/song/generate', async (route) => {
      if (await fulfillPreflight(route)) return;
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await json(route, readyResult());
    });
    await page.route('**/api/v1/song/audio/**', async (route) => {
      if (await fulfillPreflight(route)) return;
      const headers = {
        ...corsHeaders,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Length': String(audioBytes.byteLength),
        'Content-Type': 'audio/wav',
        'X-Content-Type-Options': 'nosniff',
      };
      if (route.request().method() === 'HEAD') {
        await route.fulfill({ status: 200, headers });
        return;
      }
      const range = parseRange(route.request().headers().range, audioBytes.byteLength);
      if (range) {
        const body = audioBytes.subarray(range.start, range.end + 1);
        await route.fulfill({
          status: 206,
          headers: {
            ...headers,
            'Content-Length': String(body.byteLength),
            'Content-Range': `bytes ${range.start}-${range.end}/${audioBytes.byteLength}`,
          },
          body,
        });
        return;
      }
      await route.fulfill({ status: 200, headers, body: audioBytes });
    });

    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    await page.getByRole('button', { name: 'Audio-Postcard erstellen' }).click();

    const player = page.locator('audio');
    await expect(page.getByRole('heading', { name: 'Audio-Postcard ist bereit' })).toBeVisible();
    await expect(player).toHaveAttribute('controls', '');
    await expect(player).toHaveAttribute('preload', 'metadata');
    await expect(player).not.toHaveAttribute('autoplay');
    expect(await player.evaluate((audio: HTMLAudioElement) => audio.autoplay)).toBe(false);
    await expect(page.getByText(/4 von 5 Versuchen im gelieferten festen Fenster/)).toBeVisible();
    await expect(page.getByText(/Beschriebene Szene:/).locator('..')).toContainText(
      'Eine helle Straße',
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      imageMimeType: 'image/jpeg',
      locale: 'de-DE',
      durationSec: 30,
      promptProfile: 'warm_audio_postcard',
      vocals: 'instrumental',
      voiceMode: 'lyria_sung_hook',
      shareVideo: false,
    });
    expect(bodies[0]).not.toHaveProperty('stylePreset');
    expect(String(bodies[0]?.imageBase64)).not.toContain('data:');
    await expect(page.getByRole('button', { name: /teilen|herunterladen/iu })).toHaveCount(0);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    const storage = await page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      databases:
        typeof indexedDB.databases === 'function'
          ? (await indexedDB.databases()).map((database) => database.name)
          : [],
      cacheRequests: (
        await Promise.all(
          (await caches.keys()).map(async (name) =>
            (await caches.open(name)).keys().then((requests) => requests.map((item) => item.url)),
          ),
        )
      ).flat(),
    }));
    expect(storage.local).toEqual([]);
    expect(storage.session).toEqual([]);
    expect(storage.databases).toEqual([]);
    expect(storage.cacheRequests.filter((url) => /\/api\/|\/song\/audio\//u.test(url))).toEqual([]);
  });

  test('cancels active work and suppresses a late terminal response', async ({ page }) => {
    let releaseResponse: (() => void) | undefined;
    await page.route('**/api/v1/song/generate', async (route) => {
      if (await fulfillPreflight(route)) return;
      await new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      await json(route, readyResult());
    });

    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    await page.getByRole('button', { name: 'Audio-Postcard erstellen' }).click();
    await expect(page.getByText(/Musik wird erstellt/)).toBeVisible();
    await page.getByRole('button', { name: 'Audio-Postcard abbrechen' }).click();
    await expect(page.getByText(/im Browser abgebrochen/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neuen Versuch starten' })).toBeFocused();
    releaseResponse?.();
    await expect(page.locator('audio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Neuen Versuch starten' })).toBeVisible();
  });

  test('treats an unknown terminal status as a contract error and never renders a player', async ({
    page,
  }) => {
    await page.route('**/api/v1/song/generate', async (route) => {
      if (await fulfillPreflight(route)) return;
      await json(route, { ...readyResult(), status: 'processing' });
    });

    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    await page.getByRole('button', { name: 'Audio-Postcard erstellen' }).click();
    await expect(page.getByRole('alert')).toContainText('nicht vertragskonform');
    await expect(page.locator('audio')).toHaveCount(0);
  });
});

async function mockReadiness(page: Page): Promise<void> {
  await page.route('**/api/v1/config', (route) =>
    json(route, {
      environment: 'staging',
      features: { sceneDescribe: true, followup: true, audioPostcard: true },
      profiles: { backendSupportedProfileIds: ['brief'] },
    }),
  );
  await page.route('**/api/v1/session/bootstrap', async (route) => {
    if (await fulfillPreflight(route)) return;
    await json(route, {
      sessionToken: 'session-1',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      featureFlags: { sceneDescribe: true, followup: true, audioPostcard: true },
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
                supportsFollowup: true,
              },
            },
          },
        ],
      },
      { ETag: '"profiles-audio-postcard"' },
    ),
  );
}

async function mockDescription(page: Page): Promise<void> {
  await page.route('**/api/v1/scene/describe', async (route) => {
    if (await fulfillPreflight(route)) return;
    const events = [
      event('metadata', {
        mode: 'describe',
        modelAlias: 'scene-describe-v1',
        profileId: 'brief',
        locale: 'de-DE',
      }),
      event('delta', { textDelta: 'Eine helle Straße.', requestId: 'request-1' }),
      event('done', {
        answerText: 'Eine helle Straße.',
        mode: 'describe',
        modelAlias: 'scene-describe-v1',
        requestId: 'request-1',
        sceneToken: 'scene-token',
        sceneTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        profileId: 'brief',
        locale: 'de-DE',
      }),
    ].join('');
    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: events,
    });
  });
}

async function mockOptions(page: Page): Promise<void> {
  await page.route('**/api/v1/song/options', async (route) => {
    if (await fulfillPreflight(route)) return;
    await json(route, {
      schemaVersion: 1,
      selectionModel: 'profile_only',
      locale: 'de-DE',
      defaults: { profileId: 'warm_audio_postcard', modeId: 'lyria_sung_hook' },
      profiles: [
        {
          id: 'warm_audio_postcard',
          label: 'Warme Audio-Postkarte',
          description: 'Ein persönlicher Songgruß.',
          enabled: true,
          experimental: false,
          allowedModeIds: ['lyria_sung_hook'],
        },
      ],
      modes: [
        {
          id: 'lyria_sung_hook',
          label: 'Automatisch',
          description: 'Technischer Kompatibilitätsmodus.',
          enabled: true,
          experimental: false,
        },
      ],
      generation: {
        transport: 'synchronous',
        availability: 'available',
        terminalStatuses: ['ready', 'stub', 'not_available', 'failed'],
        defaultDurationSec: 30,
        maxDurationSec: 60,
        responseTimeoutMs: 30_000,
        playbackTtlSeconds: 900,
        maxAudioBytes: 32 * 1_024 * 1_024,
        shareVideoAvailable: false,
        quotaPolicy: {
          schemaVersion: 1,
          product: 'audio_postcard',
          unit: 'generation_attempt',
          provisional: true,
          knownScopes: ['installation'],
        },
      },
    });
  });
}

function readyResult() {
  const resetAt = new Date(Date.now() + 60_000).toISOString();
  return {
    songId: 'song-123',
    requestId: 'request-123',
    status: 'ready',
    audio: { mimeType: 'audio/wav', url: audioUrl, durationMs: 1_800 },
    accessibility: {
      sceneCaption: 'Eine helle Straße.',
      musicalMapping: 'Helle Streicher bilden die ruhige Szene ab.',
    },
    modelAlias: 'image-song-clip-v1',
    expiresAt: new Date(Date.now() + 895_000).toISOString(),
    quota: {
      schemaVersion: 1,
      product: 'audio_postcard',
      unit: 'generation_attempt',
      charged: true,
      enforcement: 'enforced',
      windows: [
        {
          scope: 'installation',
          kind: 'fixed_window',
          limit: 5,
          remaining: 4,
          resetAt,
        },
      ],
    },
  };
}

async function chooseFileAndDescribe(page: Page): Promise<void> {
  await page.getByLabel('Oder ein Bild auswählen').setInputFiles({
    name: 'scene.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.getByRole('button', { name: 'Szene beschreiben' }).click();
  await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Audio-Postcard erstellen' })).toBeVisible();
}

async function json(
  route: Route,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false;
  await route.fulfill({ status: 204, headers: corsHeaders });
  return true;
}

function event(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function parseRange(
  value: string | undefined,
  totalBytes: number,
): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (!match) return undefined;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : totalBytes - 1;
  if (!Number.isInteger(start) || start < 0 || start >= totalBytes) return undefined;
  return { start, end: Math.min(requestedEnd, totalBytes - 1) };
}
