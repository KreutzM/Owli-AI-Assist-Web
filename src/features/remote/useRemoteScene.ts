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
import type { SpeechLifecycleGateway } from '@/platform/speech/browserSpeech';
import {
  cameraMessage,
  imageErrorIsContract,
  imageMessage,
  isRemoteSceneAbort,
  readinessMessage,
  remoteSceneErrorStatus,
  sceneMessage,
} from '@/features/remote/remoteSceneErrors';
import { useRemoteFollowup } from '@/features/remote/useRemoteFollowup';
import { useRemoteRequestLifecycle } from '@/features/remote/useRemoteRequestLifecycle';
import {
  createCancelledSceneState,
  createResetSceneState,
  INITIAL_REMOTE_SCENE_STATE,
  selectStreamingProfileId,
  type RemoteSceneState,
} from '@/features/remote/remoteSceneState';

export type { RemoteSceneState, RemoteSceneStatus } from '@/features/remote/remoteSceneState';

export function useRemoteScene(
  client: RemoteAssistClient,
  camera: RemoteCamera,
  normalizer: BrowserSceneImageNormalizer,
  speech: SpeechLifecycleGateway,
  locale: string,
) {
  const [state, setState] = useState<RemoteSceneState>(INITIAL_REMOTE_SCENE_STATE);
  const readiness = useRef<RemoteReadiness | undefined>(undefined);
  const selectedProfileId = useRef<string | undefined>(undefined);
  const image = useRef<NormalizedSceneImage | undefined>(undefined);
  const retryAt = useRef<number | undefined>(undefined);
  const { activeControllerRef, activeKindRef, attemptRef, clearAttempt } =
    useRemoteRequestLifecycle(camera, speech, image);

  const followupWorkflow = useRemoteFollowup({
    client,
    speech,
    activeControllerRef,
    activeKindRef,
    attemptRef,
    readinessRef: readiness,
    imageRef: image,
    clearAttempt,
  });
  const { clearSceneContext, clearSceneContextRefs } = followupWorkflow;

  const loadReadiness = useCallback(
    async (refresh = false) => {
      clearAttempt(false);
      clearSceneContext(true);
      retryAt.current = undefined;
      const id = attemptRef.current;
      const controller = new AbortController();
      activeControllerRef.current = controller;
      activeKindRef.current = 'readiness';
      setState({ status: 'readiness_loading', streamedText: '' });
      try {
        const next = refresh
          ? await client.refreshCatalog(controller.signal)
          : await client.initialize(controller.signal);
        if (id !== attemptRef.current || controller.signal.aborted) return;
        readiness.current = next;
        selectedProfileId.current = selectStreamingProfileId(next);
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
        if (id !== attemptRef.current || isRemoteSceneAbort(error)) return;
        setState({
          status: 'readiness_unavailable',
          streamedText: '',
          errorMessage: readinessMessage(error),
        });
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = undefined;
          activeKindRef.current = undefined;
        }
      }
    },
    [activeControllerRef, activeKindRef, attemptRef, clearAttempt, clearSceneContext, client],
  );

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void loadReadiness();
    });
    const cleanup = () => {
      clearAttempt(false);
      clearSceneContextRefs(true);
      readiness.current = undefined;
      selectedProfileId.current = undefined;
      retryAt.current = undefined;
    };
    window.addEventListener('pagehide', cleanup);
    return () => {
      mounted = false;
      window.removeEventListener('pagehide', cleanup);
      cleanup();
    };
  }, [clearAttempt, clearSceneContextRefs, loadReadiness]);

  const selectProfile = useCallback(
    (profileId: string) => {
      if (image.current || activeControllerRef.current) return;
      const profile = readiness.current?.catalog.profiles.find(
        (candidate) => candidate.id === profileId && candidate.supportsStreaming,
      );
      if (!profile) return;
      selectedProfileId.current = profile.id;
      setState((current) => ({ ...current, selectedProfileId: profile.id }));
    },
    [activeControllerRef],
  );

  const startCamera = useCallback(
    async (video: HTMLVideoElement) => {
      const currentReadiness = readiness.current;
      if (!currentReadiness?.sceneDescribeEnabled || !selectedProfileId.current) return;
      clearAttempt(false);
      clearSceneContext(true);
      retryAt.current = undefined;
      const id = attemptRef.current;
      setState({
        status: 'camera_starting',
        readiness: currentReadiness,
        selectedProfileId: selectedProfileId.current,
        streamedText: '',
      });
      try {
        await camera.start(video);
        if (id !== attemptRef.current) return;
        setState((current) => ({ ...current, status: 'camera_ready' }));
      } catch (error) {
        if (id !== attemptRef.current) return;
        setState((current) => ({
          ...current,
          status: 'recoverable_error',
          errorMessage: cameraMessage(error),
        }));
      }
    },
    [attemptRef, camera, clearAttempt, clearSceneContext],
  );

  const prepare = useCallback(
    async (source: Blob) => {
      const currentReadiness = readiness.current;
      const profileId = selectedProfileId.current;
      if (!currentReadiness?.sceneDescribeEnabled || !profileId) return;
      clearAttempt(false);
      clearSceneContext(true);
      retryAt.current = undefined;
      const id = attemptRef.current;
      const controller = new AbortController();
      activeControllerRef.current = controller;
      activeKindRef.current = 'normalizing';
      setState({
        status: 'normalizing',
        readiness: currentReadiness,
        selectedProfileId: profileId,
        streamedText: '',
      });
      try {
        const normalized = await normalizer.normalize(source, controller.signal);
        if (id !== attemptRef.current || controller.signal.aborted) {
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
        if (id !== attemptRef.current || isRemoteSceneAbort(error)) return;
        setState({
          status: imageErrorIsContract(error) ? 'contract_error' : 'recoverable_error',
          readiness: currentReadiness,
          selectedProfileId: profileId,
          streamedText: '',
          errorMessage: imageMessage(error),
        });
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = undefined;
          activeKindRef.current = undefined;
        }
      }
    },
    [activeControllerRef, activeKindRef, attemptRef, clearAttempt, clearSceneContext, normalizer],
  );

  const capture = useCallback(async () => {
    const id = attemptRef.current;
    try {
      const source = await camera.capture();
      if (id !== attemptRef.current) return;
      await prepare(source);
    } catch (error) {
      if (id !== attemptRef.current) return;
      setState((current) => ({
        ...current,
        status: 'recoverable_error',
        errorMessage: cameraMessage(error),
      }));
    }
  }, [attemptRef, camera, prepare]);

  const describe = useCallback(async () => {
    const currentImage = image.current;
    const currentReadiness = readiness.current;
    const profileId = selectedProfileId.current;
    if (!currentImage || !currentReadiness?.sceneDescribeEnabled || !profileId) return;
    if (retryAt.current !== undefined && Date.now() < retryAt.current) return;
    retryAt.current = undefined;
    clearAttempt(true);
    clearSceneContext(true);
    const id = attemptRef.current;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    activeKindRef.current = 'scene';
    setState({
      status: 'requesting',
      readiness: currentReadiness,
      selectedProfileId: profileId,
      image: currentImage,
      streamedText: '',
      announcementRun: id,
    });
    try {
      const result = await client.describeScene(
        { image: currentImage.blob, profileId, locale },
        {
          onMetadata: () => {
            if (id === attemptRef.current) {
              setState((current) => ({ ...current, status: 'streaming' }));
            }
          },
          onDelta: (textDelta) => {
            if (id === attemptRef.current) {
              setState((current) => ({
                ...current,
                status: 'streaming',
                streamedText: current.streamedText + textDelta,
              }));
            }
          },
          onTerminal: () => {
            if (id === attemptRef.current) {
              setState((current) => ({ ...current, status: 'terminal_waiting_for_eof' }));
            }
          },
        },
        controller.signal,
      );
      if (id !== attemptRef.current || controller.signal.aborted) return;
      retryAt.current = undefined;
      followupWorkflow.completeScene(currentReadiness, currentImage, result);
      setState((current) => ({
        ...current,
        status: 'complete',
        finalText: result.answerText,
        resultLocale: result.locale,
        streamedText: result.answerText,
      }));
    } catch (error) {
      if (id !== attemptRef.current || isRemoteSceneAbort(error)) return;
      const nextRetryAt =
        error instanceof RemoteClientError && error.code === 'RATE_LIMITED'
          ? error.retryAt
          : undefined;
      retryAt.current = nextRetryAt;
      setState((current) => ({
        ...current,
        status: remoteSceneErrorStatus(error),
        errorMessage: sceneMessage(error),
        ...(nextRetryAt !== undefined ? { retryAt: nextRetryAt } : {}),
      }));
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = undefined;
        activeKindRef.current = undefined;
      }
    }
  }, [
    activeControllerRef,
    activeKindRef,
    attemptRef,
    clearAttempt,
    clearSceneContext,
    client,
    followupWorkflow,
    locale,
  ]);

  const cancel = useCallback(() => {
    const currentImage = image.current;
    retryAt.current = undefined;
    clearAttempt(true);
    clearSceneContext(true);
    setState((current) => createCancelledSceneState(current, currentImage));
  }, [clearAttempt, clearSceneContext]);

  const reset = useCallback(() => {
    retryAt.current = undefined;
    clearAttempt(false);
    clearSceneContext(true);
    const currentReadiness = readiness.current;
    const profileId = selectedProfileId.current;
    setState(createResetSceneState(currentReadiness, profileId));
  }, [clearAttempt, clearSceneContext]);

  return {
    state,
    followup: followupWorkflow.followup,
    speechState: followupWorkflow.speechState,
    loadReadiness,
    selectProfile,
    startCamera,
    prepare,
    capture,
    describe,
    updateQuestionDraft: followupWorkflow.updateQuestionDraft,
    submitFollowup: followupWorkflow.submitFollowup,
    cancelFollowup: followupWorkflow.cancelFollowup,
    cancel,
    reset,
    readSceneDescription: followupWorkflow.readSceneDescription,
    readFollowupAnswer: followupWorkflow.readFollowupAnswer,
    stopSpeech: followupWorkflow.stopSpeech,
  };
}
