import { expect, test } from '@playwright/test';

test('shows the core entry points without requesting camera on load', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Assist im Browser' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kamera starten' })).toBeVisible();
  await expect(page.getByText('Demo-Modus', { exact: true })).toBeVisible();
});

test('serves the mock preview through localhost as well as 127.0.0.1', async ({ page }) => {
  await page.goto('http://localhost:4173/');
  await expect(page.getByRole('heading', { name: 'Assist im Browser' })).toBeVisible();
  await expect(page.getByText('Demo-Modus', { exact: true })).toBeVisible();
});
