import { expect, test } from '@playwright/test';

test('shows the core entry points without requesting camera on load', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Assist im Browser' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kamera starten' })).toBeVisible();
  await expect(page.getByText('Demo-Modus', { exact: true })).toBeVisible();
});
