export type ClientPlatform = 'web';
export type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PublicProfile {
  id: string;
  label: string;
  description: string;
  availability: 'backend' | 'byok' | 'both';
  supportsStreaming: boolean;
  supportsFollowup: boolean;
}

export interface BootstrapSession {
  sessionToken: string;
  expiresAt: string;
  featureFlags: {
    sceneDescribe: boolean;
    followup: boolean;
  };
}

export interface SceneRequest {
  image: Blob;
  profileId?: string;
  locale: string;
  onDelta?: (textDelta: string) => void;
  signal?: AbortSignal;
}

export interface SceneResult {
  answerText: string;
  mode: 'describe';
  modelAlias?: string;
  requestId?: string;
  sceneToken: string;
  sceneTokenExpiresAt?: string;
  profileId?: string;
  locale?: string;
}

export interface FollowupRequest {
  sceneToken: string;
  questionText: string;
  originalImage?: Blob;
  profileId?: string;
  locale: string;
  onDelta?: (textDelta: string) => void;
  signal?: AbortSignal;
}

export interface FollowupResult {
  answerText: string;
  mode: 'followup';
  modelAlias?: string;
  requestId?: string;
  profileId?: string;
  locale?: string;
}

export interface AudioPostcardRequest {
  image: Blob;
  locale: string;
  profileId?: string;
  modeId?: string;
  shareVideo: boolean;
  signal?: AbortSignal;
}

export interface AudioPostcardResult {
  status: 'ready' | 'pending';
  songId?: string;
  audioUrl?: string;
  videoUrl?: string;
  durationMs?: number;
  expiresAt?: string;
  pollAfterMs?: number;
  sceneCaption?: string;
  musicalMapping?: string;
}

export interface UsageLimit {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface UsageSnapshot {
  audioPostcards?: {
    daily?: UsageLimit;
    monthly?: UsageLimit;
  };
}

export interface OwliApi {
  listProfiles(signal?: AbortSignal): Promise<PublicProfile[]>;
  describeScene(request: SceneRequest): Promise<SceneResult>;
  askFollowup(request: FollowupRequest): Promise<FollowupResult>;
  generateAudioPostcard(request: AudioPostcardRequest): Promise<AudioPostcardResult>;
  getUsage(signal?: AbortSignal): Promise<UsageSnapshot | undefined>;
}
