import { expect, test, type Page } from '@playwright/test';

const HARNESS_KEY = '__OWLI_BRANDED_VIDEO_FULL_PATH_HARNESS__';

type ScenarioId = 'short-1s' | 'long-31s';

interface PassEvidence {
  status: 'PASS';
  scenarioId: ScenarioId;
  requestedDurationMs: number;
  decodedSourceDurationMs: number;
  sourceChannels: number;
  sourceSampleRateHz: number;
  renderElapsedMs: number;
  rendererValidationCompleted: true;
  playbackPublished: true;
  downloadPublished: true;
  file: { name: string; type: string; sizeBytes: number };
  containerInspection: {
    container: 'webm';
    videoTrackCount: number;
    audioTrackCount: number;
    videoCodecs: string[];
    audioCodecs: string[];
  };
  fixtureSource: string;
}

interface FailureEvidence {
  status: 'FAIL';
  scenarioId: ScenarioId;
  code: string;
}

test.describe('branded video real Chrome full path', () => {
  test('runs the branded video short full path through real Chrome', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'The branded MediaRecorder path requires Chromium.');
    test.setTimeout(60_000);

    const apiRequests = watchBackendRequests(page);
    await openPrototypeLab(page);
    const evidence = await runHarness(page, 'short-1s');

    expectPassEvidence(evidence, 'short-1s');
    expect(evidence.requestedDurationMs).toBe(1_000);
    expect(evidence.decodedSourceDurationMs).toBeCloseTo(1_000, 3);
    await assertPublishedOutput(page, evidence);
    expect(apiRequests).toEqual([]);
  });

  test('runs the branded video 31-second full path through real Chrome', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'The branded MediaRecorder path requires Chromium.');
    test.skip(
      process.env.OWLI_MEDIARECORDER_LONG_E2E !== '1',
      'The >30.050-second case is reserved for Full Linux Chromium validation.',
    );
    test.setTimeout(120_000);

    const apiRequests = watchBackendRequests(page);
    await openPrototypeLab(page);
    const evidence = await runHarness(page, 'long-31s');

    expectPassEvidence(evidence, 'long-31s');
    expect(evidence.requestedDurationMs).toBe(31_000);
    expect(evidence.decodedSourceDurationMs).toBeGreaterThan(30_050);
    expect(evidence.decodedSourceDurationMs).toBeCloseTo(31_000, 3);
    await assertPublishedOutput(page, evidence);
    expect(apiRequests).toEqual([]);
  });
});

async function openPrototypeLab(page: Page): Promise<void> {
  await page.goto('http://127.0.0.1:5175/lab/mediarecorder-prototype');
  await expect(
    page.getByRole('heading', {
      name: 'MediaRecorder-Renderer und deterministisches Mess-Harness',
    }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      await page.evaluate((key) => typeof Reflect.get(window, key)?.run === 'function', HARNESS_KEY),
    )
    .toBe(true);
}

function watchBackendRequests(page: Page): string[] {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === 'https://api-staging.owli-ai.com' && url.pathname.startsWith('/api/')) {
      apiRequests.push(request.url());
    }
  });
  return apiRequests;
}

async function runHarness(
  page: Page,
  scenarioId: ScenarioId,
): Promise<PassEvidence | FailureEvidence> {
  return await page.evaluate(
    async ({ key, scenario }) => {
      const harness = Reflect.get(window, key) as
        | {
            run(value: ScenarioId): Promise<PassEvidence | FailureEvidence>;
          }
        | undefined;
      if (!harness) throw new Error('Branded video full-path harness is unavailable.');
      return await harness.run(scenario);
    },
    { key: HARNESS_KEY, scenario: scenarioId },
  );
}

function expectPassEvidence(
  evidence: PassEvidence | FailureEvidence,
  scenarioId: ScenarioId,
): asserts evidence is PassEvidence {
  expect(evidence).toMatchObject({
    status: 'PASS',
    scenarioId,
    sourceChannels: 1,
    sourceSampleRateHz: 48_000,
    rendererValidationCompleted: true,
    playbackPublished: true,
    downloadPublished: true,
    file: {
      name: 'owli-audio-postcard.webm',
    },
    containerInspection: {
      container: 'webm',
      videoTrackCount: 1,
      audioTrackCount: 1,
    },
  });
  if (evidence.status !== 'PASS') {
    throw new Error(`Branded video full-path harness failed with ${evidence.code}.`);
  }
  expect(evidence.file.type.startsWith('video/webm')).toBe(true);
  expect(evidence.file.sizeBytes).toBeGreaterThan(0);
  expect(evidence.containerInspection.videoCodecs[0]).toMatch(/^V_VP[89]$/u);
  expect(evidence.containerInspection.audioCodecs).toEqual(['A_OPUS']);
  expect(evidence.fixtureSource).toContain('no user, capability, backend, or network media data');
}

async function assertPublishedOutput(page: Page, evidence: PassEvidence): Promise<void> {
  const playback = page.getByTestId('branded-video-full-path-playback');
  await expect(playback).toBeVisible();
  await expect(playback).toHaveAttribute('src', /^blob:/u);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('branded-video-full-path-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(evidence.file.name);
}
