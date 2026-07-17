import { describe, expect, it } from 'vitest';
import {
  inspectSceneSource,
  SCENE_IMAGE_MAX_BYTES,
  SOURCE_FILE_MAX_BYTES,
  SOURCE_MAX_PIXELS,
  SOURCE_MAX_SIDE_PX,
  SceneImageError,
} from '@/core/image/sceneImageInspection';

describe('scene source inspection', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8] as const)(
    'reads JPEG EXIF orientation %s',
    async (orientation) => {
      await expect(
        inspectSceneSource(new Blob([jpeg(640, 480, orientation)], { type: 'image/jpeg' })),
      ).resolves.toMatchObject({
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
        orientation,
      });
    },
  );

  it('inspects PNG and WebP dimensions before decode', async () => {
    await expect(
      inspectSceneSource(new Blob([png(320, 240)], { type: 'image/png' })),
    ).resolves.toMatchObject({ mimeType: 'image/png', width: 320, height: 240 });
    await expect(
      inspectSceneSource(new Blob([webp(800, 600)], { type: 'image/webp' })),
    ).resolves.toMatchObject({ mimeType: 'image/webp', width: 800, height: 600 });
  });

  it('rejects MIME disagreement and unsupported bytes', async () => {
    await expect(
      inspectSceneSource(new Blob([png(2, 2)], { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'MIME_MISMATCH' });
    await expect(
      inspectSceneSource(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
  });

  it('enforces source bytes, sides, pixels, and decoded output constants', async () => {
    expect(SCENE_IMAGE_MAX_BYTES).toBe(4_194_304);
    expect(SOURCE_FILE_MAX_BYTES).toBe(20_971_520);
    expect(SOURCE_MAX_SIDE_PX).toBe(8192);
    expect(SOURCE_MAX_PIXELS).toBe(16_000_000);

    await expect(
      inspectSceneSource(new Blob([new Uint8Array(SOURCE_FILE_MAX_BYTES + 1)])),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
    await expect(
      inspectSceneSource(new Blob([jpeg(SOURCE_MAX_SIDE_PX + 1, 2, 1)], { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'DIMENSIONS_TOO_LARGE' });
    await expect(
      inspectSceneSource(new Blob([jpeg(5000, 4000, 1)], { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'PIXEL_LIMIT_EXCEEDED' });
    await expect(
      inspectSceneSource(new Blob([jpeg(1, 2, 1)], { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'DIMENSIONS_TOO_SMALL' });
  });

  it('uses typed local errors', () => {
    expect(new SceneImageError('DECODE_FAILED')).toMatchObject({
      name: 'SceneImageError',
      code: 'DECODE_FAILED',
    });
  });
});

function jpeg(width: number, height: number, orientation: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
}

function png(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    8,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x49,
    0x45,
    0x4e,
    0x44,
    0,
    0,
    0,
    0,
  ]);
}

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  bytes.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0], 12);
  writeU24(bytes, 24, width - 1);
  writeU24(bytes, 27, height - 1);
  return bytes;
}

function writeU24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}
