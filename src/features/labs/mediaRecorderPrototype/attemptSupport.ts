import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import type {
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
      download: true,
      fileShare: false,
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
  expectedSuffix: string,
): Promise<void> {
  if (!mimeType) throw new Error('Output MIME type is missing.');
  if (expectedSuffix === 'webm' && !mimeType.startsWith('video/webm')) {
    throw new Error('WebM output was mislabeled.');
  }
  if (expectedSuffix === 'mp4' && !mimeType.startsWith('video/mp4')) {
    throw new Error('MP4 output was mislabeled.');
  }
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (expectedSuffix === 'webm' && !isWebm(bytes)) {
    throw new Error('WebM output is missing the EBML container signature.');
  }
  if (expectedSuffix === 'mp4' && !isMp4(bytes)) {
    throw new Error('MP4 output is missing the ftyp container signature.');
  }
}

export function estimateImageBitmapBytes(image: PrototypeImageFixture) {
  return image.width * image.height * 4;
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  message: string,
): Promise<T> {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Prototype attempt aborted.');
  }
  return await new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(message));
    }, timeoutMs);
    const onAbort = () => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('Prototype attempt aborted.'));
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

function isWebm(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

function isMp4(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}
