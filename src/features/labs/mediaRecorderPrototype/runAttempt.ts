import { loadPrototypeFixturePair } from '@/core/api/prototypeFixtureAssets';
import { getMediaRecorderScenarioFixtures } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import { determineAttemptStatus, validateRecording } from '@/features/labs/mediaRecorderPrototype/validation';
import type {
  PrototypeAttemptEvidence,
  PrototypeRecorderCandidate,
  PrototypeScenario,
} from '@/features/labs/mediaRecorderPrototype/types';

const MAX_SOURCE_LONG_EDGE_PX = 1280;
const MAX_DURATION_MS = 30_000;
const TARGET_OUTPUT_BYTES = 16 * 1024 * 1024;
const HARD_OUTPUT_BYTES = 32 * 1024 * 1024;
const HARD_INPUT_BYTES = 32 * 1024 * 1024;
const MEDIARECORDER_INPUT_BYTES = 24 * 1024 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_APP_OWNED_BYTES = 80 * 1024 * 1024;
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
  isCancelled: () => boolean;
  setRecorder(value: MediaRecorder | undefined): void;
  setStream(value: MediaStream | undefined): void;
  setCanvasStream(value: MediaStream | undefined): void;
  setAudioContext(value: AudioContext | undefined): void;
  setDestination(value: MediaStreamAudioDestinationNode | undefined): void;
  setSource(value: AudioBufferSourceNode | undefined): void;
  setBlobUrl(value: string | undefined): void;
  setImageUrl(value: string | undefined): void;
}): Promise<PrototypeAttemptEvidence> {
  const { image, audio } = getMediaRecorderScenarioFixtures(input.scenario);
  assertAdmission(image.longEdgePx <= MAX_SOURCE_LONG_EDGE_PX, `${image.id} exceeds the 1280px long-edge limit.`);
  assertAdmission(audio.durationMs <= MAX_DURATION_MS, `${audio.id} exceeds the 30-second duration limit.`);
  assertAdmission(image.sizeBytes <= HARD_INPUT_BYTES, `${image.id} exceeds the hard compressed input limit.`);
  assertAdmission(audio.sizeBytes <= HARD_INPUT_BYTES, `${audio.id} exceeds the hard compressed input limit.`);
  assertAdmission(image.sizeBytes + audio.sizeBytes <= MEDIARECORDER_INPUT_BYTES, 'Fixture pair exceeds the MediaRecorder admission limit.');

  const startedAt = new Date().toISOString();
  const initializationStart = performance.now();
  const memory = new MemoryTracker();
  memory.set('imageBytes', image.sizeBytes);
  memory.set('audioInputBytes', audio.sizeBytes);

  const { imageBlob, audioBuffer } = await loadPrototypeFixturePair(image.path, audio.path);
  const imageUrl = URL.createObjectURL(imageBlob);
  input.setImageUrl(imageUrl);
  const bitmap = await createImageBitmap(imageBlob);
  const audioContext = new AudioContext({ sampleRate: audio.sampleRateHz });
  input.setAudioContext(audioContext);
  await audioContext.resume();
  const decodedAudio = await audioContext.decodeAudioData(audioBuffer.slice(0));
  const estimatedDecodedPcmBytes = decodedAudio.length * decodedAudio.numberOfChannels * 4;
  memory.set('decodedPcmBytes', estimatedDecodedPcmBytes);
  assertAdmission(
    estimatedDecodedPcmBytes + image.sizeBytes + audio.sizeBytes < MAX_APP_OWNED_BYTES,
    'Decoded audio and input bytes exceed the prototype memory envelope.',
  );

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  memory.set('canvasBytes', canvas.width * canvas.height * 4);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas rendering context is unavailable.');
  context.drawImage(bitmap, 0, 0, image.width, image.height);
  bitmap.close();

  const canvasStream = canvas.captureStream(30);
  input.setCanvasStream(canvasStream);
  const destination = audioContext.createMediaStreamDestination();
  input.setDestination(destination);
  const source = audioContext.createBufferSource();
  source.buffer = decodedAudio;
  source.connect(destination);
  input.setSource(source);

  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  input.setStream(stream);
  const recorder = new MediaRecorder(stream, { mimeType: input.candidate.mimeType });
  input.setRecorder(recorder);
  const chunkTimes: number[] = [];
  const chunkSizes: number[] = [];
  const chunks: Blob[] = [];
  let chunkBytes = 0;
  let renderStartedAt = 0;
  let renderFinishedAt = 0;
  let finalizingStartedAt = 0;

  const outputBlob = await new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      const now = performance.now();
      chunkTimes.push(now);
      chunkSizes.push(event.data.size);
      chunkBytes += event.data.size;
      memory.set('chunkBytes', chunkBytes);
      if (event.data.size > MAX_CHUNK_BYTES) {
        reject(new Error(`Chunk ${event.data.size} exceeds the per-chunk failure envelope.`));
        recorder.stop();
        return;
      }
      if (chunkBytes > HARD_OUTPUT_BYTES) {
        reject(new Error(`Delivered chunks exceed the ${HARD_OUTPUT_BYTES} byte hard limit.`));
        recorder.stop();
        return;
      }
      chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error('MediaRecorder failed.'));
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || input.candidate.mimeType }));
    };
    renderStartedAt = performance.now();
    recorder.start(1_000);
    source.start(0);
    source.onended = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
  });

  renderFinishedAt = performance.now();
  finalizingStartedAt = performance.now();
  memory.set('finalBytes', outputBlob.size);
  assertAdmission(outputBlob.size <= HARD_OUTPUT_BYTES, 'Output blob exceeds the hard 32 MiB limit.');
  const outputMimeType = outputBlob.type;
  const outputFileName = `${input.scenario.id}.${OUTPUT_SUFFIX_BY_MIME[input.candidate.mimeType] ?? 'bin'}`;
  const blobUrl = URL.createObjectURL(outputBlob);
  input.setBlobUrl(blobUrl);
  const validation = await validateRecording({ blobUrl, image, audio });
  const status = determineAttemptStatus(validation);
  const finishedAt = new Date().toISOString();
  const chunkIntervalsMs = chunkTimes.map((value, index) =>
    index === 0 ? value - renderStartedAt : value - chunkTimes[index - 1]!,
  );
  return {
    attemptId: input.attemptId,
    scenarioId: input.scenario.id,
    scenarioOrder: input.scenario.order,
    imageId: image.id,
    audioId: audio.id,
    candidateId: input.candidate.id,
    requestedMimeType: input.candidate.mimeType,
    outputMimeType,
    outputFileName,
    outputBytes: outputBlob.size,
    status,
    startedAt,
    finishedAt,
    cancelled: input.isCancelled(),
    initializationMs: Math.round(renderStartedAt - initializationStart),
    renderMs: Math.round(renderFinishedAt - renderStartedAt),
    finalizationMs: Math.round(performance.now() - finalizingStartedAt),
    totalMs: Math.round(performance.now() - initializationStart),
    chunkIntervalsMs: chunkIntervalsMs.map((value) => Math.round(value)),
    chunkSizes,
    requestedChunkCadenceMs: 1_000,
    validation,
    memory: {
      highWaterBytes: memory.highWater,
      finalBytes: outputBlob.size,
      estimatedDecodedPcmBytes,
      inputBytes: image.sizeBytes + audio.sizeBytes,
      chunkBytes,
      canvasBytes: canvas.width * canvas.height * 4,
    },
    playbackCapability: {
      download: true,
      fileShare: canShareFile(outputFileName, outputBlob),
    },
    notes: [
      outputBlob.size > TARGET_OUTPUT_BYTES
        ? 'Output exceeds the 16 MiB target and remains within the hard 32 MiB limit.'
        : 'Output remains within the 16 MiB target.',
    ],
  };
}

class MemoryTracker {
  #entries = new Map<string, number>();
  highWater = 0;

  set(key: string, value: number) {
    this.#entries.set(key, value);
    this.highWater = Math.max(this.highWater, this.currentTotal);
  }

  get currentTotal() {
    return [...this.#entries.values()].reduce((sum, value) => sum + value, 0);
  }
}

function assertAdmission(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function canShareFile(name: string, blob: Blob): boolean {
  if (typeof navigator.canShare !== 'function' || typeof File === 'undefined') return false;
  try {
    return navigator.canShare({
      files: [new File([blob], name, { type: blob.type || 'application/octet-stream' })],
    });
  } catch {
    return false;
  }
}
