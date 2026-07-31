import { expect, test } from '@playwright/test';

test.describe('media recorder prototype lab', () => {
  test('fails closed on the normal application deployment', async ({ page }) => {
    await page.goto('/lab/mediarecorder-prototype');

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
          results: Array<{ status: string }>;
          normalFlowUnchanged: boolean;
        };
        return evidence.results[0];
      }, { timeout: 45_000 })
      .toMatchObject({
        status: expect.stringMatching(/PASS|FAIL|AUDIO_ONLY_FALLBACK/u),
      });

    const finalEvidence = await page.getByTestId('mediarecorder-prototype-evidence').textContent();
    if (!finalEvidence) throw new Error('Prototype evidence was not rendered.');
    const evidence = JSON.parse(finalEvidence.slice(finalEvidence.indexOf('{'))) as {
      results: Array<{ status: string; scenarioId: string }>;
      normalFlowUnchanged: boolean;
    };
    expect(evidence.results).toHaveLength(1);
    expect(evidence.results[0]?.scenarioId).toBe('scenario-01');
    expect(evidence.normalFlowUnchanged).toBe(true);
    expect(apiRequests).toEqual([]);
  });
});
