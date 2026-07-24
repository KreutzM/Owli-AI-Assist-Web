import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeFollowupSse } from '@/core/api/followupSse';
import {
  SCENE_FIRST_EVENT_TIMEOUT_MS,
  SCENE_IDLE_TIMEOUT_MS,
  SCENE_TERMINAL_EOF_TIMEOUT_MS,
  SCENE_TOTAL_TIMEOUT_MS,
  SceneStreamError,
} from '@/core/api/sceneSse';

const encoder = new TextEncoder();

const metadata = event('metadata', {
  mode: 'followup',
  modelAlias: 'scene-followup-v1',
  profileId: 'brief',
  locale: 'de-DE',
});
const delta = event('delta', { textDelta: 'Ausgang' });
const done = event('done', {
  answerText: 'Auf dem Schild steht Ausgang.',
  mode: 'followup',
  modelAlias: 'scene-followup-v1',
  requestId: 'followup-request-1',
  profileId: 'brief',
  locale: 'de-DE',
});

afterEach(() => {
  vi.useRealTimers();
});

describe('consumeFollowupSse', () => {
  it('does not resolve a valid terminal event before clean EOF', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        value.enqueue(encoder.encode(metadata + delta + done));
      },
    });
    let settled = false;
    const promise = consume(stream).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    controller?.close();

    await expect(promise).resolves.toEqual({
      answerText: 'Auf dem Schild steht Ausgang.',
      profileId: 'brief',
      locale: 'de-DE',
      modelAlias: 'scene-followup-v1',
      requestId: 'followup-request-1',
    });
  });

  it.each([
    ['delta before metadata', delta + done],
    ['done before metadata', done],
    ['unknown event', metadata + event('mystery', { value: true }) + done],
    ['duplicate metadata', metadata + metadata + done],
    ['duplicate terminal', metadata + done + done],
    ['event after terminal', metadata + done + delta],
    ['missing terminal', metadata + delta],
    ['malformed JSON', metadata + 'event: delta\ndata: {bad}\n\n'],
    [
      'metadata mode mismatch',
      event('metadata', {
        mode: 'describe',
        modelAlias: 'scene-followup-v1',
        profileId: 'brief',
        locale: 'de-DE',
      }) + done,
    ],
    [
      'metadata profile mismatch',
      event('metadata', {
        mode: 'followup',
        modelAlias: 'scene-followup-v1',
        profileId: 'detailed',
        locale: 'de-DE',
      }) + done,
    ],
    [
      'done locale mismatch',
      metadata +
        event('done', {
          answerText: 'Antwort',
          mode: 'followup',
          modelAlias: 'scene-followup-v1',
          requestId: 'request-2',
          profileId: 'brief',
          locale: 'en-US',
        }),
    ],
  ])('rejects %s as a contract violation', async (_name, input) => {
    await expect(consume(closedStream(input))).rejects.toMatchObject({
      code: 'STREAM_CONTRACT_INVALID',
    });
  });

  it('maps a valid terminal error event without committing a result', async () => {
    const error = event('error', {
      error: 'provider_failed',
      message: 'Provider failed.',
      details: { requestId: 'followup-request-1' },
    });

    await expect(consume(closedStream(metadata + error))).rejects.toMatchObject({
      code: 'REMOTE_STREAM_ERROR',
      payload: {
        error: 'provider_failed',
        message: 'Provider failed.',
      },
    });
  });

  it('enforces the first-event timeout', async () => {
    vi.useFakeTimers();
    const promise = consume(openStream());
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'STREAM_FIRST_EVENT_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(SCENE_FIRST_EVENT_TIMEOUT_MS);
    await rejection;
  });

  it('enforces the idle timeout after valid metadata', async () => {
    vi.useFakeTimers();
    const promise = consume(openStream(metadata));
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'STREAM_IDLE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(SCENE_IDLE_TIMEOUT_MS);
    await rejection;
  });

  it('enforces the absolute total timeout', async () => {
    vi.useFakeTimers();
    const promise = consume(openStream(), Date.now() - SCENE_TOTAL_TIMEOUT_MS);
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'STREAM_TOTAL_TIMEOUT',
    });
    await vi.runAllTimersAsync();
    await rejection;
  });

  it('enforces the terminal-to-EOF timeout', async () => {
    vi.useFakeTimers();
    const promise = consume(openStream(metadata + done));
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'STREAM_TERMINAL_EOF_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(SCENE_TERMINAL_EOF_TIMEOUT_MS);
    await rejection;
  });

  it('maps caller aborts without committing partial text', async () => {
    const controller = new AbortController();
    const onDelta = vi.fn();
    const promise = consumeFollowupSse(openStream(metadata + delta), {
      profileId: 'brief',
      locale: 'de-DE',
      requestStartedAt: Date.now(),
      callbacks: { onDelta },
      signal: controller.signal,
      abort: vi.fn(),
    });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(SceneStreamError);
    await expect(promise).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(onDelta).toHaveBeenCalledWith('Ausgang');
  });
});

function consume(stream: ReadableStream<Uint8Array>, requestStartedAt = Date.now()) {
  return consumeFollowupSse(stream, {
    profileId: 'brief',
    locale: 'de-DE',
    requestStartedAt,
    abort: vi.fn(),
  });
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function closedStream(input: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
}

function openStream(input = ''): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (input) controller.enqueue(encoder.encode(input));
    },
  });
}
