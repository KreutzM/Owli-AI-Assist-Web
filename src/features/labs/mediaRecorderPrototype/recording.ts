import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import type { MemoryTracker } from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import type { PrototypeAttemptLifecycle } from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';
import type {
  PrototypeAttemptEvidence,
  PrototypeAttemptResources,
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

  const chunks: Blob[] = [];
  let chunkBytes = 0;
  let previousChunkAt: number | undefined;
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
        input.attempt.chunkIntervalsMs.push(Math.round(now - (previousChunkAt ?? renderStartedAt)));
        input.attempt.chunkSizes.push(event.data.size);
        previousChunkAt = now;
        chunkBytes += event.data.size;
        try {
          input.memory.setWithinLimit(
            'chunkBytes',
            chunkBytes,
            'App-owned media bytes exceed the 64 MiB limit while collecting recorder chunks.',
          );
          input.attempt.memory.chunkBytes = chunkBytes;
          input.attempt.memory.highWaterBytes = input.memory.highWater;
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error('Recorder memory admission failed.'));
          stopRecorder();
          return;
        }
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
        try {
          input.memory.transfer(
            'chunkBytes',
            'finalBytes',
            chunkBytes,
            'App-owned media bytes exceed the 64 MiB limit before final blob creation.',
          );
          input.attempt.memory.finalBytes = chunkBytes;
          input.attempt.memory.highWaterBytes = input.memory.highWater;
          resolve(new Blob(chunks, { type: recorder.mimeType || input.candidate.mimeType }));
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Final blob memory admission failed.'));
        }
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

  return { outputBlob, renderStartedAt, finalizationStartedAt };
}
