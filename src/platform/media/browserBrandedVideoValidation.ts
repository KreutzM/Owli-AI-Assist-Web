import { BRANDED_VIDEO_CANVAS, type BrandedVideoLayout } from '@/platform/media/brandedVideoFrame';
import { assertDecodedBrandedFrame } from '@/platform/media/brandedVideoFrameValidation';
import {
  BRANDED_VIDEO_DURATION_DRIFT_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';
import {
  assertExpectedWebmTracks,
  inspectWebmContainer,
} from '@/platform/media/webmContainerInspection';
import {
  BrandedVideoExportError,
  runWithBrandedVideoExportError,
  withBrandedVideoExportError,
} from '@/shared/media/brandedVideoExportError';

interface BrandedVideoValidationInput {
  blob: Blob;
  fileName: string;
  sourceAudioDurationMs: number;
  referenceCanvas: HTMLCanvasElement;
  layout: BrandedVideoLayout;
  signal: AbortSignal;
}

export async function validateBrandedVideoOutput(
  input: BrandedVideoValidationInput,
): Promise<void> {
  input.signal.throwIfAborted();
  if (input.blob.size <= 0 || input.blob.size > MEDIA_RECORDER_LIMITS.targetOutputBytes) {
    throw new BrandedVideoExportError('VIDEO_BYTE_LIMIT_EXCEEDED', 'byte_limit');
  }
  if (!input.blob.type.startsWith('video/webm') || !input.fileName.endsWith('.webm')) {
    throw new BrandedVideoExportError('VIDEO_CONTAINER_VALIDATION_FAILED', 'container_validation');
  }
  const inspection = await withBrandedVideoExportError(
    'VIDEO_CONTAINER_VALIDATION_FAILED',
    'container_validation',
    () => inspectWebmContainer(input.blob),
  );
  runWithBrandedVideoExportError('VIDEO_TRACK_VALIDATION_FAILED', 'track_validation', () =>
    assertExpectedWebmTracks(inspection),
  );

  const { url, video } = runWithBrandedVideoExportError(
    'VIDEO_METADATA_VALIDATION_FAILED',
    'metadata_validation',
    () => {
      const nextUrl = URL.createObjectURL(input.blob);
      const nextVideo = document.createElement('video');
      nextVideo.preload = 'auto';
      nextVideo.playsInline = true;
      nextVideo.muted = true;
      nextVideo.src = nextUrl;
      return { url: nextUrl, video: nextVideo };
    },
  );
  try {
    await withBrandedVideoExportError(
      'VIDEO_METADATA_VALIDATION_FAILED',
      'metadata_validation',
      () =>
        waitForMediaEvent(
          video,
          'loadedmetadata',
          MEDIA_RECORDER_LIMITS.metadataDeadlineMs,
          input.signal,
        ),
    );
    if (
      video.videoWidth !== BRANDED_VIDEO_CANVAS.width ||
      video.videoHeight !== BRANDED_VIDEO_CANVAS.height
    ) {
      throw new BrandedVideoExportError('VIDEO_METADATA_VALIDATION_FAILED', 'metadata_validation');
    }
    const measuredDurationMs = await withBrandedVideoExportError(
      'VIDEO_DURATION_VALIDATION_FAILED',
      'duration_validation',
      () => resolveDurationMs(video, input.signal),
    );
    if (
      Math.abs(measuredDurationMs - input.sourceAudioDurationMs) > BRANDED_VIDEO_DURATION_DRIFT_MS
    ) {
      throw new BrandedVideoExportError('VIDEO_DURATION_VALIDATION_FAILED', 'duration_validation');
    }

    const seekTime = Math.max(0.1, Math.min(measuredDurationMs / 2_000, video.duration - 0.05));
    await withBrandedVideoExportError('VIDEO_SEEK_VALIDATION_FAILED', 'seek_validation', () =>
      seekForFrame(video, seekTime, input.signal),
    );
    runWithBrandedVideoExportError('VIDEO_FRAME_VALIDATION_FAILED', 'frame_validation', () =>
      assertDecodedBrandedFrame(video, input.referenceCanvas, input.layout),
    );
    await withBrandedVideoExportError('VIDEO_PLAYBACK_PROBE_FAILED', 'playback_probe', () =>
      assertPlayback(video, input.signal),
    );
    await withBrandedVideoExportError(
      'VIDEO_OUTPUT_AUDIO_VALIDATION_FAILED',
      'output_audio_validation',
      () => assertOutputAudio(input.blob, input.sourceAudioDurationMs, input.signal),
    );
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function resolveDurationMs(video: HTMLVideoElement, signal: AbortSignal): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Math.round(video.duration * 1_000);
  }
  await seekForFrame(video, Number.MAX_SAFE_INTEGER, signal);
  if (!Number.isFinite(video.currentTime) || video.currentTime <= 0) {
    throw new Error('Recorded output duration is unavailable.');
  }
  return Math.round(video.currentTime * 1_000);
}

async function assertPlayback(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await video.play();
    await wait(MEDIA_RECORDER_LIMITS.playbackProbeMs, signal);
  } finally {
    video.pause();
  }
}

async function assertOutputAudio(
  blob: Blob,
  sourceAudioDurationMs: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    signal.throwIfAborted();
    const durationMs = Math.round(buffer.duration * 1_000);
    if (Math.abs(durationMs - sourceAudioDurationMs) > BRANDED_VIDEO_DURATION_DRIFT_MS) {
      throw new Error('Recorded audio track duration differs from the decoded source audio.');
    }
    let sumSquares = 0;
    let sampleCount = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      const stride = Math.max(1, Math.floor(samples.length / 20_000));
      for (let index = 0; index < samples.length; index += stride) {
        const value = samples[index] ?? 0;
        sumSquares += value * value;
        sampleCount += 1;
      }
    }
    if (sampleCount === 0 || Math.sqrt(sumSquares / sampleCount) < 0.0001) {
      throw new Error('Recorded audio track is empty or silent.');
    }
  } finally {
    await context.close();
  }
}

async function seekForFrame(
  video: HTMLVideoElement,
  timeSeconds: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const timeout = window.setTimeout(
      () => finish(new Error('Recorded output seek timed out.')),
      MEDIA_RECORDER_LIMITS.seekDeadlineMs,
    );
    const onSeeked = () => finish();
    const onError = () => finish(new Error('Recorded output seeking failed.'));
    const onAbort = () => finish(abortReason(signal));
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    video.currentTime = timeSeconds;
  });
}

function waitForMediaEvent(
  target: EventTarget,
  eventName: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      target.removeEventListener(eventName, onLoad);
      target.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const timeout = window.setTimeout(
      () => finish(new Error(`Timed out waiting for ${eventName}.`)),
      timeoutMs,
    );
    const onLoad = () => finish();
    const onError = () => finish(new Error(`Failed while waiting for ${eventName}.`));
    const onAbort = () => finish(abortReason(signal));
    target.addEventListener(eventName, onLoad, { once: true });
    target.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function wait(timeoutMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const timeout = window.setTimeout(() => finish(), timeoutMs);
    const onAbort = () => finish(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}
