import { describe, expect, it } from 'vitest';
import {
  buildWebSceneFollowupRequest,
  FOLLOWUP_HISTORY_ITEM_MAX_LENGTH,
  FOLLOWUP_MAX_TRANSCRIPT_PAIRS,
  FOLLOWUP_QUESTION_MAX_LENGTH,
} from '@/core/api/remoteFollowupContracts';

describe('remote follow-up contracts', () => {
  it('serializes only the authorized request fields and trims the current question', () => {
    const request = buildWebSceneFollowupRequest({
      sessionToken: 'session-token',
      installationId: 'installation-id',
      imageBase64: 'jpeg-base64',
      input: {
        sceneToken: 'scene-token',
        questionText: '  Was steht auf dem Schild?  ',
        image: new Blob(['jpeg'], { type: 'image/jpeg' }),
        transcript: [
          { question: 'Welche Farbe hat die Tür?', answer: 'Die Tür ist blau.' },
        ],
        profileId: 'brief',
        locale: 'de-DE',
      },
    });

    expect(Object.keys(request).sort()).toEqual(
      [
        'conversationHistory',
        'imageBase64',
        'imageMimeType',
        'installationId',
        'locale',
        'profileId',
        'questionText',
        'sceneToken',
        'sessionToken',
        'stream',
      ].sort(),
    );
    expect(request).toMatchObject({
      sessionToken: 'session-token',
      installationId: 'installation-id',
      sceneToken: 'scene-token',
      questionText: 'Was steht auf dem Schild?',
      imageBase64: 'jpeg-base64',
      imageMimeType: 'image/jpeg',
      stream: true,
      profileId: 'brief',
      locale: 'de-DE',
    });
    expect(request.conversationHistory).toEqual([
      { role: 'user', text: 'Welche Farbe hat die Tür?' },
      { role: 'assistant', text: 'Die Tür ist blau.' },
    ]);
    expect(JSON.stringify(request)).not.toContain('initialDescription');
  });

  it('keeps only four completed atomic transcript pairs', () => {
    const transcript = Array.from({ length: FOLLOWUP_MAX_TRANSCRIPT_PAIRS + 2 }, (_, index) => ({
      question: `Frage ${index}`,
      answer: `Antwort ${index}`,
    }));

    const request = buildWebSceneFollowupRequest({
      sessionToken: 'session-token',
      installationId: 'installation-id',
      imageBase64: 'jpeg-base64',
      input: {
        sceneToken: 'scene-token',
        questionText: 'Aktuelle Frage',
        image: new Blob(['jpeg'], { type: 'image/jpeg' }),
        transcript,
        profileId: 'brief',
        locale: 'de-DE',
      },
    });

    expect(request.conversationHistory).toHaveLength(FOLLOWUP_MAX_TRANSCRIPT_PAIRS * 2);
    expect(request.conversationHistory[0]).toEqual({ role: 'user', text: 'Frage 2' });
    expect(request.conversationHistory.at(-1)).toEqual({
      role: 'assistant',
      text: `Antwort ${FOLLOWUP_MAX_TRANSCRIPT_PAIRS + 1}`,
    });
    expect(request.conversationHistory).not.toContainEqual({
      role: 'user',
      text: 'Aktuelle Frage',
    });
  });

  it('bounds each retained history item before schema validation', () => {
    const request = buildWebSceneFollowupRequest({
      sessionToken: 'session-token',
      installationId: 'installation-id',
      imageBase64: 'jpeg-base64',
      input: {
        sceneToken: 'scene-token',
        questionText: 'Aktuelle Frage',
        image: new Blob(['jpeg'], { type: 'image/jpeg' }),
        transcript: [
          {
            question: 'q'.repeat(FOLLOWUP_HISTORY_ITEM_MAX_LENGTH + 10),
            answer: 'a'.repeat(FOLLOWUP_HISTORY_ITEM_MAX_LENGTH + 10),
          },
        ],
        profileId: 'brief',
        locale: 'de-DE',
      },
    });

    expect(request.conversationHistory[0]?.text).toHaveLength(FOLLOWUP_HISTORY_ITEM_MAX_LENGTH);
    expect(request.conversationHistory[1]?.text).toHaveLength(FOLLOWUP_HISTORY_ITEM_MAX_LENGTH);
  });

  it('uses JavaScript UTF-16 length for the 280-character question limit', () => {
    const exact = '🙂'.repeat(FOLLOWUP_QUESTION_MAX_LENGTH / 2);
    expect(exact).toHaveLength(FOLLOWUP_QUESTION_MAX_LENGTH);

    expect(() =>
      buildWebSceneFollowupRequest({
        sessionToken: 'session-token',
        installationId: 'installation-id',
        imageBase64: 'jpeg-base64',
        input: {
          sceneToken: 'scene-token',
          questionText: exact,
          image: new Blob(['jpeg'], { type: 'image/jpeg' }),
          transcript: [],
          profileId: 'brief',
          locale: 'de-DE',
        },
      }),
    ).not.toThrow();

    expect(() =>
      buildWebSceneFollowupRequest({
        sessionToken: 'session-token',
        installationId: 'installation-id',
        imageBase64: 'jpeg-base64',
        input: {
          sceneToken: 'scene-token',
          questionText: `${exact}🙂`,
          image: new Blob(['jpeg'], { type: 'image/jpeg' }),
          transcript: [],
          profileId: 'brief',
          locale: 'de-DE',
        },
      }),
    ).toThrow();
  });

  it('rejects whitespace-only questions', () => {
    expect(() =>
      buildWebSceneFollowupRequest({
        sessionToken: 'session-token',
        installationId: 'installation-id',
        imageBase64: 'jpeg-base64',
        input: {
          sceneToken: 'scene-token',
          questionText: '   ',
          image: new Blob(['jpeg'], { type: 'image/jpeg' }),
          transcript: [],
          profileId: 'brief',
          locale: 'de-DE',
        },
      }),
    ).toThrow();
  });
});
