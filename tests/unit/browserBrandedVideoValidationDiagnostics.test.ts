import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDecodedBrandedFrame } from '@/platform/media/brandedVideoFrameValidation';
import { validateBrandedVideoOutput } from '@/platform/media/browserBrandedVideoValidation';
import {
  BRANDED_VIDEO_MAX_OUTPUT_PADDING_MS,
  BRANDED_VIDEO_MAX_OUTPUT_SHORTFALL_MS,
} from '@/platform/media/mediaRecorderLimits';
import {
  assertExpectedWebmTracks,
  inspectWebmContainer,
} from '@/platform/media/webmContainerInspection';

vi.mock('@/platform/media/brandedVideoFrameValidation', () => ({
  assertDecodedBrandedFrame: vi.fn(),
}));
vi.mock('@/platform/media/webmContainerInspection', () => ({
  inspectWebmContainer: vi.fn(),
  assertExpectedWebmTracks: vi.fn(),
}));

const validInspection = {
  container: 'webm' as const,
  videoTrackCount: 1,
  audioTrackCount: 1,
  videoCodecs: ['V_VP8'],
  audioCodecs: ['A_OPUS'],
};
let video: FakeVideo;

beforeEach(() => {
  video = new FakeVideo();
  vi.mocked(inspectWebmContainer).mockResolvedValue(validInspection);
  vi.mocked(assertExpectedWebmTracks).mockImplementation(() => undefined);
  vi.mocked(assertDecodedBrandedFrame).mockImplementation(() => undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:validation-output');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string, options?: ElementCreationOptions) =>
      tagName === 'video'
        ? (video as unknown as HTMLVideoElement)
        : createElement(tagName, options),
  );
  installAudioContext(audioBuffer(1));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('branded video output diagnostic categories', () => {
  it('categorizes the output byte envelope', async () => {
    await expectCode(
      validate({ blob: new Blob([], { type: 'video/webm' }) }),
      'VIDEO_BYTE_LIMIT_EXCEEDED',
    );
  });

  it('categorizes WebM MIME and container inspection', async () => {
    await expectCode(
      validate({ blob: new Blob(['x'], { type: 'video/mp4' }), fileName: 'output.mp4' }),
      'VIDEO_CONTAINER_VALIDATION_FAILED',
    );

    vi.mocked(inspectWebmContainer).mockRejectedValue(new Error('bad EBML'));
    await expectCode(validate(), 'VIDEO_CONTAINER_VALIDATION_FAILED');
  });

  it('categorizes track count and codec validation', async () => {
    vi.mocked(assertExpectedWebmTracks).mockImplementation(() => {
      throw new Error('bad tracks');
    });

    await expectCode(validate(), 'VIDEO_TRACK_VALIDATION_FAILED');
  });

  it('categorizes loadedmetadata and dimensions', async () => {
    video.metadataMode = 'error';
    await expectCode(validate(), 'VIDEO_METADATA_VALIDATION_FAILED');

    video = new FakeVideo();
    video.videoWidth = 1;
    await expectCode(validate(), 'VIDEO_METADATA_VALIDATION_FAILED');
  });

  it('accepts bounded output padding and rejects the next millisecond', async () => {
    video.duration = (1_000 + BRANDED_VIDEO_MAX_OUTPUT_PADDING_MS) / 1_000;
    await expect(validate()).resolves.toBeUndefined();

    video = new FakeVideo();
    video.duration = (1_000 + BRANDED_VIDEO_MAX_OUTPUT_PADDING_MS + 1) / 1_000;
    await expectCode(validate(), 'VIDEO_DURATION_VALIDATION_FAILED');
  });

  it('accepts the shortfall tolerance and rejects the next millisecond', async () => {
    video.duration = (1_000 - BRANDED_VIDEO_MAX_OUTPUT_SHORTFALL_MS) / 1_000;
    await expect(validate()).resolves.toBeUndefined();

    video = new FakeVideo();
    video.duration = (1_000 - BRANDED_VIDEO_MAX_OUTPUT_SHORTFALL_MS - 1) / 1_000;
    await expectCode(validate(), 'VIDEO_DURATION_VALIDATION_FAILED');
  });

  it('categorizes output duration resolution and larger drift', async () => {
    video.duration = 4;

    await expectCode(validate(), 'VIDEO_DURATION_VALIDATION_FAILED');
  });

  it('categorizes seeking independently from duration', async () => {
    video.seekMode = 'error';

    await expectCode(validate(), 'VIDEO_SEEK_VALIDATION_FAILED');
  });

  it('categorizes decoded frame and branding validation', async () => {
    vi.mocked(assertDecodedBrandedFrame).mockImplementation(() => {
      throw new Error('bad frame');
    });

    await expectCode(validate(), 'VIDEO_FRAME_VALIDATION_FAILED');
  });

  it('categorizes the local playback probe', async () => {
    video.play.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));

    await expectCode(validate(), 'VIDEO_PLAYBACK_PROBE_FAILED');
  });

  it('applies the same asymmetric duration envelope to the output audio track', async () => {
    installAudioContext(audioBuffer((1_000 + BRANDED_VIDEO_MAX_OUTPUT_PADDING_MS) / 1_000));
    await expect(validate()).resolves.toBeUndefined();

    installAudioContext(audioBuffer((1_000 + BRANDED_VIDEO_MAX_OUTPUT_PADDING_MS + 1) / 1_000));
    await expectCode(validate(), 'VIDEO_OUTPUT_AUDIO_VALIDATION_FAILED');

    installAudioContext(audioBuffer((1_000 - BRANDED_VIDEO_MAX_OUTPUT_SHORTFALL_MS) / 1_000));
    await expect(validate()).resolves.toBeUndefined();

    installAudioContext(audioBuffer((1_000 - BRANDED_VIDEO_MAX_OUTPUT_SHORTFALL_MS - 1) / 1_000));
    await expectCode(validate(), 'VIDEO_OUTPUT_AUDIO_VALIDATION_FAILED');
  });

  it('categorizes output audio decode and energy validation', async () => {
    installAudioContext(undefined, new Error('A/V WebM decode failed'));

    await expectCode(validate(), 'VIDEO_OUTPUT_AUDIO_VALIDATION_FAILED');
  });
});

function validate({
  blob = new Blob(['webm'], { type: 'video/webm' }),
  fileName = 'output.webm',
  sourceAudioDurationMs = 1_000,
}: {
  blob?: Blob;
  fileName?: string;
  sourceAudioDurationMs?: number;
} = {}) {
  return validateBrandedVideoOutput({
    blob,
    fileName,
    sourceAudioDurationMs,
    referenceCanvas: {} as HTMLCanvasElement,
    layout: {} as never,
    signal: new AbortController().signal,
  });
}

async function expectCode(promise: Promise<void>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'BrandedVideoExportError', code });
}

function audioBuffer(duration: number): AudioBuffer {
  return {
    duration,
    length: Math.max(1, Math.round(duration * 48_000)),
    numberOfChannels: 1,
    sampleRate: 48_000,
    getChannelData: () => new Float32Array([0.1, -0.1, 0.2]),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  };
}

function installAudioContext(buffer?: AudioBuffer, failure?: Error): void {
  class AudioContextStub {
    readonly state = 'running';
    async decodeAudioData(): Promise<AudioBuffer> {
      if (failure) throw failure;
      if (!buffer) throw new Error('Missing test audio buffer.');
      return buffer;
    }
    async close(): Promise<void> {}
  }
  vi.stubGlobal('AudioContext', AudioContextStub);
}

class FakeVideo extends EventTarget {
  preload = '';
  playsInline = false;
  muted = false;
  videoWidth = 540;
  videoHeight = 960;
  duration = 1;
  metadataMode: 'success' | 'error' = 'success';
  seekMode: 'success' | 'error' = 'success';
  readonly play = vi.fn(async () => undefined);
  readonly pause = vi.fn();
  readonly load = vi.fn();
  #src = '';
  #currentTime = 0;

  set src(value: string) {
    this.#src = value;
    queueMicrotask(() =>
      this.dispatchEvent(new Event(this.metadataMode === 'success' ? 'loadedmetadata' : 'error')),
    );
  }

  get src(): string {
    return this.#src;
  }

  set currentTime(value: number) {
    this.#currentTime = value;
    queueMicrotask(() =>
      this.dispatchEvent(new Event(this.seekMode === 'success' ? 'seeked' : 'error')),
    );
  }

  get currentTime(): number {
    return this.#currentTime;
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.#src = '';
  }
}
