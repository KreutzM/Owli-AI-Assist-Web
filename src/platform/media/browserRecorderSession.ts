import { BoundedRecorderChunks } from '@/platform/media/boundedRecorderChunks';
import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';

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
      if (finalizationTimer !== undefined) {
        window.clearTimeout(finalizationTimer);
      }
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
        reject(asError(finalizeError, 'Recorder finalization failed.'));
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
        finish(new Error('Recorder finalization deadline exceeded.'));
      }, MEDIA_RECORDER_LIMITS.finalizationDeadlineMs);
      input.recorder.stop();
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
        finish(asError(error, 'Recorder chunk admission failed.'));
      }
    };
    input.recorder.onerror = () => {
      stopImmediately();
      finish(new Error('MediaRecorder failed.'));
    };
    input.recorder.onstop = () => finish();
    input.source.onended = beginFinalization;
    input.signal.addEventListener('abort', onAbort, { once: true });
    input.recorder.start(MEDIA_RECORDER_LIMITS.requestedChunkCadenceMs);
    input.source.start(0);
    input.source.stop(input.durationSeconds);
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Aborted', 'AbortError');
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}
