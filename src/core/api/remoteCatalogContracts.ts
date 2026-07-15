import { z } from 'zod';

export const PROFILE_REGISTRY_SCHEMA_VERSION = 'vlm_profile_registry/v1';

export const remotePublicConfigSchema = z.object({
  environment: z.enum(['dev', 'staging', 'prod']),
  features: z.object({
    sceneDescribe: z.boolean(),
    followup: z.boolean(),
  }),
  profiles: z.object({
    backendSupportedProfileIds: z.array(z.string().min(1)),
  }),
});

const featureFlagsSchema = z.record(z.string(), z.boolean()).superRefine((flags, context) => {
  for (const required of ['sceneDescribe', 'followup'] as const) {
    if (!(required in flags)) {
      context.addIssue({ code: 'custom', message: `Missing required feature flag: ${required}` });
    }
  }
});

export const webBootstrapResponseV2Schema = z
  .object({
    sessionToken: z.string().min(1),
    expiresAt: z.string().datetime({ offset: true }),
    featureFlags: featureFlagsSchema,
    bootstrapInfo: z
      .object({
        environment: z.enum(['dev', 'staging', 'prod']),
        sessionTtlSeconds: z.number().int().positive().finite(),
        sessionSchemaVersion: z.literal(2),
        platform: z.literal('web'),
        trust: z.object({
          kind: z.literal('browser_public_client'),
          status: z.literal('unattested_public_client'),
          enforced: z.literal(false),
          note: z.string(),
        }),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.now()) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Expiry must be in the future',
      });
    }
  });

const backendTransportSchema = z.object({
  available: z.boolean(),
  supportsStreaming: z.boolean(),
  supportsFollowup: z.boolean(),
});

export const remoteProfilesResponseSchema = z.object({
  schemaVersion: z.literal(PROFILE_REGISTRY_SCHEMA_VERSION),
  defaultProfileId: z.string(),
  profiles: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string().min(1),
      availability: z.enum(['backend', 'byok', 'both']),
      transports: z.object({
        backend: backendTransportSchema.optional(),
      }),
    }),
  ),
});

export type RemotePublicConfig = z.infer<typeof remotePublicConfigSchema>;
export type WebBootstrapResponseV2 = z.infer<typeof webBootstrapResponseV2Schema>;
export type RemoteProfilesResponse = z.infer<typeof remoteProfilesResponseSchema>;

export interface RemoteProfile {
  id: string;
  label: string;
  description: string;
  supportsStreaming: boolean;
  supportsFollowup: boolean;
}

export interface RemoteProfileCatalog {
  profiles: RemoteProfile[];
  defaultProfileId?: string;
}
