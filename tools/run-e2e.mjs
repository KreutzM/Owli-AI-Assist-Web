import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const playwrightArgs = process.argv.slice(2);
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

execFileSync('pnpm', ['build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const servers = [
  startVite(['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort']),
  startVite(['--host', '0.0.0.0', '--port', '5173', '--strictPort'], {
    VITE_OWLI_API_MODE: 'remote',
    VITE_OWLI_API_BASE_URL: 'https://api-staging.owli-ai.com/',
    VITE_OWLI_APP_VERSION: '0.1.0',
    VITE_OWLI_VERSION_CODE: '1',
    VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
  }),
  startVite(['--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
    VITE_OWLI_API_MODE: 'remtoe',
    VITE_OWLI_API_BASE_URL: 'https://api-staging.owli-ai.com/',
    VITE_OWLI_APP_VERSION: '0.1.0',
    VITE_OWLI_VERSION_CODE: '1',
    VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
  }),
];

try {
  await Promise.all([waitForServer(4173), waitForServer(5173), waitForServer(5174)]);
  execFileSync('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs], {
    stdio: 'inherit',
    env: { ...process.env, OWLI_E2E_EXTERNAL_SERVERS: '1' },
    shell: process.platform === 'win32',
  });
} finally {
  await Promise.all(servers.map(stopServer));
}

function startVite(args, environment = {}) {
  return spawn(process.execPath, [viteBin, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...environment },
  });
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}
