import type { BoundedRecorderChunks } from '@/platform/media/boundedRecorderChunks';
import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';
import {
  BrandedVideoExportError,
  type BrandedVideoExportErrorCode,
  type BrandedVideoExportPhase,
} from '@/shared/media/brandedVideoExportError';

export async function recordAudioCanvas(input: {
  recorder: MediaRecorder;
  source: AudioBufferSourceNode;
  stream: MediaStream;
  collector: BoundedRecorderChunks;
  durationSeconds: number;
  signal: AbortSignal;
}): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let finalizationTimer: number | undefined;

    const cleanup = () => {
      if (finalizationTimer !== undefined) window.clearTimeout(finalizationTimer);
      input.signal.removeEventListener('abort', onAbort);
      input.recorder.ondataavailable = null;
      input.recorder.onerror = null;
      input.recorder.onstop = null;
      input.source.onended = null;
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(input.collector.finalize(input.recorder.mimeType));
      } catch (finalizeError) {
        reject(
          typedError(
            finalizeError,
            'VIDEO_RECORDER_FINALIZATION_FAILED',
            'recorder_finalization',
          ),
        );
      }
    };
    const stopImmediately = () => {
      input.stream.getTracks().forEach((track) => track.stop());
      try {
        input.source.stop();
      } catch {
        // Source may already be stopped.
      }
      if (input.recorder.state !== 'inactive') {
        try {
          input.recorder.stop();
        } catch {
          // Recorder may already be stopping.
        }
      }
    };
    const beginFinalization = () => {
      if (input.recorder.state === 'inactive') return;
      finalizationTimer = window.setTimeout(() => {
        stopImmediately();
        finish(
          new BrandedVideoExportError(
            'VIDEO_RECORDER_FINALIZATION_FAILED',
            'recorder_finalization',
          ),
        );
      }, MEDIA_RECORDER_LIMITS.finalizationDeadlineMs);
      try {
        input.recorder.stop();
      } catch (error) {
        stopImmediately();
        finish(
          typedError(
            error,
            'VIDEO_RECORDER_FINALIZATION_FAILED',
            'recorder_finalization',
          ),
        );
      }
    };
    const onAbort = () => {
      stopImmediately();
      finish(abortReason(input.signal));
    };

    input.recorder.ondataavailable = (event) => {
      try {
        input.collector.add(event.data);
      } catch (error) {
        stopImmediately();
        finish(typedError(error, 'VIDEO_RECORDING_FAILED', 'recording'));
      }
    };
    input.recorder.onerror = () => {
      stopImmediately();
      finish(new BrandedVideoExportError('VIDEO_RECORDING_FAILED', 'recording'));
    };
    input.recorder.onstop = () => finish();
    input.source.onended = beginFinalization;
    input.signal.addEventListener('abort', onAbort, { once: true });
    try {
      input.recorder.start(MEDIA_RECORDER_LIMITS.requestedChunkCadenceMs);
    } catch (error) {
      stopImmediately();
      finish(
        typedError(
          error,
          'VIDEO_RECORDER_INITIALIZATION_FAILED',
          'recorder_initialization',
        ),
      );
      return;
    }
    try {
      input.source.start(0);
      input.source.stop(input.durationSeconds);
    } catch (error) {
      stopImmediately();
      finish(typedError(error, 'VIDEO_RECORDING_FAILED', 'recording'));
    }
  });
}

function typedError(
  error: unknown,
  code: BrandedVideoExportErrorCode,
  phase: BrandedVideoExportPhase,
): BrandedVideoExportError {
  return error instanceof BrandedVideoExportError
    ? error
    : new BrandedVideoExportError(code, phase, error);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}
