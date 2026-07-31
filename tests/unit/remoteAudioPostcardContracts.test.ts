import { describe, expect, it } from 'vitest';
import {
  audioPostcardOptionsSchema,
  audioPostcardQuotaSchema,
  audioPostcardTerminalResultSchema,
  buildWebAudioPostcardGenerateRequest,
  validateAudioCapability,
} from '@/core/api/remoteAudioPostcardContracts';
import {
  audioPostcardOptions,
  audioPostcardQuota,
  readyAudioPostcard,
} from './audioPostcardFixtures';

describe('Audio-Postcard remote contracts', () => {
  it('accepts the exact options contract and rejects contradictory defaults', () => {
    expect(audioPostcardOptionsSchema.safeParse(audioPostcardOptions()).success).toBe(true);
    expect(
      audioPostcardOptionsSchema.safeParse({
        ...audioPostcardOptions(),
        defaults: { profileId: 'unknown', modeId: 'lyria_sung_hook' },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown and legacy progress statuses instead of mapping them to pending', () => {
    for (const status of ['pending', 'queued', 'processing', 'future']) {
      expect(
        audioPostcardTerminalResultSchema.safeParse({
          ...readyAudioPostcard(),
          status,
        }).success,
      ).toBe(false);
    }
  });

  it('requires truthful quota shapes without fabricated windows', () => {
    expect(audioPostcardQuotaSchema.safeParse(audioPostcardQuota()).success).toBe(true);
    expect(
      audioPostcardQuotaSchema.safeParse(
        audioPostcardQuota({ enforcement: 'not_enforced', windows: [] }),
      ).success,
    ).toBe(true);
    expect(
      audioPostcardQuotaSchema.safeParse(audioPostcardQuota({ enforcement: 'not_enforced' }))
        .success,
    ).toBe(false);
    expect(
      audioPostcardQuotaSchema.safeParse(
        audioPostcardQuota({
          windows: [
            {
              scope: 'installation',
              kind: 'fixed_window',
              limit: 5,
              remaining: 6,
              resetAt: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('serializes only the approved browser request fields', () => {
    const request = buildWebAudioPostcardGenerateRequest({
      sessionToken: 'session-1',
      installationId: 'installation-1',
      imageBase64: '/9j/',
      locale: 'de-DE',
      options: audioPostcardOptions(),
      profileId: 'warm_audio_postcard',
      modeId: 'lyria_sung_hook',
    });
    expect(request).toEqual({
      sessionToken: 'session-1',
      installationId: 'installation-1',
      imageBase64: '/9j/',
      imageMimeType: 'image/jpeg',
      locale: 'de-DE',
      durationSec: 30,
      promptProfile: 'warm_audio_postcard',
      vocals: 'instrumental',
      voiceMode: 'lyria_sung_hook',
      shareVideo: false,
    });
    expect(request).not.toHaveProperty('stylePreset');
  });

  it('accepts only opaque, same-origin, HTTPS playback capabilities with bounded expiry', () => {
    const options = audioPostcardOptions();
    expect(() =>
      validateAudioCapability(readyAudioPostcard(), options, 'https://api-staging.owli-ai.com/'),
    ).not.toThrow();
    for (const url of [
      'http://api-staging.owli-ai.com/api/v1/song/audio/123e4567-e89b-42d3-a456-426614174000',
      'https://evil.example/api/v1/song/audio/123e4567-e89b-42d3-a456-426614174000',
      'https://api-staging.owli-ai.com/api/v1/scene/123e4567-e89b-42d3-a456-426614174000',
      'https://api-staging.owli-ai.com/api/v1/song/audio/short',
      'https://api-staging.owli-ai.com/api/v1/song/audio/123e4567-e89b-42d3-a456-426614174000/extra',
    ]) {
      expect(() =>
        validateAudioCapability(
          readyAudioPostcard({ audio: { ...readyAudioPostcard().audio, url } }),
          options,
          'https://api-staging.owli-ai.com/',
        ),
      ).toThrow();
    }
  });
});
