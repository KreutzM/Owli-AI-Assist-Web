import {
  PROTOTYPE_AUDIO_MARKERS,
  PROTOTYPE_AUDIO_SAMPLE_INTERVAL_MS,
  PROTOTYPE_FFT_SIZE,
  PROTOTYPE_LIMITS,
} from '@/features/labs/mediaRecorderPrototype/constants';
import type { getMediaRecorderScenarioFixtures } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import {
  clampDb,
  computeBandDb,
  computeBandDbFromWindow,
  computeRms,
  createMarkerSnapshot,
  detectMarkerSamples,
  getChannelBands,
  type MarkerSnapshot,
} from '@/features/labs/mediaRecorderPrototype/audioMarkerAnalysis';
import { throwIfAborted } from '@/features/labs/mediaRecorderPrototype/validationMedia';

export { detectMarkerSamples };
export type { MarkerSnapshot };

export async function analyzeAudioMarkers(
  video: HTMLVideoElement,
  audio: ReturnType<typeof getMediaRecorderScenarioFixtures>['audio'],
  signal: AbortSignal,
  onContextCreated?: (context: AudioContext) => void,
): Promise<{
  audioNonSilent: boolean;
  startMarkerDetected: boolean;
  endMarkerDetected: boolean;
  startMarkerMs?: number;
  endMarkerMs?: number;
  samples: MarkerSnapshot[];
}> {
  const context = new AudioContext({ sampleRate: audio.sampleRateHz });
  onContextCreated?.(context);
  await context.resume();
  if (context.state !== 'running') {
    throw new Error(`Audio validation context did not enter running state (${context.state}).`);
  }

  const source = context.createMediaElementSource(video);
  const splitter = context.createChannelSplitter(2);
  const leftAnalyser = createAnalyser(context);
  const rightAnalyser = createAnalyser(context);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  source.connect(splitter);
  splitter.connect(leftAnalyser, 0);
  splitter.connect(rightAnalyser, 1);
  source.connect(silentGain);
  silentGain.connect(context.destination);

  const samples: MarkerSnapshot[] = [];
  const leftTimeDomain = new Uint8Array(leftAnalyser.fftSize);
  const rightTimeDomain = new Uint8Array(rightAnalyser.fftSize);
  const leftFrequencyDomain = new Float32Array(leftAnalyser.frequencyBinCount);
  const rightFrequencyDomain = new Float32Array(rightAnalyser.frequencyBinCount);
  video.currentTime = 0;
  video.playbackRate = 1;
  await video.play();

  await new Promise<void>((resolve, reject) => {
    const interval = window.setInterval(() => {
      try {
        throwIfAborted(signal);
        leftAnalyser.getByteTimeDomainData(leftTimeDomain);
        rightAnalyser.getByteTimeDomainData(rightTimeDomain);
        leftAnalyser.getFloatFrequencyData(leftFrequencyDomain);
        rightAnalyser.getFloatFrequencyData(rightFrequencyDomain);
        samples.push(
          createMarkerSnapshot({
            timeMs: Math.round(video.currentTime * 1_000),
            rms: Math.max(computeByteRms(leftTimeDomain), computeByteRms(rightTimeDomain)),
            start: getChannelBands(
              computeBandDb(leftFrequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.start.left.targetHz),
              maxBands(leftFrequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.start.left.backgroundHz),
              computeBandDb(rightFrequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.start.right.targetHz),
              maxBands(rightFrequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.start.right.backgroundHz),
            ),
            end: getChannelBands(
              computeBandDb(leftFrequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.end.left.targetHz),
              maxBands(leftFrequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.end.left.backgroundHz),
              computeBandDb(rightFrequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.end.right.targetHz),
              maxBands(rightFrequencyDomain, context.sampleRate, PROTOTYPE_AUDIO_MARKERS.end.right.backgroundHz),
            ),
          }),
        );
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
    splitter.disconnect();
    leftAnalyser.disconnect();
    rightAnalyser.disconnect();
    silentGain.disconnect();
    await context.close();
  });

  return summarizeMarkerSamples(samples, audio);
}

export function analyzeFixtureAudioBuffer(
  audioBuffer: AudioBuffer,
  audio: ReturnType<typeof getMediaRecorderScenarioFixtures>['audio'],
): {
  audioNonSilent: boolean;
  startMarkerDetected: boolean;
  endMarkerDetected: boolean;
  startMarkerMs?: number;
  endMarkerMs?: number;
  samples: MarkerSnapshot[];
} {
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  const intervalSamples = Math.max(
    1,
    Math.round((PROTOTYPE_AUDIO_SAMPLE_INTERVAL_MS / 1_000) * audioBuffer.sampleRate),
  );
  const samples: MarkerSnapshot[] = [];
  for (let centerSample = 0; centerSample < audioBuffer.length; centerSample += intervalSamples) {
    const timeMs = Math.round((centerSample / audioBuffer.sampleRate) * 1_000);
    samples.push(
      createMarkerSnapshot({
        timeMs,
        rms: Math.max(
          computeWindowRms(left, centerSample),
          computeWindowRms(right, centerSample),
        ),
        start: getChannelBands(
          computeBandDbFromWindow(left, audioBuffer.sampleRate, centerSample, PROTOTYPE_AUDIO_MARKERS.start.left.targetHz, PROTOTYPE_FFT_SIZE),
          maxWindowBands(left, audioBuffer.sampleRate, centerSample, PROTOTYPE_AUDIO_MARKERS.start.left.backgroundHz),
          computeBandDbFromWindow(right, audioBuffer.sampleRate, centerSample, PROTOTYPE_AUDIO_MARKERS.start.right.targetHz, PROTOTYPE_FFT_SIZE),
          maxWindowBands(right, audioBuffer.sampleRate, centerSample, PROTOTYPE_AUDIO_MARKERS.start.right.backgroundHz),
        ),
        end: getChannelBands(
          computeBandDbFromWindow(left, audioBuffer.sampleRate, centerSample, PROTOTYPE_AUDIO_MARKERS.end.left.targetHz, PROTOTYPE_FFT_SIZE),
          maxWindowBands(left, audioBuffer.sampleRate, centerSample, PROTOTYPE_AUDIO_MARKERS.end.left.backgroundHz),
          computeBandDbFromWindow(right, audioBuffer.sampleRate, centerSample, PROTOTYPE_AUDIO_MARKERS.end.right.targetHz, PROTOTYPE_FFT_SIZE),
          maxWindowBands(right, audioBuffer.sampleRate, centerSample, PROTOTYPE_AUDIO_MARKERS.end.right.backgroundHz),
        ),
      }),
    );
  }
  return summarizeMarkerSamples(samples, audio);
}

function summarizeMarkerSamples(
  samples: MarkerSnapshot[],
  audio: ReturnType<typeof getMediaRecorderScenarioFixtures>['audio'],
) {
  const startMarker = detectMarkerSamples(
    samples,
    audio.markerWindows.startMs,
    audio.markerWindows.toleranceMs,
    'startMarkerLeadDb',
  );
  const endMarker = detectMarkerSamples(
    samples,
    audio.markerWindows.endMs,
    audio.markerWindows.toleranceMs,
    'endMarkerLeadDb',
  );
  return {
    audioNonSilent: samples.some((sample) => sample.rms >= PROTOTYPE_AUDIO_MARKERS.minOverallRms),
    startMarkerDetected: startMarker !== undefined,
    endMarkerDetected: endMarker !== undefined,
    ...(startMarker !== undefined ? { startMarkerMs: startMarker } : {}),
    ...(endMarker !== undefined ? { endMarkerMs: endMarker } : {}),
    samples,
  };
}

function createAnalyser(context: AudioContext): AnalyserNode {
  const analyser = context.createAnalyser();
  analyser.fftSize = PROTOTYPE_FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  return analyser;
}

function maxBands(
  frequencyDomain: Float32Array,
  sampleRate: number,
  frequencies: readonly number[],
): number {
  return clampDb(
    Math.max(...frequencies.map((frequency) => computeBandDb(frequencyDomain, sampleRate, frequency))),
  );
}

function maxWindowBands(
  channel: Float32Array,
  sampleRate: number,
  centerSample: number,
  frequencies: readonly number[],
): number {
  return clampDb(
    Math.max(
      ...frequencies.map((frequency) =>
        computeBandDbFromWindow(channel, sampleRate, centerSample, frequency, PROTOTYPE_FFT_SIZE),
      ),
    ),
  );
}

function computeByteRms(buffer: Uint8Array): number {
  return computeRms(
    Array.from(buffer, (value) => value / 128 - 1),
  );
}

function computeWindowRms(channel: Float32Array, centerSample: number): number {
  const half = Math.floor(PROTOTYPE_FFT_SIZE / 2);
  const start = Math.max(0, Math.min(channel.length - PROTOTYPE_FFT_SIZE, centerSample - half));
  const end = Math.min(channel.length, start + PROTOTYPE_FFT_SIZE);
  return computeRms(channel.subarray(start, end));
}
