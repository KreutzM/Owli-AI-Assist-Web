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

test.use({ serviceWorkers: 'block' });

test.describe('remote follow-up and local speech', () => {
  test.beforeEach(async ({ page }) => {
    await installSpeechMock(page);
    await mockReadiness(page);
  });

  test('completes multiple clean-EOF turns and supports speak, replace, stop, and reset', async ({
    page,
  }) => {
    await mockDescribe(page);
    const followupBodies: Record<string, unknown>[] = [];
    await page.route('**/api/v1/scene/followup', async (route) => {
      if (await fulfillPreflight(route)) return;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      followupBodies.push(body);
      const answer =
        followupBodies.length === 1
          ? 'Auf dem Schild steht Ausgang.'
          : 'Die Tür neben dem Schild ist blau.';
      await fulfillSse(route, followupEvents(answer, followupBodies.length));
    });

    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    const question = page.getByLabel('Rückfrage zur aktuellen Szene');
    await expect(question).toBeFocused();

    const sceneSpeechBefore = await speechSnapshot(page);
    await page.getByRole('button', { name: 'Beschreibung vorlesen' }).click();
    await expect
      .poll(async () => speechDelta(page, sceneSpeechBefore))
      .toMatchObject({ cancelCount: 1, spoken: [{ text: 'Eine helle Straße.', lang: 'de-DE' }] });

    await question.fill('Was steht auf dem Schild?');
    await page.getByRole('button', { name: 'Rückfrage senden' }).click();
    await expect(page.getByRole('listitem').nth(0)).toContainText('Auf dem Schild steht Ausgang.');
    await expect(question).toBeFocused();

    const answerSpeechBefore = await speechSnapshot(page);
    await page.getByRole('button', { name: 'Antwort vorlesen' }).click();
    await expect
      .poll(async () => speechDelta(page, answerSpeechBefore))
      .toMatchObject({
        cancelCount: 1,
        spoken: [{ text: 'Auf dem Schild steht Ausgang.', lang: 'de-DE' }],
      });
    const stopSpeechBefore = await speechSnapshot(page);
    await page.getByRole('button', { name: 'Vorlesen stoppen' }).click();
    await expect
      .poll(async () => speechDelta(page, stopSpeechBefore))
      .toMatchObject({ cancelCount: 1, spoken: [] });
    await expect(page.getByText('Sprachausgabe läuft.')).toHaveCount(0);

    await question.fill('Welche Farbe hat die Tür?');
    await page.getByRole('button', { name: 'Rückfrage senden' }).click();
    await expect(page.getByRole('listitem').nth(1)).toContainText(
      'Die Tür neben dem Schild ist blau.',
    );
    expect(followupBodies).toHaveLength(2);
    expect(followupBodies[0]?.conversationHistory).toEqual([]);
    expect(followupBodies[1]?.conversationHistory).toEqual([
      { role: 'user', text: 'Was steht auf dem Schild?' },
      { role: 'assistant', text: 'Auf dem Schild steht Ausgang.' },
    ]);

    await page.getByRole('button', { name: 'Neues Bild' }).click();
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Rückfragen zur aktuellen Szene' })).toHaveCount(
      0,
    );
  });

  test('retries explicitly after a recoverable pre-stream failure', async ({ page }) => {
    await mockDescribe(page);
    let followupCalls = 0;
    await page.route('**/api/v1/scene/followup', async (route) => {
      if (await fulfillPreflight(route)) return;
      followupCalls += 1;
      if (followupCalls === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'temporarily_unavailable',
            message: 'Bitte erneut versuchen.',
          }),
        });
        return;
      }
      await fulfillSse(route, followupEvents('Auf dem Schild steht Ausgang.', followupCalls));
    });

    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    const question = page.getByLabel('Rückfrage zur aktuellen Szene');
    await question.fill('Was steht auf dem Schild?');
    await page.getByRole('button', { name: 'Rückfrage senden' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(question).toHaveValue('Was steht auf dem Schild?');
    await expect(page.getByRole('heading', { name: 'Abgeschlossene Rückfragen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Rückfrage erneut senden' }).click();

    await expect(page.getByRole('listitem')).toContainText('Auf dem Schild steht Ausgang.');
    expect(followupCalls).toBe(2);
  });

  test('cancels a streaming turn, discards partial text, and preserves the draft', async ({
    page,
  }) => {
    await installCancellableFollowupFetch(page);
    await mockDescribe(page);

    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    const question = page.getByLabel('Rückfrage zur aktuellen Szene');
    await question.fill('Welche Farbe hat die Tür?');
    await page.getByRole('button', { name: 'Rückfrage senden' }).click();

    await expect(page.getByRole('heading', { name: 'Laufende Antwort' })).toBeVisible();
    await expect(page.getByText('Nicht vollständig')).toBeVisible();
    await page.getByRole('button', { name: 'Rückfrage abbrechen' }).click();

    await expect(
      page.getByText('Die Rückfrage wurde abgebrochen. Dein Entwurf bleibt erhalten.'),
    ).toBeVisible();
    await expect(question).toHaveValue('Welche Farbe hat die Tür?');
    await expect(question).toBeFocused();
    await expect(page.getByText('Nicht vollständig')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Abgeschlossene Rückfragen' })).toHaveCount(0);
  });

  test('expires context automatically, clears history, and focuses the new-scene action', async ({
    page,
  }) => {
    await mockDescribe(page, 2_500);
    await page.route('**/api/v1/scene/followup', async (route) => {
      if (await fulfillPreflight(route)) return;
      await fulfillSse(route, followupEvents('Auf dem Schild steht Ausgang.', 1));
    });

    await page.goto(remoteUrl);
    await chooseFileAndDescribe(page);
    const question = page.getByLabel('Rückfrage zur aktuellen Szene');
    await question.fill('Was steht auf dem Schild?');
    await page.getByRole('button', { name: 'Rückfrage senden' }).click();
    await expect(page.getByRole('heading', { name: 'Abgeschlossene Rückfragen' })).toBeVisible();

    const newScene = page.getByRole('button', { name: 'Neue Szene beginnen' });
    await expect(newScene).toBeVisible({ timeout: 6_000 });
    await expect(page.getByRole('alert')).toContainText('Szenenkontext ist abgelaufen');
    await expect(question).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Abgeschlossene Rückfragen' })).toHaveCount(0);
    await expect(newScene).toBeFocused();

    await newScene.click();
    await expect(page.getByRole('button', { name: 'Rückkamera öffnen' })).toBeFocused();
  });
});

async function chooseFileAndDescribe(page: Page): Promise<void> {
  await page.getByLabel('Oder ein Bild auswählen').setInputFiles({
    name: 'scene.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.getByRole('button', { name: 'Szene beschreiben' }).click();
  await expect(page.getByRole('heading', { name: 'Szenenbeschreibung' })).toBeVisible();
}

async function installSpeechMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const speechState = {
      cancelCount: 0,
      spoken: [] as { text: string; lang: string }[],
    };
    class MockSpeechSynthesisUtterance {
      lang = '';
      onend: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(readonly text = '') {}
    }
    const synthesis = {
      cancel() {
        speechState.cancelCount += 1;
      },
      speak(utterance: MockSpeechSynthesisUtterance) {
        speechState.spoken.push({ text: utterance.text, lang: utterance.lang });
      },
    };
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(globalThis, 'speechSynthesis', {
      configurable: true,
      value: synthesis,
    });
    (
      globalThis as typeof globalThis & {
        __owliSpeechMock?: typeof speechState;
      }
    ).__owliSpeechMock = speechState;
  });
}

async function installCancellableFollowupFetch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const encoder = new TextEncoder();
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith('/api/v1/scene/followup')) {
        return await nativeFetch(input, init);
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: metadata\ndata: ${JSON.stringify({
                mode: 'followup',
                modelAlias: 'scene-followup-v1',
                profileId: 'brief',
                locale: 'de-DE',
              })}\n\nevent: delta\ndata: ${JSON.stringify({
                textDelta: 'Nicht vollständig',
                requestId: 'followup-cancel',
              })}\n\n`,
            ),
          );
          init?.signal?.addEventListener(
            'abort',
            () => {
              try {
                controller.error(new DOMException('aborted', 'AbortError'));
              } catch {
                // The consumer may already have cancelled the stream.
              }
            },
            { once: true },
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      });
    };
  });
}

async function speechDelta(
  page: Page,
  baseline: { cancelCount: number; spoken: { text: string; lang: string }[] },
) {
  const current = await speechSnapshot(page);
  return {
    cancelCount: current.cancelCount - baseline.cancelCount,
    spoken: current.spoken.slice(baseline.spoken.length),
  };
}

async function speechSnapshot(page: Page) {
  return await page.evaluate(() => {
    const state = (
      globalThis as typeof globalThis & {
        __owliSpeechMock?: {
          cancelCount: number;
          spoken: { text: string; lang: string }[];
        };
      }
    ).__owliSpeechMock;
    if (!state) throw new Error('Speech mock is unavailable.');
    return structuredClone(state);
  });
}

async function mockReadiness(page: Page): Promise<void> {
  await page.route('**/api/v1/config', (route) =>
    json(route, {
      environment: 'staging',
      features: { sceneDescribe: true, followup: true },
      profiles: { backendSupportedProfileIds: ['brief'] },
    }),
  );
  await page.route('**/api/v1/session/bootstrap', async (route) => {
    if (await fulfillPreflight(route)) return;
    await json(route, {
      sessionToken: 'session-1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      featureFlags: { sceneDescribe: true, followup: true },
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
      { ETag: '"profiles-followup"' },
    ),
  );
}

async function mockDescribe(page: Page, expiresInMs = 60_000): Promise<void> {
  await page.route('**/api/v1/scene/describe', async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillSse(route, sceneEvents(new Date(Date.now() + expiresInMs).toISOString()));
  });
}

function sceneEvents(sceneTokenExpiresAt: string): string {
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
      sceneTokenExpiresAt,
      profileId: 'brief',
      locale: 'de-DE',
    })
  );
}

function followupEvents(answerText: string, turn: number): string {
  return (
    event('metadata', {
      mode: 'followup',
      modelAlias: 'scene-followup-v1',
      profileId: 'brief',
      locale: 'de-DE',
    }) +
    event('delta', { textDelta: answerText, requestId: `followup-${turn}` }) +
    event('done', {
      answerText,
      mode: 'followup',
      modelAlias: 'scene-followup-v1',
      requestId: `followup-${turn}`,
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
