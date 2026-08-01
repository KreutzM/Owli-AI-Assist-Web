import { PROTOTYPE_AUDIO_MARKERS } from '@/features/labs/mediaRecorderPrototype/constants';

export interface MarkerSnapshot {
  timeMs: number;
  rms: number;
  startMarkerDb: number;
  endMarkerDb: number;
  backgroundDb: number;
  startMarkerLeadDb: number;
  endMarkerLeadDb: number;
}

export function detectMarkerSamples(
  samples: MarkerSnapshot[],
  expectedMs: number,
  toleranceMs: number,
  band: 'startMarkerLeadDb' | 'endMarkerLeadDb',
): number | undefined {
  return samples.find((sample) => {
    return (
      Math.abs(sample.timeMs - expectedMs) <= toleranceMs &&
      sample.rms >= PROTOTYPE_AUDIO_MARKERS.minMarkerRms &&
      sample[band] >= PROTOTYPE_AUDIO_MARKERS.minMarkerLeadDb
    );
  })?.timeMs;
}

export function createMarkerSnapshot(input: {
  timeMs: number;
  rms: number;
  start: ChannelBands;
  end: ChannelBands;
}): MarkerSnapshot {
  const startMarkerDb = Math.max(input.start.left.targetDb, input.start.right.targetDb);
  const endMarkerDb = Math.max(input.end.left.targetDb, input.end.right.targetDb);
  const startBackgroundDb = Math.max(input.start.left.backgroundDb, input.start.right.backgroundDb);
  const endBackgroundDb = Math.max(input.end.left.backgroundDb, input.end.right.backgroundDb);
  return {
    timeMs: input.timeMs,
    rms: input.rms,
    startMarkerDb,
    endMarkerDb,
    backgroundDb: Math.max(startBackgroundDb, endBackgroundDb),
    startMarkerLeadDb: Math.max(
      input.start.left.targetDb - input.start.left.backgroundDb,
      input.start.right.targetDb - input.start.right.backgroundDb,
    ),
    endMarkerLeadDb: Math.max(
      input.end.left.targetDb - input.end.left.backgroundDb,
      input.end.right.targetDb - input.end.right.backgroundDb,
    ),
  };
}

export function clampDb(value: number): number {
  if (!Number.isFinite(value)) return PROTOTYPE_AUDIO_MARKERS.floorDb;
  return Math.max(PROTOTYPE_AUDIO_MARKERS.floorDb, value);
}

export function computeBandDb(
  magnitudes: ArrayLike<number>,
  sampleRate: number,
  targetHz: number,
): number {
  const binSize = sampleRate / 2 / magnitudes.length;
  const index = Math.min(magnitudes.length - 1, Math.max(0, Math.round(targetHz / binSize)));
  return clampDb(magnitudes[index] ?? PROTOTYPE_AUDIO_MARKERS.floorDb);
}

export function computeBandDbFromWindow(
  channel: Float32Array,
  sampleRate: number,
  centerSample: number,
  targetHz: number,
  windowSize: number,
): number {
  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, Math.min(channel.length - windowSize, centerSample - half));
  const end = Math.min(channel.length, start + windowSize);
  const slice = channel.subarray(start, end);
  if (slice.length === 0) return PROTOTYPE_AUDIO_MARKERS.floorDb;
  const magnitude = goertzelMagnitude(slice, targetHz, sampleRate);
  if (magnitude <= Number.EPSILON) return PROTOTYPE_AUDIO_MARKERS.floorDb;
  return clampDb(20 * Math.log10(magnitude));
}

export function computeRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function getChannelBands(
  leftTargetDb: number,
  leftBackgroundDb: number,
  rightTargetDb: number,
  rightBackgroundDb: number,
): ChannelBands {
  return {
    left: {
      targetDb: clampDb(leftTargetDb),
      backgroundDb: clampDb(leftBackgroundDb),
    },
    right: {
      targetDb: clampDb(rightTargetDb),
      backgroundDb: clampDb(rightBackgroundDb),
    },
  };
}

export interface ChannelBands {
  left: {
    targetDb: number;
    backgroundDb: number;
  };
  right: {
    targetDb: number;
    backgroundDb: number;
  };
}

function goertzelMagnitude(samples: Float32Array, targetHz: number, sampleRate: number): number {
  const normalized = targetHz / sampleRate;
  const coefficient = 2 * Math.cos(2 * Math.PI * normalized);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    q0 = coefficient * q1 - q2 + (samples[index] ?? 0);
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * Math.cos(2 * Math.PI * normalized);
  const imaginary = q2 * Math.sin(2 * Math.PI * normalized);
  return Math.sqrt(real * real + imaginary * imaginary) / samples.length;
}
