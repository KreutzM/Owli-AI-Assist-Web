import type {
  AudioPostcardOptions,
  AudioPostcardQuota,
  AudioPostcardReadyResult,
} from '@/core/api/remoteAudioPostcardContracts';

export function audioPostcardOptions(
  overrides: Partial<AudioPostcardOptions['generation']> = {},
): AudioPostcardOptions {
  return {
    schemaVersion: 1,
    selectionModel: 'profile_only',
    locale: 'de-DE',
    defaults: {
      profileId: 'warm_audio_postcard',
      modeId: 'lyria_sung_hook',
    },
    profiles: [
      {
        id: 'warm_audio_postcard',
        label: 'Warme Audio-Postkarte',
        description: 'Ein persönlicher Songgruß.',
        enabled: true,
        experimental: false,
        allowedModeIds: ['lyria_sung_hook'],
      },
    ],
    modes: [
      {
        id: 'lyria_sung_hook',
        label: 'Automatisch',
        description: 'Technischer Kompatibilitätsmodus.',
        enabled: true,
        experimental: false,
      },
    ],
    generation: {
      transport: 'synchronous',
      availability: 'available',
      terminalStatuses: ['ready', 'stub', 'not_available', 'failed'],
      defaultDurationSec: 30,
      maxDurationSec: 60,
      responseTimeoutMs: 30_000,
      playbackTtlSeconds: 900,
      maxAudioBytes: 32 * 1_024 * 1_024,
      shareVideoAvailable: false,
      quotaPolicy: {
        schemaVersion: 1,
        product: 'audio_postcard',
        unit: 'generation_attempt',
        provisional: true,
        knownScopes: ['installation'],
      },
      ...overrides,
    },
  };
}

export function audioPostcardQuota(
  overrides: Partial<AudioPostcardQuota> = {},
): AudioPostcardQuota {
  return {
    schemaVersion: 1,
    product: 'audio_postcard',
    unit: 'generation_attempt',
    charged: true,
    enforcement: 'enforced',
    windows: [
      {
        scope: 'installation',
        kind: 'fixed_window',
        limit: 5,
        remaining: 4,
        resetAt: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
    ...overrides,
  };
}

export function readyAudioPostcard(
  overrides: Partial<AudioPostcardReadyResult> = {},
): AudioPostcardReadyResult {
  return {
    songId: 'song-123',
    requestId: 'request-123',
    status: 'ready',
    audio: {
      mimeType: 'audio/mpeg',
      url: 'https://api-staging.owli-ai.com/api/v1/song/audio/123e4567-e89b-42d3-a456-426614174000?token=123e4567-e89b-42d3-a456-426614174111',
      durationMs: 30_000,
    },
    accessibility: {
      sceneCaption: 'Eine helle Straße.',
      musicalMapping: 'Helle Streicher bilden die ruhige Szene ab.',
    },
    modelAlias: 'image-song-clip-v1',
    expiresAt: new Date(Date.now() + 895_000).toISOString(),
    quota: audioPostcardQuota(),
    ...overrides,
  };
}
