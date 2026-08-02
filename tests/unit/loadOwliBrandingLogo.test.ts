import { describe, expect, it, vi } from 'vitest';
import {
  loadOwliBrandingLogo,
  OWLI_VIDEO_BRANDING_LOGO_PATH,
} from '@/core/api/loadOwliBrandingLogo';

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const ASSET_ORIGIN = 'https://staging.owli-ai.com';
const ASSET_URL = `${ASSET_ORIGIN}${OWLI_VIDEO_BRANDING_LOGO_PATH}`;

function response(
  overrides: {
    bytes?: Uint8Array;
    contentType?: string;
    contentLength?: string;
    url?: string;
    status?: number;
  } = {},
): Response {
  const bytes = overrides.bytes ?? PNG_BYTES;
  const value = new Response(Uint8Array.from(bytes).buffer, {
    status: overrides.status ?? 200,
    headers: {
      'Content-Type': overrides.contentType ?? 'image/png',
      'Content-Length': overrides.contentLength ?? String(bytes.byteLength),
    },
  });
  Object.defineProperty(value, 'url', {
    value: overrides.url ?? ASSET_URL,
    configurable: true,
  });
  return value;
}

describe('loadOwliBrandingLogo', () => {
  it('loads the fixed same-origin canonical PNG with an active abort signal', async () => {
    const fetchImplementation = vi.fn(async () => response());
    const signal = new AbortController().signal;

    const blob = await loadOwliBrandingLogo(
      signal,
      fetchImplementation,
      ASSET_ORIGIN,
    );

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG_BYTES);
    expect(blob.type).toBe('image/png');
    expect(fetchImplementation).toHaveBeenCalledWith(new URL(ASSET_URL), {
      method: 'GET',
      headers: { Accept: 'image/png' },
      credentials: 'omit',
      cache: 'force-cache',
      redirect: 'error',
      signal,
    });
  });

  it.each([
    [
      'changed origin',
      { url: `https://example.com${OWLI_VIDEO_BRANDING_LOGO_PATH}` },
    ],
    ['changed path', { url: `${ASSET_ORIGIN}/assets/branding/other.png` }],
    ['wrong MIME', { contentType: 'image/jpeg' }],
    ['invalid length', { contentLength: 'invalid' }],
    ['length mismatch', { contentLength: '10' }],
    [
      'invalid PNG signature',
      { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
    ],
  ])('fails closed for %s', async (_name, overrides) => {
    const fetchImplementation = vi.fn(async () => response(overrides));

    await expect(
      loadOwliBrandingLogo(
        new AbortController().signal,
        fetchImplementation,
        ASSET_ORIGIN,
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it('propagates abort before loading the asset', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImplementation = vi.fn(async () => response());

    await expect(
      loadOwliBrandingLogo(
        controller.signal,
        fetchImplementation,
        ASSET_ORIGIN,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
