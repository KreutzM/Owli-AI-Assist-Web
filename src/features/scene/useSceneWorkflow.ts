import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { OwliApi } from '@/core/types';
import { initialSceneState, sceneReducer } from '@/features/scene/sceneReducer';
import type { CameraGateway } from '@/platform/camera/types';

interface SceneWorkflowOptions {
  api: OwliApi;
  camera: CameraGateway;
  locale: string;
}

export function useSceneWorkflow({ api, camera, locale }: SceneWorkflowOptions) {
  const [state, dispatch] = useReducer(sceneReducer, initialSceneState);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const previewUrl = useRef<string | undefined>(undefined);

  const stopRequest = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
  }, []);

  useEffect(
    () => () => {
      stopRequest();
      camera.stop();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [camera, stopRequest],
  );

  const startCamera = useCallback(
    async (video: HTMLVideoElement) => {
      dispatch({ type: 'cameraStarting' });
      try {
        await camera.start(video);
        dispatch({ type: 'cameraReady' });
      } catch (error) {
        dispatch({ type: 'cameraFailed', message: toUserMessage(error) });
      }
    },
    [camera],
  );

  const captureAndDescribe = useCallback(
    async (profileId?: string) => {
      stopRequest();
      const controller = new AbortController();
      activeRequest.current = controller;
      dispatch({ type: 'captureStarted' });
      try {
        const image = await camera.capture();
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = URL.createObjectURL(image);
        dispatch({ type: 'imageCaptured', image, previewUrl: previewUrl.current });
        dispatch({ type: 'analysisStarted' });
        const scene = await api.describeScene({
          image,
          locale,
          ...(profileId ? { profileId } : {}),
          signal: controller.signal,
          onDelta: (delta) => dispatch({ type: 'analysisDelta', delta }),
        });
        dispatch({ type: 'analysisReady', scene });
      } catch (error) {
        if (!isAbortError(error)) {
          dispatch({ type: 'analysisFailed', message: toUserMessage(error) });
        }
      } finally {
        if (activeRequest.current === controller) activeRequest.current = undefined;
      }
    },
    [api, camera, locale, stopRequest],
  );

  const askFollowup = useCallback(
    async (questionText: string, profileId?: string) => {
      if (!state.scene) return;
      stopRequest();
      const controller = new AbortController();
      activeRequest.current = controller;
      dispatch({ type: 'followupStarted' });
      try {
        const result = await api.askFollowup({
          sceneToken: state.scene.sceneToken,
          questionText,
          ...(state.image ? { originalImage: state.image } : {}),
          locale,
          ...(profileId ? { profileId } : {}),
          signal: controller.signal,
          onDelta: (delta) => dispatch({ type: 'followupDelta', delta }),
        });
        dispatch({ type: 'followupReady', result });
      } catch (error) {
        if (!isAbortError(error)) {
          dispatch({ type: 'followupFailed', message: toUserMessage(error) });
        }
      } finally {
        if (activeRequest.current === controller) activeRequest.current = undefined;
      }
    },
    [api, locale, state.image, state.scene, stopRequest],
  );

  const reset = useCallback(() => {
    stopRequest();
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = undefined;
    dispatch({ type: 'reset' });
  }, [stopRequest]);

  return { state, startCamera, captureAndDescribe, askFollowup, reset, stopRequest };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function toUserMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ein unbekannter Fehler ist aufgetreten.';
}
