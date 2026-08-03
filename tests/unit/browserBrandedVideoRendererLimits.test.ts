import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';

const imageBlob = new Blob(['image'], { type: 'image/jpeg' });
const logoBlob = new Blob(['logo'], { type: 'image/png' });
const audioBlob = new Blob(['audio'], { type: 'audio/mpeg' });
type RenderInput = Parameters<typeof renderBrandedVideo>[0];

function input(overrides: Partial<RenderInput> = {}): RenderInput {
  return {
    imageBlob,
    logoBlob,
    audioBlob,
    expectedDurationMs: 1_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('renderBrandedVideo admission and lifecycle', () => {
  it('rejects a source duration above the Candidate A 30-second limit', async () => {
    await expectCode(
      renderBrandedVideo(input({ expectedDurationMs: MEDIA_RECORDER_LIMITS.maxDurationMs + 1 })),
      'VIDEO_SOURCE_DURATION_LIMIT_EXCEEDED',
    );
  });

  it('rejects empty or oversized compressed audio before browser media allocation', async () => {
    await expectCode(
      renderBrandedVideo(input({ audioBlob: new Blob([], { type: 'audio/mpeg' }) })),
      'VIDEO_SOURCE_AUDIO_INPUT_INVALID',
    );
    const oversized = new Blob([
      new Uint8Array(MEDIA_RECORDER_LIMITS.hardCompressedInputBytes + 1),
    ]);
    await expectCode(
      renderBrandedVideo(input({ audioBlob: oversized })),
      'VIDEO_SOURCE_AUDIO_INPUT_INVALID',
    );
  });

  it('requires both the scene image and canonical logo', async () => {
    await expectCode(
      renderBrandedVideo(input({ imageBlob: new Blob([]) })),
      'VIDEO_SOURCE_IMAGE_INPUT_INVALID',
    );
    await expectCode(
      renderBrandedVideo(input({ logoBlob: new Blob([]) })),
      'VIDEO_BRANDING_INPUT_INVALID',
    );
  });

  it('allows at most one active render and releases the lock after abort cleanup', async () => {
    const controller = new AbortController();
    let supported = true;
    class RecorderStub {
      static isTypeSupported() {
        return supported;
      }
    }
    vi.stubGlobal('MediaRecorder', RecorderStub);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => new Promise<ImageBitmap>(() => undefined)),
    );

    const first = renderBrandedVideo(input({ signal: controller.signal }));
    await expectCode(renderBrandedVideo(input()), 'VIDEO_CONCURRENT_RENDER_REJECTED');

    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });

    supported = false;
    await expectCode(renderBrandedVideo(input()), 'VIDEO_RECORDER_UNSUPPORTED');
  });

  it('closes scene and logo bitmaps that finish decoding after abort', async () => {
    const controller = new AbortController();
    const sceneClose = vi.fn();
    const logoClose = vi.fn();
    const scene = { width: 1280, height: 720, close: sceneClose } as unknown as ImageBitmap;
    const logo = { width: 1024, height: 1024, close: logoClose } as unknown as ImageBitmap;
    let resolveScene!: (bitmap: ImageBitmap) => void;
    let resolveLogo!: (bitmap: ImageBitmap) => void;
    class RecorderStub {
      static isTypeSupported() {
        return true;
      }
    }
    vi.stubGlobal('MediaRecorder', RecorderStub);
    vi.stubGlobal(
      'createImageBitmap',
      vi
        .fn()
        .mockImplementationOnce(
          () => new Promise<ImageBitmap>((resolve) => (resolveScene = resolve)),
        )
        .mockImplementationOnce(
          () => new Promise<ImageBitmap>((resolve) => (resolveLogo = resolve)),
        ),
    );

    const rendering = renderBrandedVideo(input({ signal: controller.signal }));
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(rendering).rejects.toMatchObject({ name: 'AbortError' });

    resolveScene(scene);
    resolveLogo(logo);
    await waitFor(() => {
      expect(sceneClose).toHaveBeenCalledTimes(1);
      expect(logoClose).toHaveBeenCalledTimes(1);
    });
  });

  it('releases the active render lock after an initialization failure so retry is possible', async () => {
    let supported = true;
    class RecorderStub {
      static isTypeSupported() {
        return supported;
      }
    }
    vi.stubGlobal('MediaRecorder', RecorderStub);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('decode failed'))),
    );

    await expectCode(renderBrandedVideo(input()), 'VIDEO_SOURCE_IMAGE_DECODE_FAILED');

    supported = false;
    await expectCode(renderBrandedVideo(input()), 'VIDEO_RECORDER_UNSUPPORTED');
  });
});

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'BrandedVideoExportError', code });
}
