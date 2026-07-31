import { createRoot } from 'react-dom/client';
import type { RemoteAssistClient, RemoteReadiness } from '@/core/api/remoteAssistClient';
import { RemoteAssist } from '@/features/remote/RemoteAssist';
import type { RemoteCamera } from '@/platform/camera/remoteCamera';
import { BrowserSceneImageNormalizer } from '@/platform/image/browserSceneImageNormalizer';
import { BrowserSpeech } from '@/platform/speech/browserSpeech';
import '@/app/app.css';

const readiness: RemoteReadiness = {
  sceneDescribeEnabled: true,
  followupEnabled: false,
  audioPostcardEnabled: false,
  catalog: {
    defaultProfileId: 'brief',
    profiles: [
      {
        id: 'brief',
        label: 'Kurz',
        description: 'Lokaler Safari-JPEG-Test',
        supportsStreaming: true,
        supportsFollowup: false,
      },
    ],
  },
};

const localClient = {
  initialize: () => Promise.resolve(readiness),
  refreshCatalog: () => Promise.resolve(readiness),
  describeScene: () =>
    Promise.reject(new Error('Scene requests are disabled in the local Safari JPEG harness.')),
} as unknown as RemoteAssistClient;

const disabledCamera = {
  start: () =>
    Promise.reject(new Error('Camera access is disabled in the local Safari JPEG harness.')),
  capture: () =>
    Promise.reject(new Error('Camera capture is disabled in the local Safari JPEG harness.')),
  stop: () => undefined,
} as unknown as RemoteCamera;

const root = document.getElementById('root');
if (!root) throw new Error('Safari JPEG harness root is missing.');

createRoot(root).render(
  <main id="main-content" className="app-shell">
    <RemoteAssist
      client={localClient}
      camera={disabledCamera}
      normalizer={new BrowserSceneImageNormalizer()}
      speech={new BrowserSpeech()}
      locale="de-DE"
    />
  </main>,
);
