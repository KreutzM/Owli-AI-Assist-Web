import { useEffect, useRef, useState } from 'react';
import type { AudioPostcardQuota } from '@/core/api/remoteAudioPostcardContracts';
import {
  canStartAudioPostcard,
  isAudioPostcardActive,
  readyAudioPostcardResult,
} from '@/features/remote/audioPostcardState';
import type { useAudioPostcard } from '@/features/remote/useAudioPostcard';

interface RemoteAudioPostcardPanelProps {
  workflow: ReturnType<typeof useAudioPostcard>;
  conflictingRequest: boolean;
  onNewImage: () => void;
}

export function RemoteAudioPostcardPanel({
  workflow,
  conflictingRequest,
  onNewImage,
}: RemoteAudioPostcardPanelProps) {
  const { state } = workflow;
  const playerRef = useRef<HTMLAudioElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const recoveryActionRef = useRef<HTMLButtonElement>(null);
  const previousStatusRef = useRef(state.status);
  const [clock, setClock] = useState(() => Date.now());
  const active = isAudioPostcardActive(state.status);
  const readyResult = readyAudioPostcardResult(state);
  const retryReady = state.retryAt === undefined || clock >= state.retryAt;
  const retrySeconds =
    state.retryAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAt - clock) / 1_000));
  const canGenerate =
    canStartAudioPostcard(state.status) &&
    (state.status !== 'failed' || state.retryable === true) &&
    retryReady &&
    !conflictingRequest &&
    !active;
  const showRecoveryActions = [
    'stub',
    'not_available',
    'failed',
    'cancelled',
    'rate_limited',
    'timed_out',
    'recoverable_error',
    'contract_error',
    'expired',
  ].includes(state.status);

  useEffect(() => {
    if (state.retryAt === undefined || clock >= state.retryAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [clock, state.retryAt]);

  useEffect(() => {
    if (previousStatusRef.current !== 'ready' && state.status === 'ready') {
      resultHeadingRef.current?.focus();
    } else if (
      (isAudioPostcardActive(previousStatusRef.current) && !active) ||
      state.status === 'expired'
    ) {
      recoveryActionRef.current?.focus();
    }
    previousStatusRef.current = state.status;
  }, [active, state.status]);

  useEffect(() => {
    const player = playerRef.current;
    return () => {
      if (!player) return;
      player.pause();
      player.removeAttribute('src');
      player.load();
    };
  }, [readyResult?.audio.url]);

  if (
    state.status === 'unavailable' &&
    state.errorCategory !== 'stub' &&
    state.errorCategory !== 'not_available' &&
    state.errorCategory !== 'contract_error' &&
    state.errorCategory !== 'options_unavailable'
  ) {
    return null;
  }

  return (
    <section className="audio-postcard-panel" aria-labelledby="audio-postcard-title">
      <p className="eyebrow">Temporäre Audio-Postcard</p>
      <h3 id="audio-postcard-title">Die aktuelle Szene als Musik erleben</h3>
      <p>
        Erst nach deiner Aktion sendet Owli das vorbereitete Bild an das Owli-Backend. Freigegebene
        externe KI- und Musikanbieter können es verarbeiten. Das erzeugte Audio wird nur
        vorübergehend für die Wiedergabe gespeichert und läuft ab.
      </p>

      {state.status === 'loading_options' && (
        <p className="live-status" role="status">
          Audio-Postcard-Optionen werden geprüft …
        </p>
      )}

      {state.options && (
        <div className="audio-postcard-options">
          <label htmlFor="audio-postcard-profile">Musikprofil</label>
          <select
            id="audio-postcard-profile"
            value={state.selectedProfileId}
            disabled={active}
            onChange={(event) => workflow.selectProfile(event.currentTarget.value)}
          >
            {state.options.profiles
              .filter((profile) => profile.enabled)
              .map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
          </select>
          <p className="field-hint">
            {
              state.options.profiles.find((profile) => profile.id === state.selectedProfileId)
                ?.description
            }
          </p>
        </div>
      )}

      {active && (
        <div className="audio-postcard-progress">
          <p role="status">
            {state.status === 'preparing'
              ? 'Das vorbereitete Bild wird für die Anfrage eingelesen …'
              : state.status === 'submitting'
                ? 'Die Audio-Postcard-Anfrage wird gesendet …'
                : 'Die Musik wird erstellt und vorübergehend gespeichert …'}
          </p>
          <button className="button button--secondary" type="button" onClick={workflow.cancel}>
            Audio-Postcard abbrechen
          </button>
        </div>
      )}

      {state.status === 'ready' && readyResult && (
        <section className="audio-postcard-result" aria-labelledby="audio-postcard-result-title">
          <h4 ref={resultHeadingRef} id="audio-postcard-result-title" tabIndex={-1}>
            Audio-Postcard ist bereit
          </h4>
          {/* Generated music has adjacent textual alternatives rather than a timed caption track. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={playerRef}
            controls
            preload="metadata"
            crossOrigin="anonymous"
            src={readyResult.audio.url}
            onLoadedMetadata={() => workflow.setPlayerState('metadata_ready')}
            onPlay={() => workflow.setPlayerState('playing')}
            onPause={() => workflow.setPlayerState('paused')}
            onError={workflow.expire}
          >
            Dein Browser unterstützt das Audio-Element nicht.
          </audio>
          <AudioPostcardDescriptions result={readyResult} />
        </section>
      )}

      {(state.status === 'stub' || state.status === 'not_available') &&
        state.result &&
        (state.result.status === 'stub' || state.result.status === 'not_available') && (
          <section
            className="audio-postcard-result"
            aria-labelledby="audio-postcard-unavailable-title"
          >
            <h4 id="audio-postcard-unavailable-title">Keine Audio-Wiedergabe verfügbar</h4>
            <AudioPostcardDescriptions result={state.result} />
          </section>
        )}

      {state.status === 'unavailable' && state.errorCategory && (
        <p className="live-status" role="status">
          {state.errorCategory === 'contract_error'
            ? 'Die Audio-Postcard-Angaben des Backends sind nicht sicher verwendbar.'
            : state.errorCategory === 'stub'
              ? 'Audio-Postcards sind in dieser Bereitstellung nur als nicht spielbarer Test verfügbar.'
              : 'Audio-Postcards sind in dieser Bereitstellung derzeit nicht verfügbar.'}
        </p>
      )}

      {state.status === 'cancelled' && (
        <p className="live-status" role="status">
          Die Audio-Postcard-Anfrage wurde im Browser abgebrochen.
          {state.ambiguousOutcome &&
            ' Das Backend könnte die bereits gestartete Anfrage trotzdem abgeschlossen oder gezählt haben.'}
        </p>
      )}

      {state.status === 'timed_out' && (
        <p className="live-status" role="alert">
          Die Antwort ist nicht rechtzeitig eingetroffen. Das Ergebnis des bisherigen Versuchs ist
          unbekannt; ein erneuter Versuch kann erneut zählen.
        </p>
      )}

      {state.status === 'recoverable_error' && (
        <p className="live-status" role="alert">
          Die Verbindung wurde unterbrochen. Das Ergebnis kann unbekannt sein; ein erneuter Versuch
          kann erneut zählen.
        </p>
      )}

      {state.status === 'rate_limited' && (
        <div>
          <p className="live-status" role="alert">
            Das Backend hat das gelieferte feste Quotenfenster erreicht.
          </p>
          {retrySeconds > 0 && <p>Erneut möglich in {retrySeconds} Sekunden.</p>}
        </div>
      )}

      {(state.status === 'failed' || state.status === 'contract_error') && (
        <p className="live-status" role="alert">
          {state.status === 'contract_error'
            ? 'Die Backend-Antwort war nicht vertragskonform. Es wird kein Audio abgespielt.'
            : errorMessage(state.errorCategory)}
        </p>
      )}

      {state.status === 'expired' && (
        <section className="audio-postcard-result" aria-labelledby="audio-postcard-expired-title">
          <h4 id="audio-postcard-expired-title">Audio ist nicht mehr verfügbar</h4>
          <p>
            Die temporäre Wiedergabe ist abgelaufen oder konnte nicht mehr sicher geladen werden.
          </p>
          {state.result?.status === 'ready' && <AudioPostcardDescriptions result={state.result} />}
        </section>
      )}

      {state.quota && <QuotaSummary quota={state.quota} />}

      {(canGenerate || showRecoveryActions) && (
        <div className="scene-actions audio-postcard-actions">
          {canGenerate && (
            <button
              ref={recoveryActionRef}
              className="button button--primary"
              type="button"
              onClick={() => void workflow.generate()}
            >
              {state.status === 'idle' ? 'Audio-Postcard erstellen' : 'Neuen Versuch starten'}
            </button>
          )}
          {showRecoveryActions && (
            <button
              ref={canGenerate ? undefined : recoveryActionRef}
              className="button button--secondary"
              type="button"
              onClick={onNewImage}
            >
              Neues Bild verwenden
            </button>
          )}
        </div>
      )}

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement(state.status)}
      </p>
    </section>
  );
}

function AudioPostcardDescriptions({
  result,
}: {
  result: {
    accessibility: { sceneCaption: string; musicalMapping: string };
  };
}) {
  return (
    <div className="audio-postcard-descriptions">
      <p>
        <strong>Beschriebene Szene:</strong> {result.accessibility.sceneCaption}
      </p>
      <p>
        <strong>Musikalische Umsetzung:</strong> {result.accessibility.musicalMapping}
      </p>
    </div>
  );
}

function QuotaSummary({ quota }: { quota: AudioPostcardQuota }) {
  return (
    <section className="audio-postcard-quota" aria-labelledby="audio-postcard-quota-title">
      <h4 id="audio-postcard-quota-title">Angaben zu diesem Versuch</h4>
      <p>
        {quota.charged
          ? 'Das Backend meldet diesen Versuch als gezählt.'
          : 'Das Backend meldet diesen Versuch als nicht gezählt.'}
      </p>
      {quota.enforcement === 'not_enforced' && (
        <p>Das Backend liefert derzeit kein erzwungenes Quotenfenster.</p>
      )}
      {quota.windows.length > 0 && (
        <ul>
          {quota.windows.map((window) => (
            <li key={window.scope}>
              {quotaScope(window.scope)}: {window.remaining} von {window.limit} Versuchen im
              gelieferten festen Fenster verbleiben. Rücksetzung{' '}
              <time dateTime={window.resetAt}>{formatDate(window.resetAt)}</time>.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function quotaScope(scope: AudioPostcardQuota['windows'][number]['scope']): string {
  if (scope === 'installation') return 'Diese Browser-Sitzung';
  if (scope === 'ip') return 'Netzwerk';
  return 'Gesamtdienst';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function errorMessage(category: string | undefined): string {
  if (category === 'content_not_allowed') {
    return 'Aus diesem Bild kann keine Audio-Postcard erstellt werden. Bitte verwende ein anderes Bild.';
  }
  if (category === 'provider_timeout') {
    return 'Der Musikanbieter hat nicht rechtzeitig geantwortet. Ein neuer Versuch startet eine neue Anfrage.';
  }
  return 'Die Audio-Postcard konnte nicht erstellt werden. Starte nur dann einen neuen Versuch, wenn die Schaltfläche verfügbar ist.';
}

function announcement(status: string): string {
  if (status === 'ready') return 'Die Audio-Postcard ist bereit.';
  if (status === 'stub' || status === 'not_available') {
    return 'Für diese Audio-Postcard ist keine Wiedergabe verfügbar.';
  }
  if (status === 'expired') return 'Die temporäre Audio-Wiedergabe ist nicht mehr verfügbar.';
  if (status === 'cancelled') return 'Die Audio-Postcard-Anfrage wurde abgebrochen.';
  return '';
}
