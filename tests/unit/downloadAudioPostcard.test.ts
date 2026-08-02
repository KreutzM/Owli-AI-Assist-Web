import { describe, expect, it, vi } from 'vitest';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import {
  audioPostcardOptions,
  readyAudioPostcard,
} from './audioPostcardFixtures';

const API_BASE_URL = 'https://api-staging.owli-ai.com/';
const AUDIO_BYTES = new Uint8Array([1, 2, 3, 4]);

function validResponse(
  overrides: {
    headers?: Record<string, string>;
    url?: string;
    body?: Uint8Array;
    status?: number;
  } = {},
): Response {
  const result = readyAudioPostcard();
  const body = overrides.body ?? AUDIO_BYTES;
  const response = new Response(Uint8Array.from(body).buffer, {
    status: overrides.status ?? 200,
    headers: {
      'Content-Type': result.audio.mimeType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      ...overrides.headers,
    },
  });
  Object.defineProperty(response, 'url', {
    value: overrides.url ?? result.audio.url,
    configurable: true,
  });
  return response;
}

function input(fetchImplementation: typeof fetch, now = Date.now) {
  return {
    result: readyAudioPostcard(),
    options: audioPostcardOptions(),
    apiBaseUrl: API_BASE_URL,
    signal: new AbortController().signal,
    fetchImplementation,
    now,
  };
}

describe('downloadAudioPostcard', () => {
  it('performs one exact no-store capability GET and returns the validated bytes', async () => {
    const fetchImplementation = vi.fn(async () => validResponse());

    const blob = await downloadAudioPostcard(input(fetchImplementation));

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(AUDIO_BYTES);
    expect(blob.type).toBe('audio/mpeg');
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: { Accept: 'audio/mpeg' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
  });

  it('rejects an expired capability without starting a GET', async () => {
    const fetchImplementation = vi.fn(async () => validResponse());
    const result = readyAudioPostcard({
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });

    await expect(
      downloadAudioPostcard({ ...input(fetchImplementation), result }),
    ).rejects.toThrow(/Invalid Audio-Postcard playback capability/u);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wrong origin',
      'https://example.com/api/v1/song/audio/123e4567-e89b-42d3-a456-426614174000?token=123e4567-e89b-42d3-a456-426614174111',
    ],
    [
      'wrong path',
      'https://api-staging.owli-ai.com/api/v1/song/video/123e4567-e89b-42d3-a456-426614174000?token=123e4567-e89b-42d3-a456-426614174111',
    ],
  ])('rejects a capability with %s before fetch', async (_name, url) => {
    const fetchImplementation = vi.fn(async () => validResponse());
    const base = readyAudioPostcard();
    const result = { ...base, audio: { ...base.audio, url } };

    await expect(
      downloadAudioPostcard({ ...input(fetchImplementation), result }),
    ).rejects.toThrow(/Invalid Audio-Postcard playback capability/u);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [
      'redirected URL',
      { url: `${readyAudioPostcard().audio.url}&redirected=1` },
    ],
    ['wrong MIME', { headers: { 'Content-Type': 'audio/wav' } }],
    ['missing Content-Length', { headers: { 'Content-Length': '' } }],
    ['invalid Content-Length', { headers: { 'Content-Length': '4.5' } }],
    ['zero Content-Length', { headers: { 'Content-Length': '0' } }],
    ['missing no-store', { headers: { 'Cache-Control': 'private' } }],
    ['missing nosniff', { headers: { 'X-Content-Type-Options': 'sniff' } }],
    ['missing byte ranges', { headers: { 'Accept-Ranges': 'none' } }],
  ])('rejects a response with %s', async (_name, responseOverrides) => {
    const fetchImplementation = vi.fn(async () => validResponse(responseOverrides));

    await expect(
      downloadAudioPostcard(input(fetchImplementation)),
    ).rejects.toBeInstanceOf(Error);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('rejects a declared response above the options limit', async () => {
    const fetchImplementation = vi.fn(async () =>
      validResponse({
        headers: { 'Content-Length': String(32 * 1_024 * 1_024 + 1) },
      }),
    );

    await expect(
      downloadAudioPostcard(input(fetchImplementation)),
    ).rejects.toThrow(/approved input limit/u);
  });

  it('rejects streaming bytes above the declared length without retry', async () => {
    const fetchImplementation = vi.fn(async () =>
      validResponse({ headers: { 'Content-Length': '3' }, body: AUDIO_BYTES }),
    );

    await expect(
      downloadAudioPostcard(input(fetchImplementation)),
    ).rejects.toThrow(/approved input limit/u);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('rejects expiry that occurs while the response stream is being consumed', async () => {
    const times = [1_000, 1_000, 901_000, 901_000];
    const now = vi.fn(() => times.shift() ?? 901_000);
    const result = readyAudioPostcard({
      expiresAt: new Date(900_000).toISOString(),
    });
    const options = audioPostcardOptions({ playbackTtlSeconds: 900 });
    const fetchImplementation = vi.fn(async () => validResponse());

    await expect(
      downloadAudioPostcard({
        result,
        options,
        apiBaseUrl: API_BASE_URL,
        signal: new AbortController().signal,
        fetchImplementation,
        now,
      }),
    ).rejects.toThrow(/expired during download/u);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('propagates abort and never performs a second request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImplementation = vi.fn(async () => validResponse());

    await expect(
      downloadAudioPostcard({
        ...input(fetchImplementation),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
