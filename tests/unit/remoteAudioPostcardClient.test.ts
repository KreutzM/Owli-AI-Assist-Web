import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteAudioPostcardClient } from '@/core/api/remoteAudioPostcardClient';
import { AudioPostcardClientError } from '@/core/api/remoteAudioPostcardErrors';
import type { WebBootstrapResponseV2 } from '@/core/api/remoteCatalogContracts';
import { RemoteSessionManager } from '@/core/session/remoteSessionManager';
import {
  audioPostcardOptions,
  audioPostcardQuota,
  readyAudioPostcard,
} from './audioPostcardFixtures';

const config = {
  mode: 'remote' as const,
  target: 'staging' as const,
  apiBaseUrl: 'https://api-staging.owli-ai.com/',
  appVersion: '0.1.0',
  versionCode: 1,
  defaultLocale: 'de-DE',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('RemoteAudioPostcardClient', () => {
  it('loads strict options without credentials or persistence', async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      void input;
      void init;
      return Response.json(audioPostcardOptions());
    });
    const client = createClient(fetchImplementation);
    await expect(client.loadOptions('de-DE')).resolves.toMatchObject({
      generation: { availability: 'available' },
    });
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe('https://api-staging.owli-ai.com/api/v1/song/options');
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json', 'Accept-Language': 'de-DE' },
    });
  });

  it('sends the exact generation body and approved public headers', async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      void input;
      void init;
      return Response.json(readyAudioPostcard());
    });
    const client = createClient(fetchImplementation);
    const options = audioPostcardOptions();
    await client.generate(input(options));

    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe('https://api-staging.owli-ai.com/api/v1/song/generate');
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionToken: 'session-1',
      installationId: 'installation-1',
      imageBase64: '/9j/',
      imageMimeType: 'image/jpeg',
      locale: 'de-DE',
      durationSec: 30,
      promptProfile: 'warm_audio_postcard',
      vocals: 'instrumental',
      voiceMode: 'lyria_sung_hook',
      shareVideo: false,
    });
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' });
  });

  it('refreshes once only for a stable pre-admission session failure', async () => {
    let bootstrapCalls = 0;
    let generateCalls = 0;
    const sessions = new RemoteSessionManager(async () =>
      bootstrapSession(`session-${++bootstrapCalls}`),
    );
    const fetchImplementation = vi.fn(async () => {
      generateCalls += 1;
      if (generateCalls === 1) {
        return Response.json(
          {
            error: 'UNAUTHORIZED',
            message: 'Session expired.',
            details: { category: 'unauthorized', reason: 'session_token_expired' },
          },
          { status: 401 },
        );
      }
      return Response.json({
        ...readyAudioPostcard(),
        status: 'not_available',
        reason: 'provider_not_configured',
        retryable: true,
        audio: { mimeType: null, url: null, durationMs: 0 },
        expiresAt: null,
      });
    });
    const client = new RemoteAudioPostcardClient(
      config,
      fetchImplementation,
      'installation-1',
      sessions,
    );

    await expect(client.generate(input(audioPostcardOptions()))).resolves.toMatchObject({
      status: 'not_available',
    });
    expect(bootstrapCalls).toBe(2);
    expect(generateCalls).toBe(2);
  });

  it('does not refresh an ambiguous unauthorized response or a quota rejection', async () => {
    let bootstrapCalls = 0;
    const sessions = new RemoteSessionManager(async () =>
      bootstrapSession(`session-${++bootstrapCalls}`),
    );
    const ambiguous401 = new RemoteAudioPostcardClient(
      config,
      vi.fn(async () =>
        Response.json(
          {
            error: 'UNAUTHORIZED',
            message: 'Unauthorized.',
            details: { category: 'unauthorized' },
          },
          { status: 401 },
        ),
      ),
      'installation-1',
      sessions,
    );
    await expect(ambiguous401.generate(input(audioPostcardOptions()))).rejects.toMatchObject({
      kind: 'rejected',
      details: { status: 401 },
    });
    expect(bootstrapCalls).toBe(1);

    const quota = audioPostcardQuota({
      charged: false,
      windows: [
        {
          scope: 'installation',
          kind: 'fixed_window',
          limit: 5,
          remaining: 0,
          resetAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    });
    const limited = createClient(
      vi.fn(async () =>
        Response.json(
          {
            error: 'RATE_LIMITED',
            message: 'Limit reached.',
            details: {
              category: 'rate_limited',
              route: 'song_generate',
              scope: 'installation',
            },
            quota,
          },
          { status: 429, headers: { 'Retry-After': '60' } },
        ),
      ),
    );
    await expect(limited.generate(input(audioPostcardOptions()))).rejects.toMatchObject({
      kind: 'rate_limited',
      details: { status: 429, scope: 'installation', quota },
    });
  });

  it('uses the options response timeout and reports an ambiguous outcome', async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) =>
        await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const client = createClient(fetchImplementation);
    const pending = client.generate(input(audioPostcardOptions()));
    const assertion = expect(pending).rejects.toMatchObject({
      kind: 'timed_out',
      details: { ambiguousOutcome: true },
    });
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown terminal statuses and unsafe playback metadata', async () => {
    const unknown = createClient(
      vi.fn(async () => Response.json({ ...readyAudioPostcard(), status: 'processing' })),
    );
    await expect(unknown.generate(input(audioPostcardOptions()))).rejects.toBeInstanceOf(
      AudioPostcardClientError,
    );

    const head = vi.fn(
      async () =>
        new Response(null, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': '1024',
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=900',
          },
        }),
    );
    const playback = createClient(head);
    await expect(
      playback.verifyPlayback(readyAudioPostcard(), audioPostcardOptions()),
    ).rejects.toMatchObject({ kind: 'contract' });
  });

  it('accepts only the reviewed no-store HEAD playback boundary', async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': '1024',
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        },
      });
    });
    const client = createClient(fetchImplementation);
    await expect(
      client.verifyPlayback(readyAudioPostcard(), audioPostcardOptions()),
    ).resolves.toBeUndefined();
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({
      method: 'HEAD',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  });
});

function createClient(fetchImplementation: typeof fetch) {
  return new RemoteAudioPostcardClient(
    config,
    fetchImplementation,
    'installation-1',
    new RemoteSessionManager(async () => bootstrapSession('session-1')),
  );
}

function input(options: ReturnType<typeof audioPostcardOptions>) {
  return {
    image: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
    locale: 'de-DE',
    options,
    profileId: 'warm_audio_postcard',
    modeId: 'lyria_sung_hook',
  };
}

function bootstrapSession(sessionToken: string): WebBootstrapResponseV2 {
  return {
    sessionToken,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    featureFlags: { sceneDescribe: true, followup: true, audioPostcard: true },
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
