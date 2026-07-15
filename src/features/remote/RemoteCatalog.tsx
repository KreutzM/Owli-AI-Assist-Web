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
  const [busy, setBusy] = useState(true);
  const currentCatalog = useRef<RemoteProfileCatalog | undefined>(undefined);
  const attempt = useRef(0);
  const activeController = useRef<AbortController | undefined>(undefined);

  const run = useCallback(
    async (refresh: boolean, showLoading: boolean) => {
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;
      const id = ++attempt.current;
      setBusy(true);
      if (!refresh && showLoading) setState({ status: 'loading' });

      try {
        const catalog = refresh
          ? await client.refresh(controller.signal)
          : await client.initialize(controller.signal);
        if (id !== attempt.current) return;
        currentCatalog.current = catalog;
        setState(catalog.profiles.length ? { status: 'ready', catalog } : { status: 'empty' });
      } catch (error) {
        if (id !== attempt.current) return;
        if (
          (error instanceof RemoteClientError && error.code === 'REQUEST_ABORTED') ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }
        if (refresh && currentCatalog.current) {
          setState({ status: 'refresh_failed', catalog: currentCatalog.current });
        } else if (error instanceof RemoteClientError && error.code === 'RATE_LIMITED') {
          setState({
            status: 'rate_limited',
            ...(error.retryAt !== undefined ? { retryAt: error.retryAt } : {}),
          });
        } else {
          setState({ status: 'unavailable' });
        }
      } finally {
        if (id === attempt.current && activeController.current === controller) {
          activeController.current = undefined;
          setBusy(false);
        }
      }
    },
    [client],
  );

  useEffect(() => {
    currentCatalog.current = undefined;
    let active = true;
    queueMicrotask(() => {
      if (active) void run(false, true);
    });
    return () => {
      active = false;
      attempt.current += 1;
      activeController.current?.abort();
      activeController.current = undefined;
    };
  }, [run]);

  const catalog =
    state.status === 'ready' || state.status === 'refresh_failed' ? state.catalog : undefined;

  return (
    <section className="panel remote-catalog" aria-labelledby="remote-title" aria-busy={busy}>
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

      {busy && catalog !== undefined && (
        <p className="live-status" role="status" aria-live="polite">
          Der Profilkatalog wird aktualisiert …
        </p>
      )}

      {state.status === 'empty' && (
        <div>
          <p className="live-status" role="status">
            Der Dienst ist erreichbar, bietet aktuell aber keine freigegebenen Profile an.
          </p>
          <RetryButton disabled={busy} onRetry={() => void run(false, false)} />
        </div>
      )}

      {state.status === 'rate_limited' && (
        <div>
          <p className="live-status" role="alert">
            Der Dienst ist vorübergehend ausgelastet. Bitte versuche es später erneut.
          </p>
          <RetryButton disabled={busy} onRetry={() => void run(false, false)} />
        </div>
      )}

      {state.status === 'unavailable' && (
        <div>
          <p className="live-status" role="alert">
            Die Online-Vorbereitung ist derzeit nicht verfügbar. Es wurden keine Inhalte übertragen.
          </p>
          <RetryButton disabled={busy} onRetry={() => void run(false, false)} />
        </div>
      )}

      {state.status === 'refresh_failed' && (
        <p className="live-status" role="status">
          Der vorhandene Profilkatalog bleibt sichtbar, konnte aber nicht aktualisiert werden.
        </p>
      )}

      {catalog !== undefined && (
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
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={() => void run(true, false)}
          >
            Profilkatalog aktualisieren
          </button>
        </>
      )}
    </section>
  );
}

function RetryButton({ disabled, onRetry }: { disabled: boolean; onRetry: () => void }) {
  return (
    <button className="button button--primary" type="button" disabled={disabled} onClick={onRetry}>
      Erneut versuchen
    </button>
  );
}
