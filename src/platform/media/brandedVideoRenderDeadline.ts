import { BRANDED_VIDEO_TOTAL_SLACK_MS } from '@/platform/media/mediaRecorderLimits';

export function resolveRemainingBrandedVideoRenderMs(
  sourceAudioDurationMs: number,
  elapsedRenderMs: number,
): number {
  return sourceAudioDurationMs + BRANDED_VIDEO_TOTAL_SLACK_MS - elapsedRenderMs;
}
