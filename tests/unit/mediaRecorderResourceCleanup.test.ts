import { describe, expect, it, vi } from 'vitest';
import { stopResources } from '@/features/labs/mediaRecorderPrototype/resourceCleanup';
import type { PrototypeAttemptResources } from '@/features/labs/mediaRecorderPrototype/types';

describe('media recorder prototype resource cleanup', () => {
  it('awaits an active recorder, ends every track, and closes the audio context', async () => {
    let audioClosed = false;
    let recorderState: RecordingState = 'recording';
    const recorderStop = vi.fn(() => {
      recorderState = 'inactive';
      recorder.dispatchEvent(new Event('stop'));
    });
    const recorder = new EventTarget() as MediaRecorder;
    Object.defineProperty(recorder, 'state', { get: () => recorderState });
    Object.assign(recorder, {
      ondataavailable: null,
      onerror: null,
      onstop: null,
      stop: recorderStop,
    });
    const sourceDisconnect = vi.fn();
    const destinationDisconnect = vi.fn();
    const imageBitmapClose = vi.fn();
    const streamTrackStop = vi.fn();
    const canvasTrackStop = vi.fn();
    const resources: PrototypeAttemptResources = {
      recorder,
      source: {
        stop: vi.fn(() => {
          throw new Error('already ended');
        }),
        disconnect: sourceDisconnect,
      } as unknown as AudioBufferSourceNode,
      destination: {
        disconnect: destinationDisconnect,
      } as unknown as MediaStreamAudioDestinationNode,
      stream: createTrackStream(streamTrackStop),
      canvasStream: createTrackStream(canvasTrackStop),
      audioContext: {
        state: 'running',
        close: vi.fn(async () => {
          await Promise.resolve();
          audioClosed = true;
          Object.defineProperty(resources.audioContext!, 'state', { value: 'closed' });
        }),
      } as unknown as AudioContext,
      imageBitmap: {
        close: imageBitmapClose,
      } as unknown as ImageBitmap,
      blobUrl: 'blob:output',
      imageUrl: 'blob:image',
    };

    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      await expect(stopResources(resources)).resolves.toBe(true);
      expect(audioClosed).toBe(true);
      expect(recorderStop).toHaveBeenCalledTimes(1);
      expect(sourceDisconnect).toHaveBeenCalledTimes(1);
      expect(destinationDisconnect).toHaveBeenCalledTimes(1);
      expect(imageBitmapClose).toHaveBeenCalledTimes(1);
      expect(streamTrackStop).toHaveBeenCalledTimes(1);
      expect(canvasTrackStop).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledTimes(2);
    } finally {
      revokeSpy.mockRestore();
    }
  });

  it('reports false when the recorder does not stop or the audio context cannot close', async () => {
    vi.useFakeTimers();
    const recorder = new EventTarget() as MediaRecorder;
    Object.defineProperty(recorder, 'state', { get: () => 'recording' });
    Object.assign(recorder, {
      ondataavailable: null,
      onerror: null,
      onstop: null,
      stop: vi.fn(),
    });
    const resources: PrototypeAttemptResources = {
      recorder,
      audioContext: {
        state: 'running',
        close: vi.fn().mockRejectedValue(new Error('close failed')),
      } as unknown as AudioContext,
    };

    try {
      const result = stopResources(resources);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(result).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a non-terminating audio-context close and still releases other resources', async () => {
    vi.useFakeTimers();
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const resources: PrototypeAttemptResources = {
      audioContext: {
        state: 'running',
        close: vi.fn(() => new Promise<void>(() => undefined)),
      } as unknown as AudioContext,
      blobUrl: 'blob:bounded-cleanup',
    };

    try {
      const result = stopResources(resources);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(result).resolves.toBe(false);
      expect(revokeSpy).toHaveBeenCalledWith('blob:bounded-cleanup');
    } finally {
      revokeSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

function createTrackStream(stop: () => void): MediaStream {
  let readyState: MediaStreamTrackState = 'live';
  const track = {
    get readyState() {
      return readyState;
    },
    stop: () => {
      stop();
      readyState = 'ended';
    },
  } as MediaStreamTrack;
  return { getTracks: () => [track] } as MediaStream;
}
