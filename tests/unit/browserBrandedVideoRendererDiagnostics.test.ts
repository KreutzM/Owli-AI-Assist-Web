import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawBrandedVideoFrame } from '@/platform/media/brandedVideoFrame';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import { recordAudioCanvas } from '@/platform/media/browserRecorderSession';
import { validateBrandedVideoOutput } from '@/platform/media/browserBrandedVideoValidation';
import {
  BRANDED_VIDEO_DURATION_DRIFT_MS,
  BRANDED_VIDEO_TOTAL_SLACK_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';
import type { BrandedVideoExportErrorCode } from '@/shared/media/brandedVideoExportError';

vi.mock('@/platform/media/brandedVideoFrame', () => ({
  BRANDED_VIDEO_CANVAS: { width: 540, height: 960 },
  drawBrandedVideoFrame: vi.fn(() => ({})),
}));
vi.mock('@/platform/media/browserRecorderSession', () => ({ recordAudioCanvas: vi.fn() }));
vi.mock('@/platform/media/browserBrandedVideoValidation', () => ({
  validateBrandedVideoOutput: vi.fn(),
}));

const imageBlob = new Blob(['image'], { type: 'image/jpeg' });
const logoBlob = new Blob(['logo'], { type: 'image/png' });
const audioBlob = new Blob(['audio'], { type: 'audio/mpeg' });
const outputBlob = new Blob(['webm'], { type: 'video/webm' });
let recorderConstructorFailure: Error | undefined;
let audioDecodeFailure: Error | undefined;
let nextAudioBuffer: AudioBuffer;
let nextScene: ImageBitmap;
let nextLogo: ImageBitmap;
let canvasContext: CanvasRenderingContext2D | null;
let canvasContextFailure: Error | undefined;

beforeEach(() => {
  recorderConstructorFailure = undefined;
  audioDecodeFailure = undefined;
  nextAudioBuffer = decodedAudio();
  nextScene = bitmap(1280, 720);
  nextLogo = bitmap(1024, 1024);
  canvasContext = {} as CanvasRenderingContext2D;
  canvasContextFailure = undefined;
  installMediaGlobals();
  vi.mocked(recordAudioCanvas).mockResolvedValue(outputBlob);
  vi.mocked(validateBrandedVideoOutput).mockResolvedValue(undefined);
  vi.mocked(drawBrandedVideoFrame).mockReturnValue({} as never);
  installBitmapDecoder();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('branded video renderer diagnostic categories', () => {
  it('categorizes source image decoding', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));

    await expectCode(renderBrandedVideo(input()), 'VIDEO_SOURCE_IMAGE_DECODE_FAILED');
  });

  it('categorizes source audio decoding', async () => {
    audioDecodeFailure = new Error('audio decode failed');

    await expectCode(renderBrandedVideo(input()), 'VIDEO_SOURCE_AUDIO_DECODE_FAILED');
  });

  it('categorizes an unsupported approved MediaRecorder configuration', async () => {
    class UnsupportedRecorder extends FakeMediaRecorder {
      static isTypeSupported(): boolean {
        return false;
      }
    }
    vi.stubGlobal('MediaRecorder', UnsupportedRecorder);

    await expectCode(renderBrandedVideo(input()), 'VIDEO_RECORDER_UNSUPPORTED');
  });

  it('categorizes MediaRecorder construction and initialization', async () => {
    recorderConstructorFailure = new Error('constructor failed');

    await expectCode(renderBrandedVideo(input()), 'VIDEO_RECORDER_INITIALIZATION_FAILED');
  });

  it('categorizes an untyped recorder-session failure as recording', async () => {
    vi.mocked(recordAudioCanvas).mockRejectedValue(new Error('recording failed'));

    await expectCode(renderBrandedVideo(input()), 'VIDEO_RECORDING_FAILED');
  });

  it('categorizes the total render deadline without weakening its limit', async () => {
    vi.useFakeTimers();
    vi.mocked(recordAudioCanvas).mockImplementation(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new DOMException('Aborted', 'AbortError'),
              ),
            { once: true },
          );
        }),
    );
    const rendering = expectCode(renderBrandedVideo(input()), 'VIDEO_RENDER_DEADLINE_EXCEEDED');
    await flushWork();

    await vi.advanceTimersByTimeAsync(1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS);

    await rendering;
  });
});

describe('specific source admission categories and render-token release', () => {
  it.each<{
    label: string;
    code: BrandedVideoExportErrorCode;
    configure: () => void;
  }>([
    {
      label: 'source image dimensions',
      code: 'VIDEO_SOURCE_IMAGE_DIMENSIONS_EXCEEDED',
      configure: () => {
        nextScene = bitmap(MEDIA_RECORDER_LIMITS.maxSourceLongEdgePx + 1, 720);
        installBitmapDecoder();
      },
    },
    {
      label: 'missing canvas context',
      code: 'VIDEO_SOURCE_CANVAS_UNAVAILABLE',
      configure: () => {
        canvasContext = null;
      },
    },
    {
      label: 'canvas context exception',
      code: 'VIDEO_SOURCE_CANVAS_UNAVAILABLE',
      configure: () => {
        canvasContextFailure = new Error('sensitive canvas detail');
      },
    },
    {
      label: 'frame layout exception',
      code: 'VIDEO_SOURCE_LAYOUT_FAILED',
      configure: () => {
        vi.mocked(drawBrandedVideoFrame).mockImplementation(() => {
          throw new Error('sensitive layout detail');
        });
      },
    },
    {
      label: 'invalid decoded duration',
      code: 'VIDEO_SOURCE_INPUT_INVALID',
      configure: () => {
        nextAudioBuffer = decodedAudio({ duration: 0 });
      },
    },
    {
      label: 'unsupported decoded channels',
      code: 'VIDEO_SOURCE_AUDIO_CHANNELS_UNSUPPORTED',
      configure: () => {
        nextAudioBuffer = decodedAudio({ numberOfChannels: 3 });
      },
    },
    {
      label: 'unsupported decoded sample rate',
      code: 'VIDEO_SOURCE_AUDIO_SAMPLE_RATE_UNSUPPORTED',
      configure: () => {
        nextAudioBuffer = decodedAudio({ sampleRate: MEDIA_RECORDER_LIMITS.maxSampleRateHz + 1 });
      },
    },
    {
      label: 'decoded PCM limit',
      code: 'VIDEO_SOURCE_AUDIO_PCM_LIMIT_EXCEEDED',
      configure: () => {
        nextAudioBuffer = decodedAudio({
          length: MEDIA_RECORDER_LIMITS.maxDecodedPcmBytes / Float32Array.BYTES_PER_ELEMENT + 1,
          numberOfChannels: 1,
        });
      },
    },
    {
      label: 'decoded duration mismatch',
      code: 'VIDEO_SOURCE_AUDIO_DURATION_MISMATCH',
      configure: () => {
        nextAudioBuffer = decodedAudio({
          duration: (1_000 + BRANDED_VIDEO_DURATION_DRIFT_MS + 1) / 1_000,
          length: 48_000,
        });
      },
    },
    {
      label: 'decoded silence',
      code: 'VIDEO_SOURCE_AUDIO_SILENT',
      configure: () => {
        nextAudioBuffer = decodedAudio({ channelData: new Float32Array([0, 0, 0]) });
      },
    },
  ])('reports $label and allows a clean retry', async ({ code, configure }) => {
    configure();

    await expectCode(renderBrandedVideo(input()), code);
    await expectCode(renderBrandedVideo(input()), code);

    expect(recordAudioCanvas).not.toHaveBeenCalled();
    expect(validateBrandedVideoOutput).not.toHaveBeenCalled();
  });

  it('uses the generic admission fallback only for an untyped unknown admission exception', async () => {
    nextAudioBuffer = decodedAudio({
      channelDataFailure: new Error('sensitive getChannelData detail'),
    });

    await expectCode(renderBrandedVideo(input()), 'VIDEO_SOURCE_ADMISSION_FAILED');
  });
});

function input(overrides: Partial<Parameters<typeof renderBrandedVideo>[0]> = {}) {
  return {
    imageBlob,
    logoBlob,
    audioBlob,
    expectedDurationMs: 1_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function expectCode(
  promise: Promise<unknown>,
  code: BrandedVideoExportErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'BrandedVideoExportError', code });
}

function installMediaGlobals(): void {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeMediaStream);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string, options?: ElementCreationOptions) =>
      tagName === 'canvas' ? fakeCanvas() : createElement(tagName, options),
  );
}

function installBitmapDecoder(): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValueOnce(nextScene).mockResolvedValueOnce(nextLogo),
  );
}

function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function decodedAudio({
  duration = 1,
  length = 48_000,
  numberOfChannels = 1,
  sampleRate = 48_000,
  channelData = new Float32Array([0.25, -0.25, 0.125]),
  channelDataFailure,
}: {
  duration?: number;
  length?: number;
  numberOfChannels?: number;
  sampleRate?: number;
  channelData?: Float32Array;
  channelDataFailure?: Error;
} = {}): AudioBuffer {
  return {
    duration,
    length,
    numberOfChannels,
    sampleRate,
    getChannelData: vi.fn(() => {
      if (channelDataFailure) throw channelDataFailure;
      return channelData;
    }),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  };
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => {
      if (canvasContextFailure) throw canvasContextFailure;
      return canvasContext;
    }),
    captureStream: vi.fn(() => new FakeMediaStream([fakeTrack()])),
  } as unknown as HTMLCanvasElement;
}

function fakeTrack(): MediaStreamTrack {
  return { stop: vi.fn() } as unknown as MediaStreamTrack;
}

async function flushWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class FakeMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}
  getTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
}

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true;
  }
  readonly state: RecordingState = 'inactive';
  readonly mimeType = 'video/webm;codecs=vp8,opus';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;

  constructor() {
    if (recorderConstructorFailure) throw recorderConstructorFailure;
  }

  stop(): void {}
}

class FakeAudioContext {
  readonly state: AudioContextState = 'running';

  async decodeAudioData(): Promise<AudioBuffer> {
    if (audioDecodeFailure) throw audioDecodeFailure;
    return nextAudioBuffer;
  }

  async resume(): Promise<void> {}

  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    return {
      stream: new FakeMediaStream([fakeTrack()]),
      disconnect: vi.fn(),
    } as unknown as MediaStreamAudioDestinationNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    return {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as AudioBufferSourceNode;
  }

  async close(): Promise<void> {}
}
