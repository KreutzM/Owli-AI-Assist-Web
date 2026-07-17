import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  applyOrientationTransform,
  fitOrientedDimensions,
  revokeNormalizedSceneImage,
  SCENE_ENCODING_ATTEMPTS,
} from '@/platform/image/browserSceneImageNormalizer';

describe('scene image normalization geometry', () => {
  it.each([
    [1, [1, 0, 0, 1, 0, 0]],
    [2, [-1, 0, 0, 1, 4, 0]],
    [3, [-1, 0, 0, -1, 4, 2]],
    [4, [1, 0, 0, -1, 0, 2]],
    [5, [0, 1, 1, 0, 0, 0]],
    [6, [0, 1, -1, 0, 2, 0]],
    [7, [0, -1, -1, 0, 2, 4]],
    [8, [0, -1, 1, 0, 0, 4]],
  ] as const)('applies EXIF orientation %s exactly once', (orientation, expected) => {
    const setTransform = vi.fn();
    applyOrientationTransform(
      { setTransform } as unknown as CanvasRenderingContext2D,
      orientation,
      4,
      2,
      orientation >= 5 ? 2 : 4,
      orientation >= 5 ? 4 : 2,
    );
    expect(setTransform).toHaveBeenCalledWith(...expected);
  });

  it('swaps dimensions for orientations 5-8 and never upscales', () => {
    expect(fitOrientedDimensions(4000, 2000, 6, 1280)).toEqual({ width: 640, height: 1280 });
    expect(fitOrientedDimensions(640, 480, 1, 1280)).toEqual({ width: 640, height: 480 });
    expect(fitOrientedDimensions(480, 640, 1, 1280)).toEqual({ width: 480, height: 640 });
  });

  it('uses only the approved deterministic JPEG attempts', () => {
    expect(SCENE_ENCODING_ATTEMPTS).toEqual([
      { maxSide: 1280, quality: 0.82 },
      { maxSide: 1280, quality: 0.72 },
      { maxSide: 1024, quality: 0.72 },
      { maxSide: 1024, quality: 0.62 },
      { maxSide: 768, quality: 0.62 },
    ]);
  });

  it('revokes the preview URL through one ownership boundary', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    revokeNormalizedSceneImage({
      blob: new Blob([], { type: 'image/jpeg' }),
      width: 2,
      height: 2,
      byteLength: 0,
      previewUrl: 'blob:scene-preview',
    });
    expect(revoke).toHaveBeenCalledWith('blob:scene-preview');
    revoke.mockRestore();
  });

  it('keeps both browser orientation probes explicit', async () => {
    const source = await readFile('src/platform/image/browserOrientation.ts', 'utf8');
    expect(source).toContain("createImageBitmap(blob, { imageOrientation: 'none' })");
    expect(source).toContain('bitmap.width === 2 && bitmap.height === 1');
    expect(source).toContain('image.naturalWidth === 1 && image.naturalHeight === 2');
    expect(source).toContain('Fall through to the WebKit-compatible HTML image path.');
  });
});
