import { z } from 'zod';

export const FOLLOWUP_QUESTION_MAX_LENGTH = 280;
export const FOLLOWUP_HISTORY_ITEM_MAX_LENGTH = 1_200;
export const FOLLOWUP_MAX_TRANSCRIPT_PAIRS = 4;
export const FOLLOWUP_MAX_HISTORY_ITEMS = FOLLOWUP_MAX_TRANSCRIPT_PAIRS * 2;

export const followupConversationItemSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(FOLLOWUP_HISTORY_ITEM_MAX_LENGTH),
  })
  .strict();

export const webSceneFollowupRequestSchema = z
  .object({
    sessionToken: z.string().min(1),
    installationId: z.string().min(1),
    sceneToken: z.string().min(1),
    questionText: z
      .string()
      .min(1)
      .max(FOLLOWUP_QUESTION_MAX_LENGTH)
      .refine((value) => value === value.trim()),
    imageBase64: z.string().min(1),
    imageMimeType: z.literal('image/jpeg'),
    conversationHistory: z.array(followupConversationItemSchema).max(FOLLOWUP_MAX_HISTORY_ITEMS),
    stream: z.literal(true),
    profileId: z.string().min(1),
    locale: z.string().min(1),
  })
  .strict();

export const followupMetadataSchema = z
  .object({
    mode: z.literal('followup'),
    modelAlias: z.string().min(1),
    profileId: z.string().min(1),
    locale: z.string().min(1),
  })
  .strict();

export const followupDeltaSchema = z
  .object({
    textDelta: z.string(),
    requestId: z.string().min(1).optional(),
  })
  .strict();

export const followupDoneSchema = z
  .object({
    answerText: z.string().min(1),
    mode: z.literal('followup'),
    modelAlias: z.string().min(1),
    requestId: z.string().min(1),
    profileId: z.string().min(1),
    locale: z.string().min(1),
  })
  .strict();

export const followupErrorSchema = z
  .object({
    error: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const remoteErrorEnvelopeSchema = z
  .object({
    error: z.string().min(1),
    message: z.string().optional(),
    details: z
      .object({
        tokenType: z.enum(['session', 'scene']).optional(),
        reason: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface FollowupTranscriptPair {
  question: string;
  answer: string;
}

export interface RemoteFollowupInput {
  sceneToken: string;
  questionText: string;
  image: Blob;
  transcript: readonly FollowupTranscriptPair[];
  profileId: string;
  locale: string;
}

export interface RemoteFollowupResult {
  answerText: string;
  profileId: string;
  locale: string;
  modelAlias: string;
  requestId: string;
}

export interface FollowupStreamCallbacks {
  onMetadata?: (metadata: FollowupMetadata) => void;
  onDelta?: (textDelta: string) => void;
  onTerminal?: () => void;
}

interface BuildFollowupRequestInput {
  sessionToken: string;
  installationId: string;
  imageBase64: string;
  input: RemoteFollowupInput;
}

export function buildWebSceneFollowupRequest(
  values: BuildFollowupRequestInput,
): WebSceneFollowupRequest {
  const conversationHistory = values.input.transcript
    .slice(-FOLLOWUP_MAX_TRANSCRIPT_PAIRS)
    .flatMap((pair) => [
      {
        role: 'user' as const,
        text: pair.question.slice(0, FOLLOWUP_HISTORY_ITEM_MAX_LENGTH),
      },
      {
        role: 'assistant' as const,
        text: pair.answer.slice(0, FOLLOWUP_HISTORY_ITEM_MAX_LENGTH),
      },
    ]);

  return webSceneFollowupRequestSchema.parse({
    sessionToken: values.sessionToken,
    installationId: values.installationId,
    sceneToken: values.input.sceneToken,
    questionText: values.input.questionText.trim(),
    imageBase64: values.imageBase64,
    imageMimeType: 'image/jpeg',
    conversationHistory,
    stream: true,
    profileId: values.input.profileId,
    locale: values.input.locale,
  });
}

export type WebSceneFollowupRequest = z.infer<typeof webSceneFollowupRequestSchema>;
export type FollowupConversationItem = z.infer<typeof followupConversationItemSchema>;
export type FollowupMetadata = z.infer<typeof followupMetadataSchema>;
export type FollowupDelta = z.infer<typeof followupDeltaSchema>;
export type FollowupDone = z.infer<typeof followupDoneSchema>;
export type FollowupErrorPayload = z.infer<typeof followupErrorSchema>;
