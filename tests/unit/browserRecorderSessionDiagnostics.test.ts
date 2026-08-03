import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedRecorderChunks } from '@/platform/media/boundedRecorderChunks';
import { recordAudioCanvas } from '@/platform/media/browserRecorderSession';
import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('browser recorder session diagnostic categories', () => {
  it('categorizes recorder start as initialization', async () => {
    const fixture = recorderFixture();
    fixture.recorder.start = vi.fn(() => {
      throw new Error('start failed');
    });

    await expectCode(fixture.record(), 'VIDEO_RECORDER_INITIALIZATION_FAILED');
  });

  it('categorizes an asynchronous MediaRecorder error as recording', async () => {
    const fixture = recorderFixture();
    fixture.recorder.start = vi.fn(() => {
      queueMicrotask(() => fixture.recorder.onerror?.(new Event('error')));
    });

    await expectCode(fixture.record(), 'VIDEO_RECORDING_FAILED');
  });

  it('preserves the byte-limit category from chunk admission', async () => {
    const fixture = recorderFixture();
    fixture.recorder.start = vi.fn(() => {
      queueMicrotask(() =>
        fixture.recorder.ondataavailable?.({
          data: new Blob([new Uint8Array(MEDIA_RECORDER_LIMITS.maxChunkBytes + 1)]),
        } as BlobEvent),
      );
    });

    await expectCode(fixture.record(), 'VIDEO_BYTE_LIMIT_EXCEEDED');
  });

  it('categorizes recorder finalization timeout', async () => {
    vi.useFakeTimers();
    const fixture = recorderFixture();
    fixture.source.start = vi.fn(() =>
      queueMicrotask(() => fixture.source.onended?.(new Event('ended'))),
    );
    fixture.recorder.start = vi.fn(() => {
      fixture.recorder.state = 'recording';
    });
    fixture.recorder.stop = vi.fn();
    const recording = fixture.record();
    await flushWork();

    await vi.advanceTimersByTimeAsync(MEDIA_RECORDER_LIMITS.finalizationDeadlineMs);

    await expectCode(recording, 'VIDEO_RECORDER_FINALIZATION_FAILED');
  });
});

function recorderFixture() {
  const recorder = {
    state: 'inactive' as RecordingState,
    mimeType: 'video/webm;codecs=vp8,opus',
    ondataavailable: null as ((event: BlobEvent) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onstop: null as ((event: Event) => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
  };
  const source = {
    onended: null as ((event: Event) => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
  };
  const stream = {
    getTracks: () => [{ stop: vi.fn() }],
  };
  const collector = new BoundedRecorderChunks(0);
  return {
    recorder,
    source,
    record: () =>
      recordAudioCanvas({
        recorder: recorder as unknown as MediaRecorder,
        source: source as unknown as AudioBufferSourceNode,
        stream: stream as unknown as MediaStream,
        collector,
        durationSeconds: 1,
        signal: new AbortController().signal,
      }),
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'BrandedVideoExportError', code });
}

async function flushWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
