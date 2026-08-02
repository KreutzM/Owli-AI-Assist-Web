import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp } from 'node:fs/promises';
import path from 'node:path';

const STAGING_API_ROOT = 'https://api-staging.owli-ai.com/';
const GIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const GIT_DIRTY = readGitDirty();
const SOURCE_DIGEST = readSourceDigest();
const target = process.argv[2];
const OUT_DIR =
  process.env.OWLI_WEB_OUT_DIR ??
  (target === 'safari-jpeg-harness' ? path.resolve('tests/harness/safari-jpeg/dist') : 'dist');

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
    VITE_OWLI_STAGING_BRANDED_VIDEO_EXPORT: 'enabled',
  },
  production: {
    VITE_OWLI_API_MODE: 'mock',
    VITE_OWLI_APP_VERSION: '0.1.0',
    VITE_OWLI_VERSION_CODE: '1',
    VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
  },
  'safari-jpeg-harness': {
    VITE_OWLI_API_MODE: 'mock',
    VITE_OWLI_APP_VERSION: '0.1.0',
    VITE_OWLI_VERSION_CODE: '1',
    VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
  },
  'staging-mediarecorder-prototype': {
    VITE_OWLI_API_MODE: 'remote',
    VITE_OWLI_API_BASE_URL: STAGING_API_ROOT,
    VITE_OWLI_APP_VERSION: '0.1.0',
    VITE_OWLI_VERSION_CODE: '1',
    VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
    VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER: 'enabled',
  },
};

if (!target || !Object.hasOwn(targetConfig, target)) {
  throw new Error(
    'Build target must be exactly mock, staging, production, safari-jpeg-harness, or staging-mediarecorder-prototype.',
  );
}
if (
  target === 'staging-mediarecorder-prototype' &&
  GIT_DIRTY &&
  process.env.OWLI_ALLOW_DIRTY_PROTOTYPE_BUILD !== '1'
) {
  throw new Error(
    'staging-mediarecorder-prototype requires a clean working tree unless OWLI_ALLOW_DIRTY_PROTOTYPE_BUILD=1 is set.',
  );
}

const headerTarget =
  target === 'safari-jpeg-harness'
    ? 'mock'
    : target === 'staging-mediarecorder-prototype'
      ? 'staging'
      : target;
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (key.startsWith('VITE_OWLI_')) delete environment[key];
}
Object.assign(environment, targetConfig[target], {
  OWLI_WEB_DEPLOY_TARGET: headerTarget,
  VITE_OWLI_BUILD_TARGET: target,
  VITE_OWLI_GIT_SHA: GIT_SHA,
  VITE_OWLI_GIT_DIRTY: String(GIT_DIRTY),
  VITE_OWLI_SOURCE_DIGEST: SOURCE_DIGEST,
  OWLI_WEB_OUT_DIR: OUT_DIR,
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
  const viteArgs = ['exec', 'vite', 'build', '--outDir', OUT_DIR];
  if (target === 'safari-jpeg-harness') {
    viteArgs.push('--config', 'vite.safari-jpeg.config.mjs');
  }
  await run('pnpm', viteArgs, environment);
  if (target === 'staging-mediarecorder-prototype') {
    await cp(
      path.resolve('prototype-fixtures', 'mediarecorder', 'fixtures'),
      path.resolve(OUT_DIR, 'prototypes', 'mediarecorder', 'fixtures'),
      { recursive: true, force: true },
    );
  }
  await run(process.execPath, ['tools/generate-cloudflare-headers.mjs', headerTarget], environment);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32' && command !== process.execPath,
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

function readGitDirty() {
  return (
    execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      encoding: 'utf8',
    }).trim().length > 0
  );
}

function readSourceDigest() {
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    encoding: 'utf8',
  });
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD', '--'], { encoding: 'utf8' });
  return createHash('sha256')
    .update(GIT_SHA)
    .update('\n')
    .update(status)
    .update('\n')
    .update(diff)
    .digest('hex');
}
