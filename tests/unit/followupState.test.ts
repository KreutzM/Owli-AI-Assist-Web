import { describe, expect, it } from 'vitest';
import {
  appendCompletedPair,
  followupReducer,
  INITIAL_FOLLOWUP_STATE,
  type RemoteFollowupState,
} from '@/features/remote/followupState';

const context = {
  sceneToken: 'scene-token',
  sceneTokenExpiresAt: '2099-07-17T12:00:00.000Z',
  frozenProfileId: 'brief',
  frozenLocale: 'de-DE',
};

describe('followup state', () => {
  it('commits a completed pair only after terminal and clean completion', () => {
    let state = followupReducer(INITIAL_FOLLOWUP_STATE, {
      type: 'availability',
      context,
    });
    state = followupReducer(state, { type: 'draft_changed', value: 'Was steht dort?' });
    state = followupReducer(state, { type: 'request_started', announcementRun: 1 });
    state = followupReducer(state, { type: 'metadata' });
    state = followupReducer(state, { type: 'delta', text: 'Aus' });
    state = followupReducer(state, { type: 'terminal' });

    expect(state.status).toBe('terminal_waiting_for_eof');
    expect(state.partialAnswer).toBe('Aus');
    expect(state.transcript).toEqual([]);

    state = followupReducer(state, {
      type: 'completed',
      question: 'Was steht dort?',
      answer: 'Ausgang',
      focusRun: 2,
    });

    expect(state.status).toBe('complete');
    expect(state.questionDraft).toBe('');
    expect(state.partialAnswer).toBe('');
    expect(state.completedAnswer).toBe('Ausgang');
    expect(state.transcript).toEqual([{ question: 'Was steht dort?', answer: 'Ausgang' }]);
    expect(state.focusTarget).toBe('question');
  });

  it('discards only the partial answer when cancelled', () => {
    const state = activeState({
      questionDraft: 'Welche Farbe?',
      transcript: [{ question: 'Vorher?', answer: 'Vorherige Antwort.' }],
      partialAnswer: 'Unvollständig',
    });

    const cancelled = followupReducer(state, { type: 'cancelled', focusRun: 3 });

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.questionDraft).toBe('Welche Farbe?');
    expect(cancelled.partialAnswer).toBe('');
    expect(cancelled.transcript).toEqual([
      { question: 'Vorher?', answer: 'Vorherige Antwort.' },
    ]);
    expect(cancelled.focusTarget).toBe('question');
  });

  it('preserves the draft and prior transcript on recoverable failure', () => {
    const failed = followupReducer(
      activeState({
        questionDraft: 'Welche Farbe?',
        transcript: [{ question: 'Vorher?', answer: 'Vorherige Antwort.' }],
        partialAnswer: 'Unvollständig',
      }),
      {
        type: 'failed',
        status: 'recoverable_error',
        message: 'Erneut versuchen.',
        focusRun: 4,
      },
    );

    expect(failed.status).toBe('recoverable_error');
    expect(failed.questionDraft).toBe('Welche Farbe?');
    expect(failed.partialAnswer).toBe('');
    expect(failed.transcript).toHaveLength(1);
    expect(failed.errorMessage).toBe('Erneut versuchen.');
  });

  it('clears unusable context and transcript when the scene token expires', () => {
    const expired = followupReducer(
      activeState({
        questionDraft: 'Welche Farbe?',
        transcript: [{ question: 'Vorher?', answer: 'Vorherige Antwort.' }],
      }),
      {
        type: 'context_expired',
        message: 'Neue Szene erforderlich.',
        focusRun: 5,
      },
    );

    expect(expired.status).toBe('context_expired');
    expect(expired.questionDraft).toBe('Welche Farbe?');
    expect(expired.transcript).toEqual([]);
    expect(expired.sceneToken).toBeUndefined();
    expect(expired.sceneTokenExpiresAt).toBeUndefined();
    expect(expired.frozenProfileId).toBeUndefined();
    expect(expired.frozenLocale).toBeUndefined();
    expect(expired.focusTarget).toBe('new_scene');
  });

  it('retains only the newest four completed pairs', () => {
    let transcript: { question: string; answer: string }[] = [];
    for (let index = 0; index < 6; index += 1) {
      transcript = appendCompletedPair(transcript, {
        question: `Frage ${index}`,
        answer: `Antwort ${index}`,
      });
    }

    expect(transcript).toEqual([
      { question: 'Frage 2', answer: 'Antwort 2' },
      { question: 'Frage 3', answer: 'Antwort 3' },
      { question: 'Frage 4', answer: 'Antwort 4' },
      { question: 'Frage 5', answer: 'Antwort 5' },
    ]);
  });

  it('clears all volatile follow-up data on reset', () => {
    const cleared = followupReducer(
      activeState({
        questionDraft: 'Frage',
        transcript: [{ question: 'Vorher?', answer: 'Antwort.' }],
      }),
      { type: 'clear' },
    );

    expect(cleared).toEqual(INITIAL_FOLLOWUP_STATE);
  });
});

function activeState(overrides: Partial<RemoteFollowupState>): RemoteFollowupState {
  return {
    ...INITIAL_FOLLOWUP_STATE,
    status: 'streaming',
    sceneToken: context.sceneToken,
    sceneTokenExpiresAt: context.sceneTokenExpiresAt,
    frozenProfileId: context.frozenProfileId,
    frozenLocale: context.frozenLocale,
    ...overrides,
  };
}
