import { BoundedRecorderChunks } from '@/platform/media/boundedRecorderChunks';
import { BRANDED_VIDEO_CANVAS, drawBrandedVideoFrame } from '@/platform/media/brandedVideoFrame';
import { recordAudioCanvas } from '@/platform/media/browserRecorderSession';
import { validateBrandedVideoOutput } from '@/platform/media/browserBrandedVideoValidation';
import {
  BRANDED_VIDEO_DURATION_DRIFT_MS,
  BRANDED_VIDEO_TOTAL_SLACK_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';
import {
  BrandedVideoExportError,
  asUnknownBrandedVideoExportError,
  runWithBrandedVideoExportError,
  withBrandedVideoExportError,
} from '@/shared/media/brandedVideoExportError';
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
    throw new BrandedVideoExportError('VIDEO_SOURCE_ADMISSION_FAILED', 'source_admission');
  }
  const token = Symbol('branded-video-render');
  activeRenderToken = token;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(values.signal.reason);
  if (values.signal.aborted) forwardAbort();
  else values.signal.addEventListener('abort', forwardAbort, { once: true });
  const totalDeadline = window.setTimeout(
    () =>
      controller.abort(
        new BrandedVideoExportError(
          'VIDEO_RENDER_DEADLINE_EXCEEDED',
          'render_deadline',
        ),
      ),
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
    const mimeType = runWithBrandedVideoExportError(
      'VIDEO_RECORDER_UNSUPPORTED',
      'recorder_support',
      () => MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)),
    );
    if (!mimeType) {
      throw new BrandedVideoExportError('VIDEO_RECORDER_UNSUPPORTED', 'recorder_support');
    }
    [scene, logo] = await decodeBrandedBitmaps(
      values.imageBlob,
      values.logoBlob,
      controller.signal,
    );
    if (Math.max(scene.width, scene.height) > MEDIA_RECORDER_LIMITS.maxSourceLongEdgePx) {
      throw new BrandedVideoExportError('VIDEO_SOURCE_ADMISSION_FAILED', 'source_admission');
    }
    audioContext = runWithBrandedVideoExportError(
      'VIDEO_SOURCE_AUDIO_DECODE_FAILED',
      'source_audio_decode',
      () => new AudioContext(),
    );
    const audioBytes = await withBrandedVideoExportError(
      'VIDEO_SOURCE_AUDIO_DECODE_FAILED',
      'source_audio_decode',
      () => values.audioBlob.arrayBuffer(),
    );
    const audioBuffer = await withDeadline(
      withBrandedVideoExportError(
        'VIDEO_SOURCE_AUDIO_DECODE_FAILED',
        'source_audio_decode',
        () => audioContext!.decodeAudioData(audioBytes),
      ),
      MEDIA_RECORDER_LIMITS.initializationDeadlineMs,
      controller.signal,
      new BrandedVideoExportError(
        'VIDEO_SOURCE_AUDIO_DECODE_FAILED',
        'source_audio_decode',
      ),
    );
    assertDecodedAudio(audioBuffer, values.expectedDurationMs);
    await withBrandedVideoExportError(
      'VIDEO_SOURCE_AUDIO_DECODE_FAILED',
      'source_audio_decode',
      () => audioContext!.resume(),
    );
    const canvas = document.createElement('canvas');
    canvas.width = BRANDED_VIDEO_CANVAS.width;
    canvas.height = BRANDED_VIDEO_CANVAS.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new BrandedVideoExportError('VIDEO_SOURCE_ADMISSION_FAILED', 'source_admission');
    }
    const layout = runWithBrandedVideoExportError(
      'VIDEO_SOURCE_ADMISSION_FAILED',
      'source_admission',
      () => drawBrandedVideoFrame(context, scene!, logo!),
    );
    const recorderResources = runWithBrandedVideoExportError(
      'VIDEO_RECORDER_INITIALIZATION_FAILED',
      'recorder_initialization',
      () => {
        const nextDestination = audioContext!.createMediaStreamDestination();
        const nextSource = audioContext!.createBufferSource();
        nextSource.buffer = audioBuffer;
        nextSource.connect(nextDestination);
        const nextCanvasStream = canvas.captureStream(30);
        const nextStream = new MediaStream([
          ...nextCanvasStream.getVideoTracks(),
          ...nextDestination.stream.getAudioTracks(),
        ]);
        const nextRecorder = new MediaRecorder(nextStream, {
          mimeType,
          videoBitsPerSecond: 2_500_000,
        });
        return {
          destination: nextDestination,
          source: nextSource,
          canvasStream: nextCanvasStream,
          stream: nextStream,
          recorder: nextRecorder,
        };
      },
    );
    ({ destination, source, canvasStream, stream, recorder } = recorderResources);
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
    const outputBlob = await withBrandedVideoExportError(
      'VIDEO_RECORDING_FAILED',
      'recording',
      () =>
        recordAudioCanvas({
          recorder: recorder!,
          source: source!,
          stream: stream!,
          collector: collector!,
          durationSeconds: audioBuffer.duration,
          signal: controller.signal,
        }),
    );
    controller.signal.throwIfAborted();
    const outputFile = runWithBrandedVideoExportError(
      'VIDEO_RECORDER_FINALIZATION_FAILED',
      'recorder_finalization',
      () => new File([outputBlob], OUTPUT_FILE_NAME, { type: outputBlob.type }),
    );
    await withBrandedVideoExportError(
      'VIDEO_UNKNOWN_EXPORT_FAILURE',
      'unknown',
      () =>
        validateBrandedVideoOutput({
          blob: outputFile,
          fileName: outputFile.name,
          expectedDurationMs: values.expectedDurationMs,
          referenceCanvas: canvas,
          layout,
          signal: controller.signal,
        }),
    );
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
    if (audioContext && audioContext.state !== 'closed') await audioContext.close();
    if (activeRenderToken === token) activeRenderToken = undefined;
  }
}
async function decodeBrandedBitmaps(
  imageBlob: Blob,
  logoBlob: Blob,
  signal: AbortSignal,
): Promise<[ImageBitmap, ImageBitmap]> {
  const closed = new Set<ImageBitmap>();
  const close = (bitmap: ImageBitmap) => {
    if (closed.has(bitmap)) return;
    closed.add(bitmap);
    bitmap.close();
  };
  let resolvedScene: ImageBitmap | undefined;
  let resolvedLogo: ImageBitmap | undefined;
  const rawScene = Promise.resolve()
    .then(() => createImageBitmap(imageBlob))
    .then((bitmap) => {
      resolvedScene = bitmap;
      return bitmap;
    });
  const rawLogo = Promise.resolve()
    .then(() => createImageBitmap(logoBlob))
    .then((bitmap) => {
      resolvedLogo = bitmap;
      return bitmap;
    });
  const scenePromise = withDeadline(
    withBrandedVideoExportError(
      'VIDEO_SOURCE_IMAGE_DECODE_FAILED',
      'source_image_decode',
      () => rawScene,
    ),
    MEDIA_RECORDER_LIMITS.initializationDeadlineMs,
    signal,
    new BrandedVideoExportError('VIDEO_SOURCE_IMAGE_DECODE_FAILED', 'source_image_decode'),
  );
  const logoPromise = withDeadline(
    withBrandedVideoExportError(
      'VIDEO_BRANDING_ASSET_LOAD_FAILED',
      'branding_asset_load',
      () => rawLogo,
    ),
    MEDIA_RECORDER_LIMITS.initializationDeadlineMs,
    signal,
    new BrandedVideoExportError('VIDEO_BRANDING_ASSET_LOAD_FAILED', 'branding_asset_load'),
  );
  try {
    return await Promise.all([scenePromise, logoPromise]);
  } catch (error) {
    if (resolvedScene) close(resolvedScene);
    if (resolvedLogo) close(resolvedLogo);
    void rawScene.then(close, () => undefined);
    void rawLogo.then(close, () => undefined);
    throw error;
  }
}
function assertInput(values: BrandedVideoRenderInput): void {
  if (
    !Number.isFinite(values.expectedDurationMs) ||
    values.expectedDurationMs <= 0 ||
    values.expectedDurationMs > MEDIA_RECORDER_LIMITS.maxDurationMs ||
    values.audioBlob.size <= 0 ||
    values.audioBlob.size > MEDIA_RECORDER_LIMITS.hardCompressedInputBytes ||
    values.imageBlob.size <= 0 ||
    values.logoBlob.size <= 0
  ) {
    throw new BrandedVideoExportError('VIDEO_SOURCE_ADMISSION_FAILED', 'source_admission');
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
    throw new BrandedVideoExportError('VIDEO_SOURCE_ADMISSION_FAILED', 'source_admission');
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
    throw new BrandedVideoExportError('VIDEO_SOURCE_ADMISSION_FAILED', 'source_admission');
  }
}
async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  timeoutError: BrandedVideoExportError,
): Promise<T> {
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(undefined, timeoutError), timeoutMs);
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
      (error) =>
        finish(
          undefined,
          error instanceof Error ? error : asUnknownBrandedVideoExportError(error),
        ),
    );
  });
}
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}
