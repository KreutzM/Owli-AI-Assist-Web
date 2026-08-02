import { describe, expect, it } from 'vitest';
import {
  BRANDED_VIDEO_BRAND_TEXT,
  BRANDED_VIDEO_CANVAS,
  BRANDED_VIDEO_COLORS,
  computeBrandedVideoLayout,
  fitBrandTextSize,
} from '@/platform/media/brandedVideoFrame';

describe('branded video frame layout', () => {
  it.each([
    ['landscape', 1280, 720],
    ['portrait', 720, 1280],
    ['square', 900, 900],
  ])('center-fits a %s scene without crop or stretch', (_name, width, height) => {
    const layout = computeBrandedVideoLayout(width, height, 1024, 1024);

    expect(layout.image.width / layout.image.height).toBeCloseTo(width / height, 2);
    expect(layout.image.x).toBeGreaterThanOrEqual(layout.imageArea.x);
    expect(layout.image.y).toBeGreaterThanOrEqual(layout.imageArea.y);
    expect(layout.image.x + layout.image.width).toBeLessThanOrEqual(
      layout.imageArea.x + layout.imageArea.width,
    );
    expect(layout.image.y + layout.image.height).toBeLessThanOrEqual(
      layout.imageArea.y + layout.imageArea.height,
    );
    expect(layout.image.x + layout.image.width / 2).toBeCloseTo(
      layout.imageArea.x + layout.imageArea.width / 2,
      0,
    );
    expect(layout.image.y + layout.image.height / 2).toBeCloseTo(
      layout.imageArea.y + layout.imageArea.height / 2,
      0,
    );
  });

  it('does not upscale a small normalized scene', () => {
    const layout = computeBrandedVideoLayout(160, 90, 1024, 1024);

    expect(layout.image).toMatchObject({ width: 160, height: 90 });
  });

  it('matches the proportionally scaled Android composition', () => {
    const layout = computeBrandedVideoLayout(1280, 720, 1024, 1024);

    expect(BRANDED_VIDEO_CANVAS).toEqual({ width: 540, height: 960 });
    expect(BRANDED_VIDEO_CANVAS.width / BRANDED_VIDEO_CANVAS.height).toBe(9 / 16);
    expect(layout.canvas).toEqual({ x: 0, y: 0, width: 540, height: 960 });
    expect(layout.imageArea).toEqual({ x: 32, y: 32, width: 476, height: 756 });
    expect(layout.band).toEqual({ x: 32, y: 812, width: 476, height: 112 });
    expect(layout.logoArea).toEqual({ x: 52, y: 836, width: 82, height: 64 });
    expect(layout.text).toEqual({ x: 150, y: 832, width: 338, height: 72 });
    expect(layout.imageRadius).toBe(16);
    expect(layout.bandRadius).toBe(18);
    expect(layout.nominalTextSize).toBe(29);
    expect(layout.minimumTextSize).toBe(18);
  });

  it('aspect-fits the canonical square logo without crop or distortion', () => {
    const layout = computeBrandedVideoLayout(1280, 720, 1024, 1024);

    expect(layout.logo.width).toBe(layout.logo.height);
    expect(layout.logo.x).toBeGreaterThanOrEqual(layout.logoArea.x);
    expect(layout.logo.y).toBeGreaterThanOrEqual(layout.logoArea.y);
    expect(layout.logo.x + layout.logo.width).toBeLessThanOrEqual(
      layout.logoArea.x + layout.logoArea.width,
    );
    expect(layout.logo.y + layout.logo.height).toBeLessThanOrEqual(
      layout.logoArea.y + layout.logoArea.height,
    );
  });

  it('shrinks branding text only to the approved proportional minimum', () => {
    const layout = computeBrandedVideoLayout(1280, 720, 1024, 1024);
    const context = {
      font: '',
      measureText: () => ({ width: 330 }),
    };

    expect(fitBrandTextSize(context, layout)).toBe(29);
    expect(BRANDED_VIDEO_BRAND_TEXT).toBe('Owli-AI.com');
    expect(BRANDED_VIDEO_COLORS).toMatchObject({
      background: '#101418',
      band: 'rgba(28, 35, 43, 0.902)',
      text: '#ffffff',
    });
  });

  it('fails closed when the branding text cannot fit at the minimum size', () => {
    const layout = computeBrandedVideoLayout(1280, 720, 1024, 1024);
    const context = {
      font: '',
      measureText: () => ({ width: 1_000 }),
    };

    expect(() => fitBrandTextSize(context, layout)).toThrow(/does not fit/u);
  });
});
