import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDecodedBrandedFrame } from '@/platform/media/brandedVideoFrameValidation';
import { validateBrandedVideoOutput } from '@/platform/media/browserBrandedVideoValidation';
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
const validAudioBuffer = {
  duration: 1,
  numberOfChannels: 1,
  getChannelData: () => new Float32Array([0.1, -0.1, 0.2]),
} as AudioBuffer;
let video: FakeVideo;

beforeEach(() => {
  video = new FakeVideo();
  vi.mocked(inspectWebmContainer).mockResolvedValue(validInspection);
  vi.mocked(assertExpectedWebmTracks).mockImplementation(() => undefined);
  vi.mocked(assertDecodedBrandedFrame).mockImplementation(() => undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:validation-output');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) =>
    tagName === 'video'
      ? (video as unknown as HTMLVideoElement)
      : createElement(tagName, options)) as typeof document.createElement);
  installAudioContext(validAudioBuffer);
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

  it('categorizes output duration resolution and drift', async () => {
    video.duration = 2;

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

  it('categorizes output audio decode, duration, and energy validation', async () => {
    installAudioContext(undefined, new Error('A/V WebM decode failed'));

    await expectCode(validate(), 'VIDEO_OUTPUT_AUDIO_VALIDATION_FAILED');
  });
});

function validate({
  blob = new Blob(['webm'], { type: 'video/webm' }),
  fileName = 'output.webm',
}: {
  blob?: Blob;
  fileName?: string;
} = {}) {
  return validateBrandedVideoOutput({
    blob,
    fileName,
    expectedDurationMs: 1_000,
    referenceCanvas: {} as HTMLCanvasElement,
    layout: {} as never,
    signal: new AbortController().signal,
  });
}

async function expectCode(promise: Promise<void>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'BrandedVideoExportError', code });
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
