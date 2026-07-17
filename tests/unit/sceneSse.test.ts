import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeSceneSse,
  SCENE_FIRST_EVENT_TIMEOUT_MS,
  SCENE_IDLE_TIMEOUT_MS,
  SCENE_RESPONSE_TIMEOUT_MS,
  SCENE_TERMINAL_EOF_TIMEOUT_MS,
  SCENE_TOTAL_TIMEOUT_MS,
} from '@/core/api/sceneSse';

const metadata = event('metadata', {
  mode: 'describe',
  modelAlias: 'scene-describe-v1',
  profileId: 'brief',
  locale: 'de-DE',
});
const delta = event('delta', { textDelta: 'Eine helle Straße.', requestId: 'request-1' });
const done = event('done', {
  answerText: 'Eine helle Straße.',
  mode: 'describe',
  modelAlias: 'scene-describe-v1',
  requestId: 'request-1',
  sceneToken: 'scene-token',
  sceneTokenExpiresAt: '2026-07-17T12:00:00.000Z',
  profileId: 'brief',
  locale: 'de-DE',
});

afterEach(() => {
  vi.useRealTimers();
});

describe('strict scene SSE consumer', () => {
  it('accepts chunk boundaries and a terminal event at clean EOF', async () => {
    const deltas: string[] = [];
    const terminal = vi.fn();
    const result = await consumeSceneSse(
      streamOf(metadata.slice(0, 13), metadata.slice(13) + delta, done.trimEnd()),
      options({
        callbacks: {
          onDelta: (text) => deltas.push(text),
          onTerminal: terminal,
        },
      }),
    );
    expect(result).toMatchObject({
      answerText: 'Eine helle Straße.',
      sceneToken: 'scene-token',
      profileId: 'brief',
      locale: 'de-DE',
    });
    expect(deltas).toEqual(['Eine helle Straße.']);
    expect(terminal).toHaveBeenCalledTimes(1);
  });

  it('does not resolve until clean EOF after done', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let resolveTerminal: (() => void) | undefined;
    const terminalSeen = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });
    let resolved = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(bytes(metadata + done));
      },
    });
    const pending = consumeSceneSse(
      stream,
      options({ callbacks: { onTerminal: () => resolveTerminal?.() } }),
    ).then((value) => {
      resolved = true;
      return value;
    });
    await terminalSeen;
    expect(resolved).toBe(false);
    streamController?.close();
    await expect(pending).resolves.toMatchObject({ answerText: 'Eine helle Straße.' });
  });

  it.each([
    [done, 'metadata must be first'],
    [metadata + metadata + done, 'metadata must be unique'],
    [metadata + done + delta, 'post-terminal events are forbidden'],
    [metadata + delta, 'a terminal event is required'],
    [metadata + event('mystery', {}), 'unknown events are forbidden'],
  ])('rejects invalid lifecycle: %s', async (payload) => {
    await expect(consumeSceneSse(streamOf(payload), options())).rejects.toMatchObject({
      code: 'STREAM_CONTRACT_INVALID',
    });
  });

  it('surfaces a terminal error only after EOF', async () => {
    const payload = event('error', {
      error: 'BAD_GATEWAY',
      message: 'Provider unavailable',
      details: { category: 'provider_unavailable' },
    });
    await expect(consumeSceneSse(streamOf(metadata + payload), options())).rejects.toMatchObject({
      code: 'REMOTE_STREAM_ERROR',
      payload: { error: 'BAD_GATEWAY', message: 'Provider unavailable' },
    });
  });

  it('enforces the first-event timeout', async () => {
    vi.useFakeTimers();
    const pending = expect(consumeSceneSse(heldStream(), options())).rejects.toMatchObject({
      code: 'STREAM_FIRST_EVENT_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(SCENE_FIRST_EVENT_TIMEOUT_MS);
    await pending;
  });

  it('enforces the valid-event idle timeout', async () => {
    vi.useFakeTimers();
    const pending = expect(consumeSceneSse(heldStream(metadata), options())).rejects.toMatchObject({
      code: 'STREAM_IDLE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(SCENE_IDLE_TIMEOUT_MS);
    await pending;
  });

  it('enforces the total request timeout', async () => {
    vi.useFakeTimers();
    const pending = expect(
      consumeSceneSse(
        heldStream(),
        options({ requestStartedAt: Date.now() - SCENE_TOTAL_TIMEOUT_MS }),
      ),
    ).rejects.toMatchObject({ code: 'STREAM_TOTAL_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(0);
    await pending;
  });

  it('enforces terminal-to-EOF timeout', async () => {
    vi.useFakeTimers();
    const pending = expect(
      consumeSceneSse(heldStream(metadata + done), options()),
    ).rejects.toMatchObject({ code: 'STREAM_TERMINAL_EOF_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(SCENE_TERMINAL_EOF_TIMEOUT_MS);
    await pending;
  });

  it('pins every normative timeout constant', () => {
    expect(SCENE_RESPONSE_TIMEOUT_MS).toBe(15_000);
    expect(SCENE_FIRST_EVENT_TIMEOUT_MS).toBe(10_000);
    expect(SCENE_IDLE_TIMEOUT_MS).toBe(20_000);
    expect(SCENE_TOTAL_TIMEOUT_MS).toBe(60_000);
    expect(SCENE_TERMINAL_EOF_TIMEOUT_MS).toBe(2_000);
  });
});

type SceneSseOptions = Parameters<typeof consumeSceneSse>[1];

function options(overrides: Partial<SceneSseOptions> = {}): SceneSseOptions {
  return {
    profileId: 'brief',
    locale: 'de-DE',
    requestStartedAt: Date.now(),
    abort: vi.fn(),
    ...overrides,
  };
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(bytes(chunk)));
      controller.close();
    },
  });
}

function heldStream(initial?: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (initial) controller.enqueue(bytes(initial));
    },
  });
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
