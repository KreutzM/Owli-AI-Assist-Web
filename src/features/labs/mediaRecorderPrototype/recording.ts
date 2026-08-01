import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import type { MemoryTracker } from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import type { PrototypeAttemptLifecycle } from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';
import type { PrototypeAttemptResources } from '@/features/labs/mediaRecorderPrototype/runAttempt';
import type {
  PrototypeAttemptEvidence,
  PrototypeRecorderCandidate,
} from '@/features/labs/mediaRecorderPrototype/types';

export async function recordCanvasAudio(input: {
  canvas: HTMLCanvasElement;
  destination: MediaStreamAudioDestinationNode;
  source: AudioBufferSourceNode;
  candidate: PrototypeRecorderCandidate;
  resources: PrototypeAttemptResources;
  attempt: PrototypeAttemptEvidence;
  memory: MemoryTracker;
  lifecycle: PrototypeAttemptLifecycle;
  durationMs: number;
  onRecordingStart?(): void;
}): Promise<{
  outputBlob: Blob;
  renderStartedAt: number;
  finalizationStartedAt: number;
}> {
  const canvasStream = input.canvas.captureStream(30);
  input.resources.canvasStream = canvasStream;
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...input.destination.stream.getAudioTracks(),
  ]);
  input.resources.stream = stream;
  const recorder = new MediaRecorder(stream, { mimeType: input.candidate.mimeType });
  input.resources.recorder = recorder;

  const chunkTimes: number[] = [];
  const chunkSizes: number[] = [];
  const chunks: Blob[] = [];
  let chunkBytes = 0;
  let renderStartedAt = 0;
  let finalizationStartedAt = 0;
  let stopped = false;

  const stopRecorder = () => {
    if (stopped || recorder.state === 'inactive') return;
    stopped = true;
    finalizationStartedAt = performance.now();
    recorder.stop();
  };

  const outputBlob = await input.lifecycle.run(
    new Promise<Blob>((resolve, reject) => {
      const onAbort = () => {
        reject(
          input.lifecycle.signal.reason instanceof Error
            ? input.lifecycle.signal.reason
            : new DOMException('aborted', 'AbortError'),
        );
        stopRecorder();
      };
      const cleanup = () => {
        input.lifecycle.signal.removeEventListener('abort', onAbort);
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        input.source.onended = null;
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const now = performance.now();
        chunkTimes.push(now);
        chunkSizes.push(event.data.size);
        chunkBytes += event.data.size;
        input.memory.set('chunkBytes', chunkBytes);
        input.attempt.memory.chunkBytes = chunkBytes;
        if (event.data.size > PROTOTYPE_LIMITS.maxChunkBytes) {
          cleanup();
          reject(new Error(`Chunk ${event.data.size} exceeds the per-chunk failure envelope.`));
          stopRecorder();
          return;
        }
        if (chunkBytes > PROTOTYPE_LIMITS.hardOutputBytes) {
          cleanup();
          reject(
            new Error(
              `Delivered chunks exceed the ${PROTOTYPE_LIMITS.hardOutputBytes} byte hard limit.`,
            ),
          );
          stopRecorder();
          return;
        }
        chunks.push(event.data);
      };
      recorder.onerror = () => {
        cleanup();
        reject(new Error('MediaRecorder failed.'));
      };
      recorder.onstop = () => {
        cleanup();
        resolve(new Blob(chunks, { type: recorder.mimeType || input.candidate.mimeType }));
      };
      input.source.onended = () => stopRecorder();
      input.lifecycle.signal.addEventListener('abort', onAbort, { once: true });
      renderStartedAt = performance.now();
      recorder.start(PROTOTYPE_LIMITS.requestedChunkCadenceMs);
      input.source.start(0);
      input.onRecordingStart?.();
    }),
    input.durationMs + PROTOTYPE_LIMITS.renderSlackMs,
    'Render deadline exceeded.',
  );

  input.attempt.chunkIntervalsMs = chunkTimes.map((value, index) =>
    index === 0 ? Math.round(value - renderStartedAt) : Math.round(value - chunkTimes[index - 1]!),
  );
  input.attempt.chunkSizes = chunkSizes;
  return { outputBlob, renderStartedAt, finalizationStartedAt };
}
