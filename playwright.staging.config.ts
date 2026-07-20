import { defineConfig, devices } from '@playwright/test';

const baseURL = 'https://127.0.0.1:4180';
const localChromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [/remote-staging\.spec\.ts/u, /remote-media-layout-staging\.spec\.ts/u],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm build:staging && node tools/serve-built-web.mjs --https --port 4180',
    url: baseURL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium-staging',
      use: {
        ...devices['Desktop Chrome'],
        serviceWorkers: 'allow',
        launchOptions: {
          args: ['--allow-insecure-localhost', '--ignore-certificate-errors'],
          ...(localChromiumExecutable ? { executablePath: localChromiumExecutable } : {}),
        },
      },
    },
    {
      name: 'webkit-staging',
      use: { ...devices['iPhone 15'], serviceWorkers: 'block' },
    },
  ],
});
