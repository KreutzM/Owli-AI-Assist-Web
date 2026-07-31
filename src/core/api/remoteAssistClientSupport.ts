import { remoteErrorEnvelopeSchema } from '@/core/api/remoteFollowupContracts';
import type {
  RemoteProfileCatalog,
  RemoteProfilesResponse,
  RemotePublicConfig,
  WebBootstrapResponseV2,
} from '@/core/api/remoteCatalogContracts';
import { RemoteClientError } from '@/core/api/remoteClientErrors';
import { SCENE_RESPONSE_TIMEOUT_MS, SceneStreamError } from '@/core/api/sceneSse';
import { RemoteHttpError } from '@/core/session/remoteSessionManager';
import type { RemoteReadiness } from '@/core/api/remoteAssistTypes';

export interface ProfileCatalogCacheEntry {
  etag: string;
  response: RemoteProfilesResponse;
}

export interface RemoteAssistClientOptions {
  installationId?: string;
  fetch?: typeof fetch;
}

export function projectReadiness(
  config: RemotePublicConfig,
  bootstrap: WebBootstrapResponseV2,
  catalog: RemoteProfileCatalog,
): RemoteReadiness {
  return {
    catalog,
    sceneDescribeEnabled:
      config.features.sceneDescribe === true &&
      bootstrap.featureFlags.sceneDescribe === true &&
      catalog.profiles.some((profile) => profile.supportsStreaming),
    followupEnabled:
      config.features.followup === true &&
      bootstrap.featureFlags.followup === true &&
      catalog.profiles.some((profile) => profile.supportsStreaming && profile.supportsFollowup),
    audioPostcardEnabled:
      config.features.audioPostcard === true && bootstrap.featureFlags.audioPostcard === true,
  };
}

export function projectCatalog(
  response: RemoteProfilesResponse,
  config: RemotePublicConfig,
): RemoteProfileCatalog {
  const allowed = new Set(config.profiles.backendSupportedProfileIds);
  const profiles = response.profiles
    .filter(
      (profile) =>
        (profile.availability === 'backend' || profile.availability === 'both') &&
        profile.transports.backend?.available === true &&
        allowed.has(profile.id),
    )
    .map((profile) => ({
      id: profile.id,
      label: profile.label,
      description: profile.description,
      supportsStreaming: profile.transports.backend!.supportsStreaming,
      supportsFollowup: profile.transports.backend!.supportsFollowup,
    }));
  const defaultProfileId = profiles.some((profile) => profile.id === response.defaultProfileId)
    ? response.defaultProfileId
    : undefined;
  return { profiles, ...(defaultProfileId ? { defaultProfileId } : {}) };
}

export async function withResponseTimeout(
  responsePromise: Promise<Response>,
  controller: AbortController,
  setTimer: (timer: ReturnType<typeof setTimeout>) => void,
): Promise<Response> {
  return Promise.race([
    responsePromise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new SceneStreamError('STREAM_RESPONSE_TIMEOUT'));
      }, SCENE_RESPONSE_TIMEOUT_MS);
      setTimer(timer);
    }),
  ]);
}

export function assertEventStreamResponse(response: Response): asserts response is Response & {
  body: ReadableStream<Uint8Array>;
} {
  if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream')) {
    throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
  }
  if (!response.body) throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
}

export async function throwFollowupUnauthorized(response: Response): Promise<never> {
  const parsed = remoteErrorEnvelopeSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new RemoteClientError('UNAUTHORIZED', undefined, 401);
  const tokenType = parsed.data.details?.tokenType;
  const reason = parsed.data.details?.reason;
  if (tokenType === 'session' && reason?.startsWith('session_token_')) {
    throw new RemoteHttpError(401);
  }
  if (tokenType === 'scene' && reason?.startsWith('scene_token_')) {
    throw new RemoteClientError(
      reason === 'scene_token_expired' ? 'SCENE_CONTEXT_EXPIRED' : 'SCENE_CONTEXT_INVALID',
      undefined,
      401,
    );
  }
  throw new RemoteClientError('UNAUTHORIZED', undefined, 401);
}
