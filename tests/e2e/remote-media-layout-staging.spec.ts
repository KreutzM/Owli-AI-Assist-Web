import { expect, test, type Locator, type Page } from '@playwright/test';

const API_BASE = 'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/';
const syntheticPortraitPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR42mMUqTjBwMDAxMDAgKAAGNwBWqZmmI0AAAAASUVORK5CYII=',
  'base64',
);
const viewports = [
  { width: 1440, height: 900 },
  { width: 2048, height: 1113 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 320, height: 800 },
] as const;

type HarnessAction = 'resolveCamera' | 'metadata' | 'delta' | 'done' | 'remoteError' | 'close';
type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

test.describe('built staging remote media geometry', () => {
  for (const viewport of viewports) {
    test(`${viewport.width} × ${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await installHarness(page);
      const response = await page.goto('/');
      if (!response) throw new Error('No response.');

      const panel = page.locator('.remote-scene');
      const footer = page.locator('.site-footer');
      const video = page.locator('video.remote-camera-preview');
      const camera = page.getByRole('button', { name: 'Rückkamera öffnen' });
      const preview = page.locator('.remote-scene-preview');
      const image = page.locator('.remote-scene-preview__image');
      const describe = page.getByRole('button', { name: 'Szene beschreiben' });

      await expect(camera).toBeEnabled();
      await expectHiddenVideo(video);
      await expectPanelBeforeFooter(panel, footer);
      await expectNoHorizontalOverflow(page);
      const idle = await layoutSnapshot(panel, footer);

      await camera.click();
      await expect(status(page, 'Die Kamera wird gestartet …')).toBeVisible();
      const startingVideo = await expectVisibleVideo(video);
      expectContained(startingVideo, await requiredBox(panel, 'camera-starting panel'));
      expect(startingVideo.width).toBeGreaterThan(startingVideo.height);
      expect(startingVideo.height).toBeLessThanOrEqual(
        Math.min(viewport.height * 0.65, 32 * 16) + 1,
      );

      await act(page, 'resolveCamera');
      const capture = page.getByRole('button', { name: 'Bild aufnehmen' });
      const closeCamera = page.getByRole('button', { name: 'Kamera schließen' });
      await expect(capture).toBeEnabled();
      await expectActionsReachable(capture, closeCamera);
      await expectOrderedWithoutOverlap(video, capture.locator('..'));
      expectContained(
        await requiredBox(video, 'camera-ready video'),
        await requiredBox(panel, 'camera-ready panel'),
      );

      await capture.click();
      await expectHiddenVideo(video);
      await expect(describe).toBeEnabled();
      await expectPrepared(page, panel, footer, preview, image, describe.locator('..'));
      await page.getByRole('button', { name: 'Bild verwerfen' }).click();
      await expect(image).toHaveCount(0);
      await expectCompactIdle(panel, footer, idle);

      await page.getByLabel('Oder ein Bild auswählen').setInputFiles({
        name: 'synthetic-portrait.png',
        mimeType: 'image/png',
        buffer: syntheticPortraitPng,
      });
      await expect(describe).toBeEnabled();
      await expectPrepared(page, panel, footer, preview, image, describe.locator('..'));

      await describe.click();
      const requesting = status(page, 'Die Anfrage wird gesendet …').locator('..');
      await expect(requesting).toBeVisible();
      await expectActive(page, panel, preview, image, requesting);

      await page.getByRole('button', { name: 'Abbrechen' }).click();
      const cancelled = status(page, 'Der Vorgang wurde abgebrochen.').locator('..');
      const resend = page.getByRole('button', { name: 'Erneut senden' });
      const cancelledReset = cancelled.getByRole('button', { name: 'Zurücksetzen' });
      await expectRetainedImageState(
        page,
        panel,
        footer,
        preview,
        image,
        cancelled,
        resend.locator('..'),
      );
      await expectActionsReachable(resend, cancelledReset);

      await resend.click();
      await expect(status(page, 'Die Anfrage wird gesendet …')).toBeVisible();
      await act(page, 'metadata');
      await expect(status(page, 'Die Beschreibung wird übertragen …')).toBeVisible();
      await act(page, 'remoteError');
      const errorState = page
        .getByRole('alert')
        .filter({ hasText: 'Synthetischer Szenenfehler.' })
        .locator('..');
      const retry = page.getByRole('button', {
        name: 'Mit dem vorbereiteten Bild erneut versuchen',
      });
      const errorReset = errorState.getByRole('button', { name: 'Zurücksetzen' });
      await expect(retry).toBeEnabled();
      await expectRetainedImageState(
        page,
        panel,
        footer,
        preview,
        image,
        errorState,
        retry.locator('..'),
      );
      await expectActionsReachable(retry, errorReset);

      await retry.click();
      const retrying = status(page, 'Die Anfrage wird gesendet …').locator('..');
      await expect(retrying).toBeVisible();
      await expectActive(page, panel, preview, image, retrying);

      await act(page, 'metadata');
      const streaming = status(page, 'Die Beschreibung wird übertragen …').locator('..');
      await expect(streaming).toBeVisible();
      await expectActive(page, panel, preview, image, streaming);

      await act(page, 'delta');
      const runningResult = page.getByRole('region', { name: 'Laufende Beschreibung' });
      await expect(runningResult).toContainText('Eine synthetische Szene.');
      await expectActive(page, panel, preview, image, streaming, runningResult);

      await act(page, 'done');
      const terminal = status(page, 'Die Antwort wird sicher abgeschlossen …').locator('..');
      await expect(terminal).toBeVisible();
      await expectActive(page, panel, preview, image, terminal, runningResult);

      await act(page, 'close');
      const result = page.getByRole('region', { name: 'Szenenbeschreibung' });
      const reset = page.getByRole('button', { name: 'Neues Bild' });
      await expect(result).toContainText('Eine synthetische Szene.');
      await expectComplete(page, panel, footer, preview, image, result, reset);

      await reset.click();
      await expect(image).toHaveCount(0);
      await expect(result).toHaveCount(0);
      await expectHiddenVideo(video);
      await expectCompactIdle(panel, footer, idle);
      await expectNoHorizontalOverflow(page);
    });
  }
});

function status(page: Page, text: string): Locator {
  return page.locator('p[role="status"]', { hasText: text });
}

async function expectPrepared(
  page: Page,
  panel: Locator,
  footer: Locator,
  preview: Locator,
  image: Locator,
  actions: Locator,
): Promise<void> {
  await expectImageReady(image);
  const boxes = await boxesFor({ panel, preview, image, actions, footer });
  expectContained(boxes.image, boxes.preview);
  expectContained(boxes.preview, boxes.panel);
  expectContained(boxes.actions, boxes.panel);
  expectOrdered(boxes.preview, boxes.actions);
  expectOrdered(boxes.panel, boxes.footer);
  await expectNoHorizontalOverflow(page);
}

async function expectActive(
  page: Page,
  panel: Locator,
  preview: Locator,
  image: Locator,
  actions: Locator,
  result?: Locator,
): Promise<void> {
  const panelBox = await requiredBox(panel, 'active panel');
  const previewBox = await requiredBox(preview, 'active preview');
  const imageBox = await requiredBox(image, 'active image');
  const actionsBox = await requiredBox(actions, 'active actions');
  expectContained(imageBox, previewBox);
  expectContained(previewBox, panelBox);
  expectContained(actionsBox, panelBox);
  expectOrdered(previewBox, actionsBox);
  if (result) {
    const resultBox = await requiredBox(result, 'active result');
    expectContained(resultBox, panelBox);
    expect(intersectionArea(imageBox, resultBox)).toBe(0);
  }
  await expectNoHorizontalOverflow(page);
}

async function expectRetainedImageState(
  page: Page,
  panel: Locator,
  footer: Locator,
  preview: Locator,
  image: Locator,
  state: Locator,
  actions: Locator,
): Promise<void> {
  await expectImageReady(image);
  const boxes = await boxesFor({ panel, footer, preview, image, state, actions });
  expectContained(boxes.image, boxes.preview);
  for (const child of [boxes.preview, boxes.state, boxes.actions]) {
    expectContained(child, boxes.panel);
  }
  expectContained(boxes.actions, boxes.state);
  expectOrdered(boxes.preview, boxes.state);
  expectOrdered(boxes.panel, boxes.footer);
  await expectNoHorizontalOverflow(page);
}

async function expectComplete(
  page: Page,
  panel: Locator,
  footer: Locator,
  preview: Locator,
  image: Locator,
  result: Locator,
  reset: Locator,
): Promise<void> {
  const boxes = await boxesFor({ panel, footer, preview, image, result, reset });
  expectContained(boxes.image, boxes.preview);
  for (const child of [boxes.preview, boxes.result, boxes.reset]) {
    expectContained(child, boxes.panel);
  }
  expectOrdered(boxes.preview, boxes.result);
  expectOrdered(boxes.result, boxes.reset);
  expectOrdered(boxes.panel, boxes.footer);
  await expectNoHorizontalOverflow(page);
}

async function expectHiddenVideo(video: Locator): Promise<void> {
  await expect(video).toHaveAttribute('hidden', '');
  expect(await video.evaluate((element) => (element as HTMLVideoElement).hidden)).toBe(true);
  expect(await video.evaluate((element) => getComputedStyle(element).display)).toBe('none');
  expect(await video.boundingBox()).toBeNull();
}

async function expectVisibleVideo(video: Locator): Promise<Box> {
  await expect(video).not.toHaveAttribute('hidden', '');
  expect(await video.evaluate((element) => (element as HTMLVideoElement).hidden)).toBe(false);
  expect(await video.evaluate((element) => getComputedStyle(element).display)).toBe('block');
  return await requiredBox(video, 'visible video');
}

async function expectImageReady(image: Locator): Promise<void> {
  await expect
    .poll(() =>
      image.evaluate(
        (element) =>
          (element as HTMLImageElement).complete &&
          (element as HTMLImageElement).naturalWidth > 0 &&
          (element as HTMLImageElement).naturalHeight > 0,
      ),
    )
    .toBe(true);
}

async function expectCompactIdle(
  panel: Locator,
  footer: Locator,
  idle: { panel: Box; footer: Box },
): Promise<void> {
  const current = await layoutSnapshot(panel, footer);
  expect(Math.abs(current.panel.height - idle.panel.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(current.panel.x - idle.panel.x)).toBeLessThanOrEqual(1);
  expectOrdered(current.panel, current.footer);
}

async function expectPanelBeforeFooter(panel: Locator, footer: Locator): Promise<void> {
  expectOrdered(await requiredBox(panel, 'panel'), await requiredBox(footer, 'footer'));
}

async function expectActionsReachable(...actions: Locator[]): Promise<void> {
  for (const action of actions) {
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
  }
}

async function expectOrderedWithoutOverlap(first: Locator, second: Locator): Promise<void> {
  expectOrdered(
    await requiredBox(first, 'first element'),
    await requiredBox(second, 'second element'),
  );
}

function expectOrdered(first: Box, second: Box): void {
  expect(intersectionArea(first, second)).toBe(0);
  expect(first.y + first.height).toBeLessThanOrEqual(second.y + 0.5);
}

function expectContained(inner: Box, outer: Box): void {
  const epsilon = 0.5;
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - epsilon);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - epsilon);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + epsilon);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + epsilon);
}

function intersectionArea(first: Box, second: Box): number {
  return (
    Math.max(
      0,
      Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
    ) *
    Math.max(
      0,
      Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
    )
  );
}

async function boxesFor<T extends Record<string, Locator>>(
  locators: T,
): Promise<{ [K in keyof T]: Box }> {
  const entries = await Promise.all(
    Object.entries(locators).map(async ([name, locator]) => [
      name,
      await requiredBox(locator, name),
    ]),
  );
  return Object.fromEntries(entries) as { [K in keyof T]: Box };
}

async function requiredBox(locator: Locator, name: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${name} should have a bounding box`).not.toBeNull();
  if (!box) throw new Error(`${name} has no bounding box.`);
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  return box;
}

async function layoutSnapshot(
  panel: Locator,
  footer: Locator,
): Promise<{ panel: Box; footer: Box }> {
  return {
    panel: await requiredBox(panel, 'idle panel'),
    footer: await requiredBox(footer, 'idle footer'),
  };
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        return (
          root.scrollWidth <= root.clientWidth &&
          document.body.scrollWidth <= document.body.clientWidth
        );
      }),
    )
    .toBe(true);
}

async function act(page: Page, action: HarnessAction): Promise<void> {
  await page.evaluate((name) => {
    const harness = (
      globalThis as typeof globalThis & {
        __owliLayoutHarness?: Record<HarnessAction, () => void>;
      }
    ).__owliLayoutHarness;
    if (!harness) throw new Error('No harness.');
    harness[name]();
  }, action);
}

async function installHarness(page: Page): Promise<void> {
  await page.addInitScript((apiBase) => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const encoder = new TextEncoder();
    let resolveCamera: (() => void) | undefined;
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            resolveCamera = () => resolve(new MediaStream());
          }),
      },
    });
    Object.defineProperties(HTMLVideoElement.prototype, {
      videoWidth: { configurable: true, get: () => 1280 },
      videoHeight: { configurable: true, get: () => 960 },
    });
    HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('canplay'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = () => undefined;
    // Geometry is the subject here; pixel fidelity is covered by the dedicated image suites.
    // A no-op draw leaves the capture and normalization pipeline intact: canvas allocation,
    // JPEG encoding, source inspection, browser decode, dimension fitting, re-encoding, and
    // preview rendering still execute with synthetic, non-sensitive outputs.
    CanvasRenderingContext2D.prototype.drawImage = () => undefined;

    const event = (name: string, data: unknown) =>
      `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    const enqueue = (value: string) => {
      if (!stream) throw new Error('Stream shut.');
      stream.enqueue(encoder.encode(value));
    };
    const finish = (value?: string) => {
      if (!stream) throw new Error('Scene stream is not open.');
      const controller = stream;
      stream = undefined;
      if (value) controller.enqueue(encoder.encode(value));
      controller.close();
    };
    const harness: Record<HarnessAction, () => void> = {
      resolveCamera: () => {
        if (!resolveCamera) throw new Error('Camera is not pending.');
        const resolve = resolveCamera;
        resolveCamera = undefined;
        resolve();
      },
      metadata: () =>
        enqueue(
          event('metadata', {
            mode: 'describe',
            modelAlias: 'scene-describe-v1',
            profileId: 'brief',
            locale: 'de-DE',
          }),
        ),
      delta: () =>
        enqueue(event('delta', { textDelta: 'Eine synthetische Szene.', requestId: 'request-1' })),
      done: () =>
        enqueue(
          event('done', {
            answerText: 'Eine synthetische Szene.',
            mode: 'describe',
            modelAlias: 'scene-describe-v1',
            requestId: 'request-1',
            sceneToken: 'scene-token',
            sceneTokenExpiresAt: '2030-01-01T00:00:00.000Z',
            profileId: 'brief',
            locale: 'de-DE',
          }),
        ),
      remoteError: () =>
        finish(
          event('error', {
            error: 'UPSTREAM_FAILED',
            message: 'Synthetischer Szenenfehler.',
          }),
        ),
      close: () => finish(),
    };
    Object.defineProperty(globalThis, '__owliLayoutHarness', {
      configurable: true,
      value: harness,
    });

    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (!url.href.startsWith(apiBase)) return await nativeFetch(input, init);
      if (url.pathname === '/api/v1/config') {
        return json({
          environment: 'staging',
          features: { sceneDescribe: true, followup: false },
          profiles: { backendSupportedProfileIds: ['brief'] },
        });
      }
      if (url.pathname === '/api/v1/session/bootstrap') {
        return json({
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
      }
      if (url.pathname === '/api/v1/profiles') {
        return json(
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
      }
      if (url.pathname !== '/api/v1/scene/describe') {
        return json({ code: 'NOT_FOUND' }, {}, 404);
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
      );
    };

    function json(value: unknown, headers: Record<string, string> = {}, status = 200): Response {
      return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }
  }, API_BASE);
}
