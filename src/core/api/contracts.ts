import { z } from 'zod';

export const errorPayloadSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const bootstrapResponseSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.string().min(1),
  featureFlags: z.object({
    sceneDescribe: z.boolean(),
    followup: z.boolean(),
  }),
});

const backendTransportSchema = z
  .object({
    available: z.boolean().optional(),
    supportsStreaming: z.boolean().optional(),
    supportsFollowup: z.boolean().optional(),
  })
  .optional();

export const profilesResponseSchema = z.object({
  schemaVersion: z.string(),
  defaultProfileId: z.string(),
  profiles: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      availability: z.enum(['backend', 'byok', 'both']),
      transports: z.object({
        backend: backendTransportSchema,
      }),
    }),
  ),
});

const sceneDoneBaseSchema = z.object({
  answerText: z.string(),
  modelAlias: z.string().optional(),
  requestId: z.string().optional(),
  profileId: z.string().optional(),
  locale: z.string().optional(),
});

export const sceneDoneSchema = sceneDoneBaseSchema.extend({
  mode: z.literal('describe'),
  sceneToken: z.string(),
  sceneTokenExpiresAt: z.string().optional(),
});

export const followupDoneSchema = sceneDoneBaseSchema.extend({
  mode: z.literal('followup'),
});

export const deltaEventSchema = z.object({
  textDelta: z.string(),
  requestId: z.string().optional(),
});

export const songGenerateResponseSchema = z.object({
  songId: z.string().nullish(),
  status: z.enum(['ready', 'pending']).catch('pending'),
  expiresAt: z.string().nullish(),
  pollAfterMs: z.number().nullish(),
  audio: z
    .object({
      url: z.string().url().nullish(),
      durationMs: z.number().nullish(),
    })
    .nullish(),
  video: z
    .object({
      url: z.string().url().nullish(),
    })
    .nullish(),
  accessibility: z
    .object({
      sceneCaption: z.string().nullish(),
      musicalMapping: z.string().nullish(),
    })
    .nullish(),
});
