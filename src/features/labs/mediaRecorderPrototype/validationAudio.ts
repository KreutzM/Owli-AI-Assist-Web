import {
  PROTOTYPE_AUDIO_MARKERS,
  PROTOTYPE_AUDIO_SAMPLE_INTERVAL_MS,
  PROTOTYPE_FFT_SIZE,
  PROTOTYPE_LIMITS,
} from '@/features/labs/mediaRecorderPrototype/constants';
import type { getMediaRecorderScenarioFixtures } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import { throwIfAborted } from '@/features/labs/mediaRecorderPrototype/validationMedia';

export interface MarkerSnapshot {
  timeMs: number;
  rms: number;
  startMarkerDb: number;
  endMarkerDb: number;
  backgroundDb: number;
}

export async function analyzeAudioMarkers(
  video: HTMLVideoElement,
  audio: ReturnType<typeof getMediaRecorderScenarioFixtures>['audio'],
  signal: AbortSignal,
): Promise<{
  audioNonSilent: boolean;
  startMarkerDetected: boolean;
  endMarkerDetected: boolean;
  startMarkerMs?: number;
  endMarkerMs?: number;
  samples: MarkerSnapshot[];
}> {
  const context = new AudioContext({ sampleRate: audio.sampleRateHz });
  await context.resume();
  if (context.state !== 'running') {
    throw new Error(`Audio validation context did not enter running state (${context.state}).`);
  }
  const source = context.createMediaElementSource(video);
  const analyser = context.createAnalyser();
  const silentGain = context.createGain();
  analyser.fftSize = PROTOTYPE_FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  silentGain.gain.value = 0;
  analyser.connect(silentGain);
  silentGain.connect(context.destination);

  const samples: MarkerSnapshot[] = [];
  const timeDomain = new Uint8Array(analyser.fftSize);
  const frequencyDomain = new Float32Array(analyser.frequencyBinCount);
  video.currentTime = 0;
  video.playbackRate = 1;
  await video.play();

  await new Promise<void>((resolve, reject) => {
    const interval = window.setInterval(() => {
      try {
        throwIfAborted(signal);
        analyser.getByteTimeDomainData(timeDomain);
        analyser.getFloatFrequencyData(frequencyDomain);
        samples.push({
          timeMs: Math.round(video.currentTime * 1_000),
          rms: computeRms(timeDomain),
          startMarkerDb: maxBandDb(frequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.startHz),
          endMarkerDb: maxBandDb(frequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.endHz),
          backgroundDb: maxBandDb(frequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.backgroundHz),
        });
        if (video.ended) {
          cleanup();
          resolve();
        }
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('Audio sampling failed.'));
      }
    }, PROTOTYPE_AUDIO_SAMPLE_INTERVAL_MS);
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Audio validation timeout.'));
    }, audio.durationMs + PROTOTYPE_LIMITS.finalizationDeadlineMs);
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Audio validation playback failed.'));
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('Prototype validation aborted.'));
    };

    const cleanup = () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };

    video.addEventListener('ended', onEnded, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  }).finally(async () => {
    video.pause();
    source.disconnect();
    analyser.disconnect();
    silentGain.disconnect();
    await context.close();
  });

  const startMarker = detectMarkerSamples(
    samples,
    audio.markerWindows.startMs,
    audio.markerWindows.toleranceMs,
    'startMarkerDb',
  );
  const endMarker = detectMarkerSamples(
    samples,
    audio.markerWindows.endMs,
    audio.markerWindows.toleranceMs,
    'endMarkerDb',
  );
  const audioNonSilent = samples.some((sample) => sample.rms >= PROTOTYPE_AUDIO_MARKERS.minOverallRms);
  return {
    audioNonSilent,
    startMarkerDetected: startMarker !== undefined,
    endMarkerDetected: endMarker !== undefined,
    ...(startMarker !== undefined ? { startMarkerMs: startMarker } : {}),
    ...(endMarker !== undefined ? { endMarkerMs: endMarker } : {}),
    samples,
  };
}

export function detectMarkerSamples(
  samples: MarkerSnapshot[],
  expectedMs: number,
  toleranceMs: number,
  band: 'startMarkerDb' | 'endMarkerDb',
): number | undefined {
  return samples.find((sample) => {
    return (
      Math.abs(sample.timeMs - expectedMs) <= toleranceMs &&
      sample.rms >= PROTOTYPE_AUDIO_MARKERS.minMarkerRms &&
      sample[band] - sample.backgroundDb >= PROTOTYPE_AUDIO_MARKERS.minMarkerLeadDb
    );
  })?.timeMs;
}

function computeRms(buffer: Uint8Array): number {
  return Math.sqrt(
    buffer.reduce((sum, value) => {
      const centered = value / 128 - 1;
      return sum + centered * centered;
    }, 0) / buffer.length,
  );
}

function maxBandDb(
  frequencyDomain: Float32Array,
  sampleRate: number,
  frequencies: readonly number[],
): number {
  const binSize = sampleRate / 2 / frequencyDomain.length;
  return Math.max(
    ...frequencies.map((frequency) => {
      const index = Math.min(
        frequencyDomain.length - 1,
        Math.max(0, Math.round(frequency / binSize)),
      );
      return frequencyDomain[index] ?? -160;
    }),
  );
}
