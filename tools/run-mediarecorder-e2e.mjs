import { execFileSync, spawn } from 'node:child_process';

const playwrightArgs = process.argv.slice(2);

execFileSync('pnpm', ['build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    OWLI_WEB_OUT_DIR: 'dist-e2e-normal',
  },
  shell: process.platform === 'win32',
});

execFileSync('pnpm', ['build:staging:mediarecorder-prototype'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    OWLI_WEB_OUT_DIR: 'dist-e2e-prototype',
    OWLI_ALLOW_DIRTY_PROTOTYPE_BUILD: '1',
  },
  shell: process.platform === 'win32',
});

const normalServer = spawn(
  process.execPath,
  ['tools/serve-built-web.mjs', '--root', 'dist-e2e-normal', '--port', '4173'],
  {
    stdio: 'inherit',
  },
);
const prototypeServer = spawn(
  process.execPath,
  ['tools/serve-built-web.mjs', '--root', 'dist-e2e-prototype', '--port', '5175'],
  {
    stdio: 'inherit',
  },
);

try {
  await waitForServer(4173);
  await waitForServer(5175);
  execFileSync(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config=playwright.mediarecorder.config.mjs',
      ...playwrightArgs,
    ],
    {
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    },
  );
} finally {
  normalServer.kill('SIGTERM');
  prototypeServer.kill('SIGTERM');
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // Retry until the server is reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out while waiting for http://127.0.0.1:${port}`);
}
