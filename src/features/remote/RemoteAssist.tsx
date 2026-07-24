import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { FOLLOWUP_QUESTION_MAX_LENGTH } from '@/core/api/remoteFollowupContracts';
import type { RemoteAssistClient } from '@/core/api/remoteAssistClient';
import type { RemoteCamera } from '@/platform/camera/remoteCamera';
import type { BrowserSceneImageNormalizer } from '@/platform/image/browserSceneImageNormalizer';
import type { SpeechLifecycleGateway } from '@/platform/speech/browserSpeech';
import { isFollowupActive } from '@/features/remote/followupState';
import { useFollowupAnnouncements } from '@/features/remote/useFollowupAnnouncements';
import { useRemoteScene } from '@/features/remote/useRemoteScene';
import { useSceneAnnouncements } from '@/features/remote/useSceneAnnouncements';
import '@/features/remote/remote.css';

interface RemoteAssistProps {
  client: RemoteAssistClient;
  camera: RemoteCamera;
  normalizer: BrowserSceneImageNormalizer;
  speech: SpeechLifecycleGateway;
  locale: string;
}

export function RemoteAssist({ client, camera, normalizer, speech, locale }: RemoteAssistProps) {
  const workflow = useRemoteScene(client, camera, normalizer, speech, locale);
  const { state, followup, speechState } = workflow;
  const sceneAnnouncement = useSceneAnnouncements(state);
  const followupAnnouncement = useFollowupAnnouncements(followup);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const newSceneButtonRef = useRef<HTMLButtonElement>(null);
  const previousSceneStatus = useRef(state.status);
  const [videoReady, setVideoReady] = useState(false);
  const [retryClock, setRetryClock] = useState(() => Date.now());

  const readinessEnabled =
    state.readiness?.sceneDescribeEnabled === true && state.selectedProfileId !== undefined;
  const sceneActive = [
    'camera_starting',
    'normalizing',
    'requesting',
    'streaming',
    'terminal_waiting_for_eof',
  ].includes(state.status);
  const followupActive = isFollowupActive(followup.status);
  const active = sceneActive || followupActive;
  const cameraVisible = state.status === 'camera_starting' || state.status === 'camera_ready';
  const sceneRetrySeconds =
    state.status === 'rate_limited' && state.retryAt !== undefined
      ? Math.max(0, Math.ceil((state.retryAt - retryClock) / 1000))
      : 0;
  const followupRetrySeconds =
    followup.status === 'rate_limited' && followup.retryAt !== undefined
      ? Math.max(0, Math.ceil((followup.retryAt - retryClock) / 1000))
      : 0;
  const sceneRetryReady =
    state.status !== 'rate_limited' || state.retryAt === undefined || retryClock >= state.retryAt;
  const followupRetryReady =
    followup.status !== 'rate_limited' ||
    followup.retryAt === undefined ||
    retryClock >= followup.retryAt;
  const retryableImage =
    state.image !== undefined &&
    ['prepared', 'cancelled', 'recoverable_error', 'rate_limited'].includes(state.status);
  const canDescribe = retryableImage && sceneRetryReady && !followupActive;
  const profileLocked = state.image !== undefined;
  const followupVisible = state.status === 'complete' && followup.status !== 'unavailable';
  const canSubmitFollowup =
    followupVisible &&
    followup.status !== 'context_expired' &&
    !followupActive &&
    followupRetryReady &&
    Boolean(followup.questionDraft.trim());
  const remainingQuestionCharacters =
    FOLLOWUP_QUESTION_MAX_LENGTH - followup.questionDraft.length;

  useEffect(() => {
    const unlockAt = [state.retryAt, followup.retryAt]
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right)[0];
    if (unlockAt === undefined || retryClock >= unlockAt) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setRetryClock(current);
      if (current >= unlockAt) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [followup.retryAt, retryClock, state.retryAt]);

  useEffect(() => {
    if (
      state.status === 'recoverable_error' ||
      state.status === 'contract_error' ||
      state.status === 'cancelled'
    ) {
      cameraButtonRef.current?.focus();
    }
  }, [state.status]);

  useEffect(() => {
    if (followup.focusTarget === 'question') questionRef.current?.focus();
    if (followup.focusTarget === 'new_scene') newSceneButtonRef.current?.focus();
  }, [followup.focusRun, followup.focusTarget]);

  useEffect(() => {
    if (
      previousSceneStatus.current !== 'complete' &&
      state.status === 'complete' &&
      followup.status === 'idle'
    ) {
      questionRef.current?.focus();
    }
    previousSceneStatus.current = state.status;
  }, [followup.status, state.status]);

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selected = input.files?.[0];
    try {
      if (selected) await workflow.prepare(selected);
    } finally {
      input.value = '';
    }
  };

  const submitFollowup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void workflow.submitFollowup();
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

      {followupVisible && (
        <section className="followup-panel" aria-labelledby="followup-title">
          <h3 id="followup-title">Rückfragen zur aktuellen Szene</h3>
          <form className="followup-form" onSubmit={submitFollowup}>
            <label htmlFor="scene-followup-question">Rückfrage zur aktuellen Szene</label>
            <textarea
              ref={questionRef}
              id="scene-followup-question"
              value={followup.questionDraft}
              maxLength={FOLLOWUP_QUESTION_MAX_LENGTH}
              rows={3}
              disabled={followupActive || followup.status === 'context_expired'}
              aria-invalid={Boolean(followup.errorMessage)}
              aria-describedby="followup-character-count followup-help"
              placeholder="Zum Beispiel: Was steht auf dem Schild?"
              onChange={(event) => workflow.updateQuestionDraft(event.currentTarget.value)}
            />
            <div className="followup-field-meta">
              <p id="followup-help" className="field-hint">
                Die Frage bezieht sich nur auf die aktuelle, im Speicher gehaltene Szene.
              </p>
              <p id="followup-character-count" className="field-hint">
                {remainingQuestionCharacters} Zeichen verbleiben
              </p>
            </div>

            {followup.errorMessage && (
              <p className="live-status" role="alert">
                {followup.errorMessage}
              </p>
            )}
            {followup.status === 'rate_limited' && followupRetrySeconds > 0 && (
              <p role="status">Erneut möglich in {followupRetrySeconds} Sekunden.</p>
            )}
            {followup.status === 'cancelled' && (
              <p className="live-status" role="status">
                Die Rückfrage wurde abgebrochen. Dein Entwurf bleibt erhalten.
              </p>
            )}

            <div className="scene-actions">
              <button
                className="button button--primary"
                type="submit"
                disabled={!canSubmitFollowup}
              >
                {followup.status === 'rate_limited' && !followupRetryReady
                  ? 'Erneut senden, sobald freigegeben'
                  : followup.status === 'recoverable_error' || followup.status === 'cancelled'
                    ? 'Rückfrage erneut senden'
                    : 'Rückfrage senden'}
              </button>
              {followupActive && (
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={workflow.cancelFollowup}
                >
                  Rückfrage abbrechen
                </button>
              )}
            </div>
          </form>

          {followupActive && (
            <p role="status">
              {followup.status === 'requesting'
                ? 'Die Rückfrage wird gesendet …'
                : followup.status === 'terminal_waiting_for_eof'
                  ? 'Die Antwort wird sicher abgeschlossen …'
                  : 'Die Antwort wird übertragen …'}
            </p>
          )}

          {followup.partialAnswer && (
            <section className="followup-partial" aria-labelledby="followup-partial-title">
              <h4 id="followup-partial-title">Laufende Antwort</h4>
              <p>{followup.partialAnswer}</p>
            </section>
          )}

          {followup.transcript.length > 0 && (
            <section className="followup-transcript" aria-labelledby="followup-transcript-title">
              <h4 id="followup-transcript-title">Abgeschlossene Rückfragen</h4>
              <ol>
                {followup.transcript.map((pair, index) => (
                  <li key={`${index}-${pair.question}`}>
                    <p>
                      <strong>Frage:</strong> {pair.question}
                    </p>
                    <p>
                      <strong>Antwort:</strong> {pair.answer}
                    </p>
                    {speechState !== 'unsupported' && (
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => workflow.readFollowupAnswer(index)}
                      >
                        Antwort vorlesen
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </section>
      )}

      {state.status === 'complete' && (
        <section className="speech-disclosure" aria-labelledby="speech-title">
          <h3 id="speech-title">Lokale Sprachausgabe</h3>
          <p>
            Owli sendet keine zusätzliche Sprachanfrage an das Owli-Backend. Der Browser oder das
            Betriebssystem übernimmt die Sprachsynthese; Plattformstimmen können dabei ein eigenes
            Verarbeitungsverhalten haben. Eine vollständig offline oder ausschließlich auf dem Gerät
            ausgeführte Sprachausgabe wird nicht garantiert.
          </p>
          {speechState === 'unsupported' && (
            <p role="status">Sprachausgabe wird in diesem Browser nicht unterstützt.</p>
          )}
          {speechState === 'speaking' && <p role="status">Sprachausgabe läuft.</p>}
          {speechState === 'error' && (
            <p className="live-status" role="alert">
              Die lokale Sprachausgabe konnte nicht gestartet oder abgeschlossen werden.
            </p>
          )}
        </section>
      )}

      {(state.status === 'complete' || followup.status === 'context_expired') && (
        <button
          ref={newSceneButtonRef}
          className="button button--secondary"
          type="button"
          onClick={workflow.reset}
        >
          {followup.status === 'context_expired' ? 'Neue Szene beginnen' : 'Neues Bild'}
        </button>
      )}

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {sceneAnnouncement}
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {followupAnnouncement}
      </p>
    </section>
  );
}

function formatBytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}
