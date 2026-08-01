import { describe, expect, it } from 'vitest';
import { determineAttemptStatus } from '@/features/labs/mediaRecorderPrototype/validation';

const validValidation = {
  trackEvidence: { hasVisualFrames: true, hasAudibleFrames: true },
  playbackSupported: true,
  seekingSupported: true,
  containerInspection: {
    container: 'webm' as const,
    seekingRequired: true,
    videoTrackCount: 1,
    audioTrackCount: 1,
    videoCodecs: ['V_VP8'],
    audioCodecs: ['A_OPUS'],
    codecsMatchCandidate: true,
  },
  audioNonSilent: true,
  startMarkerDetected: true,
  endMarkerDetected: true,
  durationDriftMs: 0,
  aspectRatioDelta: 0,
};

describe('media recorder prototype validation status', () => {
  it.each([
    ['playback', { playbackSupported: false }],
    ['required seeking', { seekingSupported: false }],
    [
      'container track codecs',
      {
        containerInspection: {
          ...validValidation.containerInspection,
          codecsMatchCandidate: false,
        },
      },
    ],
    [
      'track count',
      { containerInspection: { ...validValidation.containerInspection, audioTrackCount: 0 } },
    ],
  ])('rejects PASS when %s is invalid', (_label, patch) => {
    expect(determineAttemptStatus({ ...validValidation, ...patch } as never)).toBe('FAIL');
  });

  it('accepts PASS only after all playback, seeking, track, and content gates pass', () => {
    expect(determineAttemptStatus(validValidation as never)).toBe('PASS');
  });
});
