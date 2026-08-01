import { describe, expect, it, vi } from 'vitest';
import { stopResources } from '@/features/labs/mediaRecorderPrototype/resourceCleanup';
import type { PrototypeAttemptResources } from '@/features/labs/mediaRecorderPrototype/runAttempt';

describe('media recorder prototype resource cleanup', () => {
  it('awaits audio-context closure and continues after intermediate cleanup errors', async () => {
    let audioClosed = false;
    const sourceDisconnect = vi.fn();
    const destinationDisconnect = vi.fn();
    const imageBitmapClose = vi.fn();
    const streamTrackStop = vi.fn();
    const canvasTrackStop = vi.fn();
    const resources: PrototypeAttemptResources = {
      recorder: {
        state: 'inactive',
        ondataavailable: null,
        onerror: null,
        onstop: null,
      } as MediaRecorder,
      source: {
        stop: vi.fn(() => {
          throw new Error('already ended');
        }),
        disconnect: sourceDisconnect,
      } as unknown as AudioBufferSourceNode,
      destination: {
        disconnect: destinationDisconnect,
      } as unknown as MediaStreamAudioDestinationNode,
      stream: {
        getTracks: () => [{ stop: streamTrackStop }] as unknown as MediaStreamTrack[],
      } as MediaStream,
      canvasStream: {
        getTracks: () => [{ stop: canvasTrackStop }] as unknown as MediaStreamTrack[],
      } as MediaStream,
      audioContext: {
        state: 'running',
        close: vi.fn(async () => {
          await Promise.resolve();
          audioClosed = true;
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
});
