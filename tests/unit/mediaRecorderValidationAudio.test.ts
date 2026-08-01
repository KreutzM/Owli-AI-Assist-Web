import { describe, expect, it } from 'vitest';
import { detectMarkerSamples, type MarkerSnapshot } from '@/features/labs/mediaRecorderPrototype/validationAudio';

function markerSample(
  timeMs: number,
  overrides: Partial<MarkerSnapshot> = {},
): MarkerSnapshot {
  return {
    timeMs,
    rms: 0.01,
    startMarkerDb: -70,
    endMarkerDb: -70,
    backgroundDb: -72,
    ...overrides,
  };
}

describe('media recorder prototype audio marker detection', () => {
  it('accepts a marker only when the target band leads the background floor', () => {
    const samples = [
      markerSample(340, { rms: 0.05, startMarkerDb: -28, backgroundDb: -40 }),
      markerSample(9200, { rms: 0.05, endMarkerDb: -30, backgroundDb: -42 }),
    ];

    expect(detectMarkerSamples(samples, 350, 25, 'startMarkerDb')).toBe(340);
    expect(detectMarkerSamples(samples, 9200, 25, 'endMarkerDb')).toBe(9200);
  });

  it('rejects plain RMS activity without a frequency-specific lead', () => {
    const samples = [
      markerSample(350, { rms: 0.08, startMarkerDb: -46, backgroundDb: -43 }),
      markerSample(9200, { rms: 0.08, endMarkerDb: -44, backgroundDb: -40 }),
    ];

    expect(detectMarkerSamples(samples, 350, 25, 'startMarkerDb')).toBeUndefined();
    expect(detectMarkerSamples(samples, 9200, 25, 'endMarkerDb')).toBeUndefined();
  });

  it('rejects markers outside the expected timing window', () => {
    const samples = [markerSample(900, { rms: 0.05, startMarkerDb: -25, backgroundDb: -38 })];

    expect(detectMarkerSamples(samples, 350, 100, 'startMarkerDb')).toBeUndefined();
  });
});
