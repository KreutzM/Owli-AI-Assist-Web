import { describe, expect, it } from 'vitest';
import { resolveRemainingBrandedVideoRenderMs } from '@/platform/media/brandedVideoRenderDeadline';
import { BRANDED_VIDEO_TOTAL_SLACK_MS } from '@/platform/media/mediaRecorderLimits';

describe('branded video render deadline', () => {
  it('derives the remaining deadline from the admitted decoded source duration', () => {
    expect(resolveRemainingBrandedVideoRenderMs(31_000, 1_250)).toBe(
      31_000 + BRANDED_VIDEO_TOTAL_SLACK_MS - 1_250,
    );
  });

  it('does not cap a valid 60-second mono source at 60 seconds wall time', () => {
    expect(resolveRemainingBrandedVideoRenderMs(60_000, 1_000)).toBe(74_000);
  });

  it('reports an expired budget only after source duration and slack are consumed', () => {
    expect(
      resolveRemainingBrandedVideoRenderMs(60_000, 60_000 + BRANDED_VIDEO_TOTAL_SLACK_MS + 1),
    ).toBe(-1);
  });
});
