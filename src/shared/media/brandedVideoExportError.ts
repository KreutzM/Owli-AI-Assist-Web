export const BRANDED_VIDEO_EXPORT_ERROR_CODES = [
  'VIDEO_CAPABILITY_DOWNLOAD_FAILED',
  'VIDEO_BRANDING_ASSET_LOAD_FAILED',
  'VIDEO_SOURCE_IMAGE_DECODE_FAILED',
  'VIDEO_SOURCE_AUDIO_DECODE_FAILED',
  'VIDEO_SOURCE_INPUT_INVALID',
  'VIDEO_SOURCE_DURATION_LIMIT_EXCEEDED',
  'VIDEO_SOURCE_AUDIO_INPUT_INVALID',
  'VIDEO_SOURCE_IMAGE_INPUT_INVALID',
  'VIDEO_BRANDING_INPUT_INVALID',
  'VIDEO_CONCURRENT_RENDER_REJECTED',
  'VIDEO_SOURCE_IMAGE_DIMENSIONS_EXCEEDED',
  'VIDEO_SOURCE_CANVAS_UNAVAILABLE',
  'VIDEO_SOURCE_LAYOUT_FAILED',
  'VIDEO_SOURCE_AUDIO_CHANNELS_UNSUPPORTED',
  'VIDEO_SOURCE_AUDIO_SAMPLE_RATE_UNSUPPORTED',
  'VIDEO_SOURCE_AUDIO_PCM_LIMIT_EXCEEDED',
  'VIDEO_SOURCE_AUDIO_DURATION_MISMATCH',
  'VIDEO_SOURCE_AUDIO_SILENT',
  'VIDEO_SOURCE_ADMISSION_FAILED',
  'VIDEO_RECORDER_UNSUPPORTED',
  'VIDEO_RECORDER_INITIALIZATION_FAILED',
  'VIDEO_RECORDING_FAILED',
  'VIDEO_RECORDER_FINALIZATION_FAILED',
  'VIDEO_BYTE_LIMIT_EXCEEDED',
  'VIDEO_RENDER_DEADLINE_EXCEEDED',
  'VIDEO_CONTAINER_VALIDATION_FAILED',
  'VIDEO_TRACK_VALIDATION_FAILED',
  'VIDEO_METADATA_VALIDATION_FAILED',
  'VIDEO_DURATION_VALIDATION_FAILED',
  'VIDEO_SEEK_VALIDATION_FAILED',
  'VIDEO_FRAME_VALIDATION_FAILED',
  'VIDEO_PLAYBACK_PROBE_FAILED',
  'VIDEO_OUTPUT_AUDIO_VALIDATION_FAILED',
  'VIDEO_UNKNOWN_EXPORT_FAILURE',
] as const;

export type BrandedVideoExportErrorCode = (typeof BRANDED_VIDEO_EXPORT_ERROR_CODES)[number];

export type BrandedVideoExportPhase =
  | 'capability_download'
  | 'branding_asset_load'
  | 'source_image_decode'
  | 'source_audio_decode'
  | 'source_admission'
  | 'recorder_support'
  | 'recorder_initialization'
  | 'recording'
  | 'recorder_finalization'
  | 'byte_limit'
  | 'render_deadline'
  | 'container_validation'
  | 'track_validation'
  | 'metadata_validation'
  | 'duration_validation'
  | 'seek_validation'
  | 'frame_validation'
  | 'playback_probe'
  | 'output_audio_validation'
  | 'unknown';

export class BrandedVideoExportError extends Error {
  readonly code: BrandedVideoExportErrorCode;
  readonly phase: BrandedVideoExportPhase;

  constructor(code: BrandedVideoExportErrorCode, phase: BrandedVideoExportPhase, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'BrandedVideoExportError';
    this.code = code;
    this.phase = phase;
  }
}

export async function withBrandedVideoExportError<T>(
  code: BrandedVideoExportErrorCode,
  phase: BrandedVideoExportPhase,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    rethrowBrandedVideoExportError(error, code, phase);
  }
}

export function runWithBrandedVideoExportError<T>(
  code: BrandedVideoExportErrorCode,
  phase: BrandedVideoExportPhase,
  operation: () => T,
): T {
  try {
    return operation();
  } catch (error) {
    rethrowBrandedVideoExportError(error, code, phase);
  }
}

export function asUnknownBrandedVideoExportError(error: unknown): BrandedVideoExportError {
  return error instanceof BrandedVideoExportError
    ? error
    : new BrandedVideoExportError('VIDEO_UNKNOWN_EXPORT_FAILURE', 'unknown', error);
}

export function isExpectedBrandedVideoAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function rethrowBrandedVideoExportError(
  error: unknown,
  code: BrandedVideoExportErrorCode,
  phase: BrandedVideoExportPhase,
): never {
  if (error instanceof BrandedVideoExportError || isExpectedBrandedVideoAbort(error)) {
    throw error;
  }
  throw new BrandedVideoExportError(code, phase, error);
}
