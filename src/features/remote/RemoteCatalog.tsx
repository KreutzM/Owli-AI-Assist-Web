import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteClientError, type RemoteCatalogClient } from '@/core/api/remoteCatalogClient';
import type { RemoteProfileCatalog } from '@/core/api/remoteCatalogContracts';

type State =
  | { status: 'loading' }
  | { status: 'ready'; catalog: RemoteProfileCatalog }
  | { status: 'empty' }
  | { status: 'refresh_failed'; catalog: RemoteProfileCatalog }
  | { status: 'rate_limited'; retryAt?: number }
  | { status: 'unavailable' };

export function RemoteCatalog({ client }: { client: RemoteCatalogClient }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const currentCatalog = useRef<RemoteProfileCatalog>();
  const attempt = useRef(0);

  const run = useCallback(
    async (refresh: boolean) => {
      const id = ++attempt.current;
      const controller = new AbortController();
      if (!refresh) setState({ status: 'loading' });
      try {
        const catalog = refresh
          ? await client.refresh(controller.signal)
          : await client.initialize(controller.signal);
        if (id !== attempt.current) return;
        currentCatalog.current = catalog;
        setState(catalog.profiles.length ? { status: 'ready', catalog } : { status: 'empty' });
      } catch (error) {
        if (id !== attempt.current) return;
        if (error instanceof RemoteClientError && error.code === 'REQUEST_ABORTED') return;
        if (refresh && currentCatalog.current) {
          setState({ status: 'refresh_failed', catalog: currentCatalog.current });
        } else if (error instanceof RemoteClientError && error.code === 'RATE_LIMITED') {
          setState({
            status: 'rate_limited',
            ...(error.retryAt ? { retryAt: error.retryAt } : {}),
          });
        } else {
          setState({ status: 'unavailable' });
        }
      }
      return () => controller.abort();
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    const id = ++attempt.current;
    setState({ status: 'loading' });
    void client
      .initialize(controller.signal)
      .then((catalog) => {
        if (id !== attempt.current) return;
        currentCatalog.current = catalog;
        setState(catalog.profiles.length ? { status: 'ready', catalog } : { status: 'empty' });
      })
      .catch((error: unknown) => {
        if (id !== attempt.current) return;
        if (error instanceof RemoteClientError && error.code === 'REQUEST_ABORTED') return;
        if (error instanceof RemoteClientError && error.code === 'RATE_LIMITED') {
          setState({
            status: 'rate_limited',
            ...(error.retryAt ? { retryAt: error.retryAt } : {}),
          });
        } else {
          setState({ status: 'unavailable' });
        }
      });
    return () => {
      controller.abort();
      attempt.current += 1;
    };
  }, [client]);

  const catalog =
    state.status === 'ready' || state.status === 'refresh_failed' ? state.catalog : undefined;

  return (
    <section className="panel remote-catalog" aria-labelledby="remote-title">
      <p className="eyebrow">Online-Vorbereitung</p>
      <h2 id="remote-title">Backend-Bereitschaft und Profile</h2>
      <p>
        Diese Ansicht prüft nur Konfiguration, private Sitzung und den Profilkatalog. Reale
        Szenenanalyse, Kamera, Upload, Rückfragen, Audio und Video bleiben bis zu späteren Slices
        deaktiviert.
      </p>

      {state.status === 'loading' && (
        <p className="live-status" role="status" aria-live="polite">
          Sichere Verbindung und Profilkatalog werden vorbereitet …
        </p>
      )}

      {state.status === 'empty' && (
        <div>
          <p className="live-status" role="status">
            Der Dienst ist erreichbar, bietet aktuell aber keine freigegebenen Profile an.
          </p>
          <RetryButton onRetry={() => void run(false)} />
        </div>
      )}

      {state.status === 'rate_limited' && (
        <div>
          <p className="live-status" role="alert">
            Der Dienst ist vorübergehend ausgelastet. Bitte versuche es später erneut.
          </p>
          <RetryButton onRetry={() => void run(false)} />
        </div>
      )}

      {state.status === 'unavailable' && (
        <div>
          <p className="live-status" role="alert">
            Die Online-Vorbereitung ist derzeit nicht verfügbar. Es wurden keine Inhalte übertragen.
          </p>
          <RetryButton onRetry={() => void run(false)} />
        </div>
      )}

      {state.status === 'refresh_failed' && (
        <p className="live-status" role="status">
          Der vorhandene Profilkatalog bleibt sichtbar, konnte aber nicht aktualisiert werden.
        </p>
      )}

      {catalog && (
        <>
          <ul className="profile-list" aria-label="Verfügbare Backend-Profile">
            {catalog.profiles.map((profile) => (
              <li key={profile.id}>
                <h3>{profile.label}</h3>
                <p>{profile.description}</p>
                {profile.id === catalog.defaultProfileId && <strong>Backend-Standardprofil</strong>}
              </li>
            ))}
          </ul>
          <button className="button button--secondary" type="button" onClick={() => void run(true)}>
            Profilkatalog aktualisieren
          </button>
        </>
      )}
    </section>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button className="button button--primary" type="button" onClick={onRetry}>
      Erneut versuchen
    </button>
  );
}
