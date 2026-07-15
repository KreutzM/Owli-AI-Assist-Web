import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

async function generate(target: string): Promise<string> {
  await exec(process.execPath, ['tools/generate-cloudflare-headers.mjs', target]);
  return readFile('dist/_headers', 'utf8');
}

async function printBuildConfig(target: string): Promise<Record<string, string>> {
  const { stdout } = await exec(
    process.execPath,
    ['tools/build-web.mjs', target, '--print-config'],
    {
      env: {
        ...process.env,
        VITE_OWLI_API_MODE: 'remote',
        VITE_OWLI_API_BASE_URL: 'https://inherited.invalid/',
        VITE_OWLI_VERSION_CODE: '999',
      },
    },
  );
  return JSON.parse(stdout.trim()) as Record<string, string>;
}

describe('deployment build targets', () => {
  it('clears inherited runtime configuration and binds each build target', async () => {
    await expect(printBuildConfig('mock')).resolves.toEqual({
      OWLI_WEB_DEPLOY_TARGET: 'mock',
      VITE_OWLI_API_MODE: 'mock',
      VITE_OWLI_APP_VERSION: '0.1.0',
      VITE_OWLI_VERSION_CODE: '1',
      VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
    });
    await expect(printBuildConfig('staging')).resolves.toEqual({
      OWLI_WEB_DEPLOY_TARGET: 'staging',
      VITE_OWLI_API_MODE: 'remote',
      VITE_OWLI_API_BASE_URL:
        'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/',
      VITE_OWLI_APP_VERSION: '0.1.0',
      VITE_OWLI_VERSION_CODE: '1',
      VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
    });
    await expect(printBuildConfig('production')).resolves.toEqual({
      OWLI_WEB_DEPLOY_TARGET: 'production',
      VITE_OWLI_API_MODE: 'mock',
      VITE_OWLI_APP_VERSION: '0.1.0',
      VITE_OWLI_VERSION_CODE: '1',
      VITE_OWLI_DEFAULT_LOCALE: 'de-DE',
    });
  });
});

describe('Cloudflare header artifacts', () => {
  it('generates isolated mock, staging and production CSPs', async () => {
    const mock = await generate('mock');
    expect(mock).not.toContain('api.owli-ai.com');
    expect(mock).not.toContain('workers.dev');

    const staging = await generate('staging');
    expect(staging).toContain(
      "connect-src 'self' https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev",
    );
    expect(staging).not.toContain('https://api.owli-ai.com');
    expect(staging).not.toMatch(/media-src[^;]*workers\.dev/);

    const production = await generate('production');
    expect(production).toContain("connect-src 'self' https://api.owli-ai.com");
    expect(production).toContain("media-src 'self' blob: https://api.owli-ai.com");
    expect(production).not.toContain('workers.dev');
  });

  it.each(['unknown', 'constructor', 'toString'])('fails for unknown target %s', async (target) => {
    await expect(
      exec(process.execPath, ['tools/generate-cloudflare-headers.mjs', target]),
    ).rejects.toBeTruthy();
  });

  it('fails when runtime and header targets differ', async () => {
    await expect(
      exec(process.execPath, ['tools/generate-cloudflare-headers.mjs', 'staging'], {
        env: { ...process.env, OWLI_WEB_DEPLOY_TARGET: 'mock' },
      }),
    ).rejects.toBeTruthy();
  });
});
