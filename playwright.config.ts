import { defineConfig, devices } from '@playwright/test';

const localChromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: /remote-staging\.spec\.ts/u,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm build && pnpm preview',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev --host 0.0.0.0',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_OWLI_API_MODE: 'remote',
        VITE_OWLI_API_BASE_URL: 'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/',
        VITE_OWLI_APP_VERSION: '0.1.0',
        VITE_OWLI_VERSION_CODE: '1',
        VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
      },
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_OWLI_API_MODE: 'remtoe',
        VITE_OWLI_API_BASE_URL: 'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/',
        VITE_OWLI_APP_VERSION: '0.1.0',
        VITE_OWLI_VERSION_CODE: '1',
        VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(localChromiumExecutable
          ? { launchOptions: { executablePath: localChromiumExecutable } }
          : {}),
      },
    },
    { name: 'webkit', use: { ...devices['iPhone 15'] } },
  ],
});
