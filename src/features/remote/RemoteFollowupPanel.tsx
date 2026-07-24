import type { FormEvent, RefObject } from 'react';
import { FOLLOWUP_QUESTION_MAX_LENGTH } from '@/core/api/remoteFollowupContracts';
import type { RemoteSceneWorkflow } from '@/features/remote/useRemoteScene';

interface RemoteFollowupPanelProps {
  workflow: RemoteSceneWorkflow;
  questionRef: RefObject<HTMLTextAreaElement | null>;
  visible: boolean;
  active: boolean;
  canSubmit: boolean;
  retrySeconds: number;
  retryReady: boolean;
  remainingQuestionCharacters: number;
}

export function RemoteFollowupPanel({
  workflow,
  questionRef,
  visible,
  active,
  canSubmit,
  retrySeconds,
  retryReady,
  remainingQuestionCharacters,
}: RemoteFollowupPanelProps) {
  if (!visible) return null;
  const { followup, speechState } = workflow;

  const submitFollowup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void workflow.submitFollowup();
  };

  return (
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
          disabled={active || followup.status === 'context_expired'}
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
        {followup.status === 'rate_limited' && retrySeconds > 0 && (
          <p role="status">Erneut möglich in {retrySeconds} Sekunden.</p>
        )}
        {followup.status === 'cancelled' && (
          <p className="live-status" role="status">
            Die Rückfrage wurde abgebrochen. Dein Entwurf bleibt erhalten.
          </p>
        )}

        <div className="scene-actions">
          <button className="button button--primary" type="submit" disabled={!canSubmit}>
            {followup.status === 'rate_limited' && !retryReady
              ? 'Erneut senden, sobald freigegeben'
              : followup.status === 'recoverable_error' || followup.status === 'cancelled'
                ? 'Rückfrage erneut senden'
                : 'Rückfrage senden'}
          </button>
          {active && (
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

      {active && (
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
  );
}
