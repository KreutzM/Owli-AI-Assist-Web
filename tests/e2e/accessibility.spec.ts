import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('has no automatically detectable serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Assist im Browser' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
  );
  expect(blocking).toEqual([]);
});
