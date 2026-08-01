import { loadPrototypeFixturePair, throwIfAborted } from '@/core/api/prototypeFixtureAssets';
import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import {
  assertAdmission,
  assertOutputContainer,
  createAttemptDraft,
  estimateImageBitmapBytes,
  MemoryTracker,
} from '@/features/labs/mediaRecorderPrototype/attemptSupport';
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
  PrototypeRecorderCandidate,
  PrototypeScenario,
} from '@/features/labs/mediaRecorderPrototype/types';

const OUTPUT_SUFFIX_BY_MIME: Record<string, string> = {
  'video/webm': 'webm',
  'video/webm;codecs=vp8,opus': 'webm',
  'video/webm;codecs=vp9,opus': 'webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2': 'mp4',
};

export class PrototypeAttemptCancelledError extends Error {
  constructor(readonly attempt: PrototypeAttemptEvidence) {
    super('Prototype attempt cancelled.');
  }
}

export async function runScenarioAttempt(input: {
  attemptId: number;
  scenario: PrototypeScenario;
  candidate: PrototypeRecorderCandidate;
  signal: AbortSignal;
  onResourceUpdate(resources: PrototypeAttemptResources): void;
  onRecordingStart?(): void;
}): Promise<{
  attempt: PrototypeAttemptEvidence;
  verifiedFixtures: Array<{
    fixtureId: string;
    kind: 'image' | 'audio';
    fileName: string;
    sha256: string;
    sizeBytes: number;
    verified: boolean;
  }>;
}> {
  const { image, audio } = getMediaRecorderScenarioFixtures(input.scenario);
  const startedAt = new Date().toISOString();
  const initializationStart = performance.now();
  const memory = new MemoryTracker();
  const resources: PrototypeAttemptResources = {};
  const lifecycle = new PrototypeAttemptLifecycle(input.signal);
  input.onResourceUpdate(resources);
  const attemptDraft = createAttemptDraft(
    input.attemptId,
    input.scenario,
    input.candidate,
    startedAt,
  );

  try {
    assertAdmission(
      image.longEdgePx <= PROTOTYPE_LIMITS.maxSourceLongEdgePx,
      `${image.id} exceeds the 1280px long-edge limit.`,
    );
    assertAdmission(
      audio.durationMs <= PROTOTYPE_LIMITS.maxDurationMs,
      `${audio.id} exceeds the 30-second duration limit.`,
    );
    assertAdmission(
      audio.sizeBytes <= PROTOTYPE_LIMITS.maxCompressedAudioBytes,
      `${audio.id} exceeds the 16 MiB compressed audio limit.`,
    );
    assertAdmission(
      image.sizeBytes <= PROTOTYPE_LIMITS.hardCompressedInputBytes,
      `${image.id} exceeds the hard compressed input limit.`,
    );
    assertAdmission(
      audio.sizeBytes <= PROTOTYPE_LIMITS.hardCompressedInputBytes,
      `${audio.id} exceeds the hard compressed input limit.`,
    );
    assertAdmission(
      audio.channels <= PROTOTYPE_LIMITS.maxChannels,
      `${audio.id} exceeds the channel limit.`,
    );
    assertAdmission(
      audio.sampleRateHz <= PROTOTYPE_LIMITS.maxSampleRateHz,
      `${audio.id} exceeds the sample-rate limit.`,
    );

    memory.set('imageBytes', image.sizeBytes);
    memory.set('compressedAudioBytes', audio.sizeBytes);
    attemptDraft.memory.inputBytes = image.sizeBytes + audio.sizeBytes;
    attemptDraft.memory.compressedAudioBytes = audio.sizeBytes;

    let loaded: Awaited<ReturnType<typeof loadPrototypeFixturePair>> | undefined =
      await lifecycle.run(
        loadPrototypeFixturePair(image, audio, lifecycle.signal),
        PROTOTYPE_LIMITS.initializationDeadlineMs,
        'Fixture loading deadline exceeded.',
      );
    throwIfAborted(lifecycle.signal);

    const verifiedFixtures = loaded.verifiedFixtures;
    const imageBlob = loaded.imageBlob;
    let encodedAudio = loaded.audioBuffer;
    loaded = undefined;

    const imageUrl = URL.createObjectURL(imageBlob);
    resources.imageUrl = imageUrl;
    const bitmapPromise = createImageBitmap(imageBlob);
    void bitmapPromise
      .then((lateBitmap) => {
        if (lifecycle.signal.aborted) lateBitmap.close();
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
    const imageBitmapBytes = estimateImageBitmapBytes(image);
    memory.set('imageBitmapBytes', imageBitmapBytes);
    attemptDraft.memory.imageBitmapBytes = imageBitmapBytes;

    const audioContext = new AudioContext({ sampleRate: audio.sampleRateHz });
    resources.audioContext = audioContext;
    await lifecycle.run(
      audioContext.resume(),
      PROTOTYPE_LIMITS.initializationDeadlineMs,
      'Audio context resume deadline exceeded.',
    );
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
    memory.set('decodedPcmBytes', estimatedDecodedPcmBytes);
    attemptDraft.memory.estimatedDecodedPcmBytes = estimatedDecodedPcmBytes;
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
    memory.set('canvasBytes', canvas.width * canvas.height * 4);
    attemptDraft.memory.canvasBytes = canvas.width * canvas.height * 4;

    const destination = audioContext.createMediaStreamDestination();
    resources.destination = destination;
    const source = audioContext.createBufferSource();
    source.buffer = decodedAudio;
    source.connect(destination);
    resources.source = source;

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
    const renderFinishedAt = performance.now();
    attemptDraft.initializationMs = Math.round(renderStartedAt - initializationStart);
    attemptDraft.renderMs = Math.round(
      (finalizationStartedAt || renderFinishedAt) - renderStartedAt,
    );
    attemptDraft.finalizationMs = Math.round(
      renderFinishedAt - (finalizationStartedAt || renderFinishedAt),
    );
    memory.set('finalBytes', outputBlob.size);
    attemptDraft.outputBytes = outputBlob.size;
    attemptDraft.memory.finalBytes = outputBlob.size;
    attemptDraft.memory.highWaterBytes = memory.highWater;
    assertAdmission(
      outputBlob.size <= PROTOTYPE_LIMITS.hardOutputBytes,
      'Output blob exceeds the hard 32 MiB limit.',
    );

    const outputMimeType = outputBlob.type;
    const containerInspection = await lifecycle.run(
      assertOutputContainer(outputBlob, outputMimeType, input.candidate),
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
    const validationStartedAt = performance.now();
    const validation = await lifecycle.run(
      validateRecording({
        blobUrl,
        image,
        audio,
        containerInspection,
        signal: lifecycle.signal,
      }),
      audio.durationMs + PROTOTYPE_LIMITS.finalizationDeadlineMs,
      'Validation deadline exceeded.',
    );
    throwIfAborted(lifecycle.signal);
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
    if (input.signal.aborted) {
      attemptDraft.cancelled = true;
      attemptDraft.status = 'FAIL';
      attemptDraft.finishedAt = new Date().toISOString();
      attemptDraft.totalMs = Math.round(performance.now() - initializationStart);
      attemptDraft.notes = ['Attempt was cancelled before safe completion.'];
      throw new PrototypeAttemptCancelledError(attemptDraft);
    }
    throw error;
  } finally {
    await lifecycle.settlePending();
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

export interface PrototypeAttemptResources {
  recorder?: MediaRecorder;
  stream?: MediaStream;
  canvasStream?: MediaStream;
  audioContext?: AudioContext;
  destination?: MediaStreamAudioDestinationNode;
  source?: AudioBufferSourceNode;
  blobUrl?: string;
  imageUrl?: string;
  imageBitmap?: ImageBitmap;
  canvas?: HTMLCanvasElement;
  cleanupPromise?: Promise<boolean>;
}
