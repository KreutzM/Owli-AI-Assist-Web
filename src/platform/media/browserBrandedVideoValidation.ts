import {
  BRANDED_VIDEO_CANVAS,
  type BrandedVideoLayout,
  type FrameRect,
} from '@/platform/media/brandedVideoFrame';
import {
  BRANDED_VIDEO_DURATION_DRIFT_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';
import {
  assertExpectedWebmTracks,
  inspectWebmContainer,
} from '@/platform/media/webmContainerInspection';

export async function validateBrandedVideoOutput(input: {
  blob: Blob;
  fileName: string;
  expectedDurationMs: number;
  referenceCanvas: HTMLCanvasElement;
  layout: BrandedVideoLayout;
  signal: AbortSignal;
}): Promise<void> {
  input.signal.throwIfAborted();
  if (input.blob.size <= 0 || input.blob.size > MEDIA_RECORDER_LIMITS.targetOutputBytes) {
    throw new Error('Recorded output size is outside the Candidate A target envelope.');
  }
  if (!input.blob.type.startsWith('video/webm') || !input.fileName.endsWith('.webm')) {
    throw new Error('Recorded output MIME and extension must both be WebM.');
  }
  assertExpectedWebmTracks(await inspectWebmContainer(input.blob));

  const url = URL.createObjectURL(input.blob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = true;
  video.src = url;
  try {
    await waitForMediaEvent(
      video,
      'loadedmetadata',
      MEDIA_RECORDER_LIMITS.metadataDeadlineMs,
      input.signal,
    );
    if (
      video.videoWidth !== BRANDED_VIDEO_CANVAS.width ||
      video.videoHeight !== BRANDED_VIDEO_CANVAS.height
    ) {
      throw new Error('Recorded output is not the approved 9:16 frame size.');
    }
    const measuredDurationMs = await resolveDurationMs(video, input.signal);
    if (Math.abs(measuredDurationMs - input.expectedDurationMs) > BRANDED_VIDEO_DURATION_DRIFT_MS) {
      throw new Error('Recorded output duration differs from the Audio-Postcard contract.');
    }

    const seekTime = Math.max(0.1, Math.min(measuredDurationMs / 2_000, video.duration - 0.05));
    await seekForFrame(video, seekTime, input.signal);
    assertDecodedFrame(video, input.referenceCanvas, input.layout);
    await assertPlayback(video, input.signal);
    await assertOutputAudio(input.blob, input.expectedDurationMs, input.signal);
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

function assertDecodedFrame(
  video: HTMLVideoElement,
  referenceCanvas: HTMLCanvasElement,
  layout: BrandedVideoLayout,
): void {
  const decoded = document.createElement('canvas');
  decoded.width = BRANDED_VIDEO_CANVAS.width;
  decoded.height = BRANDED_VIDEO_CANVAS.height;
  const decodedContext = decoded.getContext('2d', { alpha: false });
  const referenceContext = referenceCanvas.getContext('2d', { alpha: false });
  if (!decodedContext || !referenceContext) throw new Error('Frame validation canvas is unavailable.');
  decodedContext.drawImage(video, 0, 0, decoded.width, decoded.height);

  const sampleRects = [layout.image, layout.band, layout.logo, layout.text];
  let distanceTotal = 0;
  let samples = 0;
  for (const rect of sampleRects) {
    for (const point of sampleRect(rect, 5, 4)) {
      const expected = referenceContext.getImageData(point.x, point.y, 1, 1).data;
      const actual = decodedContext.getImageData(point.x, point.y, 1, 1).data;
      if ((actual[3] ?? 0) !== 255) throw new Error('Recorded output frame is not opaque.');
      distanceTotal += colorDistance(expected, actual);
      samples += 1;
    }
  }
  if (samples === 0 || distanceTotal / samples > 48) {
    throw new Error('Recorded output frame does not match the current branded scene.');
  }

  assertRegionHasColor(decodedContext, layout.logo, 18, 'canonical Owli logo');
  assertRegionHasWhite(decodedContext, layout.text, 'Owli-AI.com');
  const corner = decodedContext.getImageData(2, 2, 1, 1).data;
  if (colorDistance(corner, new Uint8ClampedArray([16, 20, 24, 255])) > 18) {
    throw new Error('Recorded output background color is invalid.');
  }
}

async function assertPlayback(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await video.play();
    await wait(MEDIA_RECORDER_LIMITS.playbackProbeMs, signal);
  } catch {
    throw new Error('Recorded output cannot be played locally.');
  } finally {
    video.pause();
  }
}

async function assertOutputAudio(
  blob: Blob,
  expectedDurationMs: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    signal.throwIfAborted();
    const durationMs = Math.round(buffer.duration * 1_000);
    if (Math.abs(durationMs - expectedDurationMs) > BRANDED_VIDEO_DURATION_DRIFT_MS) {
      throw new Error('Recorded audio track duration differs from the Audio-Postcard contract.');
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

function assertRegionHasColor(
  context: CanvasRenderingContext2D,
  rect: FrameRect,
  minimumSamples: number,
  label: string,
): void {
  let colorful = 0;
  for (const point of sampleRect(rect, 9, 7)) {
    const pixel = context.getImageData(point.x, point.y, 1, 1).data;
    const maximum = Math.max(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0);
    const minimum = Math.min(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0);
    if (maximum - minimum >= 35 && maximum >= 70) colorful += 1;
  }
  if (colorful < minimumSamples) throw new Error(`Recorded output is missing the ${label}.`);
}

function assertRegionHasWhite(
  context: CanvasRenderingContext2D,
  rect: FrameRect,
  label: string,
): void {
  let white = 0;
  for (const point of sampleRect(rect, 24, 8)) {
    const pixel = context.getImageData(point.x, point.y, 1, 1).data;
    if ((pixel[0] ?? 0) > 190 && (pixel[1] ?? 0) > 190 && (pixel[2] ?? 0) > 190) {
      white += 1;
    }
  }
  if (white < 4) throw new Error(`Recorded output is missing ${label}.`);
}

function sampleRect(rect: FrameRect, columns: number, rows: number) {
  const points: Array<{ x: number; y: number }> = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      points.push({
        x: Math.min(
          BRANDED_VIDEO_CANVAS.width - 1,
          Math.max(0, Math.round(rect.x + (rect.width * column) / (columns + 1))),
        ),
        y: Math.min(
          BRANDED_VIDEO_CANVAS.height - 1,
          Math.max(0, Math.round(rect.y + (rect.height * row) / (rows + 1))),
        ),
      });
    }
  }
  return points;
}

function colorDistance(left: ArrayLike<number>, right: ArrayLike<number>): number {
  return Math.sqrt(
    ((left[0] ?? 0) - (right[0] ?? 0)) ** 2 +
      ((left[1] ?? 0) - (right[1] ?? 0)) ** 2 +
      ((left[2] ?? 0) - (right[2] ?? 0)) ** 2,
  );
}

async function seekForFrame(
  video: HTMLVideoElement,
  timeSeconds: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Recorded output seek timed out.')),
      MEDIA_RECORDER_LIMITS.seekDeadlineMs,
    );
    const onSeeked = () => finish();
    const onError = () => finish(new Error('Recorded output seeking failed.'));
    const onAbort = () => finish(abortReason(signal));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
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
    const timeout = window.setTimeout(() => finish(new Error(`Timed out waiting for ${eventName}.`)), timeoutMs);
    const onLoad = () => finish();
    const onError = () => finish(new Error(`Failed while waiting for ${eventName}.`));
    const onAbort = () => finish(abortReason(signal));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      target.removeEventListener(eventName, onLoad);
      target.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    target.addEventListener(eventName, onLoad, { once: true });
    target.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function wait(timeoutMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(), timeoutMs);
    const onAbort = () => finish(abortReason(signal));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}
