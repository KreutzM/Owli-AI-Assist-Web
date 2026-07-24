import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  FOLLOWUP_QUESTION_MAX_LENGTH,
  type FollowupTranscriptPair,
} from '@/core/api/remoteFollowupContracts';
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
import type { SpeechLifecycleGateway, SpeechState } from '@/platform/speech/browserSpeech';
import {
  appendCompletedPair,
  followupReducer,
  INITIAL_FOLLOWUP_STATE,
  isFollowupSubmittable,
  type FollowupSceneContext,
} from '@/features/remote/followupState';
import {
  cameraMessage,
  followupMessage,
  imageErrorIsContract,
  imageMessage,
  isRemoteSceneAbort,
  readinessMessage,
  remoteFollowupErrorStatus,
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
  resultLocale?: string;
  errorMessage?: string;
  retryAt?: number;
  announcementRun?: number;
}

const INITIAL_STATE: RemoteSceneState = {
  status: 'readiness_loading',
  streamedText: '',
};

type ActiveRequestKind = 'readiness' | 'normalizing' | 'scene' | 'followup';

export function useRemoteScene(
  client: RemoteAssistClient,
  camera: RemoteCamera,
  normalizer: BrowserSceneImageNormalizer,
  speech: SpeechLifecycleGateway,
  locale: string,
) {
  const [state, setState] = useState<RemoteSceneState>(INITIAL_STATE);
  const [followup, dispatchFollowup] = useReducer(followupReducer, INITIAL_FOLLOWUP_STATE);
  const [speechState, setSpeechState] = useState<SpeechState>(speech.state);
  const activeController = useRef<AbortController | undefined>(undefined);
  const activeKind = useRef<ActiveRequestKind | undefined>(undefined);
  const attempt = useRef(0);
  const focusRun = useRef(0);
  const readiness = useRef<RemoteReadiness | undefined>(undefined);
  const selectedProfileId = useRef<string | undefined>(undefined);
  const image = useRef<NormalizedSceneImage | undefined>(undefined);
  const retryAt = useRef<number | undefined>(undefined);
  const followupRetryAt = useRef<number | undefined>(undefined);
  const sceneContext = useRef<FollowupSceneContext | undefined>(undefined);
  const transcript = useRef<FollowupTranscriptPair[]>([]);
  const questionDraft = useRef('');
  const completedSceneText = useRef<string | undefined>(undefined);
  const completedSceneLocale = useRef<string | undefined>(undefined);

  const clearSceneContextRefs = useCallback((clearDraft: boolean) => {
    sceneContext.current = undefined;
    transcript.current = [];
    followupRetryAt.current = undefined;
    completedSceneText.current = undefined;
    completedSceneLocale.current = undefined;
    if (clearDraft) questionDraft.current = '';
  }, []);

  const clearAttempt = useCallback(
    (retainImage: boolean) => {
      attempt.current += 1;
      activeController.current?.abort();
      activeController.current = undefined;
      activeKind.current = undefined;
      camera.stop();
      speech.stop();
      if (!retainImage) {
        revokeNormalizedSceneImage(image.current);
        image.current = undefined;
      }
    },
    [camera, speech],
  );

  const clearSceneContext = useCallback(
    (clearDraft: boolean) => {
      clearSceneContextRefs(clearDraft);
      dispatchFollowup({ type: 'clear' });
    },
    [clearSceneContextRefs],
  );

  const loadReadiness = useCallback(
    async (refresh = false) => {
      clearAttempt(false);
      clearSceneContext(true);
      retryAt.current = undefined;
      const id = attempt.current;
      const controller = new AbortController();
      activeController.current = controller;
      activeKind.current = 'readiness';
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
        if (activeController.current === controller) {
          activeController.current = undefined;
          activeKind.current = undefined;
        }
      }
    },
    [clearAttempt, clearSceneContext, client],
  );

  useEffect(() => speech.subscribe(setSpeechState), [speech]);

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

  const selectProfile = useCallback((profileId: string) => {
    if (image.current || sceneContext.current || activeController.current) return;
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
      clearSceneContext(true);
      retryAt.current = undefined;
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
    [camera, clearAttempt, clearSceneContext],
  );

  const prepare = useCallback(
    async (source: Blob) => {
      const currentReadiness = readiness.current;
      const profileId = selectedProfileId.current;
      if (!currentReadiness?.sceneDescribeEnabled || !profileId) return;
      clearAttempt(false);
      clearSceneContext(true);
      retryAt.current = undefined;
      const id = attempt.current;
      const controller = new AbortController();
      activeController.current = controller;
      activeKind.current = 'normalizing';
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
        if (activeController.current === controller) {
          activeController.current = undefined;
          activeKind.current = undefined;
        }
      }
    },
    [clearAttempt, clearSceneContext, normalizer],
  );

  const capture = useCallback(async () => {
    const id = attempt.current;
    try {
      const source = await camera.capture();
      if (id !== attempt.current) return;
      await prepare(source);
    } catch (error) {
      if (id !== attempt.current) return;
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
    if (retryAt.current !== undefined && Date.now() < retryAt.current) return;
    retryAt.current = undefined;
    clearAttempt(true);
    clearSceneContext(true);
    const id = attempt.current;
    const controller = new AbortController();
    activeController.current = controller;
    activeKind.current = 'scene';
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
      retryAt.current = undefined;
      completedSceneText.current = result.answerText;
      completedSceneLocale.current = result.locale;
      const context = resolveFollowupContext(currentReadiness, currentImage, result);
      sceneContext.current = context;
      setState((current) => ({
        ...current,
        status: 'complete',
        finalText: result.answerText,
        resultLocale: result.locale,
        streamedText: result.answerText,
      }));
      dispatchFollowup(context ? { type: 'availability', context } : { type: 'availability' });
    } catch (error) {
      if (id !== attempt.current || isRemoteSceneAbort(error)) return;
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
      if (activeController.current === controller) {
        activeController.current = undefined;
        activeKind.current = undefined;
      }
    }
  }, [clearAttempt, clearSceneContext, client, locale]);

  const updateQuestionDraft = useCallback((value: string) => {
    questionDraft.current = value;
    dispatchFollowup({ type: 'draft_changed', value });
  }, []);

  const submitFollowup = useCallback(async () => {
    const currentContext = sceneContext.current;
    const currentImage = image.current;
    const currentReadiness = readiness.current;
    const normalizedQuestion = questionDraft.current.trim();
    const nextFocusRun = ++focusRun.current;

    if (!normalizedQuestion) {
      dispatchFollowup({
        type: 'validation_failed',
        message: 'Bitte gib eine Rückfrage ein.',
        focusRun: nextFocusRun,
      });
      return;
    }
    if (normalizedQuestion.length > FOLLOWUP_QUESTION_MAX_LENGTH) {
      dispatchFollowup({
        type: 'validation_failed',
        message: `Die Rückfrage darf höchstens ${FOLLOWUP_QUESTION_MAX_LENGTH} Zeichen enthalten.`,
        focusRun: nextFocusRun,
      });
      return;
    }
    if (!currentContext || !currentImage || !currentReadiness) return;
    if (!isFollowupSubmittable(followup.status) || activeController.current) return;
    const sceneExpiresAt = Date.parse(currentContext.sceneTokenExpiresAt);
    if (!Number.isFinite(sceneExpiresAt) || sceneExpiresAt <= Date.now()) {
      sceneContext.current = undefined;
      transcript.current = [];
      followupRetryAt.current = undefined;
      dispatchFollowup({
        type: 'context_expired',
        message: 'Der Szenenkontext ist abgelaufen. Bitte erstelle eine neue Szenenbeschreibung.',
        focusRun: nextFocusRun,
      });
      return;
    }
    if (!isFollowupReady(currentReadiness, currentContext)) {
      sceneContext.current = undefined;
      transcript.current = [];
      dispatchFollowup({ type: 'availability' });
      return;
    }
    if (followupRetryAt.current !== undefined && Date.now() < followupRetryAt.current) return;

    clearAttempt(true);
    const id = attempt.current;
    const controller = new AbortController();
    activeController.current = controller;
    activeKind.current = 'followup';
    followupRetryAt.current = undefined;
    dispatchFollowup({ type: 'request_started', announcementRun: id });

    try {
      const result = await client.followupScene(
        {
          sceneToken: currentContext.sceneToken,
          questionText: normalizedQuestion,
          image: currentImage.blob,
          transcript: transcript.current,
          profileId: currentContext.frozenProfileId,
          locale: currentContext.frozenLocale,
        },
        {
          onMetadata: () => {
            if (id === attempt.current) dispatchFollowup({ type: 'metadata' });
          },
          onDelta: (text) => {
            if (id === attempt.current) dispatchFollowup({ type: 'delta', text });
          },
          onTerminal: () => {
            if (id === attempt.current) dispatchFollowup({ type: 'terminal' });
          },
        },
        controller.signal,
      );
      if (id !== attempt.current || controller.signal.aborted) return;
      transcript.current = appendCompletedPair(transcript.current, {
        question: normalizedQuestion,
        answer: result.answerText,
      });
      questionDraft.current = '';
      followupRetryAt.current = undefined;
      dispatchFollowup({
        type: 'completed',
        question: normalizedQuestion,
        answer: result.answerText,
        focusRun: ++focusRun.current,
      });
    } catch (error) {
      if (id !== attempt.current || isRemoteSceneAbort(error)) return;
      const status = remoteFollowupErrorStatus(error);
      if (status === 'context_expired') {
        sceneContext.current = undefined;
        transcript.current = [];
        followupRetryAt.current = undefined;
        dispatchFollowup({
          type: 'context_expired',
          message: followupMessage(error),
          focusRun: ++focusRun.current,
        });
        return;
      }
      const nextRetryAt =
        error instanceof RemoteClientError && error.code === 'RATE_LIMITED'
          ? error.retryAt
          : undefined;
      followupRetryAt.current = nextRetryAt;
      dispatchFollowup({
        type: 'failed',
        status,
        message: followupMessage(error),
        focusRun: ++focusRun.current,
        ...(nextRetryAt !== undefined ? { retryAt: nextRetryAt } : {}),
      });
    } finally {
      if (activeController.current === controller) {
        activeController.current = undefined;
        activeKind.current = undefined;
      }
    }
  }, [clearAttempt, client, followup.status]);

  const cancelFollowup = useCallback(() => {
    if (activeKind.current !== 'followup') return;
    clearAttempt(true);
    followupRetryAt.current = undefined;
    dispatchFollowup({ type: 'cancelled', focusRun: ++focusRun.current });
  }, [clearAttempt]);

  const cancel = useCallback(() => {
    const currentImage = image.current;
    retryAt.current = undefined;
    clearAttempt(true);
    clearSceneContext(true);
    setState((current) => ({
      status: 'cancelled',
      ...(current.readiness ? { readiness: current.readiness } : {}),
      ...(current.selectedProfileId ? { selectedProfileId: current.selectedProfileId } : {}),
      ...(currentImage ? { image: currentImage } : {}),
      streamedText: '',
    }));
  }, [clearAttempt, clearSceneContext]);

  const reset = useCallback(() => {
    retryAt.current = undefined;
    clearAttempt(false);
    clearSceneContext(true);
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
  }, [clearAttempt, clearSceneContext]);

  const readSceneDescription = useCallback(() => {
    const text = completedSceneText.current;
    const resultLocale = completedSceneLocale.current;
    if (text && resultLocale) speech.speak(text, resultLocale);
  }, [speech]);

  const readFollowupAnswer = useCallback(
    (index: number) => {
      const answer = transcript.current[index]?.answer;
      const resultLocale = sceneContext.current?.frozenLocale;
      if (answer && resultLocale) speech.speak(answer, resultLocale);
    },
    [speech],
  );

  const stopSpeech = useCallback(() => speech.stop(), [speech]);

  return {
    state,
    followup,
    speechState,
    loadReadiness,
    selectProfile,
    startCamera,
    prepare,
    capture,
    describe,
    updateQuestionDraft,
    submitFollowup,
    cancelFollowup,
    cancel,
    reset,
    readSceneDescription,
    readFollowupAnswer,
    stopSpeech,
  };
}

function resolveFollowupContext(
  readiness: RemoteReadiness,
  currentImage: NormalizedSceneImage,
  result: {
    sceneToken: string;
    sceneTokenExpiresAt: string;
    profileId: string;
    locale: string;
  },
): FollowupSceneContext | undefined {
  const sceneExpiresAt = Date.parse(result.sceneTokenExpiresAt);
  if (!Number.isFinite(sceneExpiresAt) || sceneExpiresAt <= Date.now()) return undefined;
  const profile = readiness.catalog.profiles.find(
    (candidate) =>
      candidate.id === result.profileId &&
      candidate.supportsStreaming &&
      candidate.supportsFollowup,
  );
  if (!readiness.followupEnabled || !profile) return undefined;
  return {
    sceneToken: result.sceneToken,
    sceneTokenExpiresAt: result.sceneTokenExpiresAt,
    frozenProfileId: result.profileId,
    frozenLocale: result.locale,
  };
}

function isFollowupReady(readiness: RemoteReadiness, context: FollowupSceneContext): boolean {
  return (
    readiness.followupEnabled &&
    readiness.catalog.profiles.some(
      (profile) =>
        profile.id === context.frozenProfileId &&
        profile.supportsStreaming &&
        profile.supportsFollowup,
    )
  );
}
