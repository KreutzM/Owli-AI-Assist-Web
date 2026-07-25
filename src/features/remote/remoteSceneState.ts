import type { RemoteReadiness } from '@/core/api/remoteAssistClient';
import type { NormalizedSceneImage } from '@/platform/image/browserSceneImageNormalizer';

export type RemoteSceneStatus =
  | 'readiness_loading'
  | 'readiness_unavailable'
  | 'ready_idle'
  | 'camera_starting'
  | 'camera_ready'
  | 'normalizing'
  | 'prepared'
  | 'requesting'
  | 'streaming'
  | 'terminal_waiting_for_eof'
  | 'complete'
  | 'cancelled'
  | 'rate_limited'
  | 'recoverable_error'
  | 'contract_error';

export interface RemoteSceneState {
  status: RemoteSceneStatus;
  readiness?: RemoteReadiness;
  selectedProfileId?: string;
  image?: NormalizedSceneImage;
  streamedText: string;
  finalText?: string;
  resultLocale?: string;
  errorMessage?: string;
  retryAt?: number;
  announcementRun?: number;
}

export const INITIAL_REMOTE_SCENE_STATE: RemoteSceneState = {
  status: 'readiness_loading',
  streamedText: '',
};

export function createResetSceneState(
  readiness: RemoteReadiness | undefined,
  profileId: string | undefined,
): RemoteSceneState {
  return {
    status: readiness?.sceneDescribeEnabled && profileId ? 'ready_idle' : 'readiness_unavailable',
    ...(readiness ? { readiness } : {}),
    ...(profileId ? { selectedProfileId: profileId } : {}),
    streamedText: '',
  };
}

export function selectStreamingProfileId(readiness: RemoteReadiness): string | undefined {
  const preferred = readiness.catalog.profiles.find(
    (profile) => profile.id === readiness.catalog.defaultProfileId && profile.supportsStreaming,
  );
  return (
    preferred?.id ?? readiness.catalog.profiles.find((profile) => profile.supportsStreaming)?.id
  );
}

export function createCancelledSceneState(
  current: RemoteSceneState,
  image: NormalizedSceneImage | undefined,
): RemoteSceneState {
  return {
    status: 'cancelled',
    ...(current.readiness ? { readiness: current.readiness } : {}),
    ...(current.selectedProfileId ? { selectedProfileId: current.selectedProfileId } : {}),
    ...(image ? { image } : {}),
    streamedText: '',
  };
}
