import type { FollowupResult, SceneResult } from '@/core/types';

export interface SceneState {
  cameraStatus: 'idle' | 'starting' | 'ready' | 'error';
  requestStatus: 'idle' | 'capturing' | 'analyzing' | 'ready' | 'error';
  image: Blob | undefined;
  previewUrl: string | undefined;
  streamedText: string;
  scene: SceneResult | undefined;
  followupStatus: 'idle' | 'asking' | 'ready' | 'error';
  followupText: string;
  followup: FollowupResult | undefined;
  errorMessage: string | undefined;
}

export const initialSceneState: SceneState = {
  cameraStatus: 'idle',
  requestStatus: 'idle',
  image: undefined,
  previewUrl: undefined,
  streamedText: '',
  scene: undefined,
  followupStatus: 'idle',
  followupText: '',
  followup: undefined,
  errorMessage: undefined,
};

type SceneAction =
  | { type: 'cameraStarting' }
  | { type: 'cameraReady' }
  | { type: 'cameraFailed'; message: string }
  | { type: 'captureStarted' }
  | { type: 'imageCaptured'; image: Blob; previewUrl: string }
  | { type: 'analysisStarted' }
  | { type: 'analysisDelta'; delta: string }
  | { type: 'analysisReady'; scene: SceneResult }
  | { type: 'analysisFailed'; message: string }
  | { type: 'followupStarted' }
  | { type: 'followupDelta'; delta: string }
  | { type: 'followupReady'; result: FollowupResult }
  | { type: 'followupFailed'; message: string }
  | { type: 'reset' };

export function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.type) {
    case 'cameraStarting':
      return { ...state, cameraStatus: 'starting', errorMessage: undefined };
    case 'cameraReady':
      return { ...state, cameraStatus: 'ready', errorMessage: undefined };
    case 'cameraFailed':
      return { ...state, cameraStatus: 'error', errorMessage: action.message };
    case 'captureStarted':
      return {
        ...state,
        requestStatus: 'capturing',
        streamedText: '',
        scene: undefined,
        followup: undefined,
        followupText: '',
        errorMessage: undefined,
      };
    case 'imageCaptured':
      return { ...state, image: action.image, previewUrl: action.previewUrl };
    case 'analysisStarted':
      return { ...state, requestStatus: 'analyzing' };
    case 'analysisDelta':
      return { ...state, streamedText: state.streamedText + action.delta };
    case 'analysisReady':
      return {
        ...state,
        requestStatus: 'ready',
        streamedText: action.scene.answerText,
        scene: action.scene,
      };
    case 'analysisFailed':
      return { ...state, requestStatus: 'error', errorMessage: action.message };
    case 'followupStarted':
      return { ...state, followupStatus: 'asking', followupText: '', errorMessage: undefined };
    case 'followupDelta':
      return { ...state, followupText: state.followupText + action.delta };
    case 'followupReady':
      return {
        ...state,
        followupStatus: 'ready',
        followupText: action.result.answerText,
        followup: action.result,
      };
    case 'followupFailed':
      return { ...state, followupStatus: 'error', errorMessage: action.message };
    case 'reset':
      return { ...initialSceneState, cameraStatus: state.cameraStatus };
  }
}
