import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('remote portrait camera layout', () => {
  it('removes the desktop flex basis from the file control on narrow screens', async () => {
    const css = await readFile('src/features/remote/remote.css', 'utf8');
    const mobile = css.match(/@media \(max-width: 32rem\) \{([\s\S]*)\}\s*$/u)?.[1] ?? '';

    expect(mobile).toContain('.file-control');
    expect(mobile).toContain('flex: 0 1 auto;');
    expect(mobile).toContain('width: 100%;');
  });

  it('gives the visible camera preview stable portrait dimensions', async () => {
    const css = await readFile('src/features/remote/remote.css', 'utf8');

    expect(css).toMatch(/\.camera-preview \{[\s\S]*width: 100%;/u);
    expect(css).toMatch(/\.camera-preview \{[\s\S]*aspect-ratio: 4 \/ 3;/u);
    expect(css).toMatch(/\.camera-preview \{[\s\S]*max-height: min\(65vh, 32rem\);/u);
    expect(css).toContain('.camera-preview--hidden {\n  display: none;');
  });
});
