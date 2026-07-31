import type {
  AudioPostcardOptions,
  AudioPostcardQuota,
  AudioPostcardReadyResult,
  AudioPostcardTerminalResult,
} from '@/core/api/remoteAudioPostcardContracts';

export type AudioPostcardStatus =
  | 'unavailable'
  | 'loading_options'
  | 'idle'
  | 'preparing'
  | 'submitting'
  | 'generating'
  | 'ready'
  | 'stub'
  | 'not_available'
  | 'failed'
  | 'cancelled'
  | 'rate_limited'
  | 'timed_out'
  | 'recoverable_error'
  | 'contract_error'
  | 'expired';

export interface AudioPostcardState {
  status: AudioPostcardStatus;
  imageKey?: string;
  options?: AudioPostcardOptions;
  selectedProfileId?: string;
  selectedModeId?: string;
  requestRun: number;
  requestStartedAt?: number;
  result?: AudioPostcardTerminalResult;
  quota?: AudioPostcardQuota;
  retryAt?: number;
  errorCategory?: string;
  retryable?: boolean;
  ambiguousOutcome: boolean;
  playerState: 'empty' | 'metadata_ready' | 'playing' | 'paused' | 'error';
}

export const INITIAL_AUDIO_POSTCARD_STATE: AudioPostcardState = {
  status: 'unavailable',
  requestRun: 0,
  ambiguousOutcome: false,
  playerState: 'empty',
};

export type AudioPostcardAction =
  | { type: 'OPTIONS_LOADING'; imageKey: string; requestRun: number }
  | {
      type: 'OPTIONS_READY';
      imageKey: string;
      requestRun: number;
      options: AudioPostcardOptions;
      profileId: string;
      modeId: string;
    }
  | { type: 'OPTIONS_UNAVAILABLE'; imageKey: string; requestRun: number; category: string }
  | { type: 'SELECT_PROFILE'; profileId: string; modeId: string }
  | { type: 'PREPARE'; requestRun: number; startedAt: number }
  | { type: 'SUBMIT'; requestRun: number }
  | { type: 'GENERATE'; requestRun: number }
  | { type: 'TERMINAL'; requestRun: number; result: AudioPostcardTerminalResult }
  | {
      type: 'ERROR';
      requestRun: number;
      status: Extract<
        AudioPostcardStatus,
        | 'failed'
        | 'cancelled'
        | 'rate_limited'
        | 'timed_out'
        | 'recoverable_error'
        | 'contract_error'
        | 'expired'
      >;
      category?: string;
      quota?: AudioPostcardQuota;
      retryAt?: number;
      retryable?: boolean;
      ambiguousOutcome?: boolean;
    }
  | { type: 'PLAYER'; playerState: AudioPostcardState['playerState'] }
  | { type: 'EXPIRE' }
  | { type: 'RESET'; requestRun: number };

export function audioPostcardReducer(
  state: AudioPostcardState,
  action: AudioPostcardAction,
): AudioPostcardState {
  if ('requestRun' in action && action.type !== 'RESET' && action.requestRun < state.requestRun) {
    return state;
  }

  switch (action.type) {
    case 'OPTIONS_LOADING':
      return {
        status: 'loading_options',
        imageKey: action.imageKey,
        requestRun: action.requestRun,
        ambiguousOutcome: false,
        playerState: 'empty',
      };
    case 'OPTIONS_READY':
      if (state.status !== 'loading_options' || state.imageKey !== action.imageKey) return state;
      return {
        status: 'idle',
        imageKey: action.imageKey,
        requestRun: action.requestRun,
        options: action.options,
        selectedProfileId: action.profileId,
        selectedModeId: action.modeId,
        ambiguousOutcome: false,
        playerState: 'empty',
      };
    case 'OPTIONS_UNAVAILABLE':
      return {
        status: 'unavailable',
        imageKey: action.imageKey,
        requestRun: action.requestRun,
        errorCategory: action.category,
        ambiguousOutcome: false,
        playerState: 'empty',
      };
    case 'SELECT_PROFILE':
      if (!state.options || isAudioPostcardActive(state.status)) return state;
      return {
        ...state,
        selectedProfileId: action.profileId,
        selectedModeId: action.modeId,
      };
    case 'PREPARE':
      if (
        !state.options ||
        !state.selectedProfileId ||
        !state.selectedModeId ||
        !canStartAudioPostcard(state.status)
      ) {
        return state;
      }
      return {
        ...retainRetryContext(state),
        status: 'preparing',
        requestRun: action.requestRun,
        requestStartedAt: action.startedAt,
        ambiguousOutcome: false,
        playerState: 'empty',
      };
    case 'SUBMIT':
      return state.status === 'preparing' && state.requestRun === action.requestRun
        ? { ...state, status: 'submitting' }
        : state;
    case 'GENERATE':
      return state.status === 'submitting' && state.requestRun === action.requestRun
        ? { ...state, status: 'generating' }
        : state;
    case 'TERMINAL':
      if (!isAudioPostcardActive(state.status) || state.requestRun !== action.requestRun) {
        return state;
      }
      return terminalState(state, action.result);
    case 'ERROR':
      if (action.requestRun < state.requestRun) return state;
      return {
        ...retainRetryContext(state),
        status: action.status,
        requestRun: action.requestRun,
        ...(action.category ? { errorCategory: action.category } : {}),
        ...(action.quota ? { quota: action.quota } : {}),
        ...(action.retryAt !== undefined ? { retryAt: action.retryAt } : {}),
        ...(action.retryable !== undefined ? { retryable: action.retryable } : {}),
        ambiguousOutcome: action.ambiguousOutcome ?? false,
        playerState: action.status === 'expired' ? 'error' : 'empty',
      };
    case 'PLAYER':
      return state.status === 'ready' ? { ...state, playerState: action.playerState } : state;
    case 'EXPIRE':
      return state.status === 'ready'
        ? {
            ...state,
            status: 'expired',
            ambiguousOutcome: false,
            playerState: 'error',
          }
        : state;
    case 'RESET':
      return { ...INITIAL_AUDIO_POSTCARD_STATE, requestRun: action.requestRun };
  }
}

export function isAudioPostcardActive(status: AudioPostcardStatus): boolean {
  return status === 'preparing' || status === 'submitting' || status === 'generating';
}

export function canStartAudioPostcard(status: AudioPostcardStatus): boolean {
  return [
    'idle',
    'cancelled',
    'rate_limited',
    'timed_out',
    'recoverable_error',
    'failed',
    'expired',
  ].includes(status);
}

function terminalState(
  state: AudioPostcardState,
  result: AudioPostcardTerminalResult,
): AudioPostcardState {
  const common = {
    ...retainRetryContext(state),
    result,
    quota: result.quota,
    ambiguousOutcome: false,
  };
  if (result.status === 'ready') {
    return {
      ...common,
      status: 'ready',
      playerState: 'metadata_ready',
    };
  }
  return {
    ...common,
    status: result.status,
    ...(result.status === 'failed'
      ? { errorCategory: result.category, retryable: result.retryable }
      : {}),
    playerState: 'empty',
  };
}

function retainRetryContext(
  state: AudioPostcardState,
): Pick<
  AudioPostcardState,
  'imageKey' | 'options' | 'selectedProfileId' | 'selectedModeId' | 'requestRun'
> {
  return {
    ...(state.imageKey ? { imageKey: state.imageKey } : {}),
    ...(state.options ? { options: state.options } : {}),
    ...(state.selectedProfileId ? { selectedProfileId: state.selectedProfileId } : {}),
    ...(state.selectedModeId ? { selectedModeId: state.selectedModeId } : {}),
    requestRun: state.requestRun,
  };
}

export function readyAudioPostcardResult(
  state: AudioPostcardState,
): AudioPostcardReadyResult | undefined {
  return state.result?.status === 'ready' ? state.result : undefined;
}
