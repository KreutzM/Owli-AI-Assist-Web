import { describe, expect, it, vi } from 'vitest';
import {
  assertBrandedVideoDecodedAudio,
  assertBrandedVideoSourceImageDimensions,
  assertBrandedVideoSourceInput,
} from '@/platform/media/brandedVideoSourceAdmission';
import {
  BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';
import type { BrandedVideoExportErrorCode } from '@/shared/media/brandedVideoExportError';

const imageBlob = new Blob(['image'], { type: 'image/jpeg' });
const logoBlob = new Blob(['logo'], { type: 'image/png' });
const audioBlob = new Blob(['audio'], { type: 'audio/mpeg' });

function sourceInput(overrides: Partial<Parameters<typeof assertBrandedVideoSourceInput>[0]> = {}) {
  return {
    imageBlob,
    logoBlob,
    audioBlob,
    ...overrides,
  };
}

describe('branded video source input admission', () => {
  it('rejects empty and oversized compressed audio independently', () => {
    expectCode(
      () => assertBrandedVideoSourceInput(sourceInput({ audioBlob: new Blob([]) })),
      'VIDEO_SOURCE_AUDIO_INPUT_INVALID',
    );
    expectCode(
      () =>
        assertBrandedVideoSourceInput(
          sourceInput({
            audioBlob: new Blob([
              new Uint8Array(MEDIA_RECORDER_LIMITS.hardCompressedInputBytes + 1),
            ]),
          }),
        ),
      'VIDEO_SOURCE_AUDIO_INPUT_INVALID',
    );
  });

  it('distinguishes an empty scene image from an empty canonical logo', () => {
    expectCode(
      () => assertBrandedVideoSourceInput(sourceInput({ imageBlob: new Blob([]) })),
      'VIDEO_SOURCE_IMAGE_INPUT_INVALID',
    );
    expectCode(
      () => assertBrandedVideoSourceInput(sourceInput({ logoBlob: new Blob([]) })),
      'VIDEO_BRANDING_INPUT_INVALID',
    );
  });

  it('keeps the existing 1280-pixel source-image boundary unchanged', () => {
    expect(() =>
      assertBrandedVideoSourceImageDimensions(bitmap(MEDIA_RECORDER_LIMITS.maxSourceLongEdgePx, 1)),
    ).not.toThrow();
    expectCode(
      () =>
        assertBrandedVideoSourceImageDimensions(
          bitmap(MEDIA_RECORDER_LIMITS.maxSourceLongEdgePx + 1, 1),
        ),
      'VIDEO_SOURCE_IMAGE_DIMENSIONS_EXCEEDED',
    );
  });
});

describe('decoded audio admission', () => {
  it('rejects non-positive decoded duration as invalid source input', () => {
    expectCode(
      () => assertBrandedVideoDecodedAudio(decodedAudio({ duration: 0 })),
      'VIDEO_SOURCE_INPUT_INVALID',
    );
  });

  it('admits only the fixed decoder-padding envelope above the 30-second source limit', () => {
    const paddedBoundaryMs =
      MEDIA_RECORDER_LIMITS.maxDurationMs + BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS;
    expect(() =>
      assertBrandedVideoDecodedAudio(
        decodedAudio({
          duration: paddedBoundaryMs / 1_000,
          length: Math.round((paddedBoundaryMs / 1_000) * 48_000),
        }),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        assertBrandedVideoDecodedAudio(
          decodedAudio({
            duration: (paddedBoundaryMs + 1) / 1_000,
            length: Math.round(((paddedBoundaryMs + 1) / 1_000) * 48_000),
          }),
        ),
      'VIDEO_SOURCE_DURATION_LIMIT_EXCEEDED',
    );
  });

  it.each([0, MEDIA_RECORDER_LIMITS.maxChannels + 1])(
    'rejects unsupported channel count %s',
    (numberOfChannels) => {
      expectCode(
        () => assertBrandedVideoDecodedAudio(decodedAudio({ numberOfChannels })),
        'VIDEO_SOURCE_AUDIO_CHANNELS_UNSUPPORTED',
      );
    },
  );

  it('rejects sample rates above the existing maximum and accepts 48 kHz', () => {
    expectCode(
      () =>
        assertBrandedVideoDecodedAudio(
          decodedAudio({ sampleRate: MEDIA_RECORDER_LIMITS.maxSampleRateHz + 1 }),
        ),
      'VIDEO_SOURCE_AUDIO_SAMPLE_RATE_UNSUPPORTED',
    );
    expect(() =>
      assertBrandedVideoDecodedAudio(
        decodedAudio({ sampleRate: MEDIA_RECORDER_LIMITS.maxSampleRateHz }),
      ),
    ).not.toThrow();
  });

  it('accepts exactly the decoded PCM limit and rejects the next frame', () => {
    const channels = 1;
    const exactLength =
      MEDIA_RECORDER_LIMITS.maxDecodedPcmBytes / channels / Float32Array.BYTES_PER_ELEMENT;
    expect(() =>
      assertBrandedVideoDecodedAudio(
        decodedAudio({ length: exactLength, numberOfChannels: channels }),
      ),
    ).not.toThrow();
    expectCode(
      () =>
        assertBrandedVideoDecodedAudio(
          decodedAudio({ length: exactLength + 1, numberOfChannels: channels }),
        ),
      'VIDEO_SOURCE_AUDIO_PCM_LIMIT_EXCEEDED',
    );
  });

  it.each([29.749, 29.751, 30])(
    'admits valid decoded duration %s without comparing backend metadata',
    (duration) => {
      expect(() =>
        assertBrandedVideoDecodedAudio(
          decodedAudio({ duration, length: Math.round(duration * 48_000) }),
        ),
      ).not.toThrow();
    },
  );

  it('rejects decoded audio below the existing RMS threshold', () => {
    expectCode(
      () =>
        assertBrandedVideoDecodedAudio(
          decodedAudio({ channelData: new Float32Array([0, 0, 0, 0]) }),
        ),
      'VIDEO_SOURCE_AUDIO_SILENT',
    );
  });

  it('keeps valid 30-second stereo 48-kHz audio admitted', () => {
    expect(() =>
      assertBrandedVideoDecodedAudio(
        decodedAudio({
          duration: 30,
          length: 30 * 48_000,
          numberOfChannels: 2,
          sampleRate: 48_000,
        }),
      ),
    ).not.toThrow();
  });
});

function decodedAudio({
  duration = 30,
  length = 30 * 48_000,
  numberOfChannels = 2,
  sampleRate = 48_000,
  channelData = new Float32Array([0.25, -0.25, 0.125, -0.125]),
}: {
  duration?: number;
  length?: number;
  numberOfChannels?: number;
  sampleRate?: number;
  channelData?: Float32Array<ArrayBuffer>;
} = {}): AudioBuffer {
  return {
    duration,
    length,
    numberOfChannels,
    sampleRate,
    getChannelData: () => channelData,
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  };
}

function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() };
}

function expectCode(operation: () => void, code: BrandedVideoExportErrorCode): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ name: 'BrandedVideoExportError', code });
  }
}
