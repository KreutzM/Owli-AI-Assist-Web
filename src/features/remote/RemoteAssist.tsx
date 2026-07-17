import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { RemoteAssistClient } from '@/core/api/remoteAssistClient';
import type { RemoteCamera } from '@/platform/camera/remoteCamera';
import type { BrowserSceneImageNormalizer } from '@/platform/image/browserSceneImageNormalizer';
import { useRemoteScene } from '@/features/remote/useRemoteScene';
import { useSceneAnnouncements } from '@/features/remote/useSceneAnnouncements';
import '@/features/remote/remote.css';

interface RemoteAssistProps {
  client: RemoteAssistClient;
  camera: RemoteCamera;
  normalizer: BrowserSceneImageNormalizer;
  locale: string;
}

export function RemoteAssist({ client, camera, normalizer, locale }: RemoteAssistProps) {
  const workflow = useRemoteScene(client, camera, normalizer, locale);
  const { state } = workflow;
  const announcement = useSceneAnnouncements(state);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  const readinessEnabled =
    state.readiness?.sceneDescribeEnabled === true && state.selectedProfileId !== undefined;
  const active = [
    'camera_starting',
    'normalizing',
    'requesting',
    'streaming',
    'terminal_waiting_for_eof',
  ].includes(state.status);
  const cameraVisible = state.status === 'camera_starting' || state.status === 'camera_ready';
  const canDescribe =
    state.image !== undefined &&
    ['prepared', 'cancelled', 'recoverable_error'].includes(state.status);

  useEffect(() => {
    if (
      state.status === 'recoverable_error' ||
      state.status === 'contract_error' ||
      state.status === 'cancelled'
    ) {
      cameraButtonRef.current?.focus();
    }
  }, [state.status]);

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selected = input.files?.[0];
    try {
      if (selected) await workflow.prepare(selected);
    } finally {
      input.value = '';
    }
  };

  return (
    <section className="panel remote-scene" aria-labelledby="remote-scene-title" aria-busy={active}>
      <p className="eyebrow">Sichere Online-Beschreibung</p>
      <h2 id="remote-scene-title">Eine Szene aufnehmen oder auswählen</h2>
      <p>
        Kamera und Datei werden erst nach deiner Aktion verwendet. Das Bild wird lokal geprüft, als
        JPEG verkleinert und nicht im Browser gespeichert.
      </p>

      {state.status === 'readiness_loading' && (
        <p className="live-status" role="status">
          Sichere Sitzung und Profile werden vorbereitet …
        </p>
      )}

      {state.status === 'readiness_unavailable' && (
        <div>
          <p className="live-status" role="alert">
            {state.errorMessage ??
              'Die Szenenbeschreibung ist in dieser Bereitstellung nicht freigegeben.'}
          </p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => void workflow.loadReadiness(true)}
          >
            Erneut prüfen
          </button>
        </div>
      )}

      {state.readiness && (
        <div className="scene-controls">
          <label htmlFor="scene-profile">Profil für die Beschreibung</label>
          <select
            id="scene-profile"
            value={state.selectedProfileId ?? ''}
            disabled={!readinessEnabled || active}
            onChange={(event) => workflow.selectProfile(event.currentTarget.value)}
          >
            {state.readiness.catalog.profiles
              .filter((profile) => profile.supportsStreaming)
              .map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
          </select>

          <div className="scene-source-actions">
            <button
              ref={cameraButtonRef}
              className="button button--primary"
              type="button"
              disabled={!readinessEnabled || active}
              onClick={() => {
                setVideoReady(false);
                if (videoRef.current) void workflow.startCamera(videoRef.current);
              }}
            >
              Rückkamera öffnen
            </button>

            <div className="file-control">
              <label htmlFor="scene-file">Oder ein Bild auswählen</label>
              <input
                id="scene-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!readinessEnabled || active}
                onChange={(event) => void selectFile(event)}
              />
            </div>
          </div>
        </div>
      )}

      <video
        ref={videoRef}
        className={cameraVisible ? 'camera-preview' : 'camera-preview camera-preview--hidden'}
        aria-label={cameraVisible ? 'Lokale Live-Vorschau der Rückkamera' : undefined}
        aria-hidden={!cameraVisible}
        muted
        playsInline
        onLoadedMetadata={() => setVideoReady(Boolean(videoRef.current?.videoWidth))}
        onCanPlay={() => setVideoReady(Boolean(videoRef.current?.videoWidth))}
      />

      {state.status === 'camera_starting' && <p role="status">Die Kamera wird gestartet …</p>}
      {state.status === 'camera_ready' && (
        <div className="scene-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={!videoReady}
            onClick={() => void workflow.capture()}
          >
            Bild aufnehmen
          </button>
          <button className="button button--secondary" type="button" onClick={workflow.cancel}>
            Kamera schließen
          </button>
        </div>
      )}

      {state.status === 'normalizing' && (
        <p role="status">Das Bild wird lokal geprüft und vorbereitet …</p>
      )}

      {state.image && (
        <div className="scene-preview">
          <img src={state.image.previewUrl} alt="Ausgewählte Szene" />
          <p>
            Normalisiertes JPEG: {state.image.width} × {state.image.height} Pixel,{' '}
            {formatBytes(state.image.byteLength)}
          </p>
        </div>
      )}

      {state.status === 'prepared' && (
        <div className="scene-actions">
          <button
            className="button button--primary"
            type="button"
            onClick={() => void workflow.describe()}
          >
            Szene beschreiben
          </button>
          <button className="button button--secondary" type="button" onClick={workflow.reset}>
            Bild verwerfen
          </button>
        </div>
      )}

      {['requesting', 'streaming', 'terminal_waiting_for_eof'].includes(state.status) && (
        <div className="scene-actions">
          <p role="status">
            {state.status === 'requesting'
              ? 'Die Anfrage wird gesendet …'
              : state.status === 'terminal_waiting_for_eof'
                ? 'Die Antwort wird sicher abgeschlossen …'
                : 'Die Beschreibung wird übertragen …'}
          </p>
          <button className="button button--secondary" type="button" onClick={workflow.cancel}>
            Abbrechen
          </button>
        </div>
      )}

      {state.streamedText && (
        <section className="scene-result" aria-labelledby="scene-result-title">
          <h3 id="scene-result-title">
            {state.status === 'complete' ? 'Szenenbeschreibung' : 'Laufende Beschreibung'}
          </h3>
          <p>{state.streamedText}</p>
        </section>
      )}

      {(state.status === 'recoverable_error' ||
        state.status === 'contract_error' ||
        state.status === 'rate_limited') && (
        <div>
          <p className="live-status" role="alert">
            {state.errorMessage}
          </p>
          <div className="scene-actions">
            {canDescribe && (
              <button
                className="button button--primary"
                type="button"
                onClick={() => void workflow.describe()}
              >
                Mit dem vorbereiteten Bild erneut versuchen
              </button>
            )}
            <button className="button button--secondary" type="button" onClick={workflow.reset}>
              Zurücksetzen
            </button>
          </div>
        </div>
      )}

      {state.status === 'cancelled' && (
        <div>
          <p className="live-status" role="status">
            Der Vorgang wurde abgebrochen.
          </p>
          <div className="scene-actions">
            {canDescribe && (
              <button
                className="button button--primary"
                type="button"
                onClick={() => void workflow.describe()}
              >
                Erneut senden
              </button>
            )}
            <button className="button button--secondary" type="button" onClick={workflow.reset}>
              Zurücksetzen
            </button>
          </div>
        </div>
      )}

      {state.status === 'complete' && (
        <button className="button button--secondary" type="button" onClick={workflow.reset}>
          Neues Bild
        </button>
      )}

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}

function formatBytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}
