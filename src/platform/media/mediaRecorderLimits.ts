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

// Compressed sources without gapless metadata can decode with one or two padded codec frames.
// This fixed allowance is never compared with backend duration metadata.
export const BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS = 50;
export const BRANDED_VIDEO_TOTAL_SLACK_MS = 15_000;
export const BRANDED_VIDEO_DURATION_DRIFT_MS = 250;
