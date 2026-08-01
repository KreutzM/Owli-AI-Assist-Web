import type { PrototypeAttemptResources } from '@/features/labs/mediaRecorderPrototype/runAttempt';

const CLEANUP_TIMEOUT_MS = 1_000;

export function stopResources(resources: PrototypeAttemptResources): Promise<boolean> {
  if (resources.cleanupPromise) return resources.cleanupPromise;
  resources.cleanupPromise = cleanupResources(resources);
  return resources.cleanupPromise;
}

async function cleanupResources(resources: PrototypeAttemptResources): Promise<boolean> {
  const steps: Array<Promise<unknown>> = [];

  if (resources.recorder) {
    const recorder = resources.recorder;
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    if (recorder.state !== 'inactive') {
      steps.push(stopRecorder(recorder));
    }
  }

  if (resources.source) {
    try {
      resources.source.stop();
    } catch {
      // Best-effort cleanup continues even if the source has already ended.
    }
    try {
      resources.source.disconnect();
    } catch {
      // Best-effort cleanup continues even if the source was already disconnected.
    }
  }

  if (resources.destination) {
    try {
      resources.destination.disconnect();
    } catch {
      // Best-effort cleanup continues even if the destination was already disconnected.
    }
  }

  for (const stream of [resources.stream, resources.canvasStream]) {
    stream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Best-effort cleanup continues even if a track has already stopped.
      }
    });
  }

  try {
    resources.imageBitmap?.close();
  } catch {
    // Best-effort cleanup continues even if the bitmap was already closed.
  }

  if (resources.audioContext && resources.audioContext.state !== 'closed') {
    steps.push(resources.audioContext.close().catch(() => undefined));
  }

  for (const url of [resources.blobUrl, resources.imageUrl]) {
    if (!url) continue;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Best-effort cleanup continues even if the URL has already been revoked.
    }
  }

  const settled = await Promise.allSettled(steps);
  return settled.every((result) => result.status === 'fulfilled');
}

function stopRecorder(recorder: MediaRecorder): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, CLEANUP_TIMEOUT_MS);
    const onStop = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      recorder.removeEventListener('stop', onStop);
    };
    recorder.addEventListener('stop', onStop, { once: true });
    try {
      recorder.stop();
    } catch {
      cleanup();
      resolve();
    }
  });
}
