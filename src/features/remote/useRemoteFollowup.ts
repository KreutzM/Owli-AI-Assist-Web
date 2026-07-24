import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  FOLLOWUP_QUESTION_MAX_LENGTH,
  type FollowupTranscriptPair,
} from '@/core/api/remoteFollowupContracts';
import type { RemoteSceneResult } from '@/core/api/remoteSceneContracts';
import {
  RemoteClientError,
  type RemoteAssistClient,
  type RemoteReadiness,
} from '@/core/api/remoteAssistClient';
import type { NormalizedSceneImage } from '@/platform/image/browserSceneImageNormalizer';
import type { SpeechLifecycleGateway, SpeechState } from '@/platform/speech/browserSpeech';
import {
  appendCompletedPair,
  followupReducer,
  INITIAL_FOLLOWUP_STATE,
  isFollowupSubmittable,
  type FollowupSceneContext,
} from '@/features/remote/followupState';
import {
  followupMessage,
  isRemoteSceneAbort,
  remoteFollowupErrorStatus,
} from '@/features/remote/remoteSceneErrors';
import type { ActiveRequestKind } from '@/features/remote/remoteWorkflowTypes';

interface MutableValue<T> {
  current: T;
}

interface UseRemoteFollowupOptions {
  client: RemoteAssistClient;
  speech: SpeechLifecycleGateway;
  activeControllerRef: MutableValue<AbortController | undefined>;
  activeKindRef: MutableValue<ActiveRequestKind | undefined>;
  attemptRef: MutableValue<number>;
  readinessRef: MutableValue<RemoteReadiness | undefined>;
  imageRef: MutableValue<NormalizedSceneImage | undefined>;
  clearAttempt: (retainImage: boolean) => void;
}

export function useRemoteFollowup({
  client,
  speech,
  activeControllerRef,
  activeKindRef,
  attemptRef,
  readinessRef,
  imageRef,
  clearAttempt,
}: UseRemoteFollowupOptions) {
  const [followup, dispatchFollowup] = useReducer(followupReducer, INITIAL_FOLLOWUP_STATE);
  const [speechState, setSpeechState] = useState<SpeechState>(speech.state);
  const focusRun = useRef(0);
  const followupRetryAt = useRef<number | undefined>(undefined);
  const sceneContext = useRef<FollowupSceneContext | undefined>(undefined);
  const transcript = useRef<FollowupTranscriptPair[]>([]);
  const questionDraft = useRef('');
  const completedSceneText = useRef<string | undefined>(undefined);
  const completedSceneLocale = useRef<string | undefined>(undefined);

  useEffect(() => speech.subscribe(setSpeechState), [speech]);

  const clearSceneContextRefs = useCallback((clearDraft: boolean) => {
    sceneContext.current = undefined;
    transcript.current = [];
    followupRetryAt.current = undefined;
    completedSceneText.current = undefined;
    completedSceneLocale.current = undefined;
    if (clearDraft) questionDraft.current = '';
  }, []);

  const clearSceneContext = useCallback(
    (clearDraft: boolean) => {
      clearSceneContextRefs(clearDraft);
      dispatchFollowup({ type: 'clear' });
    },
    [clearSceneContextRefs],
  );

  const completeScene = useCallback(
    (
      currentReadiness: RemoteReadiness,
      currentImage: NormalizedSceneImage,
      result: RemoteSceneResult,
    ) => {
      completedSceneText.current = result.answerText;
      completedSceneLocale.current = result.locale;
      const context = resolveFollowupContext(currentReadiness, currentImage, result);
      sceneContext.current = context;
      dispatchFollowup(context ? { type: 'availability', context } : { type: 'availability' });
    },
    [],
  );

  const updateQuestionDraft = useCallback((value: string) => {
    questionDraft.current = value;
    dispatchFollowup({ type: 'draft_changed', value });
  }, []);

  const submitFollowup = useCallback(async () => {
    const currentContext = sceneContext.current;
    const currentImage = imageRef.current;
    const currentReadiness = readinessRef.current;
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
    if (!isFollowupSubmittable(followup.status) || activeControllerRef.current) return;

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
    const id = attemptRef.current;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    activeKindRef.current = 'followup';
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
            if (id === attemptRef.current) dispatchFollowup({ type: 'metadata' });
          },
          onDelta: (text) => {
            if (id === attemptRef.current) dispatchFollowup({ type: 'delta', text });
          },
          onTerminal: () => {
            if (id === attemptRef.current) dispatchFollowup({ type: 'terminal' });
          },
        },
        controller.signal,
      );
      if (id !== attemptRef.current || controller.signal.aborted) return;
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
      if (id !== attemptRef.current || isRemoteSceneAbort(error)) return;
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
    client,
    followup.status,
    imageRef,
    readinessRef,
  ]);

  const cancelFollowup = useCallback(() => {
    if (activeKindRef.current !== 'followup') return;
    clearAttempt(true);
    followupRetryAt.current = undefined;
    dispatchFollowup({ type: 'cancelled', focusRun: ++focusRun.current });
  }, [activeKindRef, clearAttempt]);

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
    followup,
    speechState,
    clearSceneContext,
    clearSceneContextRefs,
    completeScene,
    updateQuestionDraft,
    submitFollowup,
    cancelFollowup,
    readSceneDescription,
    readFollowupAnswer,
    stopSpeech,
  };
}

function resolveFollowupContext(
  readinessRef: RemoteReadiness,
  currentImage: NormalizedSceneImage | undefined,
  result: RemoteSceneResult,
): FollowupSceneContext | undefined {
  const sceneExpiresAt = Date.parse(result.sceneTokenExpiresAt);
  if (!Number.isFinite(sceneExpiresAt) || sceneExpiresAt <= Date.now()) return undefined;
  const profile = readinessRef.catalog.profiles.find(
    (candidate) =>
      candidate.id === result.profileId &&
      candidate.supportsStreaming &&
      candidate.supportsFollowup,
  );
  if (!readinessRef.followupEnabled || !profile || !currentImage) return undefined;
  return {
    sceneToken: result.sceneToken,
    sceneTokenExpiresAt: result.sceneTokenExpiresAt,
    frozenProfileId: result.profileId,
    frozenLocale: result.locale,
  };
}

function isFollowupReady(readinessRef: RemoteReadiness, context: FollowupSceneContext): boolean {
  return (
    readinessRef.followupEnabled &&
    readinessRef.catalog.profiles.some(
      (profile) =>
        profile.id === context.frozenProfileId &&
        profile.supportsStreaming &&
        profile.supportsFollowup,
    )
  );
}
