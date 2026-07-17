import { z } from 'zod';

export const webSceneDescribeRequestSchema = z
  .object({
    sessionToken: z.string().min(1),
    installationId: z.string().min(1),
    imageBase64: z.string().min(1),
    imageMimeType: z.literal('image/jpeg'),
    sceneMode: z.literal('describe'),
    stream: z.literal(true),
    profileId: z.string().min(1),
    locale: z.string().min(1),
  })
  .strict();

export const sceneMetadataSchema = z
  .object({
    mode: z.literal('describe'),
    modelAlias: z.string().min(1),
    profileId: z.string().min(1),
    locale: z.string().min(1),
  })
  .strict();

export const sceneDeltaSchema = z
  .object({
    textDelta: z.string(),
    requestId: z.string().min(1).optional(),
  })
  .strict();

export const sceneDoneSchema = z
  .object({
    answerText: z.string(),
    mode: z.literal('describe'),
    modelAlias: z.string().min(1),
    requestId: z.string().min(1),
    sceneToken: z.string().min(1),
    sceneTokenExpiresAt: z.string().datetime({ offset: true }),
    profileId: z.string().min(1),
    locale: z.string().min(1),
  })
  .strict();

export const sceneErrorSchema = z
  .object({
    error: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export interface NormalizedSceneInput {
  image: Blob;
  profileId: string;
  locale: string;
}

export interface SceneStreamCallbacks {
  onMetadata?: (metadata: SceneMetadata) => void;
  onDelta?: (textDelta: string) => void;
  onTerminal?: () => void;
}

export interface RemoteSceneResult {
  answerText: string;
  sceneToken: string;
  sceneTokenExpiresAt: string;
  profileId: string;
  locale: string;
  modelAlias: string;
  requestId: string;
}

export type WebSceneDescribeRequest = z.infer<typeof webSceneDescribeRequestSchema>;
export type SceneMetadata = z.infer<typeof sceneMetadataSchema>;
export type SceneDelta = z.infer<typeof sceneDeltaSchema>;
export type SceneDone = z.infer<typeof sceneDoneSchema>;
export type SceneErrorPayload = z.infer<typeof sceneErrorSchema>;
