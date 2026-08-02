import { describe, expect, it } from 'vitest';
import { computeBrandedVideoLayout } from '@/platform/media/browserBrandedVideoRenderer';

describe('computeBrandedVideoLayout', () => {
  it('center-fits a landscape scene without crop or stretch', () => {
    const layout = computeBrandedVideoLayout(1280, 720);

    expect(layout.image.width / layout.image.height).toBeCloseTo(1280 / 720, 6);
    expect(layout.image.x).toBeGreaterThanOrEqual(0);
    expect(layout.image.y).toBeGreaterThanOrEqual(0);
    expect(layout.image.x + layout.image.width).toBeLessThanOrEqual(540);
    expect(layout.image.y + layout.image.height).toBeLessThan(layout.band.y);
    expect(layout.image.x + layout.image.width / 2).toBeCloseTo(270, 6);
  });

  it('center-fits a portrait scene above the persistent branding band', () => {
    const layout = computeBrandedVideoLayout(720, 1280);

    expect(layout.image.width / layout.image.height).toBeCloseTo(720 / 1280, 6);
    expect(layout.image.x + layout.image.width / 2).toBeCloseTo(270, 6);
    expect(layout.image.y + layout.image.height).toBeLessThanOrEqual(layout.band.y);
    expect(layout.band.x).toBeGreaterThan(0);
    expect(layout.band.width).toBeLessThan(540);
    expect(layout.band.y + layout.band.height).toBeLessThan(960);
  });

  it('does not upscale small source images', () => {
    const layout = computeBrandedVideoLayout(160, 90);

    expect(layout.image.width).toBe(160);
    expect(layout.image.height).toBe(90);
  });
});
