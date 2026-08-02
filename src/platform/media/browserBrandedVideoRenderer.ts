import { BoundedRecorderChunks } from '@/platform/media/boundedRecorderChunks';
import { BRANDED_VIDEO_CANVAS, drawBrandedVideoFrame } from '@/platform/media/brandedVideoFrame';
import { recordAudioCanvas } from '@/platform/media/browserRecorderSession';
import { validateBrandedVideoOutput } from '@/platform/media/browserBrandedVideoValidation';
import {
  BRANDED_VIDEO_DURATION_DRIFT_MS,
  BRANDED_VIDEO_TOTAL_SLACK_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/webm;codecs=vp9,opus',
] as const;
const OUTPUT_FILE_NAME = 'owli-audio-postcard.webm';
let activeRenderToken: symbol | undefined;

interface BrandedVideoRenderInput {
  imageBlob: Blob;
  logoBlob: Blob;
  audioBlob: Blob;
  expectedDurationMs: number;
  signal: AbortSignal;
}

export async function renderBrandedVideo(values: BrandedVideoRenderInput): Promise<File> {
  assertInput(values);
  if (activeRenderToken) {
    throw new Error('A branded video render is already active in this tab.');
  }
  const token = Symbol('branded-video-render');
  activeRenderToken = token;

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(values.signal.reason);
  if (values.signal.aborted) {
    forwardAbort();
  } else {
    values.signal.addEventListener('abort', forwardAbort, { once: true });
  }
  const totalDeadline = window.setTimeout(
    () => controller.abort(new DOMException('Video render deadline exceeded.', 'TimeoutError')),
    values.expectedDurationMs + BRANDED_VIDEO_TOTAL_SLACK_MS,
  );

  let scene: ImageBitmap | undefined;
  let logo: ImageBitmap | undefined;
  let audioContext: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let destination: MediaStreamAudioDestinationNode | undefined;
  let stream: MediaStream | undefined;
  let canvasStream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let collector: BoundedRecorderChunks | undefined;
  try {
    controller.signal.throwIfAborted();
    const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) {
      throw new Error('No approved WebM MediaRecorder candidate is supported.');
    }

    [scene, logo] = await withDeadline(
      Promise.all([createImageBitmap(values.imageBlob), createImageBitmap(values.logoBlob)]),
      MEDIA_RECORDER_LIMITS.initializationDeadlineMs,
      controller.signal,
      'Image initialization deadline exceeded.',
    );
    if (Math.max(scene.width, scene.height) > MEDIA_RECORDER_LIMITS.maxSourceLongEdgePx) {
      throw new Error('Scene image exceeds the Candidate A normalization limit.');
    }

    audioContext = new AudioContext();
    const audioBuffer = await withDeadline(
      audioContext.decodeAudioData(await values.audioBlob.arrayBuffer()),
      MEDIA_RECORDER_LIMITS.initializationDeadlineMs,
      controller.signal,
      'Audio initialization deadline exceeded.',
    );
    assertDecodedAudio(audioBuffer, values.expectedDurationMs);
    await audioContext.resume();

    const canvas = document.createElement('canvas');
    canvas.width = BRANDED_VIDEO_CANVAS.width;
    canvas.height = BRANDED_VIDEO_CANVAS.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('2D canvas unavailable.');
    const layout = drawBrandedVideoFrame(context, scene, logo);

    destination = audioContext.createMediaStreamDestination();
    source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(destination);
    canvasStream = canvas.captureStream(30);
    stream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
    });

    const canvasBytes = canvas.width * canvas.height * 4;
    const decodedPcmBytes =
      audioBuffer.length * audioBuffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    collector = new BoundedRecorderChunks(
      values.imageBlob.size +
        values.logoBlob.size +
        values.audioBlob.size +
        canvasBytes +
        decodedPcmBytes,
    );
    const outputBlob = await recordAudioCanvas({
      recorder,
      source,
      stream,
      collector,
      durationSeconds: audioBuffer.duration,
      signal: controller.signal,
    });
    controller.signal.throwIfAborted();
    const outputFile = new File([outputBlob], OUTPUT_FILE_NAME, {
      type: outputBlob.type,
    });
    await validateBrandedVideoOutput({
      blob: outputFile,
      fileName: outputFile.name,
      expectedDurationMs: values.expectedDurationMs,
      referenceCanvas: canvas,
      layout,
      signal: controller.signal,
    });
    controller.signal.throwIfAborted();
    return outputFile;
  } finally {
    window.clearTimeout(totalDeadline);
    values.signal.removeEventListener('abort', forwardAbort);
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // The recorder may already be stopping after an abort or limit violation.
        }
      }
    }
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have reached its scheduled stop.
      }
      source.disconnect();
    }
    destination?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    canvasStream?.getTracks().forEach((track) => track.stop());
    collector?.clear();
    scene?.close();
    logo?.close();
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close();
    }
    if (activeRenderToken === token) activeRenderToken = undefined;
  }
}

function assertInput(values: BrandedVideoRenderInput): void {
  if (
    !Number.isFinite(values.expectedDurationMs) ||
    values.expectedDurationMs <= 0 ||
    values.expectedDurationMs > MEDIA_RECORDER_LIMITS.maxDurationMs
  ) {
    throw new Error('Audio duration is outside the Candidate A limit.');
  }
  if (
    values.audioBlob.size <= 0 ||
    values.audioBlob.size > MEDIA_RECORDER_LIMITS.hardCompressedInputBytes
  ) {
    throw new Error('Compressed audio is outside the Candidate A input limit.');
  }
  if (values.imageBlob.size <= 0 || values.logoBlob.size <= 0) {
    throw new Error('Scene image and canonical logo are required.');
  }
}

function assertDecodedAudio(buffer: AudioBuffer, expectedDurationMs: number): void {
  const decodedPcmBytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  if (
    buffer.duration <= 0 ||
    buffer.numberOfChannels <= 0 ||
    buffer.numberOfChannels > MEDIA_RECORDER_LIMITS.maxChannels ||
    buffer.sampleRate > MEDIA_RECORDER_LIMITS.maxSampleRateHz ||
    decodedPcmBytes > MEDIA_RECORDER_LIMITS.maxDecodedPcmBytes ||
    Math.abs(buffer.duration * 1_000 - expectedDurationMs) > BRANDED_VIDEO_DURATION_DRIFT_MS
  ) {
    throw new Error('Decoded audio violates the Audio-Postcard or Candidate A contract.');
  }
  let energy = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const stride = Math.max(1, Math.floor(data.length / 20_000));
    for (let index = 0; index < data.length; index += stride) {
      const value = data[index] ?? 0;
      energy += value * value;
      count += 1;
    }
  }
  if (count === 0 || Math.sqrt(energy / count) < 0.0001) {
    throw new Error('Decoded Audio-Postcard is empty or silent.');
  }
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  message: string,
): Promise<T> {
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(undefined, new Error(message)), timeoutMs);
    const onAbort = () => finish(undefined, abortReason(signal));
    const finish = (value?: T, error?: Error) => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value as T);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(value),
      (error) => finish(undefined, asError(error, message)),
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}
