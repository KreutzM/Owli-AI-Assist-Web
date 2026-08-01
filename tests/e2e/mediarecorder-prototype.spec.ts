import { expect, test } from '@playwright/test';

test.describe('media recorder prototype lab', () => {
  test('fails closed on the normal application deployment', async ({ page }) => {
    await page.goto('http://127.0.0.1:4173/lab/mediarecorder-prototype');

    await expect(page.getByRole('heading', { name: 'MediaRecorder-Lab ist fail-closed' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(
      'VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER=enabled',
    );
    await expect(page.getByRole('heading', { name: 'MediaRecorder Prototype Lab' })).toBeVisible();
  });

  test('runs a single local prototype scenario without backend traffic', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The real MediaRecorder prototype run is only asserted in Chromium.');
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === 'https://api-staging.owli-ai.com' && url.pathname.startsWith('/api/')) {
        apiRequests.push(request.url());
      }
    });

    await page.goto('http://127.0.0.1:5175/lab/mediarecorder-prototype');
    await expect(
      page.getByRole('heading', { name: 'MediaRecorder-Renderer und deterministisches Mess-Harness' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Ausgewaehltes Szenario ausfuehren' }).click();
    await expect
      .poll(async () => {
        const raw = await page.getByTestId('mediarecorder-prototype-evidence').textContent();
        if (!raw) return undefined;
        const start = raw.indexOf('{');
        if (start < 0) return undefined;
        const evidence = JSON.parse(raw.slice(start)) as {
          build: { buildTarget: string; gitSha: string; sourceDigest: string };
          run: { backendRequestsObserved: number };
          fixtures: Array<{ verified: boolean }>;
          results: Array<{
            status: string;
            attempt?: {
              cleanupCompleted: boolean;
              validation: {
                startMarkerDetected: boolean;
                endMarkerDetected: boolean;
                fixturePreflight: {
                  startMarkerDetected: boolean;
                  endMarkerDetected: boolean;
                };
              };
            };
          }>;
          normalFlowUnchanged: boolean;
        };
        return evidence.results[0];
      }, { timeout: 45_000 })
      .toMatchObject({
        status: 'PASS',
        attempt: expect.objectContaining({
          cleanupCompleted: true,
          validation: expect.objectContaining({
            startMarkerDetected: true,
            endMarkerDetected: true,
            fixturePreflight: expect.objectContaining({
              startMarkerDetected: true,
              endMarkerDetected: true,
            }),
          }),
        }),
      });

    const finalEvidence = await page.getByTestId('mediarecorder-prototype-evidence').textContent();
    if (!finalEvidence) throw new Error('Prototype evidence was not rendered.');
    const evidence = JSON.parse(finalEvidence.slice(finalEvidence.indexOf('{'))) as {
      build: { buildTarget: string; gitSha: string; sourceDigest: string };
      run: { backendRequestsObserved: number; scenarioCount: number };
      fixtures: Array<{ verified: boolean; sha256: string; sizeBytes: number }>;
      results: Array<{
        status: 'PASS';
        scenarioId: string;
        attempt?: {
          cleanupCompleted: boolean;
          requestedChunkCadenceMs: number;
          validation: {
            markerAnalysis: Array<unknown>;
            startMarkerDetected: boolean;
            endMarkerDetected: boolean;
            fixturePreflight: {
              startMarkerDetected: boolean;
              endMarkerDetected: boolean;
            };
          };
        };
      }>;
      normalFlowUnchanged: boolean;
    };
    expect(evidence.results).toHaveLength(1);
    expect(evidence.results[0]?.scenarioId).toBe('scenario-01');
    expect(evidence.build.buildTarget).toBe('staging-mediarecorder-prototype');
    expect(evidence.build.gitSha).toMatch(/^[a-f0-9]{40}$/u);
    expect(evidence.build.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.run.scenarioCount).toBe(1);
    expect(evidence.run.backendRequestsObserved).toBe(0);
    expect(evidence.fixtures).toHaveLength(2);
    expect(evidence.fixtures.every((fixture) => fixture.verified && fixture.sizeBytes > 0)).toBe(true);
    expect(evidence.results[0]?.attempt?.cleanupCompleted).toBe(true);
    expect(evidence.results[0]?.attempt?.requestedChunkCadenceMs).toBe(1000);
    expect((evidence.results[0]?.attempt?.validation.markerAnalysis.length ?? 0) > 0).toBe(true);
    expect(evidence.results[0]?.attempt?.validation.startMarkerDetected).toBe(true);
    expect(evidence.results[0]?.attempt?.validation.endMarkerDetected).toBe(true);
    expect(evidence.results[0]?.attempt?.validation.fixturePreflight.startMarkerDetected).toBe(true);
    expect(evidence.results[0]?.attempt?.validation.fixturePreflight.endMarkerDetected).toBe(true);
    expect(evidence.normalFlowUnchanged).toBe(true);
    expect(apiRequests).toEqual([]);
  });
});
