import { useMemo } from 'react';
import { createOwliApi } from '@/core/api/owliApi';
import { readRuntimeConfig } from '@/core/config/runtimeConfig';
import { AudioPostcardPanel } from '@/features/postcard/AudioPostcardPanel';
import { SceneWorkspace } from '@/features/scene/SceneWorkspace';
import { BrowserCamera } from '@/platform/camera/browserCamera';
import { BrowserShare } from '@/platform/share/browserShare';
import { BrowserSpeech } from '@/platform/speech/browserSpeech';
import '@/app/app.css';

export function App() {
  const config = useMemo(() => readRuntimeConfig(), []);
  const api = useMemo(() => createOwliApi(config), [config]);
  const camera = useMemo(() => new BrowserCamera(), []);
  const share = useMemo(() => new BrowserShare(), []);
  const speech = useMemo(() => new BrowserSpeech(), []);

  return (
    <>
      <header className="site-header">
        <div>
          <p className="brand-kicker">Owli-AI</p>
          <h1>Assist im Browser</h1>
          <p className="header-copy">
            Szenen verstehen, Rückfragen stellen und Audio-Postcards erstellen – ohne App-Store.
          </p>
        </div>
        <span className="mode-badge">{config.apiMode === 'mock' ? 'Demo-Modus' : 'Online'}</span>
      </header>
      <main id="main-content" className="app-shell">
        <section className="intro-card" aria-labelledby="intro-title">
          <h2 id="intro-title">Direkt starten</h2>
          <p>
            Die Kamera wird erst nach deiner Zustimmung aktiviert. Bilder werden im Online-Modus nur
            für die gewählte Funktion an das Owli-Backend übertragen.
          </p>
        </section>
        <SceneWorkspace
          api={api}
          camera={camera}
          speech={speech}
          locale={config.defaultLocale}
          renderPostcard={(image) => (
            <AudioPostcardPanel
              api={api}
              share={share}
              image={image}
              locale={config.defaultLocale}
            />
          )}
        />
      </main>
      <footer className="site-footer">
        <a href="https://owli-ai.com/privacy/assist/">Datenschutz</a>
        <a href="https://owli-ai.com/accessibility/">Barrierefreiheit</a>
        <a href="https://owli-ai.com/support/">Hilfe</a>
      </footer>
    </>
  );
}
