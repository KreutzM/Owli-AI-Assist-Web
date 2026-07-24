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
  image: MutableImageRef,
) {
  const activeController = useRef<AbortController | undefined>(undefined);
  const activeKind = useRef<ActiveRequestKind | undefined>(undefined);
  const attempt = useRef(0);

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
    [camera, image, speech],
  );

  return { activeController, activeKind, attempt, clearAttempt };
}
