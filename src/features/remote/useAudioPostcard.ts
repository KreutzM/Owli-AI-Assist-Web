import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  defaultAudioPostcardSelection,
  type RemoteAudioPostcardClient,
} from '@/core/api/remoteAudioPostcardClient';
import { AudioPostcardClientError } from '@/core/api/remoteAudioPostcardErrors';
import type { RemoteAssistClient } from '@/core/api/remoteAssistClient';
import type { NormalizedSceneImage } from '@/platform/image/browserSceneImageNormalizer';
import {
  audioPostcardReducer,
  canStartAudioPostcard,
  INITIAL_AUDIO_POSTCARD_STATE,
  isAudioPostcardActive,
} from '@/features/remote/audioPostcardState';

interface UseAudioPostcardInput {
  enabled: boolean;
  sceneComplete: boolean;
  image?: NormalizedSceneImage;
  locale: string;
  conflictingRequest: boolean;
}

export function useAudioPostcard(client: RemoteAssistClient, input: UseAudioPostcardInput) {
  const [state, dispatch] = useReducer(audioPostcardReducer, INITIAL_AUDIO_POSTCARD_STATE);
  const requestRunRef = useRef(0);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const audioClient = client.audioPostcard;
  const imageKey = input.image?.previewUrl;

  const clearRequest = useCallback(() => {
    requestRunRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    return requestRunRef.current;
  }, []);

  useEffect(() => {
    const eligible = input.enabled && input.sceneComplete && input.image && imageKey;
    const requestRun = clearRequest();
    if (!eligible) {
      dispatch({ type: 'RESET', requestRun });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: 'OPTIONS_LOADING', imageKey, requestRun });
    void loadOptions(audioClient, input.locale, imageKey, requestRun, controller, dispatch);
    return () => {
      if (controllerRef.current === controller) controllerRef.current = undefined;
      controller.abort();
    };
  }, [
    audioClient,
    clearRequest,
    imageKey,
    input.enabled,
    input.image,
    input.locale,
    input.sceneComplete,
  ]);

  useEffect(() => {
    if (state.status !== 'ready' || state.result?.status !== 'ready') return;
    const remainingMs = Date.parse(state.result.expiresAt) - Date.now();
    if (remainingMs <= 0) {
      dispatch({ type: 'EXPIRE' });
      return;
    }
    const timer = window.setTimeout(() => dispatch({ type: 'EXPIRE' }), remainingMs);
    return () => window.clearTimeout(timer);
  }, [state.result, state.status]);

  useEffect(() => {
    const cleanup = () => {
      clearRequest();
    };
    window.addEventListener('pagehide', cleanup);
    return () => {
      window.removeEventListener('pagehide', cleanup);
      cleanup();
    };
  }, [clearRequest]);

  const selectProfile = useCallback(
    (profileId: string) => {
      const options = state.options;
      if (!options || isAudioPostcardActive(state.status)) return;
      const profile = options.profiles.find(
        (candidate) => candidate.enabled && candidate.id === profileId,
      );
      const mode =
        options.modes.find(
          (candidate) =>
            candidate.enabled &&
            candidate.id === options.defaults.modeId &&
            profile?.allowedModeIds.includes(candidate.id),
        ) ??
        options.modes.find(
          (candidate) => candidate.enabled && profile?.allowedModeIds.includes(candidate.id),
        );
      if (profile && mode) {
        dispatch({ type: 'SELECT_PROFILE', profileId: profile.id, modeId: mode.id });
      }
    },
    [state.options, state.status],
  );

  const generate = useCallback(async () => {
    const { image, conflictingRequest } = input;
    const options = state.options;
    const profileId = state.selectedProfileId;
    const modeId = state.selectedModeId;
    if (
      !image ||
      conflictingRequest ||
      !options ||
      !profileId ||
      !modeId ||
      !canStartAudioPostcard(state.status) ||
      (state.status === 'failed' && state.retryable !== true) ||
      (state.retryAt !== undefined && Date.now() < state.retryAt)
    ) {
      return;
    }

    const requestRun = clearRequest();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: 'PREPARE', requestRun, startedAt: Date.now() });
    try {
      const result = await audioClient.generate(
        {
          image: image.blob,
          locale: input.locale,
          options,
          profileId,
          modeId,
          onPrepared: () => dispatch({ type: 'SUBMIT', requestRun }),
          onDispatched: () => dispatch({ type: 'GENERATE', requestRun }),
        },
        controller.signal,
      );
      if (requestRun !== requestRunRef.current) return;
      if (result.status === 'ready') {
        try {
          await audioClient.verifyPlayback(result, options, controller.signal);
        } catch (error) {
          if (
            error instanceof AudioPostcardClientError &&
            error.kind === 'expired' &&
            requestRun === requestRunRef.current
          ) {
            dispatch({ type: 'TERMINAL', requestRun, result });
            dispatch({ type: 'EXPIRE' });
            return;
          }
          throw error;
        }
      }
      if (requestRun !== requestRunRef.current || controller.signal.aborted) return;
      dispatch({ type: 'TERMINAL', requestRun, result });
    } catch (error) {
      if (requestRun !== requestRunRef.current) return;
      dispatchAudioPostcardError(error, requestRun, dispatch);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = undefined;
    }
  }, [audioClient, clearRequest, input, state]);

  const cancel = useCallback(() => {
    if (!isAudioPostcardActive(state.status)) return;
    const ambiguousOutcome = state.status === 'generating';
    const requestRun = clearRequest();
    dispatch({
      type: 'ERROR',
      requestRun,
      status: 'cancelled',
      ambiguousOutcome,
    });
  }, [clearRequest, state.status]);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET', requestRun: clearRequest() });
  }, [clearRequest]);

  const expire = useCallback(() => dispatch({ type: 'EXPIRE' }), []);
  const setPlayerState = useCallback(
    (playerState: 'metadata_ready' | 'playing' | 'paused' | 'error') => {
      dispatch({ type: 'PLAYER', playerState });
    },
    [],
  );

  return { state, selectProfile, generate, cancel, reset, expire, setPlayerState };
}

async function loadOptions(
  client: RemoteAudioPostcardClient,
  locale: string,
  imageKey: string,
  requestRun: number,
  controller: AbortController,
  dispatch: (action: Parameters<typeof audioPostcardReducer>[1]) => void,
): Promise<void> {
  try {
    const options = await client.loadOptions(locale, controller.signal);
    if (controller.signal.aborted) return;
    if (options.generation.availability !== 'available') {
      dispatch({
        type: 'OPTIONS_UNAVAILABLE',
        imageKey,
        requestRun,
        category: options.generation.availability,
      });
      return;
    }
    const selection = defaultAudioPostcardSelection(options);
    dispatch({ type: 'OPTIONS_READY', imageKey, requestRun, options, ...selection });
  } catch (error) {
    if (controller.signal.aborted) return;
    dispatch({
      type: 'OPTIONS_UNAVAILABLE',
      imageKey,
      requestRun,
      category:
        error instanceof AudioPostcardClientError && error.kind === 'contract'
          ? 'contract_error'
          : 'options_unavailable',
    });
  }
}

function dispatchAudioPostcardError(
  error: unknown,
  requestRun: number,
  dispatch: (action: Parameters<typeof audioPostcardReducer>[1]) => void,
): void {
  if (!(error instanceof AudioPostcardClientError)) {
    dispatch({
      type: 'ERROR',
      requestRun,
      status:
        error instanceof DOMException && error.name === 'AbortError'
          ? 'cancelled'
          : 'recoverable_error',
      ambiguousOutcome: true,
    });
    return;
  }
  const details = error.details;
  const status =
    error.kind === 'timed_out'
      ? 'timed_out'
      : error.kind === 'rate_limited'
        ? 'rate_limited'
        : error.kind === 'contract'
          ? 'contract_error'
          : error.kind === 'expired'
            ? 'expired'
            : error.kind === 'aborted'
              ? 'cancelled'
              : error.kind === 'network'
                ? 'recoverable_error'
                : 'failed';
  dispatch({
    type: 'ERROR',
    requestRun,
    status,
    ...(details.category ? { category: details.category } : {}),
    ...(details.quota ? { quota: details.quota } : {}),
    ...(details.retryAt !== undefined ? { retryAt: details.retryAt } : {}),
    ...(details.retryable !== undefined ? { retryable: details.retryable } : {}),
    ambiguousOutcome: details.ambiguousOutcome ?? false,
  });
}
