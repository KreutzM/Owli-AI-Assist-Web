import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import {
  inspectRecordedContainer,
  matchRecordedCodecs,
} from '@/features/labs/mediaRecorderPrototype/containerInspection';
import type {
  PrototypeContainerInspection,
  PrototypeAttemptEvidence,
  PrototypeImageFixture,
  PrototypeRecorderCandidate,
  PrototypeScenario,
} from '@/features/labs/mediaRecorderPrototype/types';

export class MemoryTracker {
  #entries = new Map<string, number>();
  highWater = 0;

  set(key: string, value: number) {
    this.#entries.set(key, value);
    this.highWater = Math.max(this.highWater, this.currentTotal);
  }

  delete(key: string) {
    this.#entries.delete(key);
  }

  get currentTotal() {
    return [...this.#entries.values()].reduce((sum, value) => sum + value, 0);
  }
}

export function createAttemptDraft(
  attemptId: number,
  scenario: PrototypeScenario,
  candidate: PrototypeRecorderCandidate,
  startedAt: string,
): PrototypeAttemptEvidence {
  return {
    attemptId,
    scenarioId: scenario.id,
    scenarioOrder: scenario.order,
    imageId: scenario.imageId,
    audioId: scenario.audioId,
    candidateId: candidate.id,
    requestedMimeType: candidate.mimeType,
    outputMimeType: '',
    outputFileName: '',
    outputBytes: 0,
    status: 'FAIL',
    startedAt,
    finishedAt: startedAt,
    cancelled: false,
    cleanupCompleted: false,
    initializationMs: 0,
    renderMs: 0,
    finalizationMs: 0,
    validationMs: 0,
    totalMs: 0,
    chunkIntervalsMs: [],
    chunkSizes: [],
    requestedChunkCadenceMs: PROTOTYPE_LIMITS.requestedChunkCadenceMs,
    validation: {
      expectedDurationMs: 0,
      measuredDurationMs: 0,
      durationDriftMs: 0,
      width: 0,
      height: 0,
      aspectRatioDelta: 0,
      playbackSupported: false,
      seekingSupported: false,
      containerInspection: {
        container: candidate.fileExtension === 'mp4' ? 'mp4' : 'webm',
        seekingRequired: true,
        videoTrackCount: 0,
        audioTrackCount: 0,
        videoCodecs: [],
        audioCodecs: [],
        codecsMatchCandidate: false,
      },
      audioNonSilent: false,
      startMarkerDetected: false,
      endMarkerDetected: false,
      markerAnalysis: [],
      fixturePreflight: {
        audioNonSilent: false,
        startMarkerDetected: false,
        endMarkerDetected: false,
      },
      trackEvidence: {
        hasVisualFrames: false,
        hasAudibleFrames: false,
      },
      sampleChecks: [],
    },
    memory: {
      highWaterBytes: 0,
      finalBytes: 0,
      estimatedDecodedPcmBytes: 0,
      inputBytes: 0,
      chunkBytes: 0,
      canvasBytes: 0,
      compressedAudioBytes: 0,
      imageBitmapBytes: 0,
      mediaElementBytes: 0,
      transferBytes: 0,
    },
    playbackCapability: {
      download: 'unknown',
      fileShare: 'unknown',
    },
    notes: [],
  };
}

export function assertAdmission(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export async function assertOutputContainer(
  blob: Blob,
  mimeType: string,
  candidate: PrototypeRecorderCandidate,
): Promise<PrototypeContainerInspection> {
  if (!mimeType) throw new Error('Output MIME type is missing.');
  const inspection = await inspectRecordedContainer(blob, mimeType, candidate);
  const matched = matchRecordedCodecs(inspection, candidate);
  if (!matched.codecsMatchCandidate) {
    throw new Error('Recorded track codecs do not match the selected MediaRecorder candidate.');
  }
  return matched;
}

export function estimateImageBitmapBytes(image: PrototypeImageFixture) {
  return image.width * image.height * 4;
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  message: string,
  onTimeout?: (error: Error) => Error | void,
): Promise<T> {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Prototype attempt aborted.');
  }
  return await new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      const error = new Error(message);
      reject(onTimeout?.(error) ?? error);
    }, timeoutMs);
    const onAbort = () => {
      cleanup();
      reject(
        signal.reason instanceof Error ? signal.reason : new Error('Prototype attempt aborted.'),
      );
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error('Timed operation failed.'));
      },
    );
  });
}
