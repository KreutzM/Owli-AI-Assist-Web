import type { RuntimeConfig } from '@/core/config/runtimeConfig';
import type {
  AudioPostcardRequest,
  AudioPostcardResult,
  FollowupRequest,
  FollowupResult,
  OwliApi,
  PublicProfile,
  SceneRequest,
  SceneResult,
  UsageSnapshot,
} from '@/core/types';

export class OwliApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'OwliApiError';
  }
}

type RemoteRuntimeConfig = Extract<RuntimeConfig, { mode: 'remote' }>;

/**
 * Legacy broad remote adapter retained only for source compatibility.
 *
 * Slice 2 composes remote startup exclusively through RemoteCatalogClient. Scene,
 * follow-up, image upload and postcard capabilities must not be reachable from
 * the remote composition root, so every broad operation fails closed here.
 */
export class RemoteOwliApi implements OwliApi {
  constructor(config: RemoteRuntimeConfig, installationId: string) {
    void config;
    void installationId;
  }

  listProfiles(signal?: AbortSignal): Promise<PublicProfile[]> {
    void signal;
    return Promise.reject(remoteCapabilityUnavailable());
  }

  describeScene(request: SceneRequest): Promise<SceneResult> {
    void request;
    return Promise.reject(remoteCapabilityUnavailable());
  }

  askFollowup(request: FollowupRequest): Promise<FollowupResult> {
    void request;
    return Promise.reject(remoteCapabilityUnavailable());
  }

  generateAudioPostcard(request: AudioPostcardRequest): Promise<AudioPostcardResult> {
    void request;
    return Promise.reject(remoteCapabilityUnavailable());
  }

  getUsage(signal?: AbortSignal): Promise<UsageSnapshot | undefined> {
    void signal;
    return Promise.resolve(undefined);
  }
}

function remoteCapabilityUnavailable(): OwliApiError {
  return new OwliApiError(
    'This remote capability is not composed in PWA Slice 2.',
    'REMOTE_CAPABILITY_UNAVAILABLE',
    501,
  );
}
