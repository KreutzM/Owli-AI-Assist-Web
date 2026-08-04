import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawBrandedVideoFrame } from '@/platform/media/brandedVideoFrame';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import { recordAudioCanvas } from '@/platform/media/browserRecorderSession';
import { validateBrandedVideoOutput } from '@/platform/media/browserBrandedVideoValidation';
import {
  BRANDED_VIDEO_TOTAL_SLACK_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';

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
let nextAudioBuffer: AudioBuffer;
let audioDecodeDelayMs: number;

beforeEach(() => {
  vi.useFakeTimers();
  nextAudioBuffer = decodedAudio();
  audioDecodeDelayMs = 0;
  installMediaGlobals();
  vi.mocked(recordAudioCanvas).mockReset().mockResolvedValue(outputBlob);
  vi.mocked(validateBrandedVideoOutput).mockReset().mockResolvedValue(undefined);
  vi.mocked(drawBrandedVideoFrame).mockReset().mockReturnValue({} as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('branded video renderer deadline phases', () => {
  it('keeps the initialization watchdog fixed at the initialization deadline', async () => {
    const controller = new AbortController();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const getSignal = installPendingRecording();

    const rendering = renderBrandedVideo(input({ signal: controller.signal }));
    await flushToRecording();

    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(
      MEDIA_RECORDER_LIMITS.initializationDeadlineMs,
    );
    expect(getSignal().aborted).toBe(false);

    await cancelPending(controller, rendering);
  });

  it('clears the initialization watchdog before starting the render watchdog', async () => {
    const controller = new AbortController();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    installPendingRecording();

    const rendering = renderBrandedVideo(input({ signal: controller.signal }));
    await flushToRecording();

    const initializationHandle = setTimeoutSpy.mock.results[0]?.value;
    const renderCallIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, timeoutMs]) => timeoutMs === 1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS,
    );
    const clearCallIndex = clearTimeoutSpy.mock.calls.findIndex(
      ([handle]) => handle === initializationHandle,
    );

    expect(renderCallIndex).toBeGreaterThanOrEqual(0);
    expect(clearCallIndex).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy.mock.invocationCallOrder[clearCallIndex]).toBeLessThan(
      setTimeoutSpy.mock.invocationCallOrder[renderCallIndex]!,
    );

    await cancelPending(controller, rendering);
  });

  it('does not subtract nine seconds of initialization from the new render budget', async () => {
    const controller = new AbortController();
    audioDecodeDelayMs = 9_000;
    nextAudioBuffer = decodedAudio({ duration: 31, length: 1_488_000 });
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const getSignal = installPendingRecording();

    const rendering = renderBrandedVideo(input({ signal: controller.signal }));
    await flushWork();
    await vi.advanceTimersByTimeAsync(9_000);
    await flushToRecording();

    expect(
      setTimeoutSpy.mock.calls.some(
        ([, timeoutMs]) => timeoutMs === 31_000 + BRANDED_VIDEO_TOTAL_SLACK_MS,
      ),
    ).toBe(true);
    expect(getSignal().aborted).toBe(false);

    await cancelPending(controller, rendering);
  });

  it('does not abort one millisecond before the dynamic render deadline', async () => {
    const controller = new AbortController();
    const getSignal = installPendingRecording();
    const rendering = renderBrandedVideo(input({ signal: controller.signal }));
    await flushToRecording();

    await vi.advanceTimersByTimeAsync(1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS - 1);

    expect(getSignal().aborted).toBe(false);

    await cancelPending(controller, rendering);
  });

  it('reports VIDEO_RENDER_DEADLINE_EXCEEDED at the dynamic render deadline', async () => {
    installPendingRecording();
    const rendering = expectCode(
      renderBrandedVideo(input()),
      'VIDEO_RENDER_DEADLINE_EXCEEDED',
    );
    await flushToRecording();

    await vi.advanceTimersByTimeAsync(1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS);

    await rendering;
  });

  it('clears the render watchdog after success', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    await expect(renderBrandedVideo(input())).resolves.toMatchObject({
      name: 'owli-audio-postcard.webm',
    });

    const renderCallIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, timeoutMs]) => timeoutMs === 1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS,
    );
    const renderHandle = setTimeoutSpy.mock.results[renderCallIndex]?.value;
    expect(renderCallIndex).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(renderHandle);
  });

  it('clears the render watchdog after a recorder failure', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    vi.mocked(recordAudioCanvas).mockRejectedValueOnce(new Error('recording failed'));

    await expectCode(renderBrandedVideo(input()), 'VIDEO_RECORDING_FAILED');

    const renderCallIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, timeoutMs]) => timeoutMs === 1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS,
    );
    const renderHandle = setTimeoutSpy.mock.results[renderCallIndex]?.value;
    expect(renderCallIndex).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(renderHandle);
  });

  it('clears the render watchdog after an output-validation failure', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    vi.mocked(validateBrandedVideoOutput).mockRejectedValueOnce(new Error('validation failed'));

    await expectCode(renderBrandedVideo(input()), 'VIDEO_UNKNOWN_EXPORT_FAILURE');

    const renderCallIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, timeoutMs]) => timeoutMs === 1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS,
    );
    const renderHandle = setTimeoutSpy.mock.results[renderCallIndex]?.value;
    expect(renderCallIndex).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(renderHandle);
  });

  it('clears the render watchdog after user cancellation', async () => {
    const controller = new AbortController();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const getSignal = installPendingRecording();

    const rendering = renderBrandedVideo(input({ signal: controller.signal }));
    await flushToRecording();
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await expectCode(rendering, 'VIDEO_RECORDING_FAILED');
    expect(getSignal().aborted).toBe(true);
    const renderCallIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, timeoutMs]) => timeoutMs === 1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS,
    );
    const renderHandle = setTimeoutSpy.mock.results[renderCallIndex]?.value;
    expect(renderCallIndex).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(renderHandle);
  });

  it('does not let a cleared timer from an aborted attempt affect a retry', async () => {
    const firstController = new AbortController();
    let firstSignal!: AbortSignal;
    let secondSignal!: AbortSignal;
    const secondRecording = deferred<Blob>();
    vi.mocked(recordAudioCanvas)
      .mockImplementationOnce(({ signal }) => {
        firstSignal = signal;
        return pendingUntilAbort(signal);
      })
      .mockImplementationOnce(({ signal }) => {
        secondSignal = signal;
        return secondRecording.promise;
      });

    const first = renderBrandedVideo(input({ signal: firstController.signal }));
    await flushToRecording();
    firstController.abort(new DOMException('cancelled', 'AbortError'));
    await expectCode(first, 'VIDEO_RECORDING_FAILED');
    expect(firstSignal.aborted).toBe(true);

    nextAudioBuffer = decodedAudio({ duration: 31, length: 1_488_000 });
    const retry = renderBrandedVideo(input());
    await flushToRecording(2);
    await vi.advanceTimersByTimeAsync(1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS);

    expect(secondSignal.aborted).toBe(false);
    secondRecording.resolve(outputBlob);
    await expect(retry).resolves.toMatchObject({ name: 'owli-audio-postcard.webm' });
  });

  it('releases the render token after a deadline so retry succeeds', async () => {
    installPendingRecording();
    const first = expectCode(
      renderBrandedVideo(input()),
      'VIDEO_RENDER_DEADLINE_EXCEEDED',
    );
    await flushToRecording();
    await vi.advanceTimersByTimeAsync(1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS);
    await first;

    await expect(renderBrandedVideo(input())).resolves.toMatchObject({
      name: 'owli-audio-postcard.webm',
    });
  });

  it('releases the render token after a recorder error so retry succeeds', async () => {
    vi.mocked(recordAudioCanvas).mockRejectedValueOnce(new Error('recording failed'));

    await expectCode(renderBrandedVideo(input()), 'VIDEO_RECORDING_FAILED');

    await expect(renderBrandedVideo(input())).resolves.toMatchObject({
      name: 'owli-audio-postcard.webm',
    });
  });

  it('ignores legacy backend-duration metadata when scheduling the render watchdog', async () => {
    const controller = new AbortController();
    nextAudioBuffer = decodedAudio({ duration: 31, length: 1_488_000 });
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const getSignal = installPendingRecording();
    const values = {
      ...input({ signal: controller.signal }),
      expectedDurationMs: 1,
    } as Parameters<typeof renderBrandedVideo>[0];

    const rendering = renderBrandedVideo(values);
    await flushToRecording();

    expect(
      setTimeoutSpy.mock.calls.some(
        ([, timeoutMs]) => timeoutMs === 31_000 + BRANDED_VIDEO_TOTAL_SLACK_MS,
      ),
    ).toBe(true);
    expect(getSignal().aborted).toBe(false);

    await cancelPending(controller, rendering);
  });
});

function input(overrides: Partial<Parameters<typeof renderBrandedVideo>[0]> = {}) {
  return {
    imageBlob,
    logoBlob,
    audioBlob,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'BrandedVideoExportError', code });
}

function installPendingRecording(): () => AbortSignal {
  let capturedSignal!: AbortSignal;
  vi.mocked(recordAudioCanvas).mockImplementationOnce(({ signal }) => {
    capturedSignal = signal;
    return pendingUntilAbort(signal);
  });
  return () => capturedSignal;
}

function pendingUntilAbort(signal: AbortSignal): Promise<Blob> {
  return new Promise((_, reject) => {
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
  });
}

async function cancelPending(
  controller: AbortController,
  rendering: Promise<unknown>,
): Promise<void> {
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await expectCode(rendering, 'VIDEO_RECORDING_FAILED');
}

async function flushWork(): Promise<void> {
  for (let step = 0; step < 12; step += 1) {
    await Promise.resolve();
  }
}

async function flushToRecording(expectedCalls = 1): Promise<void> {
  for (let step = 0; step < 50; step += 1) {
    if (vi.mocked(recordAudioCanvas).mock.calls.length >= expectedCalls) return;
    await Promise.resolve();
  }
  throw new Error('Recorder phase was not reached');
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function installMediaGlobals(): void {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal(
    'createImageBitmap',
    vi
      .fn()
      .mockResolvedValueOnce(bitmap(1280, 720))
      .mockResolvedValueOnce(bitmap(1024, 1024))
      .mockResolvedValueOnce(bitmap(1280, 720))
      .mockResolvedValueOnce(bitmap(1024, 1024)),
  );
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string, options?: ElementCreationOptions) =>
      tagName === 'canvas' ? fakeCanvas() : createElement(tagName, options),
  );
}

function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() };
}

function decodedAudio({
  duration = 1,
  length = 48_000,
}: {
  duration?: number;
  length?: number;
} = {}): AudioBuffer {
  return {
    duration,
    length,
    numberOfChannels: 1,
    sampleRate: 48_000,
    getChannelData: () => new Float32Array([0.25, -0.25, 0.125]),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  };
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({})),
    captureStream: vi.fn(() => new FakeMediaStream([fakeTrack()])),
  } as unknown as HTMLCanvasElement;
}

function fakeTrack(): MediaStreamTrack {
  return { stop: vi.fn() } as unknown as MediaStreamTrack;
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
  stop(): void {}
}

class FakeAudioContext {
  readonly state: AudioContextState = 'running';

  async decodeAudioData(): Promise<AudioBuffer> {
    if (audioDecodeDelayMs === 0) return nextAudioBuffer;
    return await new Promise((resolve) => {
      window.setTimeout(() => resolve(nextAudioBuffer), audioDecodeDelayMs);
    });
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
