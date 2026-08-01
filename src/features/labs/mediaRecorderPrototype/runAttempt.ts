import {
  loadPrototypeFixturePair,
  throwIfAborted,
} from '@/core/api/prototypeFixtureAssets';
import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import {
  assertAdmission,
  assertOutputContainer,
  createAttemptDraft,
  estimateImageBitmapBytes,
  MemoryTracker,
  withTimeout,
} from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import { getMediaRecorderScenarioFixtures } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import { determineAttemptStatus, validateRecording } from '@/features/labs/mediaRecorderPrototype/validation';
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
  input.onResourceUpdate(resources);
  const attemptDraft = createAttemptDraft(input.attemptId, input.scenario, input.candidate, startedAt);

  try {
    assertAdmission(image.longEdgePx <= PROTOTYPE_LIMITS.maxSourceLongEdgePx, `${image.id} exceeds the 1280px long-edge limit.`);
    assertAdmission(audio.durationMs <= PROTOTYPE_LIMITS.maxDurationMs, `${audio.id} exceeds the 30-second duration limit.`);
    assertAdmission(audio.sizeBytes <= PROTOTYPE_LIMITS.maxCompressedAudioBytes, `${audio.id} exceeds the 16 MiB compressed audio limit.`);
    assertAdmission(image.sizeBytes <= PROTOTYPE_LIMITS.hardCompressedInputBytes, `${image.id} exceeds the hard compressed input limit.`);
    assertAdmission(audio.sizeBytes <= PROTOTYPE_LIMITS.hardCompressedInputBytes, `${audio.id} exceeds the hard compressed input limit.`);
    assertAdmission(audio.channels <= PROTOTYPE_LIMITS.maxChannels, `${audio.id} exceeds the channel limit.`);
    assertAdmission(audio.sampleRateHz <= PROTOTYPE_LIMITS.maxSampleRateHz, `${audio.id} exceeds the sample-rate limit.`);

    memory.set('imageBytes', image.sizeBytes);
    memory.set('compressedAudioBytes', audio.sizeBytes);
    attemptDraft.memory.inputBytes = image.sizeBytes + audio.sizeBytes;
    attemptDraft.memory.compressedAudioBytes = audio.sizeBytes;

    const loaded = await withTimeout(
      loadPrototypeFixturePair(image, audio, input.signal),
      PROTOTYPE_LIMITS.initializationDeadlineMs,
      input.signal,
      'Fixture loading deadline exceeded.',
    );
    throwIfAborted(input.signal);

    const imageUrl = URL.createObjectURL(loaded.imageBlob);
    resources.imageUrl = imageUrl;
    const bitmap = await createImageBitmap(loaded.imageBlob);
    throwIfAborted(input.signal);
    resources.imageBitmap = bitmap;
    const imageBitmapBytes = estimateImageBitmapBytes(image);
    memory.set('imageBitmapBytes', imageBitmapBytes);
    attemptDraft.memory.imageBitmapBytes = imageBitmapBytes;

    const audioContext = new AudioContext({ sampleRate: audio.sampleRateHz });
    resources.audioContext = audioContext;
    await audioContext.resume();
    const decodeInput = loaded.audioBuffer.slice(0);
    memory.set('transferBytes', decodeInput.byteLength);
    attemptDraft.memory.transferBytes = decodeInput.byteLength;
    const decodedAudio = await withTimeout(
      audioContext.decodeAudioData(decodeInput),
      PROTOTYPE_LIMITS.initializationDeadlineMs,
      input.signal,
      'Audio decode deadline exceeded.',
    );
    throwIfAborted(input.signal);
    const estimatedDecodedPcmBytes = decodedAudio.length * decodedAudio.numberOfChannels * 4;
    assertAdmission(
      estimatedDecodedPcmBytes <= PROTOTYPE_LIMITS.maxDecodedPcmBytes,
      'Decoded PCM estimate exceeds the 12 MiB limit.',
    );
    memory.delete('transferBytes');
    attemptDraft.memory.transferBytes = 0;
    memory.set('decodedPcmBytes', estimatedDecodedPcmBytes);
    attemptDraft.memory.estimatedDecodedPcmBytes = estimatedDecodedPcmBytes;
    assertAdmission(
      memory.currentTotal <= PROTOTYPE_LIMITS.maxAppOwnedMediaBytes,
      'App-owned media bytes exceed the 64 MiB limit before recorder start.',
    );

    const canvas = document.createElement('canvas');
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

    const canvasStream = canvas.captureStream(30);
    resources.canvasStream = canvasStream;
    const destination = audioContext.createMediaStreamDestination();
    resources.destination = destination;
    const source = audioContext.createBufferSource();
    source.buffer = decodedAudio;
    source.connect(destination);
    resources.source = source;

    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    resources.stream = stream;
    const recorder = new MediaRecorder(stream, { mimeType: input.candidate.mimeType });
    resources.recorder = recorder;

    const chunkTimes: number[] = [];
    const chunkSizes: number[] = [];
    const chunks: Blob[] = [];
    let chunkBytes = 0;
    let renderStartedAt = 0;
    let renderFinishedAt = 0;
    let finalizingStartedAt = 0;
    let stopped = false;

    const stopRecorder = () => {
      if (stopped || recorder.state === 'inactive') return;
      stopped = true;
      recorder.stop();
    };

    const outputBlob = await new Promise<Blob>((resolve, reject) => {
      const renderDeadline = window.setTimeout(() => {
        reject(new Error('Render deadline exceeded.'));
        stopRecorder();
      }, audio.durationMs + PROTOTYPE_LIMITS.renderSlackMs);
      const onAbort = () => {
        reject(input.signal.reason instanceof Error ? input.signal.reason : new DOMException('aborted', 'AbortError'));
        stopRecorder();
      };
      const cleanup = () => {
        window.clearTimeout(renderDeadline);
        input.signal.removeEventListener('abort', onAbort);
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        source.onended = null;
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const now = performance.now();
        chunkTimes.push(now);
        chunkSizes.push(event.data.size);
        chunkBytes += event.data.size;
        memory.set('chunkBytes', chunkBytes);
        attemptDraft.memory.chunkBytes = chunkBytes;
        if (event.data.size > PROTOTYPE_LIMITS.maxChunkBytes) {
          cleanup();
          reject(new Error(`Chunk ${event.data.size} exceeds the per-chunk failure envelope.`));
          stopRecorder();
          return;
        }
        if (chunkBytes > PROTOTYPE_LIMITS.hardOutputBytes) {
          cleanup();
          reject(new Error(`Delivered chunks exceed the ${PROTOTYPE_LIMITS.hardOutputBytes} byte hard limit.`));
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
      source.onended = () => stopRecorder();
      input.signal.addEventListener('abort', onAbort, { once: true });
      renderStartedAt = performance.now();
      recorder.start(PROTOTYPE_LIMITS.requestedChunkCadenceMs);
      source.start(0);
    });

    throwIfAborted(input.signal);
    renderFinishedAt = performance.now();
    finalizingStartedAt = performance.now();
    attemptDraft.initializationMs = Math.round(renderStartedAt - initializationStart);
    attemptDraft.renderMs = Math.round(renderFinishedAt - renderStartedAt);
    memory.set('finalBytes', outputBlob.size);
    attemptDraft.outputBytes = outputBlob.size;
    attemptDraft.memory.finalBytes = outputBlob.size;
    attemptDraft.memory.highWaterBytes = memory.highWater;
    assertAdmission(outputBlob.size <= PROTOTYPE_LIMITS.hardOutputBytes, 'Output blob exceeds the hard 32 MiB limit.');

    const outputMimeType = outputBlob.type;
    await assertOutputContainer(outputBlob, outputMimeType, input.candidate.fileExtension);
    attemptDraft.outputMimeType = outputMimeType;
    attemptDraft.outputFileName = `${input.scenario.id}.${OUTPUT_SUFFIX_BY_MIME[input.candidate.mimeType] ?? 'bin'}`;

    const blobUrl = URL.createObjectURL(outputBlob);
    resources.blobUrl = blobUrl;
    const validation = await withTimeout(
      validateRecording({ blobUrl, image, audio, signal: input.signal }),
      audio.durationMs + PROTOTYPE_LIMITS.finalizationDeadlineMs,
      input.signal,
      'Validation deadline exceeded.',
    );
    throwIfAborted(input.signal);
    attemptDraft.validation = validation;
    attemptDraft.status = determineAttemptStatus(validation);
    attemptDraft.chunkIntervalsMs = chunkTimes.map((value, index) =>
      index === 0 ? Math.round(value - renderStartedAt) : Math.round(value - chunkTimes[index - 1]!),
    );
    attemptDraft.chunkSizes = chunkSizes;
    attemptDraft.notes = [
      outputBlob.size > PROTOTYPE_LIMITS.targetOutputBytes
        ? 'Output exceeds the 16 MiB target and remains within the hard 32 MiB limit.'
        : 'Output remains within the 16 MiB target.',
    ];
    attemptDraft.finalizationMs = Math.round(performance.now() - finalizingStartedAt);
    attemptDraft.totalMs = Math.round(performance.now() - initializationStart);
    attemptDraft.finishedAt = new Date().toISOString();
    attemptDraft.memory.highWaterBytes = memory.highWater;
    attemptDraft.cleanupCompleted = false;
    return { attempt: attemptDraft, verifiedFixtures: loaded.verifiedFixtures };
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
}
