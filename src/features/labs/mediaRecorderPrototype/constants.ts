export const PROTOTYPE_ROUTE_PATH = '/lab/mediarecorder-prototype' as const;

export const PROTOTYPE_LIMITS = {
  maxSourceLongEdgePx: 1280,
  maxDurationMs: 30_000,
  targetOutputBytes: 16 * 1024 * 1024,
  hardOutputBytes: 32 * 1024 * 1024,
  maxCompressedAudioBytes: 16 * 1024 * 1024,
  hardCompressedInputBytes: 32 * 1024 * 1024,
  maxDecodedPcmBytes: 12 * 1024 * 1024,
  maxAppOwnedMediaBytes: 64 * 1024 * 1024,
  maxChunkBytes: 8 * 1024 * 1024,
  maxChannels: 2,
  maxSampleRateHz: 48_000,
  requestedChunkCadenceMs: 1_000,
  initializationDeadlineMs: 10_000,
  renderSlackMs: 5_000,
  finalizationDeadlineMs: 5_000,
  metadataDeadlineMs: 5_000,
  seekDeadlineMs: 2_000,
  playbackProbeMs: 250,
  cancellationVisibleDeadlineMs: 250,
} as const;

export const RECORDER_CANDIDATE_ORDER = [
  'mp4-h264-aac',
  'webm-vp8-opus',
  'webm-default',
  'webm-vp9-opus',
] as const;

export const PROTOTYPE_FFT_SIZE = 4096;
export const PROTOTYPE_AUDIO_SAMPLE_INTERVAL_MS = 100;

export const PROTOTYPE_AUDIO_MARKERS = {
  startHz: [1320, 1760],
  endHz: [880],
  backgroundHz: [330, 440, 550, 660],
  minOverallRms: 0.01,
  minMarkerRms: 0.035,
  minMarkerLeadDb: 8,
} as const;

