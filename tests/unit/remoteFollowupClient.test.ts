import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteAssistClient, type RemoteRuntimeConfig } from '@/core/api/remoteAssistClient';
import type { RemoteFollowupInput } from '@/core/api/remoteFollowupContracts';
import { SceneStreamError } from '@/core/api/sceneSse';

const config: RemoteRuntimeConfig = {
  mode: 'remote',
  target: 'staging',
  apiBaseUrl: 'https://api-staging.owli-ai.com/',
  appVersion: '0.1.0',
  versionCode: 1,
  defaultLocale: 'de-DE',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('RemoteAssistClient follow-up', () => {
  it('sends the exact endpoint, headers, and bounded body', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (new URL(url).pathname.endsWith('/bootstrap')) {
        return Response.json(bootstrap('session-1'));
      }
      requests.push({ url, init: init ?? {} });
      return followupResponse();
    });

    const result = await client(fetchImplementation).followupScene(input());

    expect(result.answerText).toBe('Auf dem Schild steht Ausgang.');
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe('/api/v1/scene/followup');
    const request = requests[0]!.init;
    expect(request.method).toBe('POST');
    expect(request.cache).toBe('no-store');
    expect(new Headers(request.headers)).toEqual(
      new Headers({ Accept: 'text/event-stream', 'Content-Type': 'application/json' }),
    );
    expect(JSON.parse(String(request.body))).toEqual({
      sessionToken: 'session-1',
      installationId: 'installation-test-id',
      sceneToken: 'scene-token',
      questionText: 'Was steht auf dem Schild?',
      imageBase64: 'AAEC',
      imageMimeType: 'image/jpeg',
      conversationHistory: [
        { role: 'user', text: 'Welche Farbe hat die Tür?' },
        { role: 'assistant', text: 'Die Tür ist blau.' },
      ],
      stream: true,
      profileId: 'brief',
      locale: 'de-DE',
    });
  });

  it('refreshes once for an explicit session-token 401 before SSE acceptance', async () => {
    let bootstrapCalls = 0;
    let followupCalls = 0;
    const fetchImplementation = vi.fn(async (inputValue: URL | RequestInfo) => {
      const path = new URL(String(inputValue)).pathname;
      if (path.endsWith('/bootstrap')) {
        bootstrapCalls += 1;
        return Response.json(bootstrap(`session-${bootstrapCalls}`));
      }
      followupCalls += 1;
      return followupCalls === 1
        ? tokenError('session', 'session_token_expired')
        : followupResponse();
    });

    await expect(client(fetchImplementation).followupScene(input())).resolves.toMatchObject({
      answerText: 'Auf dem Schild steht Ausgang.',
    });
    expect(bootstrapCalls).toBe(2);
    expect(followupCalls).toBe(2);
  });

  it('surfaces a second session-token 401 without looping', async () => {
    let bootstrapCalls = 0;
    let followupCalls = 0;
    const fetchImplementation = vi.fn(async (inputValue: URL | RequestInfo) => {
      const path = new URL(String(inputValue)).pathname;
      if (path.endsWith('/bootstrap')) {
        bootstrapCalls += 1;
        return Response.json(bootstrap(`session-${bootstrapCalls}`));
      }
      followupCalls += 1;
      return tokenError('session', 'session_token_invalid');
    });

    await expect(client(fetchImplementation).followupScene(input())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    expect(bootstrapCalls).toBe(2);
    expect(followupCalls).toBe(2);
  });

  it.each([
    ['scene_token_expired', 'SCENE_CONTEXT_EXPIRED'],
    ['scene_token_invalid', 'SCENE_CONTEXT_INVALID'],
  ])('never session-refreshes an explicit scene-token failure: %s', async (reason, code) => {
    let bootstrapCalls = 0;
    let followupCalls = 0;
    const fetchImplementation = vi.fn(async (inputValue: URL | RequestInfo) => {
      const path = new URL(String(inputValue)).pathname;
      if (path.endsWith('/bootstrap')) {
        bootstrapCalls += 1;
        return Response.json(bootstrap('session-1'));
      }
      followupCalls += 1;
      return tokenError('scene', reason);
    });

    await expect(client(fetchImplementation).followupScene(input())).rejects.toMatchObject({
      code,
      status: 401,
    });
    expect(bootstrapCalls).toBe(1);
    expect(followupCalls).toBe(1);
  });

  it('never retries an ambiguous 401, 403, or 429', async () => {
    for (const response of [
      new Response(null, { status: 401 }),
      new Response(null, { status: 403 }),
      new Response(null, { status: 429, headers: { 'Retry-After': '5' } }),
    ]) {
      let bootstrapCalls = 0;
      let followupCalls = 0;
      const fetchImplementation = vi.fn(async (inputValue: URL | RequestInfo) => {
        const path = new URL(String(inputValue)).pathname;
        if (path.endsWith('/bootstrap')) {
          bootstrapCalls += 1;
          return Response.json(bootstrap('session-1'));
        }
        followupCalls += 1;
        return response.clone();
      });

      await expect(client(fetchImplementation).followupScene(input())).rejects.toBeDefined();
      expect(bootstrapCalls).toBe(1);
      expect(followupCalls).toBe(1);
    }
  });

  it('parses Retry-After in seconds and HTTP-date form', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));

    for (const [header, expected] of [
      ['12', Date.parse('2026-07-24T12:00:12.000Z')],
      ['Fri, 24 Jul 2026 12:00:30 GMT', Date.parse('2026-07-24T12:00:30.000Z')],
    ] as const) {
      const fetchImplementation = vi.fn(async (inputValue: URL | RequestInfo) => {
        const path = new URL(String(inputValue)).pathname;
        if (path.endsWith('/bootstrap')) return Response.json(bootstrap('session-1'));
        return new Response(null, { status: 429, headers: { 'Retry-After': header } });
      });

      await expect(client(fetchImplementation).followupScene(input())).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
        retryAt: expected,
      });
    }
  });

  it('never replays provider work after SSE acceptance', async () => {
    let bootstrapCalls = 0;
    let followupCalls = 0;
    const fetchImplementation = vi.fn(async (inputValue: URL | RequestInfo) => {
      const path = new URL(String(inputValue)).pathname;
      if (path.endsWith('/bootstrap')) {
        bootstrapCalls += 1;
        return Response.json(bootstrap('session-1'));
      }
      followupCalls += 1;
      return sseResponse(
        event('metadata', {
          mode: 'followup',
          modelAlias: 'scene-followup-v1',
          profileId: 'brief',
          locale: 'de-DE',
        }) + event('unknown', {}),
      );
    });

    await expect(client(fetchImplementation).followupScene(input())).rejects.toBeInstanceOf(
      SceneStreamError,
    );
    expect(bootstrapCalls).toBe(1);
    expect(followupCalls).toBe(1);
  });

  it('enforces the response-header timeout without replaying the request', async () => {
    vi.useFakeTimers();
    let followupCalls = 0;
    const fetchImplementation = vi.fn((inputValue: URL | RequestInfo) => {
      const path = new URL(String(inputValue)).pathname;
      if (path.endsWith('/bootstrap')) {
        return Promise.resolve(Response.json(bootstrap('session-1')));
      }
      followupCalls += 1;
      return new Promise<Response>(() => undefined);
    });
    const pending = expect(
      client(fetchImplementation).followupScene(input()),
    ).rejects.toMatchObject({
      code: 'STREAM_RESPONSE_TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(followupCalls).toBe(1);
  });
});

function client(fetchImplementation: typeof fetch): RemoteAssistClient {
  return new RemoteAssistClient(config, {
    installationId: 'installation-test-id',
    fetch: fetchImplementation,
  });
}

function input(): RemoteFollowupInput {
  return {
    sceneToken: 'scene-token',
    questionText: ' Was steht auf dem Schild? ',
    image: new Blob([new Uint8Array([0, 1, 2])], { type: 'image/jpeg' }),
    transcript: [{ question: 'Welche Farbe hat die Tür?', answer: 'Die Tür ist blau.' }],
    profileId: 'brief',
    locale: 'de-DE',
  };
}

function bootstrap(sessionToken: string) {
  return {
    sessionToken,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    featureFlags: { sceneDescribe: true, followup: true, audioPostcard: false },
    bootstrapInfo: {
      environment: 'staging',
      sessionTtlSeconds: 120,
      sessionSchemaVersion: 2,
      platform: 'web',
      trust: {
        kind: 'browser_public_client',
        status: 'unattested_public_client',
        enforced: false,
        note: 'public browser client',
      },
    },
  };
}

function tokenError(tokenType: 'session' | 'scene', reason: string): Response {
  return Response.json(
    {
      error: 'unauthorized',
      message: 'Token rejected.',
      details: { tokenType, reason },
    },
    { status: 401 },
  );
}

function followupResponse(): Response {
  return sseResponse(
    event('metadata', {
      mode: 'followup',
      modelAlias: 'scene-followup-v1',
      profileId: 'brief',
      locale: 'de-DE',
    }) +
      event('delta', { textDelta: 'Auf dem Schild steht Ausgang.' }) +
      event('done', {
        answerText: 'Auf dem Schild steht Ausgang.',
        mode: 'followup',
        modelAlias: 'scene-followup-v1',
        requestId: 'followup-request-1',
        profileId: 'brief',
        locale: 'de-DE',
      }),
  );
}

function sseResponse(payload: string): Response {
  return new Response(payload, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
