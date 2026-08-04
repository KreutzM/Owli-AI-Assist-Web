export const MEDIA_RECORDER_LIMITS = {
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
  cleanupDeadlineMs: 2_000,
  pendingQuarantineMs: 500,
  maxContainerInspectionBytes: 2 * 1024 * 1024,
} as const;

export const BRANDED_VIDEO_MAX_RENDER_WALL_TIME_MS = 60_000;
export const BRANDED_VIDEO_TOTAL_SLACK_MS = 15_000;
export const BRANDED_VIDEO_MAX_OUTPUT_SHORTFALL_MS = 250;
export const BRANDED_VIDEO_MAX_OUTPUT_PADDING_MS = 2_000;
