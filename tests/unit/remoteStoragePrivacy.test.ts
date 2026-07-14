import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('remote privacy boundary', () => {
  it('does not use persistent browser storage or logging', async () => {
    const sources = await Promise.all([
      readFile('src/core/api/remoteCatalogClient.ts', 'utf8'),
      readFile('src/core/session/remoteSessionManager.ts', 'utf8'),
      readFile('src/features/remote/RemoteCatalog.tsx', 'utf8'),
    ]);
    const combined = sources.join('\n');
    expect(combined).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|console\./);
  });
});
