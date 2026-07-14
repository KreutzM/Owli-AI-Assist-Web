import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('remote capability isolation', () => {
  it('keeps provider-backed capabilities out of the remote feature', async () => {
    const source = await readFile('src/features/remote/RemoteCatalog.tsx', 'utf8');
    expect(source).not.toMatch(/camera|imageBase64|scene\/|followup|song\/|audio|video|share/i);
  });

  it('keeps the remote client route allowlist narrow', async () => {
    const source = await readFile('src/core/api/remoteCatalogClient.ts', 'utf8');
    const routes = [...source.matchAll(/'\/(api\/v1\/[^']+)'/g)].map((match) => `/${match[1]}`);
    expect(new Set(routes)).toEqual(
      new Set(['/api/v1/config', '/api/v1/session/bootstrap', '/api/v1/profiles']),
    );
  });
});
