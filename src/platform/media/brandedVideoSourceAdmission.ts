import {
  BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';
import { BrandedVideoExportError } from '@/shared/media/brandedVideoExportError';

const SILENCE_RMS_THRESHOLD = 0.0001;

interface BrandedVideoSourceInput {
  imageBlob: Blob;
  logoBlob: Blob;
  audioBlob: Blob;
}

export function assertBrandedVideoSourceInput(values: BrandedVideoSourceInput): void {
  if (
    values.audioBlob.size <= 0 ||
    values.audioBlob.size > MEDIA_RECORDER_LIMITS.hardCompressedInputBytes
  ) {
    throw admissionError('VIDEO_SOURCE_AUDIO_INPUT_INVALID');
  }
  if (values.imageBlob.size <= 0) {
    throw admissionError('VIDEO_SOURCE_IMAGE_INPUT_INVALID');
  }
  if (values.logoBlob.size <= 0) {
    throw admissionError('VIDEO_BRANDING_INPUT_INVALID');
  }
}

export function assertBrandedVideoSourceImageDimensions(scene: ImageBitmap): void {
  if (Math.max(scene.width, scene.height) > MEDIA_RECORDER_LIMITS.maxSourceLongEdgePx) {
    throw admissionError('VIDEO_SOURCE_IMAGE_DIMENSIONS_EXCEEDED');
  }
}

export function assertBrandedVideoDecodedAudio(buffer: AudioBuffer): void {
  if (
    !Number.isFinite(buffer.duration) ||
    buffer.duration <= 0 ||
    !Number.isFinite(buffer.sampleRate) ||
    buffer.sampleRate <= 0 ||
    !Number.isFinite(buffer.length) ||
    buffer.length < 0
  ) {
    throw admissionError('VIDEO_SOURCE_INPUT_INVALID');
  }
  const decodedDurationMs = Math.round(buffer.duration * 1_000);
  if (
    decodedDurationMs >
    MEDIA_RECORDER_LIMITS.maxDurationMs + BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS
  ) {
    throw admissionError('VIDEO_SOURCE_DURATION_LIMIT_EXCEEDED');
  }
  if (buffer.numberOfChannels <= 0 || buffer.numberOfChannels > MEDIA_RECORDER_LIMITS.maxChannels) {
    throw admissionError('VIDEO_SOURCE_AUDIO_CHANNELS_UNSUPPORTED');
  }
  if (buffer.sampleRate > MEDIA_RECORDER_LIMITS.maxSampleRateHz) {
    throw admissionError('VIDEO_SOURCE_AUDIO_SAMPLE_RATE_UNSUPPORTED');
  }
  const decodedPcmBytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  if (decodedPcmBytes > MEDIA_RECORDER_LIMITS.maxDecodedPcmBytes) {
    throw admissionError('VIDEO_SOURCE_AUDIO_PCM_LIMIT_EXCEEDED');
  }

  let energy = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const stride = Math.max(1, Math.floor(data.length / 20_000));
    for (let index = 0; index < data.length; index += stride) {
      const value = data[index] ?? 0;
      energy += value * value;
      count += 1;
    }
  }
  if (count === 0 || Math.sqrt(energy / count) < SILENCE_RMS_THRESHOLD) {
    throw admissionError('VIDEO_SOURCE_AUDIO_SILENT');
  }
}

function admissionError(
  code:
    | 'VIDEO_SOURCE_INPUT_INVALID'
    | 'VIDEO_SOURCE_DURATION_LIMIT_EXCEEDED'
    | 'VIDEO_SOURCE_AUDIO_INPUT_INVALID'
    | 'VIDEO_SOURCE_IMAGE_INPUT_INVALID'
    | 'VIDEO_BRANDING_INPUT_INVALID'
    | 'VIDEO_SOURCE_IMAGE_DIMENSIONS_EXCEEDED'
    | 'VIDEO_SOURCE_AUDIO_CHANNELS_UNSUPPORTED'
    | 'VIDEO_SOURCE_AUDIO_SAMPLE_RATE_UNSUPPORTED'
    | 'VIDEO_SOURCE_AUDIO_PCM_LIMIT_EXCEEDED'
    | 'VIDEO_SOURCE_AUDIO_SILENT',
): BrandedVideoExportError {
  return new BrandedVideoExportError(code, 'source_admission');
}
