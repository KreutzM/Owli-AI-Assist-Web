import { useMemo } from 'react';
import { createAppRuntime } from '@/app/runtime';
import { AudioPostcardPanel } from '@/features/postcard/AudioPostcardPanel';
import { RemoteAssist } from '@/features/remote/RemoteAssist';
import { SceneWorkspace } from '@/features/scene/SceneWorkspace';
import { BrowserCamera } from '@/platform/camera/browserCamera';
import { RemoteCamera } from '@/platform/camera/remoteCamera';
import { BrowserSceneImageNormalizer } from '@/platform/image/browserSceneImageNormalizer';
import { BrowserShare } from '@/platform/share/browserShare';
import { BrowserSpeech } from '@/platform/speech/browserSpeech';
import '@/app/app.css';

export function App() {
  const runtime = useMemo(() => createAppRuntime(), []);

  return (
    <>
      <header className="site-header">
        <div>
          <p className="brand-kicker">Owli-AI</p>
          <h1>Assist im Browser</h1>
          <p className="header-copy">
            {runtime.mode === 'remote'
              ? 'Eine Szene aufnehmen oder auswählen, beschreiben lassen und Rückfragen stellen.'
              : 'Szenen verstehen, Rückfragen stellen und Audio-Postcards erstellen – ohne App-Store.'}
          </p>
        </div>
        <span className="mode-badge">
          {runtime.mode === 'mock'
            ? 'Demo-Modus'
            : runtime.mode === 'remote'
              ? 'Sichere Online-Beschreibung'
              : 'Konfigurationsfehler'}
        </span>
      </header>
      <main id="main-content" className="app-shell">
        {runtime.mode === 'mock' && <MockApplication runtime={runtime} />}
        {runtime.mode === 'remote' && <RemoteApplication runtime={runtime} />}
        {runtime.mode === 'invalid_configuration' && (
          <section className="panel" aria-labelledby="configuration-title">
            <p className="eyebrow">Sicher angehalten</p>
            <h2 id="configuration-title">Online-Konfiguration nicht verfügbar</h2>
            <p className="live-status" role="alert">
              Die Anwendung wurde ohne Netzwerkzugriff angehalten. Bitte prüfe die freigegebene
              Bereitstellungskonfiguration.
            </p>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <a href="https://owli-ai.com/privacy/assist/">Datenschutz</a>
        <a href="https://owli-ai.com/accessibility/">Barrierefreiheit</a>
        <a href="https://owli-ai.com/support/">Hilfe</a>
      </footer>
    </>
  );
}

function RemoteApplication({
  runtime,
}: {
  runtime: Extract<ReturnType<typeof createAppRuntime>, { mode: 'remote' }>;
}) {
  const camera = useMemo(() => new RemoteCamera(), []);
  const normalizer = useMemo(() => new BrowserSceneImageNormalizer(), []);
  const speech = useMemo(() => new BrowserSpeech(), []);
  return (
    <RemoteAssist
      client={runtime.assistClient}
      camera={camera}
      normalizer={normalizer}
      speech={speech}
      locale={runtime.defaultLocale}
    />
  );
}

function MockApplication({
  runtime,
}: {
  runtime: Extract<ReturnType<typeof createAppRuntime>, { mode: 'mock' }>;
}) {
  const camera = useMemo(() => new BrowserCamera(), []);
  const share = useMemo(() => new BrowserShare(), []);
  const speech = useMemo(() => new BrowserSpeech(), []);

  return (
    <>
      <section className="intro-card" aria-labelledby="intro-title">
        <h2 id="intro-title">Direkt starten</h2>
        <p>
          Die Kamera wird erst nach deiner Zustimmung aktiviert. Der Demo-Modus verarbeitet keine
          Inhalte über das Backend.
        </p>
      </section>
      <SceneWorkspace
        api={runtime.api}
        camera={camera}
        speech={speech}
        locale={runtime.defaultLocale}
        renderPostcard={(image) => (
          <AudioPostcardPanel
            api={runtime.api}
            share={share}
            image={image}
            locale={runtime.defaultLocale}
          />
        )}
      />
    </>
  );
}
