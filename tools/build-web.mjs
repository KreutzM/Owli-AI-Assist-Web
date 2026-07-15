import { spawn } from 'node:child_process';

const STAGING_API_ROOT =
  'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/';

const target = process.argv[2];
const printConfigOnly = process.argv.includes('--print-config');
const targetConfig = {
  mock: {
    VITE_OWLI_API_MODE: 'mock',
    VITE_OWLI_APP_VERSION: '0.1.0',
    VITE_OWLI_VERSION_CODE: '1',
    VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
  },
  staging: {
    VITE_OWLI_API_MODE: 'remote',
    VITE_OWLI_API_BASE_URL: STAGING_API_ROOT,
    VITE_OWLI_APP_VERSION: '0.1.0',
    VITE_OWLI_VERSION_CODE: '1',
    VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
  },
  production: {
    VITE_OWLI_API_MODE: 'mock',
    VITE_OWLI_APP_VERSION: '0.1.0',
    VITE_OWLI_VERSION_CODE: '1',
    VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
  },
};

if (!target || !Object.hasOwn(targetConfig, target)) {
  throw new Error('Build target must be exactly mock, staging, or production.');
}

const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (key.startsWith('VITE_OWLI_')) delete environment[key];
}
Object.assign(environment, targetConfig[target], {
  OWLI_WEB_DEPLOY_TARGET: target,
});

if (printConfigOnly) {
  const runtimeEnvironment = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => key.startsWith('VITE_OWLI_') || key === 'OWLI_WEB_DEPLOY_TARGET',
    ),
  );
  console.log(JSON.stringify(runtimeEnvironment));
} else {
  await run('pnpm', ['exec', 'tsc', '-b'], environment);
  await run('pnpm', ['exec', 'vite', 'build'], environment);
  await run(process.execPath, ['tools/generate-cloudflare-headers.mjs', target], environment);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}
