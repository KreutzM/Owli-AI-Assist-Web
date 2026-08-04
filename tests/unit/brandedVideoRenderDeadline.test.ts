import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBrandedVideoRenderDeadlineMs } from '@/platform/media/brandedVideoRenderDeadline';
import {
  BRANDED_VIDEO_TOTAL_SLACK_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';

afterEach(() => {
  vi.useRealTimers();
});

describe('branded video render deadline', () => {
  it('gives a one-second admitted source its full duration plus slack', () => {
    expect(resolveBrandedVideoRenderDeadlineMs(1_000)).toBe(1_000 + BRANDED_VIDEO_TOTAL_SLACK_MS);
  });

  it('gives a 31-second admitted source its full duration plus slack', () => {
    expect(resolveBrandedVideoRenderDeadlineMs(31_000)).toBe(31_000 + BRANDED_VIDEO_TOTAL_SLACK_MS);
  });

  it('gives a 60-second admitted source its full duration plus slack', () => {
    expect(resolveBrandedVideoRenderDeadlineMs(60_000)).toBe(60_000 + BRANDED_VIDEO_TOTAL_SLACK_MS);
  });

  it('does not reduce the render budget after nine seconds of initialization', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.advanceTimersByTime(9_000);

    expect(resolveBrandedVideoRenderDeadlineMs(60_000)).toBe(60_000 + BRANDED_VIDEO_TOTAL_SLACK_MS);
  });

  it('keeps the separate initialization deadline unchanged', () => {
    expect(MEDIA_RECORDER_LIMITS.initializationDeadlineMs).toBe(10_000);
  });
});
