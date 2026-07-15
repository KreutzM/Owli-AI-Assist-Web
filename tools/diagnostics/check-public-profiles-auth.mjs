import { chromium, webkit } from '@playwright/test';

const STAGING_URL = 'https://assist-staging.owli-ai.com/';
const BACKEND_ORIGIN = 'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev';

for (const [name, browserType] of [
  ['Chromium', chromium],
  ['WebKit', webkit],
]) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ locale: 'de-DE' });
  const page = await context.newPage();
  let profilesSeen = false;
  let authorizationPresent = false;
  let acceptPresent = false;

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== BACKEND_ORIGIN || url.pathname !== '/api/v1/profiles') return;
    profilesSeen = true;
    const headers = request.headers();
    authorizationPresent ||= Object.hasOwn(headers, 'authorization');
    acceptPresent ||= typeof headers.accept === 'string' && headers.accept.length > 0;
  });

  await page.goto(STAGING_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: 'Profilkatalog aktualisieren' }).waitFor({
    timeout: 20_000,
  });

  if (!profilesSeen) throw new Error(`${name}: profiles request was not observed.`);
  if (authorizationPresent) {
    throw new Error(`${name}: public profiles request contains Authorization.`);
  }
  if (!acceptPresent) throw new Error(`${name}: public profiles request is missing Accept.`);

  await browser.close();
  console.log(`${name}: public profiles request has Accept and no Authorization.`);
}
