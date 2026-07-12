import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { OwliApi, PublicProfile } from '@/core/types';
import { useSceneWorkflow } from '@/features/scene/useSceneWorkflow';
import type { CameraGateway } from '@/platform/camera/types';
import type { SpeechGateway } from '@/platform/speech/browserSpeech';
import { LiveStatus } from '@/shared/components/LiveStatus';
import { PrimaryButton } from '@/shared/components/PrimaryButton';

interface SceneWorkspaceProps {
  api: OwliApi;
  camera: CameraGateway;
  speech: SpeechGateway;
  locale: string;
  renderPostcard?: (image: Blob) => ReactNode;
}

export function SceneWorkspace({
  api,
  camera,
  speech,
  locale,
  renderPostcard,
}: SceneWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [profileLoadError, setProfileLoadError] = useState('');
  const [question, setQuestion] = useState('');
  const profileSelectId = useId();
  const followupId = useId();
  const workflow = useSceneWorkflow({ api, camera, locale });
  const { state } = workflow;

  useEffect(() => () => speech.stop(), [speech]);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .listProfiles(controller.signal)
      .then((nextProfiles) => {
        setProfiles(nextProfiles);
        setProfileId(nextProfiles[0]?.id ?? '');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setProfileLoadError('Profile konnten nicht geladen werden. Der Standard wird verwendet.');
        }
      });
    return () => controller.abort();
  }, [api]);

  const startCamera = () => {
    if (videoRef.current) void workflow.startCamera(videoRef.current);
  };

  const submitFollowup = () => {
    const normalized = question.trim();
    if (!normalized) return;
    void workflow.askFollowup(normalized, profileId || undefined);
  };

  const statusMessage = resolveStatusMessage(state);
  const currentAnswer = state.followupText || state.streamedText;

  return (
    <div className="workspace-grid">
      <section className="panel camera-panel" aria-labelledby="camera-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Kamera</p>
            <h2 id="camera-title">Szene aufnehmen</h2>
          </div>
          <span className={`status-chip status-chip--${state.cameraStatus}`}>
            {cameraStatusLabel(state.cameraStatus)}
          </span>
        </div>

        <video
          ref={videoRef}
          className="camera-preview"
          muted
          playsInline
          aria-label="Live-Kameravorschau"
        />

        <div className="form-field">
          <label htmlFor={profileSelectId}>Beschreibungsprofil</label>
          <select
            id={profileSelectId}
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            disabled={!profiles.length}
          >
            {!profiles.length && <option value="">Standardprofil</option>}
            {profiles.map((profile) => (
              <option value={profile.id} key={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
          {profileLoadError && <p className="field-hint">{profileLoadError}</p>}
        </div>

        <div className="button-row">
          <PrimaryButton disabled={state.cameraStatus === 'starting'} onClick={startCamera}>
            {state.cameraStatus === 'ready' ? 'Kamera neu starten' : 'Kamera starten'}
          </PrimaryButton>
          <PrimaryButton
            disabled={state.cameraStatus !== 'ready' || state.requestStatus === 'analyzing'}
            onClick={() => void workflow.captureAndDescribe(profileId || undefined)}
          >
            Neue Szene aufnehmen
          </PrimaryButton>
        </div>
        <LiveStatus message={statusMessage} assertive={state.requestStatus === 'error'} />
      </section>

      <section className="panel result-panel" aria-labelledby="result-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Ergebnis</p>
            <h2 id="result-title">Szenenbeschreibung</h2>
          </div>
          {currentAnswer && speech.supported && (
            <div className="button-row">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => speech.speak(currentAnswer, locale)}
              >
                Vorlesen
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => speech.stop()}
              >
                Vorlesen stoppen
              </button>
            </div>
          )}
        </div>

        {state.previewUrl && (
          <img className="scene-preview" src={state.previewUrl} alt="Aufgenommene Szene" />
        )}

        <div className="answer-box" aria-busy={state.requestStatus === 'analyzing'}>
          {state.streamedText ? (
            <p>{state.streamedText}</p>
          ) : (
            <p className="placeholder-text">
              Starte die Kamera und nimm eine Szene auf. Die Beschreibung erscheint hier.
            </p>
          )}
        </div>

        {state.scene && (
          <div className="followup-block">
            <label htmlFor={followupId}>Rückfrage zur Szene</label>
            <div className="followup-row">
              <input
                id={followupId}
                value={question}
                maxLength={280}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) submitFollowup();
                }}
                placeholder="Zum Beispiel: Was steht auf dem Schild?"
              />
              <PrimaryButton
                disabled={!question.trim() || state.followupStatus === 'asking'}
                onClick={submitFollowup}
              >
                Fragen
              </PrimaryButton>
            </div>
            <LiveStatus
              message={state.followupStatus === 'asking' ? 'Rückfrage wird beantwortet.' : ''}
            />
            {state.followupText && (
              <div className="answer-box answer-box--followup">
                <p>{state.followupText}</p>
              </div>
            )}
          </div>
        )}

        {(state.scene || state.image) && (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              speech.stop();
              workflow.reset();
            }}
          >
            Ergebnis zurücksetzen
          </button>
        )}
      </section>

      {state.image && <Fragment key={state.previewUrl}>{renderPostcard?.(state.image)}</Fragment>}
    </div>
  );
}

function resolveStatusMessage(state: ReturnType<typeof useSceneWorkflow>['state']): string {
  if (state.errorMessage) return state.errorMessage;
  if (state.cameraStatus === 'starting') return 'Kameraberechtigung wird angefragt.';
  if (state.cameraStatus === 'ready' && state.requestStatus === 'idle') return 'Kamera ist bereit.';
  if (state.requestStatus === 'capturing') return 'Bild wird aufgenommen.';
  if (state.requestStatus === 'analyzing') return 'Szene wird analysiert.';
  if (state.requestStatus === 'ready') return 'Szenenbeschreibung ist fertig.';
  return '';
}

function cameraStatusLabel(
  status: ReturnType<typeof useSceneWorkflow>['state']['cameraStatus'],
): string {
  const labels = {
    idle: 'Nicht gestartet',
    starting: 'Startet',
    ready: 'Bereit',
    error: 'Fehler',
  } satisfies Record<typeof status, string>;
  return labels[status];
}
