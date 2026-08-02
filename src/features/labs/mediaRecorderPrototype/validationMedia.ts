import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import type { getMediaRecorderScenarioFixtures } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';

export async function collectSampleChecks(
  video: HTMLVideoElement,
  image: ReturnType<typeof getMediaRecorderScenarioFixtures>['image'],
  signal: AbortSignal,
) {
  await seekForFrame(video, Math.min(0.25, Math.max(video.duration - 0.25, 0.1)), signal);
  throwIfAborted(signal);
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || image.width;
  canvas.height = video.videoHeight || image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Validation canvas is unavailable.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return image.samplePoints.map((sample) => {
    const x = Math.min(canvas.width - 1, Math.max(0, Math.round(sample.x * canvas.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.round(sample.y * canvas.height)));
    const pixel = context.getImageData(x, y, 1, 1).data;
    const actual: [number, number, number] = [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];
    const distance = colorDistance(sample.rgb, actual);
    return {
      id: sample.id,
      expected: sample.rgb,
      actual,
      distance,
      withinTolerance: distance <= 42,
    };
  });
}

export async function playForTick(video: HTMLVideoElement, signal: AbortSignal): Promise<boolean> {
  try {
    throwIfAborted(signal);
    await video.play();
    await wait(PROTOTYPE_LIMITS.playbackProbeMs, signal);
    return true;
  } catch {
    return false;
  } finally {
    video.pause();
  }
}

export async function seekForFrame(
  video: HTMLVideoElement,
  timeSeconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  return await new Promise<boolean>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Seek timeout.'));
    }, PROTOTYPE_LIMITS.seekDeadlineMs);
    const onSeeked = () => {
      cleanup();
      resolve(true);
    };
    const onError = () => {
      cleanup();
      resolve(false);
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('Seek aborted.'));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    video.currentTime = Math.min(Math.max(timeSeconds, 0), Math.max(video.duration - 0.01, 0));
  });
}

export function waitForMediaEvent(
  target: EventTarget,
  eventName: string,
  timeoutMs: number,
  signal: AbortSignal,
) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out while waiting for ${eventName}.`));
    }, timeoutMs);
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${eventName}.`));
    };
    const onAbort = () => {
      cleanup();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error(`Waiting for ${eventName} aborted.`),
      );
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      target.removeEventListener(eventName, onLoad);
      target.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    target.addEventListener(eventName, onLoad, { once: true });
    target.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function wait(timeoutMs: number, signal: AbortSignal) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    const onAbort = () => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('Timed wait aborted.'));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Prototype validation was aborted.', 'AbortError');
  }
}

function colorDistance(expected: [number, number, number], actual: [number, number, number]) {
  return Math.sqrt(
    (expected[0] - actual[0]) ** 2 +
      (expected[1] - actual[1]) ** 2 +
      (expected[2] - actual[2]) ** 2,
  );
}
