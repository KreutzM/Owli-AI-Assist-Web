import { useCallback, useRef } from 'react';
import type { RemoteCamera } from '@/platform/camera/remoteCamera';
import {
  revokeNormalizedSceneImage,
  type NormalizedSceneImage,
} from '@/platform/image/browserSceneImageNormalizer';
import type { SpeechLifecycleGateway } from '@/platform/speech/browserSpeech';
import type { ActiveRequestKind } from '@/features/remote/remoteWorkflowTypes';

interface MutableImageRef {
  current: NormalizedSceneImage | undefined;
}

export function useRemoteRequestLifecycle(
  camera: RemoteCamera,
  speech: SpeechLifecycleGateway,
  imageRef: MutableImageRef,
) {
  const activeControllerRef = useRef<AbortController | undefined>(undefined);
  const activeKindRef = useRef<ActiveRequestKind | undefined>(undefined);
  const attemptRef = useRef(0);

  const clearAttempt = useCallback(
    (retainImage: boolean) => {
      attemptRef.current += 1;
      activeControllerRef.current?.abort();
      activeControllerRef.current = undefined;
      activeKindRef.current = undefined;
      camera.stop();
      speech.stop();
      if (!retainImage) {
        revokeNormalizedSceneImage(imageRef.current);
        imageRef.current = undefined;
      }
    },
    [camera, imageRef, speech],
  );

  return { activeControllerRef, activeKindRef, attemptRef, clearAttempt };
}
