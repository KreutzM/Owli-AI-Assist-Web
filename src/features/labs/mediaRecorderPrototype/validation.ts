import type { getMediaRecorderScenarioFixtures } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';

export async function validateRecording(input: {
  blobUrl: string;
  image: ReturnType<typeof getMediaRecorderScenarioFixtures>['image'];
  audio: ReturnType<typeof getMediaRecorderScenarioFixtures>['audio'];
}): Promise<{
  expectedDurationMs: number;
  measuredDurationMs: number;
  durationDriftMs: number;
  width: number;
  height: number;
  aspectRatioDelta: number;
  playbackSupported: boolean;
  seekingSupported: boolean;
  audioNonSilent: boolean;
  startMarkerDetected: boolean;
  endMarkerDetected: boolean;
  startMarkerMs?: number;
  endMarkerMs?: number;
  trackEvidence: {
    hasVisualFrames: boolean;
    hasAudibleFrames: boolean;
  };
  sampleChecks: Array<{
    id: string;
    expected: [number, number, number];
    actual: [number, number, number];
    distance: number;
    withinTolerance: boolean;
  }>;
}> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.src = input.blobUrl;
  video.volume = 0;
  video.playsInline = true;
  await once(video, 'loadedmetadata');
  const width = video.videoWidth;
  const height = video.videoHeight;
  const expectedDurationMs = input.audio.durationMs;
  const sampleChecks = await collectSampleChecks(video, input.image);
  const audioEvidence = await analyzeAudioMarkers(video, input.audio);
  const measuredDurationMs = Number.isFinite(video.duration)
    ? Math.round(video.duration * 1_000)
    : Math.round(video.currentTime * 1_000);
  const playbackSupported = await playForTick(video);
  const seekingSupported = await seekForFrame(video, Math.max(0.25, video.duration / 2));
  const aspectRatioDelta = Math.abs(width / height - input.image.width / input.image.height);
  const durationDriftMs = Math.abs(measuredDurationMs - expectedDurationMs);
  return {
    expectedDurationMs,
    measuredDurationMs,
    durationDriftMs,
    width,
    height,
    aspectRatioDelta,
    playbackSupported,
    seekingSupported,
    audioNonSilent: audioEvidence.audioNonSilent,
    startMarkerDetected: audioEvidence.startMarkerDetected,
    endMarkerDetected: audioEvidence.endMarkerDetected,
    ...(audioEvidence.startMarkerMs !== undefined
      ? { startMarkerMs: audioEvidence.startMarkerMs }
      : {}),
    ...(audioEvidence.endMarkerMs !== undefined ? { endMarkerMs: audioEvidence.endMarkerMs } : {}),
    trackEvidence: {
      hasVisualFrames: width > 0 && height > 0 && sampleChecks.some((sample) => sample.withinTolerance),
      hasAudibleFrames: audioEvidence.audioNonSilent,
    },
    sampleChecks,
  };
}

export function determineAttemptStatus(
  validation: Awaited<ReturnType<typeof validateRecording>>,
): 'PASS' | 'FAIL' | 'AUDIO_ONLY_FALLBACK' {
  const outputLooksValid =
    validation.trackEvidence.hasVisualFrames &&
    validation.sampleChecks.every((sample) => sample.withinTolerance) &&
    validation.audioNonSilent &&
    validation.startMarkerDetected &&
    validation.endMarkerDetected &&
    validation.durationDriftMs <= 250 &&
    validation.aspectRatioDelta <= 0.02;
  if (outputLooksValid) return 'PASS';
  if (!validation.trackEvidence.hasVisualFrames && validation.trackEvidence.hasAudibleFrames) {
    return 'AUDIO_ONLY_FALLBACK';
  }
  return 'FAIL';
}

async function collectSampleChecks(
  video: HTMLVideoElement,
  image: ReturnType<typeof getMediaRecorderScenarioFixtures>['image'],
) {
  await seekForFrame(video, Math.min(0.25, Math.max(video.duration - 0.25, 0.1)));
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

async function analyzeAudioMarkers(
  video: HTMLVideoElement,
  audio: ReturnType<typeof getMediaRecorderScenarioFixtures>['audio'],
): Promise<{
  audioNonSilent: boolean;
  startMarkerDetected: boolean;
  endMarkerDetected: boolean;
  startMarkerMs?: number;
  endMarkerMs?: number;
}> {
  const context = new AudioContext({ sampleRate: audio.sampleRateHz });
  const source = context.createMediaElementSource(video);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  analyser.connect(context.destination);
  const samples: Array<{ timeMs: number; rms: number }> = [];
  const buffer = new Uint8Array(analyser.fftSize);
  video.currentTime = 0;
  video.playbackRate = 8;
  await video.play();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Audio validation timeout.')), 8_000);
    const step = () => {
      analyser.getByteTimeDomainData(buffer);
      const rms = Math.sqrt(
        buffer.reduce((sum, value) => {
          const centered = value / 128 - 1;
          return sum + centered * centered;
        }, 0) / buffer.length,
      );
      samples.push({ timeMs: Math.round(video.currentTime * 1_000), rms });
      if (video.ended) {
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      window.requestAnimationFrame(step);
    };
    video.onended = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.onerror = () => reject(new Error('Audio validation playback failed.'));
    window.requestAnimationFrame(step);
  }).finally(async () => {
    video.pause();
    source.disconnect();
    analyser.disconnect();
    await context.close();
  });

  const startMarker = findMarker(samples, audio.markerWindows.startMs, audio.markerWindows.toleranceMs);
  const endMarker = findMarker(samples, audio.markerWindows.endMs, audio.markerWindows.toleranceMs);
  const audioNonSilent = samples.some((sample) => sample.rms >= 0.03);
  return {
    audioNonSilent,
    startMarkerDetected: startMarker !== undefined,
    endMarkerDetected: endMarker !== undefined,
    ...(startMarker !== undefined ? { startMarkerMs: startMarker } : {}),
    ...(endMarker !== undefined ? { endMarkerMs: endMarker } : {}),
  };
}

function findMarker(samples: Array<{ timeMs: number; rms: number }>, expectedMs: number, toleranceMs: number) {
  return samples.find((sample) => Math.abs(sample.timeMs - expectedMs) <= toleranceMs && sample.rms >= 0.08)
    ?.timeMs;
}

function colorDistance(expected: [number, number, number], actual: [number, number, number]) {
  return Math.sqrt(
    (expected[0] - actual[0]) ** 2 +
      (expected[1] - actual[1]) ** 2 +
      (expected[2] - actual[2]) ** 2,
  );
}

async function playForTick(video: HTMLVideoElement): Promise<boolean> {
  try {
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    return true;
  } catch {
    return false;
  } finally {
    video.pause();
  }
}

async function seekForFrame(video: HTMLVideoElement, timeSeconds: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const onSeeked = () => {
      cleanup();
      resolve(true);
    };
    const onError = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = Math.min(Math.max(timeSeconds, 0), Math.max(video.duration - 0.01, 0));
  });
}

function once(target: EventTarget, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${eventName}.`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onLoad);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(eventName, onLoad, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}
