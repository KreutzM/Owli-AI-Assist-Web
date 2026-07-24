import {
  FOLLOWUP_HISTORY_ITEM_MAX_LENGTH,
  FOLLOWUP_MAX_TRANSCRIPT_PAIRS,
  type FollowupTranscriptPair,
} from '@/core/api/remoteFollowupContracts';

export type RemoteFollowupStatus =
  | 'unavailable'
  | 'idle'
  | 'requesting'
  | 'streaming'
  | 'terminal_waiting_for_eof'
  | 'complete'
  | 'cancelled'
  | 'rate_limited'
  | 'recoverable_error'
  | 'context_expired'
  | 'contract_error';

export type FollowupFocusTarget = 'question' | 'new_scene';

export interface FollowupSceneContext {
  sceneToken: string;
  sceneTokenExpiresAt: string;
  frozenProfileId: string;
  frozenLocale: string;
}

export interface RemoteFollowupState {
  status: RemoteFollowupStatus;
  sceneToken: string | undefined;
  sceneTokenExpiresAt: string | undefined;
  frozenProfileId: string | undefined;
  frozenLocale: string | undefined;
  questionDraft: string;
  partialAnswer: string;
  completedAnswer: string | undefined;
  transcript: FollowupTranscriptPair[];
  retryAt: number | undefined;
  errorMessage: string | undefined;
  announcementRun: number | undefined;
  focusTarget: FollowupFocusTarget | undefined;
  focusRun: number | undefined;
}

export const INITIAL_FOLLOWUP_STATE: RemoteFollowupState = {
  status: 'unavailable',
  sceneToken: undefined,
  sceneTokenExpiresAt: undefined,
  frozenProfileId: undefined,
  frozenLocale: undefined,
  questionDraft: '',
  partialAnswer: '',
  completedAnswer: undefined,
  transcript: [],
  retryAt: undefined,
  errorMessage: undefined,
  announcementRun: undefined,
  focusTarget: undefined,
  focusRun: undefined,
};

export type FollowupAction =
  | { type: 'availability'; context?: FollowupSceneContext }
  | { type: 'draft_changed'; value: string }
  | { type: 'validation_failed'; message: string; focusRun: number }
  | { type: 'request_started'; announcementRun: number }
  | { type: 'metadata' }
  | { type: 'delta'; text: string }
  | { type: 'terminal' }
  | { type: 'completed'; question: string; answer: string; focusRun: number }
  | { type: 'cancelled'; focusRun: number }
  | {
      type: 'failed';
      status: 'rate_limited' | 'recoverable_error' | 'contract_error';
      message: string;
      focusRun: number;
      retryAt?: number;
    }
  | { type: 'context_expired'; message: string; focusRun: number }
  | { type: 'clear' };

export function followupReducer(
  state: RemoteFollowupState,
  action: FollowupAction,
): RemoteFollowupState {
  switch (action.type) {
    case 'availability':
      return action.context
        ? {
            ...state,
            status: state.status === 'unavailable' ? 'idle' : state.status,
            sceneToken: action.context.sceneToken,
            sceneTokenExpiresAt: action.context.sceneTokenExpiresAt,
            frozenProfileId: action.context.frozenProfileId,
            frozenLocale: action.context.frozenLocale,
            errorMessage: undefined,
          }
        : { ...INITIAL_FOLLOWUP_STATE };
    case 'draft_changed':
      return { ...state, questionDraft: action.value, errorMessage: undefined };
    case 'validation_failed':
      return {
        ...state,
        errorMessage: action.message,
        focusTarget: 'question',
        focusRun: action.focusRun,
      };
    case 'request_started':
      return {
        ...state,
        status: 'requesting',
        partialAnswer: '',
        completedAnswer: undefined,
        retryAt: undefined,
        errorMessage: undefined,
        announcementRun: action.announcementRun,
        focusTarget: undefined,
      };
    case 'metadata':
      if (state.status !== 'requesting') return state;
      return { ...state, status: 'streaming' };
    case 'delta':
      if (state.status !== 'streaming') return state;
      return { ...state, partialAnswer: state.partialAnswer + action.text };
    case 'terminal':
      if (state.status !== 'streaming' && state.status !== 'requesting') return state;
      return { ...state, status: 'terminal_waiting_for_eof' };
    case 'completed':
      return {
        ...state,
        status: 'complete',
        questionDraft: '',
        partialAnswer: '',
        completedAnswer: action.answer,
        transcript: appendCompletedPair(state.transcript, {
          question: action.question,
          answer: action.answer,
        }),
        retryAt: undefined,
        errorMessage: undefined,
        focusTarget: 'question',
        focusRun: action.focusRun,
      };
    case 'cancelled':
      return {
        ...state,
        status: 'cancelled',
        partialAnswer: '',
        completedAnswer: undefined,
        retryAt: undefined,
        errorMessage: undefined,
        focusTarget: 'question',
        focusRun: action.focusRun,
      };
    case 'failed':
      return {
        ...state,
        status: action.status,
        partialAnswer: '',
        completedAnswer: undefined,
        errorMessage: action.message,
        retryAt: action.retryAt,
        focusTarget: 'question',
        focusRun: action.focusRun,
      };
    case 'context_expired':
      return {
        ...INITIAL_FOLLOWUP_STATE,
        status: 'context_expired',
        questionDraft: state.questionDraft,
        errorMessage: action.message,
        focusTarget: 'new_scene',
        focusRun: action.focusRun,
      };
    case 'clear':
      return { ...INITIAL_FOLLOWUP_STATE };
  }
}

export function appendCompletedPair(
  transcript: readonly FollowupTranscriptPair[],
  pair: FollowupTranscriptPair,
): FollowupTranscriptPair[] {
  const next = [
    ...transcript,
    {
      question: pair.question.slice(0, FOLLOWUP_HISTORY_ITEM_MAX_LENGTH),
      answer: pair.answer.slice(0, FOLLOWUP_HISTORY_ITEM_MAX_LENGTH),
    },
  ];
  return next.slice(-FOLLOWUP_MAX_TRANSCRIPT_PAIRS);
}

export function isFollowupActive(status: RemoteFollowupStatus): boolean {
  return ['requesting', 'streaming', 'terminal_waiting_for_eof'].includes(status);
}

export function isFollowupSubmittable(status: RemoteFollowupStatus): boolean {
  return ['idle', 'complete', 'cancelled', 'rate_limited', 'recoverable_error'].includes(status);
}
