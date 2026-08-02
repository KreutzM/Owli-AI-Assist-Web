import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFile, shareFile } from '@/platform/share/browserShare';

const file = new File(['video'], 'owli-audio-postcard.webm', { type: 'video/webm' });
const title = 'Owli-AI Audio-Postcard';
const text = 'Mit Owli-AI Assist erstellt';

afterEach(() => {
  vi.restoreAllMocks();
});

function installShareApis(input: {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
}) {
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: input.canShare,
  });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: input.share,
  });
}

describe('file sharing', () => {
  it('uses identical ShareData fields for capability detection and sharing', async () => {
    const canShare = vi.fn(() => true);
    const share = vi.fn(async () => undefined);
    installShareApis({ canShare, share });

    expect(canShareFile(file, title, text)).toBe(true);
    await expect(shareFile(file, title, text)).resolves.toBeUndefined();

    const expected = { files: [file], title, text };
    expect(canShare).toHaveBeenNthCalledWith(1, expected);
    expect(canShare).toHaveBeenNthCalledWith(2, expected);
    expect(share).toHaveBeenCalledWith(expected);
  });

  it('does not expose file sharing when canShare rejects the exact payload', async () => {
    installShareApis({ canShare: () => false, share: vi.fn(async () => undefined) });

    expect(canShareFile(file, title, text)).toBe(false);
    await expect(shareFile(file, title, text)).rejects.toThrow(/unavailable/u);
  });

  it.each([
    ['canShare', { share: vi.fn(async () => undefined) }],
    ['share', { canShare: () => true }],
  ])('requires the %s API', async (_name, apis) => {
    installShareApis(apis);

    expect(canShareFile(file, title, text)).toBe(false);
    await expect(shareFile(file, title, text)).rejects.toThrow(/unavailable/u);
  });

  it('propagates a user AbortError without mutating the file', async () => {
    installShareApis({
      canShare: () => true,
      share: vi.fn(async () => {
        throw new DOMException('cancelled', 'AbortError');
      }),
    });

    await expect(shareFile(file, title, text)).rejects.toMatchObject({ name: 'AbortError' });
    expect(file.name).toBe('owli-audio-postcard.webm');
    expect(file.type).toBe('video/webm');
  });

  it('propagates a technical share failure distinctly', async () => {
    installShareApis({
      canShare: () => true,
      share: vi.fn(async () => {
        throw new Error('share bridge failed');
      }),
    });

    await expect(shareFile(file, title, text)).rejects.toThrow('share bridge failed');
  });
});
