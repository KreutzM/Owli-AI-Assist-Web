import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteAssistClient, RemoteClientError } from '@/core/api/remoteAssistClient';
import { blobToBase64 } from '@/core/api/remoteClientSupport';
import { SceneStreamError } from '@/core/api/sceneSse';
import { SCENE_IMAGE_MAX_BYTES } from '@/core/image/sceneImageInspection';
import { PROFILE_REGISTRY_SCHEMA_VERSION } from '@/core/api/remoteCatalogContracts';

const config = {
  mode: 'remote' as const,
  target: 'staging' as const,
  apiBaseUrl: 'https://api-staging.owli-ai.com/',
  appVersion: '0.1.0',
  versionCode: 1,
  defaultLocale: 'de-DE',
};

const publicConfig = {
  environment: 'staging',
  features: { sceneDescribe: true, followup: false, audioPostcard: false },
  profiles: { backendSupportedProfileIds: ['brief'] },
};

const profiles = {
  schemaVersion: PROFILE_REGISTRY_SCHEMA_VERSION,
  defaultProfileId: 'brief',
  profiles: [
    {
      id: 'brief',
      label: 'Kurz',
      description: 'Kurze Beschreibung',
      availability: 'backend',
      transports: {
        backend: { available: true, supportsStreaming: true, supportsFollowup: false },
      },
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('RemoteAssistClient', () => {
  it('gates readiness on config, bootstrap, and streaming profile support', async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/config')) return Response.json(publicConfig);
      if (path.endsWith('/bootstrap')) return Response.json(bootstrap('session-1', true));
      return Response.json(profiles, { headers: { ETag: '"profiles-1"' } });
    });
    const readiness = await client(fetchImplementation).initialize();
    expect(readiness.sceneDescribeEnabled).toBe(true);
    expect(readiness.catalog.defaultProfileId).toBe('brief');
    expect(readiness.catalog.profiles).toHaveLength(1);
  });

  it('sends the exact request body and approved headers', async () => {
    const sceneRequests: RequestInit[] = [];
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/bootstrap')) return Response.json(bootstrap('session-1', true));
      sceneRequests.push(init ?? {});
      return sceneResponse();
    });
    const result = await client(fetchImplementation).describeScene({
      image: new Blob([new Uint8Array([0, 1, 2])], { type: 'image/jpeg' }),
      profileId: 'brief',
      locale: 'de-DE',
    });

    expect(result.answerText).toBe('Eine helle Straße.');
    expect(sceneRequests).toHaveLength(1);
    const request = sceneRequests[0]!;
    const headers = new Headers(request.headers);
    expect([...headers.entries()].sort()).toEqual([
      ['accept', 'text/event-stream'],
      ['content-type', 'application/json'],
    ]);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Request-Id')).toBeNull();
    expect(JSON.parse(String(request.body))).toEqual({
      sessionToken: 'session-1',
      installationId: 'installation-test-id',
      imageBase64: 'AAEC',
      imageMimeType: 'image/jpeg',
      sceneMode: 'describe',
      stream: true,
      profileId: 'brief',
      locale: 'de-DE',
    });
  });

  it('retries one pre-stream 401 with one fresh bootstrap', async () => {
    let bootstrapCalls = 0;
    let sceneCalls = 0;
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/bootstrap')) {
        bootstrapCalls += 1;
        return Response.json(bootstrap(`session-${bootstrapCalls}`, true));
      }
      sceneCalls += 1;
      return sceneCalls === 1 ? new Response(null, { status: 401 }) : sceneResponse();
    });
    await expect(client(fetchImplementation).describeScene(input())).resolves.toMatchObject({
      answerText: 'Eine helle Straße.',
    });
    expect(bootstrapCalls).toBe(2);
    expect(sceneCalls).toBe(2);
  });

  it('surfaces a second pre-stream 401 without looping', async () => {
    let bootstrapCalls = 0;
    let sceneCalls = 0;
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/bootstrap')) {
        bootstrapCalls += 1;
        return Response.json(bootstrap(`session-${bootstrapCalls}`, true));
      }
      sceneCalls += 1;
      return new Response(null, { status: 401 });
    });
    await expect(client(fetchImplementation).describeScene(input())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    expect(bootstrapCalls).toBe(2);
    expect(sceneCalls).toBe(2);
  });

  it('never retries 403', async () => {
    let bootstrapCalls = 0;
    let sceneCalls = 0;
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/bootstrap')) {
        bootstrapCalls += 1;
        return Response.json(bootstrap('session-1', true));
      }
      sceneCalls += 1;
      return new Response(null, { status: 403 });
    });
    await expect(client(fetchImplementation).describeScene(input())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(bootstrapCalls).toBe(1);
    expect(sceneCalls).toBe(1);
  });

  it('never retries after SSE headers are accepted', async () => {
    let bootstrapCalls = 0;
    let sceneCalls = 0;
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/bootstrap')) {
        bootstrapCalls += 1;
        return Response.json(bootstrap('session-1', true));
      }
      sceneCalls += 1;
      return sseResponse(
        event('metadata', {
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          profileId: 'brief',
          locale: 'de-DE',
        }) + event('unknown', {}),
      );
    });
    await expect(client(fetchImplementation).describeScene(input())).rejects.toBeInstanceOf(
      SceneStreamError,
    );
    expect(bootstrapCalls).toBe(1);
    expect(sceneCalls).toBe(1);
  });

  it('maps rate limiting and upstream status classes', async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/bootstrap')) return Response.json(bootstrap('session-1', true));
      return new Response(null, { status: 429, headers: { 'Retry-After': '12' } });
    });
    await expect(client(fetchImplementation).describeScene(input())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
  });

  it('rejects output over 4 MiB before session or network work', async () => {
    const fetchImplementation = vi.fn();
    await expect(
      client(fetchImplementation).describeScene({
        image: new Blob([new Uint8Array(SCENE_IMAGE_MAX_BYTES + 1)], { type: 'image/jpeg' }),
        profileId: 'brief',
        locale: 'de-DE',
      }),
    ).rejects.toBeInstanceOf(RemoteClientError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('produces the exact base64 boundary for a 4 MiB output', async () => {
    const encoded = await blobToBase64(new Blob([new Uint8Array(SCENE_IMAGE_MAX_BYTES)]));
    expect(encoded).toHaveLength(5_592_408);
  });

  it('enforces the 15-second response timeout', async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn((input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/bootstrap')) {
        return Promise.resolve(Response.json(bootstrap('session-1', true)));
      }
      return new Promise<Response>(() => undefined);
    });
    const pending = expect(
      client(fetchImplementation).describeScene(input()),
    ).rejects.toMatchObject({
      code: 'STREAM_RESPONSE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
  });
});

function client(fetchImplementation: typeof fetch): RemoteAssistClient {
  return new RemoteAssistClient(config, {
    installationId: 'installation-test-id',
    fetch: fetchImplementation,
  });
}

function input() {
  return {
    image: new Blob([new Uint8Array([0, 1, 2])], { type: 'image/jpeg' }),
    profileId: 'brief',
    locale: 'de-DE',
  };
}

function bootstrap(sessionToken: string, sceneDescribe: boolean) {
  return {
    sessionToken,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    featureFlags: { sceneDescribe, followup: false, audioPostcard: false },
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

function sceneResponse(): Response {
  return sseResponse(
    event('metadata', {
      mode: 'describe',
      modelAlias: 'scene-describe-v1',
      profileId: 'brief',
      locale: 'de-DE',
    }) +
      event('delta', { textDelta: 'Eine helle Straße.', requestId: 'request-1' }) +
      event('done', {
        answerText: 'Eine helle Straße.',
        mode: 'describe',
        modelAlias: 'scene-describe-v1',
        requestId: 'request-1',
        sceneToken: 'scene-token',
        sceneTokenExpiresAt: '2026-07-17T12:00:00.000Z',
        profileId: 'brief',
        locale: 'de-DE',
      }),
  );
}

function sseResponse(payload: string): Response {
  return new Response(payload, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
