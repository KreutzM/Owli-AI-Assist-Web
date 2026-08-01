import type { PrototypeAttemptResources } from '@/features/labs/mediaRecorderPrototype/types';

const CLEANUP_TIMEOUT_MS = 1_000;

export function stopResources(resources: PrototypeAttemptResources): Promise<boolean> {
  if (resources.cleanupPromise) return resources.cleanupPromise;
  resources.cleanupPromise = cleanupResources(resources);
  return resources.cleanupPromise;
}

async function cleanupResources(resources: PrototypeAttemptResources): Promise<boolean> {
  const outcomes: boolean[] = [];
  const recorder = resources.recorder;

  if (recorder) {
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
  }

  outcomes.push(
    ...(await Promise.all([
      recorder ? stopRecorder(recorder) : Promise.resolve(true),
      closeAudioContext(resources.audioContext),
      closeAudioContext(resources.validationAudioContext),
    ])),
  );

  outcomes.push(stopAudioSource(resources.source));
  outcomes.push(disconnectNode(resources.destination));
  outcomes.push(stopTracks(resources.stream));
  outcomes.push(stopTracks(resources.canvasStream));
  outcomes.push(closeBitmap(resources.imageBitmap));
  outcomes.push(releaseVideo(resources.validationVideo));
  outcomes.push(resetCanvas(resources.canvas));
  outcomes.push(revokeUrl(resources.blobUrl));
  outcomes.push(revokeUrl(resources.imageUrl));

  return outcomes.every(Boolean);
}

async function stopRecorder(recorder: MediaRecorder): Promise<boolean> {
  if (recorder.state === 'inactive') return true;
  return await new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => finish(false), CLEANUP_TIMEOUT_MS);
    const onStop = () => finish(recorder.state === 'inactive');
    const finish = (result: boolean) => {
      window.clearTimeout(timeout);
      recorder.removeEventListener('stop', onStop);
      resolve(result);
    };
    recorder.addEventListener('stop', onStop, { once: true });
    try {
      recorder.stop();
    } catch {
      finish(false);
    }
  });
}

function stopAudioSource(source: AudioBufferSourceNode | undefined): boolean {
  if (!source) return true;
  let disconnected = true;
  try {
    source.stop();
  } catch {
    // A source may already have ended; closing its AudioContext verifies final release.
  }
  try {
    source.disconnect();
  } catch {
    disconnected = false;
  }
  return disconnected;
}

function disconnectNode(node: AudioNode | undefined): boolean {
  if (!node) return true;
  try {
    node.disconnect();
    return true;
  } catch {
    return false;
  }
}

function stopTracks(stream: MediaStream | undefined): boolean {
  if (!stream) return true;
  return stream.getTracks().every((track) => {
    try {
      track.stop();
      return track.readyState === 'ended';
    } catch {
      return false;
    }
  });
}

function closeBitmap(bitmap: ImageBitmap | undefined): boolean {
  if (!bitmap) return true;
  try {
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

async function closeAudioContext(context: AudioContext | undefined): Promise<boolean> {
  if (!context || context.state === 'closed') return true;
  try {
    const closed = context.close();
    const completed = await settleWithin(closed, CLEANUP_TIMEOUT_MS);
    if (!completed) return false;
    return readAudioContextState(context) === 'closed';
  } catch {
    return false;
  }
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: number | undefined;
  const completed = operation.then(
    () => true,
    () => false,
  );
  const expired = new Promise<false>((resolve) => {
    timeout = window.setTimeout(() => resolve(false), timeoutMs);
  });
  const result = await Promise.race([completed, expired]);
  if (timeout !== undefined) window.clearTimeout(timeout);
  return result;
}

function releaseVideo(video: HTMLVideoElement | undefined): boolean {
  if (!video) return true;
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
    return video.currentSrc === '' || video.getAttribute('src') === null;
  } catch {
    return false;
  }
}

function readAudioContextState(context: AudioContext): AudioContextState {
  return context.state;
}

function resetCanvas(canvas: HTMLCanvasElement | undefined): boolean {
  if (!canvas) return true;
  try {
    canvas.width = 0;
    canvas.height = 0;
    return canvas.width === 0 && canvas.height === 0;
  } catch {
    return false;
  }
}

function revokeUrl(url: string | undefined): boolean {
  if (!url) return true;
  try {
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
