import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PrototypeAttemptDeadlineError,
  PrototypeAttemptLifecycle,
} from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';
import {
  createAttemptDraft,
  MemoryTracker,
} from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import { mediaRecorderFixtureManifest } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import { recordCanvasAudio } from '@/features/labs/mediaRecorderPrototype/recording';
import type { PrototypeAttemptResources } from '@/features/labs/mediaRecorderPrototype/types';

describe('media recorder prototype recording evidence', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retains the actual chunk evidence when a chunk exceeds 8 MiB', async () => {
    const fixture = createRecordingFixture((recorder) => {
      recorder.emitChunk(PROTOTYPE_LIMITS.maxChunkBytes + 1);
    });

    await expect(fixture.record()).rejects.toThrow('exceeds the per-chunk failure envelope');
    expect(fixture.attempt.chunkSizes).toEqual([PROTOTYPE_LIMITS.maxChunkBytes + 1]);
    expect(fixture.attempt.chunkIntervalsMs).toHaveLength(1);
  });

  it('retains delivered chunks when the render deadline aborts recording', async () => {
    vi.useFakeTimers();
    const fixture = createRecordingFixture((recorder) => recorder.emitChunk(2048));
    const recording = fixture.record();
    const rejected = expect(recording).rejects.toBeInstanceOf(PrototypeAttemptDeadlineError);

    await vi.advanceTimersByTimeAsync(PROTOTYPE_LIMITS.renderSlackMs);
    await rejected;
    expect(fixture.attempt.chunkSizes).toEqual([2048]);
    expect(fixture.attempt.chunkIntervalsMs).toEqual([0]);
  });

  it('retains delivered chunks when cancellation follows data delivery', async () => {
    const fixture = createRecordingFixture((recorder, abortController) => {
      recorder.emitChunk(1024);
      abortController.abort(new DOMException('cancelled', 'AbortError'));
    });

    await expect(fixture.record()).rejects.toThrow('Prototype attempt aborted.');
    expect(fixture.attempt.chunkSizes).toEqual([1024]);
    expect(fixture.attempt.chunkIntervalsMs).toHaveLength(1);
  });
});

function createRecordingFixture(
  onSourceStart: (recorder: FakeMediaRecorder, abortController: AbortController) => void,
) {
  class InstalledMediaRecorder extends FakeMediaRecorder {
    static instance: FakeMediaRecorder | undefined;

    constructor() {
      super();
      InstalledMediaRecorder.instance = this;
    }
  }
  class InstalledMediaStream {
    constructor(private readonly tracks: MediaStreamTrack[]) {}
    getTracks() {
      return this.tracks;
    }
  }
  vi.stubGlobal('MediaRecorder', InstalledMediaRecorder);
  vi.stubGlobal('MediaStream', InstalledMediaStream);

  const scenario = mediaRecorderFixtureManifest.scenarios[0]!;
  const candidate = mediaRecorderFixtureManifest.recorderCandidates[1]!;
  const attempt = createAttemptDraft(1, scenario, candidate, new Date().toISOString());
  const abortController = new AbortController();
  const lifecycle = new PrototypeAttemptLifecycle(1, abortController.signal);
  const resources: PrototypeAttemptResources = {};
  const videoTrack = {} as MediaStreamTrack;
  const audioTrack = {} as MediaStreamTrack;
  const canvas = {
    captureStream: () => ({ getVideoTracks: () => [videoTrack] }),
  } as unknown as HTMLCanvasElement;
  const destination = {
    stream: { getAudioTracks: () => [audioTrack] },
  } as unknown as MediaStreamAudioDestinationNode;
  const source = {
    onended: null,
    start: () => {
      const recorder = InstalledMediaRecorder.instance;
      if (!recorder) throw new Error('Recorder was not created.');
      onSourceStart(recorder, abortController);
    },
  } as unknown as AudioBufferSourceNode;

  return {
    abortController,
    attempt,
    record: () =>
      recordCanvasAudio({
        canvas,
        destination,
        source,
        candidate,
        resources,
        attempt,
        memory: new MemoryTracker(),
        lifecycle,
        durationMs: 0,
      }),
  };
}

class FakeMediaRecorder extends EventTarget {
  state: RecordingState = 'inactive';
  readonly mimeType = 'video/webm;codecs=vp8,opus';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    const event = new Event('stop');
    this.onstop?.(event);
    this.dispatchEvent(event);
  }

  emitChunk(size: number): void {
    this.ondataavailable?.({ data: { size } as Blob } as BlobEvent);
  }
}
