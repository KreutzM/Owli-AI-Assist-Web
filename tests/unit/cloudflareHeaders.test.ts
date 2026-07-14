import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

async function generate(target: string): Promise<string> {
  await exec(process.execPath, ['tools/generate-cloudflare-headers.mjs', target]);
  return readFile('dist/_headers', 'utf8');
}

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

  it('fails for unknown targets', async () => {
    await expect(
      exec(process.execPath, ['tools/generate-cloudflare-headers.mjs', 'unknown']),
    ).rejects.toBeTruthy();
  });
});
