import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('fixed Vite ports', () => {
  it('uses strict dev and preview ports', async () => {
    const config = await readFile('vite.config.ts', 'utf8');
    expect(config).toContain('server: { port: 5173, strictPort: true }');
    expect(config).toContain('preview: { port: 4173, strictPort: true }');
  });
});
