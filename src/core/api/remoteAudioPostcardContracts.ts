import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(128);
const safeTextSchema = z.string().trim().min(1).max(4_096);
const isoDateSchema = z.string().datetime({ offset: true });
const audioMimeTypeSchema = z.enum(['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/opus']);

const quotaWindowSchema = z
  .object({
    scope: z.enum(['installation', 'ip', 'global']),
    kind: z.literal('fixed_window'),
    limit: z.number().int().nonnegative().finite(),
    remaining: z.number().int().nonnegative().finite(),
    resetAt: isoDateSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (window.remaining > window.limit) {
      context.addIssue({ code: 'custom', path: ['remaining'], message: 'Remaining exceeds limit' });
    }
  });

export const audioPostcardQuotaSchema = z
  .object({
    schemaVersion: z.literal(1),
    product: z.literal('audio_postcard'),
    unit: z.literal('generation_attempt'),
    charged: z.boolean(),
    enforcement: z.enum(['enforced', 'not_enforced']),
    windows: z.array(quotaWindowSchema).max(3),
  })
  .strict()
  .superRefine((quota, context) => {
    if (quota.enforcement === 'not_enforced' && quota.windows.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['windows'],
        message: 'Non-enforced quota must not expose windows',
      });
    }
    if (quota.enforcement === 'enforced' && quota.windows.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['windows'],
        message: 'Enforced quota requires a window',
      });
    }
    const scopes = quota.windows.map((window) => window.scope);
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({ code: 'custom', path: ['windows'], message: 'Duplicate quota scope' });
    }
  });

const songProfileSchema = z
  .object({
    id: identifierSchema,
    label: safeTextSchema,
    description: safeTextSchema,
    enabled: z.boolean(),
    experimental: z.boolean(),
    allowedModeIds: z.array(identifierSchema).min(1),
  })
  .strict();

const songModeSchema = z
  .object({
    id: identifierSchema,
    label: safeTextSchema,
    description: safeTextSchema,
    enabled: z.boolean(),
    experimental: z.boolean(),
  })
  .strict();

export const audioPostcardOptionsSchema = z
  .object({
    schemaVersion: z.literal(1),
    selectionModel: z.literal('profile_only'),
    locale: z.enum(['de-DE', 'en-US']),
    defaults: z
      .object({
        profileId: identifierSchema,
        modeId: identifierSchema,
      })
      .strict(),
    profiles: z.array(songProfileSchema).min(1),
    modes: z.array(songModeSchema).min(1),
    generation: z
      .object({
        transport: z.literal('synchronous'),
        availability: z.enum(['available', 'stub', 'not_available']),
        terminalStatuses: z.tuple([
          z.literal('ready'),
          z.literal('stub'),
          z.literal('not_available'),
          z.literal('failed'),
        ]),
        defaultDurationSec: z.number().int().min(5).max(300),
        maxDurationSec: z.number().int().min(5).max(300),
        responseTimeoutMs: z.number().int().min(30_000).max(180_000),
        playbackTtlSeconds: z.number().int().positive().max(3_600),
        maxAudioBytes: z
          .number()
          .int()
          .positive()
          .max(32 * 1_024 * 1_024),
        shareVideoAvailable: z.literal(false),
        quotaPolicy: z
          .object({
            schemaVersion: z.literal(1),
            product: z.literal('audio_postcard'),
            unit: z.literal('generation_attempt'),
            provisional: z.literal(true),
            knownScopes: z
              .array(z.enum(['installation', 'ip', 'global']))
              .min(1)
              .max(3),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((options, context) => {
    if (options.generation.defaultDurationSec > options.generation.maxDurationSec) {
      context.addIssue({
        code: 'custom',
        path: ['generation', 'defaultDurationSec'],
        message: 'Default duration exceeds maximum',
      });
    }
    const enabledModes = new Set(
      options.modes.filter((mode) => mode.enabled).map((mode) => mode.id),
    );
    const defaultProfile = options.profiles.find(
      (profile) => profile.enabled && profile.id === options.defaults.profileId,
    );
    if (
      !defaultProfile ||
      !enabledModes.has(options.defaults.modeId) ||
      !defaultProfile.allowedModeIds.includes(options.defaults.modeId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['defaults'],
        message: 'Defaults must reference an enabled, allowed profile and mode',
      });
    }
  });

const accessibilitySchema = z
  .object({
    sceneCaption: safeTextSchema,
    musicalMapping: safeTextSchema,
  })
  .strict();

const responseMetadataShape = {
  modelAlias: identifierSchema,
  promptVersion: identifierSchema.optional(),
  visionModel: identifierSchema.optional(),
  promptProfile: identifierSchema.optional(),
  voiceMode: identifierSchema.optional(),
  captionDe: safeTextSchema.optional(),
  promptPipelineMode: identifierSchema.optional(),
  visionFailureCategory: identifierSchema.optional(),
  finalPromptHash: identifierSchema.optional(),
};

const readyResultSchema = z
  .object({
    songId: identifierSchema,
    requestId: identifierSchema,
    status: z.literal('ready'),
    audio: z
      .object({
        mimeType: audioMimeTypeSchema,
        url: z.string().url(),
        durationMs: z.number().int().positive().max(300_000),
      })
      .strict(),
    accessibility: accessibilitySchema,
    expiresAt: isoDateSchema,
    quota: audioPostcardQuotaSchema,
    ...responseMetadataShape,
  })
  .strict();

const unavailableAudioSchema = z
  .object({
    mimeType: z.null(),
    url: z.null(),
    durationMs: z.literal(0),
  })
  .strict();

const stubResultSchema = z
  .object({
    songId: identifierSchema,
    requestId: identifierSchema,
    status: z.literal('stub'),
    audio: unavailableAudioSchema,
    accessibility: accessibilitySchema,
    expiresAt: z.null(),
    quota: audioPostcardQuotaSchema,
    ...responseMetadataShape,
  })
  .strict();

const notAvailableResultSchema = z
  .object({
    songId: identifierSchema,
    requestId: identifierSchema,
    status: z.literal('not_available'),
    reason: identifierSchema.optional(),
    retryable: z.boolean().optional(),
    audio: unavailableAudioSchema,
    accessibility: accessibilitySchema,
    expiresAt: z.null(),
    quota: audioPostcardQuotaSchema,
    ...responseMetadataShape,
  })
  .strict();

const failedResultSchema = z
  .object({
    error: identifierSchema,
    message: safeTextSchema,
    details: z
      .object({
        category: identifierSchema,
        scope: z.enum(['installation', 'provider']).optional(),
      })
      .strict(),
    status: z.literal('failed'),
    requestId: identifierSchema,
    category: identifierSchema,
    retryable: z.boolean(),
    quota: audioPostcardQuotaSchema,
  })
  .strict();

export const audioPostcardTerminalResultSchema = z.discriminatedUnion('status', [
  readyResultSchema,
  stubResultSchema,
  notAvailableResultSchema,
  failedResultSchema,
]);

export const audioPostcardErrorEnvelopeSchema = z
  .object({
    error: identifierSchema,
    message: safeTextSchema,
    details: z
      .object({
        category: identifierSchema,
        reason: identifierSchema.optional(),
        scope: z.enum(['installation', 'provider']).optional(),
        route: identifierSchema.optional(),
        errors: z.array(safeTextSchema).optional(),
      })
      .strict(),
    quota: audioPostcardQuotaSchema.optional(),
  })
  .strict();

export const webAudioPostcardGenerateRequestSchema = z
  .object({
    sessionToken: z.string().trim().min(1).max(4_096),
    installationId: identifierSchema,
    imageBase64: z.string().min(1),
    imageMimeType: z.literal('image/jpeg'),
    locale: z.string().trim().min(2).max(32),
    durationSec: z.number().int().min(5).max(300),
    promptProfile: identifierSchema,
    vocals: z.literal('instrumental'),
    voiceMode: identifierSchema,
    shareVideo: z.literal(false),
  })
  .strict();

export type AudioPostcardOptions = z.infer<typeof audioPostcardOptionsSchema>;
export type AudioPostcardQuota = z.infer<typeof audioPostcardQuotaSchema>;
export type AudioPostcardTerminalResult = z.infer<typeof audioPostcardTerminalResultSchema>;
export type AudioPostcardReadyResult = Extract<AudioPostcardTerminalResult, { status: 'ready' }>;
export type WebAudioPostcardGenerateRequest = z.infer<typeof webAudioPostcardGenerateRequestSchema>;
export function selectAudioPostcardDefaults(options: AudioPostcardOptions): {
  profileId: string;
  modeId: string;
} {
  const profile = options.profiles.find(
    (candidate) => candidate.enabled && candidate.id === options.defaults.profileId,
  );
  const mode = options.modes.find(
    (candidate) =>
      candidate.enabled &&
      candidate.id === options.defaults.modeId &&
      profile?.allowedModeIds.includes(candidate.id),
  );
  if (!profile || !mode) throw new Error('Audio-Postcard options have no valid defaults');
  return { profileId: profile.id, modeId: mode.id };
}

export function validateAudioCapability(
  result: AudioPostcardReadyResult,
  options: AudioPostcardOptions,
  apiBaseUrl: string,
  now = Date.now(),
): URL {
  const capability = new URL(result.audio.url);
  const apiOrigin = new URL(apiBaseUrl).origin;
  const expiresAt = Date.parse(result.expiresAt);
  const maxExpiry = now + options.generation.playbackTtlSeconds * 1_000 + 5_000;
  if (
    capability.protocol !== 'https:' ||
    capability.origin !== apiOrigin ||
    !capability.pathname.startsWith('/api/v1/song/audio/') ||
    capability.pathname === '/api/v1/song/audio/' ||
    capability.username ||
    capability.password ||
    capability.hash ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt > maxExpiry ||
    result.audio.durationMs > options.generation.maxDurationSec * 1_000
  ) {
    throw new Error('Invalid Audio-Postcard playback capability');
  }
  const capabilityMaterial = `${capability.pathname.slice('/api/v1/song/audio/'.length)}${[
    ...capability.searchParams.values(),
  ].join('')}`.replace(/[^A-Za-z0-9]/gu, '');
  if (capabilityMaterial.length < 32) {
    throw new Error('Audio-Postcard playback capability is not sufficiently opaque');
  }
  return capability;
}

export function buildWebAudioPostcardGenerateRequest(values: {
  sessionToken: string;
  installationId: string;
  imageBase64: string;
  locale: string;
  options: AudioPostcardOptions;
  profileId: string;
  modeId: string;
}): WebAudioPostcardGenerateRequest {
  return webAudioPostcardGenerateRequestSchema.parse({
    sessionToken: values.sessionToken,
    installationId: values.installationId,
    imageBase64: values.imageBase64,
    imageMimeType: 'image/jpeg',
    locale: values.locale,
    durationSec: values.options.generation.defaultDurationSec,
    promptProfile: values.profileId,
    vocals: 'instrumental',
    voiceMode: values.modeId,
    shareVideo: false,
  });
}
