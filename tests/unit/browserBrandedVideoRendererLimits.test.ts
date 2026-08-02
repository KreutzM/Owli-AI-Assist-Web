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
    await expect(
      renderBrandedVideo(input({ expectedDurationMs: MEDIA_RECORDER_LIMITS.maxDurationMs + 1 })),
    ).rejects.toThrow(/duration.*Candidate A limit/u);
  });

  it('rejects empty or oversized compressed audio before browser media allocation', async () => {
    await expect(
      renderBrandedVideo(input({ audioBlob: new Blob([], { type: 'audio/mpeg' }) })),
    ).rejects.toThrow(/Compressed audio/u);

    const oversized = new Blob([
      new Uint8Array(MEDIA_RECORDER_LIMITS.hardCompressedInputBytes + 1),
    ]);
    await expect(renderBrandedVideo(input({ audioBlob: oversized }))).rejects.toThrow(
      /Compressed audio/u,
    );
  });

  it('requires both the scene image and canonical logo', async () => {
    await expect(renderBrandedVideo(input({ imageBlob: new Blob([]) }))).rejects.toThrow(
      /canonical logo are required/u,
    );
    await expect(renderBrandedVideo(input({ logoBlob: new Blob([]) }))).rejects.toThrow(
      /canonical logo are required/u,
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
    await expect(renderBrandedVideo(input())).rejects.toThrow(/already active/u);

    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });

    supported = false;
    await expect(renderBrandedVideo(input())).rejects.toThrow(/No approved WebM/u);
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

    await expect(renderBrandedVideo(input())).rejects.toThrow('decode failed');

    supported = false;
    await expect(renderBrandedVideo(input())).rejects.toThrow(/No approved WebM/u);
  });
});
