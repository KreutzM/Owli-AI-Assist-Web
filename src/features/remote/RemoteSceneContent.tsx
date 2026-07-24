import type { ChangeEvent, RefObject } from 'react';
import type { RemoteSceneWorkflow } from '@/features/remote/useRemoteScene';

interface RemoteSceneContentProps {
  workflow: RemoteSceneWorkflow;
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraButtonRef: RefObject<HTMLButtonElement | null>;
  readinessEnabled: boolean;
  active: boolean;
  cameraVisible: boolean;
  profileLocked: boolean;
  videoReady: boolean;
  setVideoReady: (ready: boolean) => void;
  retryableImage: boolean;
  canDescribe: boolean;
  sceneRetrySeconds: number;
  sceneRetryReady: boolean;
}

export function RemoteSceneContent({
  workflow,
  videoRef,
  cameraButtonRef,
  readinessEnabled,
  active,
  cameraVisible,
  profileLocked,
  videoReady,
  setVideoReady,
  retryableImage,
  canDescribe,
  sceneRetrySeconds,
  sceneRetryReady,
}: RemoteSceneContentProps) {
  const { state, speechState } = workflow;

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
    <>
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
            disabled={!readinessEnabled || active || profileLocked}
            aria-describedby={profileLocked ? 'scene-profile-lock' : undefined}
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
          {profileLocked && (
            <p id="scene-profile-lock" className="field-hint">
              Das Profil bleibt für die aktuelle Szene fest. Wähle „Neues Bild“, um es zu ändern.
            </p>
          )}

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
        className={
          cameraVisible
            ? 'remote-camera-preview'
            : 'remote-camera-preview remote-camera-preview--hidden'
        }
        hidden={!cameraVisible}
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
        <div className="remote-scene-preview">
          <img
            className="remote-scene-preview__image"
            src={state.image.previewUrl}
            alt="Ausgewählte Szene"
          />
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
          {state.status === 'complete' && speechState !== 'unsupported' && (
            <div className="scene-actions speech-actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={workflow.readSceneDescription}
              >
                Beschreibung vorlesen
              </button>
              <button
                className="button button--secondary"
                type="button"
                disabled={speechState !== 'speaking'}
                onClick={workflow.stopSpeech}
              >
                Vorlesen stoppen
              </button>
            </div>
          )}
        </section>
      )}

      {(state.status === 'recoverable_error' ||
        state.status === 'contract_error' ||
        state.status === 'rate_limited') && (
        <div>
          <p className="live-status" role="alert">
            {state.errorMessage}
          </p>
          {state.status === 'rate_limited' && sceneRetrySeconds > 0 && (
            <p role="status">Erneut möglich in {sceneRetrySeconds} Sekunden.</p>
          )}
          <div className="scene-actions">
            {retryableImage && (
              <button
                className="button button--primary"
                type="button"
                disabled={!canDescribe}
                onClick={() => void workflow.describe()}
              >
                {state.status === 'rate_limited' && !sceneRetryReady
                  ? 'Erneut versuchen, sobald freigegeben'
                  : 'Mit dem vorbereiteten Bild erneut versuchen'}
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
    </>
  );
}

function formatBytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}
