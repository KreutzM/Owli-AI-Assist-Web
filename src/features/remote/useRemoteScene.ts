import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RemoteClientError,
  type RemoteAssistClient,
  type RemoteReadiness,
} from '@/core/api/remoteAssistClient';
import type { RemoteCamera } from '@/platform/camera/remoteCamera';
import {
  revokeNormalizedSceneImage,
  type BrowserSceneImageNormalizer,
  type NormalizedSceneImage,
} from '@/platform/image/browserSceneImageNormalizer';
import {
  cameraMessage,
  imageErrorIsContract,
  imageMessage,
  isRemoteSceneAbort,
  readinessMessage,
  remoteSceneErrorStatus,
  sceneMessage,
} from '@/features/remote/remoteSceneErrors';

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
  errorMessage?: string;
  retryAt?: number;
}

const INITIAL_STATE: RemoteSceneState = {
  status: 'readiness_loading',
  streamedText: '',
};

export function useRemoteScene(
  client: RemoteAssistClient,
  camera: RemoteCamera,
  normalizer: BrowserSceneImageNormalizer,
  locale: string,
) {
  const [state, setState] = useState<RemoteSceneState>(INITIAL_STATE);
  const activeController = useRef<AbortController | undefined>(undefined);
  const attempt = useRef(0);
  const readiness = useRef<RemoteReadiness | undefined>(undefined);
  const selectedProfileId = useRef<string | undefined>(undefined);
  const image = useRef<NormalizedSceneImage | undefined>(undefined);

  const clearAttempt = useCallback(
    (retainImage: boolean) => {
      attempt.current += 1;
      activeController.current?.abort();
      activeController.current = undefined;
      camera.stop();
      if (!retainImage) {
        revokeNormalizedSceneImage(image.current);
        image.current = undefined;
      }
    },
    [camera],
  );

  const loadReadiness = useCallback(
    async (refresh = false) => {
      clearAttempt(false);
      const id = attempt.current;
      const controller = new AbortController();
      activeController.current = controller;
      setState({ status: 'readiness_loading', streamedText: '' });
      try {
        const next = refresh
          ? await client.refreshCatalog(controller.signal)
          : await client.initialize(controller.signal);
        if (id !== attempt.current || controller.signal.aborted) return;
        readiness.current = next;
        const preferred = next.catalog.profiles.find(
          (profile) => profile.id === next.catalog.defaultProfileId && profile.supportsStreaming,
        );
        const fallback = next.catalog.profiles.find((profile) => profile.supportsStreaming);
        selectedProfileId.current = preferred?.id ?? fallback?.id;
        setState({
          status:
            next.sceneDescribeEnabled && selectedProfileId.current
              ? 'ready_idle'
              : 'readiness_unavailable',
          readiness: next,
          ...(selectedProfileId.current ? { selectedProfileId: selectedProfileId.current } : {}),
          streamedText: '',
        });
      } catch (error) {
        if (id !== attempt.current || isRemoteSceneAbort(error)) return;
        setState({
          status: 'readiness_unavailable',
          streamedText: '',
          errorMessage: readinessMessage(error),
        });
      } finally {
        if (activeController.current === controller) activeController.current = undefined;
      }
    },
    [clearAttempt, client],
  );

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void loadReadiness();
    });
    const cleanup = () => clearAttempt(false);
    window.addEventListener('pagehide', cleanup);
    return () => {
      mounted = false;
      window.removeEventListener('pagehide', cleanup);
      cleanup();
      readiness.current = undefined;
      selectedProfileId.current = undefined;
    };
  }, [clearAttempt, loadReadiness]);

  const selectProfile = useCallback((profileId: string) => {
    const profile = readiness.current?.catalog.profiles.find(
      (candidate) => candidate.id === profileId && candidate.supportsStreaming,
    );
    if (!profile) return;
    selectedProfileId.current = profile.id;
    setState((current) => ({ ...current, selectedProfileId: profile.id }));
  }, []);

  const startCamera = useCallback(
    async (video: HTMLVideoElement) => {
      const currentReadiness = readiness.current;
      if (!currentReadiness?.sceneDescribeEnabled || !selectedProfileId.current) return;
      clearAttempt(false);
      const id = attempt.current;
      setState({
        status: 'camera_starting',
        readiness: currentReadiness,
        selectedProfileId: selectedProfileId.current,
        streamedText: '',
      });
      try {
        await camera.start(video);
        if (id !== attempt.current) return;
        setState((current) => ({ ...current, status: 'camera_ready' }));
      } catch (error) {
        if (id !== attempt.current) return;
        setState((current) => ({
          ...current,
          status: 'recoverable_error',
          errorMessage: cameraMessage(error),
        }));
      }
    },
    [camera, clearAttempt],
  );

  const prepare = useCallback(
    async (source: Blob) => {
      const currentReadiness = readiness.current;
      const profileId = selectedProfileId.current;
      if (!currentReadiness?.sceneDescribeEnabled || !profileId) return;
      clearAttempt(false);
      const id = attempt.current;
      const controller = new AbortController();
      activeController.current = controller;
      setState({
        status: 'normalizing',
        readiness: currentReadiness,
        selectedProfileId: profileId,
        streamedText: '',
      });
      try {
        const normalized = await normalizer.normalize(source, controller.signal);
        if (id !== attempt.current || controller.signal.aborted) {
          revokeNormalizedSceneImage(normalized);
          return;
        }
        image.current = normalized;
        setState({
          status: 'prepared',
          readiness: currentReadiness,
          selectedProfileId: profileId,
          image: normalized,
          streamedText: '',
        });
      } catch (error) {
        if (id !== attempt.current || isRemoteSceneAbort(error)) return;
        setState({
          status: imageErrorIsContract(error) ? 'contract_error' : 'recoverable_error',
          readiness: currentReadiness,
          selectedProfileId: profileId,
          streamedText: '',
          errorMessage: imageMessage(error),
        });
      } finally {
        if (activeController.current === controller) activeController.current = undefined;
      }
    },
    [clearAttempt, normalizer],
  );

  const capture = useCallback(async () => {
    try {
      const source = await camera.capture();
      await prepare(source);
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'recoverable_error',
        errorMessage: cameraMessage(error),
      }));
    }
  }, [camera, prepare]);

  const describe = useCallback(async () => {
    const currentImage = image.current;
    const currentReadiness = readiness.current;
    const profileId = selectedProfileId.current;
    if (!currentImage || !currentReadiness?.sceneDescribeEnabled || !profileId) return;
    clearAttempt(true);
    const id = attempt.current;
    const controller = new AbortController();
    activeController.current = controller;
    setState({
      status: 'requesting',
      readiness: currentReadiness,
      selectedProfileId: profileId,
      image: currentImage,
      streamedText: '',
    });
    try {
      const result = await client.describeScene(
        { image: currentImage.blob, profileId, locale },
        {
          onMetadata: () => {
            if (id === attempt.current) {
              setState((current) => ({ ...current, status: 'streaming' }));
            }
          },
          onDelta: (textDelta) => {
            if (id === attempt.current) {
              setState((current) => ({
                ...current,
                status: 'streaming',
                streamedText: current.streamedText + textDelta,
              }));
            }
          },
          onTerminal: () => {
            if (id === attempt.current) {
              setState((current) => ({ ...current, status: 'terminal_waiting_for_eof' }));
            }
          },
        },
        controller.signal,
      );
      if (id !== attempt.current || controller.signal.aborted) return;
      setState((current) => ({
        ...current,
        status: 'complete',
        finalText: result.answerText,
        streamedText: result.answerText,
      }));
    } catch (error) {
      if (id !== attempt.current || isRemoteSceneAbort(error)) return;
      setState((current) => ({
        ...current,
        status: remoteSceneErrorStatus(error),
        errorMessage: sceneMessage(error),
        ...(error instanceof RemoteClientError && error.retryAt !== undefined
          ? { retryAt: error.retryAt }
          : {}),
      }));
    } finally {
      if (activeController.current === controller) activeController.current = undefined;
    }
  }, [clearAttempt, client, locale]);

  const cancel = useCallback(() => {
    const currentImage = image.current;
    clearAttempt(true);
    setState((current) => ({
      status: 'cancelled',
      ...(current.readiness ? { readiness: current.readiness } : {}),
      ...(current.selectedProfileId ? { selectedProfileId: current.selectedProfileId } : {}),
      ...(currentImage ? { image: currentImage } : {}),
      streamedText: '',
    }));
  }, [clearAttempt]);

  const reset = useCallback(() => {
    clearAttempt(false);
    const currentReadiness = readiness.current;
    const profileId = selectedProfileId.current;
    setState({
      status:
        currentReadiness?.sceneDescribeEnabled && profileId
          ? 'ready_idle'
          : 'readiness_unavailable',
      ...(currentReadiness ? { readiness: currentReadiness } : {}),
      ...(profileId ? { selectedProfileId: profileId } : {}),
      streamedText: '',
    });
  }, [clearAttempt]);

  return {
    state,
    loadReadiness,
    selectProfile,
    startCamera,
    prepare,
    capture,
    describe,
    cancel,
    reset,
  };
}
