import { loadPrototypeFixturePair, throwIfAborted } from '@/core/api/prototypeFixtureAssets';
import { validatePrototypeAdmission } from '@/features/labs/mediaRecorderPrototype/attemptAdmission';
import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import {
  assertAdmission,
  assertOutputContainer,
  createAttemptDraft,
  estimateImageBitmapBytes,
  MemoryTracker,
} from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import { createAttemptFailedError } from '@/features/labs/mediaRecorderPrototype/attemptFailure';
import type { PrototypeAttemptFailedError } from '@/features/labs/mediaRecorderPrototype/attemptFailure';
import { PrototypeAttemptLifecycle } from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';
import { getMediaRecorderScenarioFixtures } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import { recordCanvasAudio } from '@/features/labs/mediaRecorderPrototype/recording';
import { analyzeFixtureAudioBuffer } from '@/features/labs/mediaRecorderPrototype/validationAudio';
import {
  determineAttemptStatus,
  validateRecording,
} from '@/features/labs/mediaRecorderPrototype/validation';
import type {
  PrototypeAttemptEvidence,
  PrototypeAttemptPhase,
  PrototypeAttemptResources,
  PrototypeRecorderCandidate,
  PrototypeScenario,
  PrototypeVerifiedFixtureEvidence,
} from '@/features/labs/mediaRecorderPrototype/types';

const OUTPUT_SUFFIX_BY_MIME: Record<string, string> = {
  'video/webm': 'webm',
  'video/webm;codecs=vp8,opus': 'webm',
  'video/webm;codecs=vp9,opus': 'webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2': 'mp4',
};

export async function runScenarioAttempt(input: {
  attemptId: number;
  scenario: PrototypeScenario;
  candidate: PrototypeRecorderCandidate;
  signal: AbortSignal;
  onResourceUpdate(resources: PrototypeAttemptResources): void;
  onRecordingStart?(): void;
}): Promise<{
  attempt: PrototypeAttemptEvidence;
  verifiedFixtures: PrototypeVerifiedFixtureEvidence[];
}> {
  const { image, audio } = getMediaRecorderScenarioFixtures(input.scenario);
  const startedAt = new Date().toISOString();
  const initializationStart = performance.now();
  const memory = new MemoryTracker();
  const resources: PrototypeAttemptResources = {};
  const lifecycle = new PrototypeAttemptLifecycle(input.attemptId, input.signal);
  input.onResourceUpdate(resources);
  const attemptDraft = createAttemptDraft(
    input.attemptId,
    input.scenario,
    input.candidate,
    startedAt,
  );
  let phase: PrototypeAttemptPhase = 'admission';
  let verifiedFixtures: PrototypeVerifiedFixtureEvidence[] = [];
  let failedError: PrototypeAttemptFailedError | undefined;

  try {
    validatePrototypeAdmission(image, audio);

    memory.set('imageBytes', image.sizeBytes);
    memory.set('compressedAudioBytes', audio.sizeBytes);
    attemptDraft.memory.inputBytes = image.sizeBytes + audio.sizeBytes;
    attemptDraft.memory.compressedAudioBytes = audio.sizeBytes;

    phase = 'fixture-load';
    let loaded: Awaited<ReturnType<typeof loadPrototypeFixturePair>> | undefined =
      await lifecycle.run(
        loadPrototypeFixturePair(image, audio, lifecycle.signal),
        PROTOTYPE_LIMITS.initializationDeadlineMs,
        'Fixture loading deadline exceeded.',
      );
    throwIfAborted(lifecycle.signal);

    verifiedFixtures = loaded.verifiedFixtures;
    const imageBlob = loaded.imageBlob;
    let encodedAudio = loaded.audioBuffer;
    loaded = undefined;

    const imageUrl = URL.createObjectURL(imageBlob);
    resources.imageUrl = imageUrl;
    phase = 'image-decode';
    const imageBitmapBytes = estimateImageBitmapBytes(image);
    memory.setWithinLimit(
      'imageBitmapBytes',
      imageBitmapBytes,
      'App-owned media bytes exceed the 64 MiB limit before image decode.',
    );
    attemptDraft.memory.imageBitmapBytes = imageBitmapBytes;
    const bitmapPromise = createImageBitmap(imageBlob);
    void bitmapPromise
      .then((lateBitmap) => {
        if (!lifecycle.accepts(input.attemptId)) lateBitmap.close();
      })
      .catch(() => undefined);
    const bitmap = await lifecycle.run(
      bitmapPromise,
      PROTOTYPE_LIMITS.initializationDeadlineMs,
      'Image bitmap creation deadline exceeded.',
    );
    if (lifecycle.signal.aborted) {
      bitmap.close();
      throwIfAborted(lifecycle.signal);
    }
    resources.imageBitmap = bitmap;

    phase = 'audio-context';
    const audioContext = new AudioContext({ sampleRate: audio.sampleRateHz });
    resources.audioContext = audioContext;
    await lifecycle.run(
      audioContext.resume(),
      PROTOTYPE_LIMITS.initializationDeadlineMs,
      'Audio context resume deadline exceeded.',
    );
    phase = 'audio-decode';
    const declaredDecodedPcmBytes = Math.ceil(
      (audio.durationMs / 1_000) * audio.sampleRateHz * audio.channels * 4,
    );
    assertAdmission(
      declaredDecodedPcmBytes <= PROTOTYPE_LIMITS.maxDecodedPcmBytes,
      'Declared PCM estimate exceeds the 12 MiB limit.',
    );
    memory.setWithinLimit(
      'decodedPcmBytes',
      declaredDecodedPcmBytes,
      'App-owned media bytes exceed the 64 MiB limit before audio decode.',
    );
    attemptDraft.memory.estimatedDecodedPcmBytes = declaredDecodedPcmBytes;
    const decodedAudio = await lifecycle.run(
      audioContext.decodeAudioData(encodedAudio),
      PROTOTYPE_LIMITS.initializationDeadlineMs,
      'Audio decode deadline exceeded.',
    );
    encodedAudio = new ArrayBuffer(0);
    memory.delete('compressedAudioBytes');
    attemptDraft.memory.compressedAudioBytes = 0;
    throwIfAborted(lifecycle.signal);
    const estimatedDecodedPcmBytes = decodedAudio.length * decodedAudio.numberOfChannels * 4;
    assertAdmission(
      estimatedDecodedPcmBytes <= PROTOTYPE_LIMITS.maxDecodedPcmBytes,
      'Decoded PCM estimate exceeds the 12 MiB limit.',
    );
    memory.delete('transferBytes');
    attemptDraft.memory.transferBytes = 0;
    memory.setWithinLimit(
      'decodedPcmBytes',
      estimatedDecodedPcmBytes,
      'App-owned media bytes exceed the 64 MiB limit after audio decode.',
    );
    attemptDraft.memory.estimatedDecodedPcmBytes = estimatedDecodedPcmBytes;
    phase = 'fixture-preflight';
    const fixturePreflight = analyzeFixtureAudioBuffer(decodedAudio, audio);
    attemptDraft.validation.fixturePreflight = {
      audioNonSilent: fixturePreflight.audioNonSilent,
      startMarkerDetected: fixturePreflight.startMarkerDetected,
      endMarkerDetected: fixturePreflight.endMarkerDetected,
      ...(fixturePreflight.startMarkerMs !== undefined
        ? { startMarkerMs: fixturePreflight.startMarkerMs }
        : {}),
      ...(fixturePreflight.endMarkerMs !== undefined
        ? { endMarkerMs: fixturePreflight.endMarkerMs }
        : {}),
    };
    assertAdmission(
      fixturePreflight.audioNonSilent &&
        fixturePreflight.startMarkerDetected &&
        fixturePreflight.endMarkerDetected,
      `Fixture preflight failed for ${audio.id}.`,
    );
    assertAdmission(
      memory.currentTotal <= PROTOTYPE_LIMITS.maxAppOwnedMediaBytes,
      'App-owned media bytes exceed the 64 MiB limit before recorder start.',
    );

    const canvasBytes = image.width * image.height * 4;
    memory.setWithinLimit(
      'canvasBytes',
      canvasBytes,
      'App-owned media bytes exceed the 64 MiB limit before canvas allocation.',
    );
    attemptDraft.memory.canvasBytes = canvasBytes;
    const canvas = document.createElement('canvas');
    resources.canvas = canvas;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas rendering context is unavailable.');
    context.drawImage(bitmap, 0, 0, image.width, image.height);
    bitmap.close();
    delete resources.imageBitmap;
    memory.delete('imageBitmapBytes');
    attemptDraft.memory.imageBitmapBytes = 0;

    const destination = audioContext.createMediaStreamDestination();
    resources.destination = destination;
    const source = audioContext.createBufferSource();
    source.buffer = decodedAudio;
    source.connect(destination);
    resources.source = source;

    phase = 'recording';
    attemptDraft.initializationMs = Math.round(performance.now() - initializationStart);
    const { outputBlob, renderStartedAt, finalizationStartedAt } = await recordCanvasAudio({
      canvas,
      destination,
      source,
      candidate: input.candidate,
      resources,
      attempt: attemptDraft,
      memory,
      lifecycle,
      durationMs: audio.durationMs,
      ...(input.onRecordingStart ? { onRecordingStart: () => input.onRecordingStart?.() } : {}),
    });

    throwIfAborted(lifecycle.signal);
    phase = 'finalization';
    const renderFinishedAt = performance.now();
    attemptDraft.initializationMs = Math.round(renderStartedAt - initializationStart);
    attemptDraft.renderMs = Math.round(
      (finalizationStartedAt || renderFinishedAt) - renderStartedAt,
    );
    attemptDraft.finalizationMs = Math.round(
      renderFinishedAt - (finalizationStartedAt || renderFinishedAt),
    );
    memory.setWithinLimit(
      'finalBytes',
      outputBlob.size,
      'App-owned media bytes exceed the 64 MiB limit after recorder finalization.',
    );
    attemptDraft.outputBytes = outputBlob.size;
    attemptDraft.memory.finalBytes = outputBlob.size;
    attemptDraft.memory.highWaterBytes = memory.highWater;
    assertAdmission(
      outputBlob.size <= PROTOTYPE_LIMITS.hardOutputBytes,
      'Output blob exceeds the hard 32 MiB limit.',
    );

    phase = 'container-inspection';
    const outputMimeType = outputBlob.type;
    const containerInspection = await lifecycle.run(
      assertOutputContainer(outputBlob, outputMimeType, input.candidate, (bytes) => {
        const release = memory.reserve(
          'containerInspectionBytes',
          bytes,
          'App-owned media bytes exceed the 64 MiB limit during container inspection.',
        );
        attemptDraft.memory.transferBytes = bytes;
        attemptDraft.memory.highWaterBytes = memory.highWater;
        return () => {
          release();
          attemptDraft.memory.transferBytes = 0;
        };
      }),
      PROTOTYPE_LIMITS.finalizationDeadlineMs,
      'Container inspection deadline exceeded.',
    );
    attemptDraft.outputMimeType = outputMimeType;
    attemptDraft.outputFileName = `${input.scenario.id}.${OUTPUT_SUFFIX_BY_MIME[input.candidate.mimeType] ?? 'bin'}`;
    attemptDraft.playbackCapability.fileShare = canShareOutputFile(
      new File([outputBlob], attemptDraft.outputFileName, { type: outputMimeType }),
    );

    const blobUrl = URL.createObjectURL(outputBlob);
    resources.blobUrl = blobUrl;
    phase = 'validation';
    memory.setWithinLimit(
      'validationCanvasBytes',
      canvasBytes,
      'App-owned media bytes exceed the 64 MiB limit before validation.',
    );
    attemptDraft.memory.mediaElementBytes = canvasBytes;
    attemptDraft.memory.highWaterBytes = memory.highWater;
    const validationStartedAt = performance.now();
    const validation = await lifecycle.run(
      validateRecording({
        blobUrl,
        image,
        audio,
        containerInspection,
        signal: lifecycle.signal,
        onVideoCreated(video) {
          resources.validationVideo = video;
        },
        onAudioContextCreated(context) {
          resources.validationAudioContext = context;
        },
      }),
      audio.durationMs + PROTOTYPE_LIMITS.finalizationDeadlineMs,
      'Validation deadline exceeded.',
    );
    throwIfAborted(lifecycle.signal);
    memory.delete('validationCanvasBytes');
    attemptDraft.memory.mediaElementBytes = 0;
    attemptDraft.validation = {
      ...validation,
      fixturePreflight: attemptDraft.validation.fixturePreflight,
    };
    attemptDraft.validationMs = Math.round(performance.now() - validationStartedAt);
    attemptDraft.status = determineAttemptStatus(validation);
    attemptDraft.notes = [
      outputBlob.size > PROTOTYPE_LIMITS.targetOutputBytes
        ? 'Output exceeds the 16 MiB target and remains within the hard 32 MiB limit.'
        : 'Output remains within the 16 MiB target.',
    ];
    attemptDraft.totalMs = Math.round(performance.now() - initializationStart);
    attemptDraft.finishedAt = new Date().toISOString();
    attemptDraft.memory.highWaterBytes = memory.highWater;
    attemptDraft.cleanupCompleted = false;
    return { attempt: attemptDraft, verifiedFixtures };
  } catch (error) {
    const cancelled = input.signal.aborted;
    failedError = createAttemptFailedError({
      attempt: attemptDraft,
      cause: error,
      phase,
      initializationStart,
      memoryHighWaterBytes: memory.highWater,
      cancelled,
      verifiedFixtures,
    });
    throw failedError;
  } finally {
    const pendingOperationsSettled = await lifecycle.settlePending(
      PROTOTYPE_LIMITS.pendingQuarantineMs,
    );
    if (failedError?.attempt.failure) {
      failedError.attempt.failure.pendingOperationsSettled = pendingOperationsSettled;
      if (!pendingOperationsSettled) {
        failedError.attempt.notes.push(
          `One or more browser operations exceeded the ${PROTOTYPE_LIMITS.pendingQuarantineMs} ms quarantine; late results are discarded for attempt ${input.attemptId}.`,
        );
      }
    }
    lifecycle.dispose(input.signal);
  }
}

function canShareOutputFile(file: File): 'supported' | 'unsupported' | 'unknown' {
  if (typeof navigator.canShare !== 'function') return 'unsupported';
  try {
    return navigator.canShare({ files: [file] }) ? 'supported' : 'unsupported';
  } catch {
    return 'unknown';
  }
}
