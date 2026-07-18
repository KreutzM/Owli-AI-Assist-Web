import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserOrientationDecoder } from '@/platform/image/browserOrientation';

describe('BrowserOrientationDecoder HTML image fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the source blob URL alive until the decoded surface is closed', async () => {
    const createdUrls = ['blob:probe', 'blob:source'];
    const createObjectURL = vi.fn(() => createdUrls.shift() ?? 'blob:unexpected');
    const revokeObjectURL = vi.fn();

    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      #src = '';

      get src(): string {
        return this.#src;
      }

      set src(value: string) {
        this.#src = value;
        if (!value) return;
        if (value === 'blob:probe') {
          this.naturalWidth = 1;
          this.naturalHeight = 2;
        } else {
          this.naturalWidth = 4000;
          this.naturalHeight = 3000;
        }
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const decoder = new BrowserOrientationDecoder();
    const decoded = await decoder.decode(new Blob(['jpeg'], { type: 'image/jpeg' }), 1);

    expect(decoded.surface.width).toBe(4000);
    expect(decoded.surface.height).toBe(3000);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe');

    decoded.surface.close();

    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:source');
  });
});
