import {
  followupDeltaSchema,
  followupDoneSchema,
  followupErrorSchema,
  followupMetadataSchema,
  type FollowupErrorPayload,
  type FollowupStreamCallbacks,
  type RemoteFollowupResult,
} from '@/core/api/remoteFollowupContracts';
import {
  SCENE_FIRST_EVENT_TIMEOUT_MS,
  SCENE_IDLE_TIMEOUT_MS,
  SCENE_TERMINAL_EOF_TIMEOUT_MS,
  SCENE_TOTAL_TIMEOUT_MS,
  SceneStreamError,
  type SceneStreamErrorCode,
} from '@/core/api/sceneSse';

interface FollowupSseOptions {
  profileId: string;
  locale: string;
  requestStartedAt: number;
  callbacks?: FollowupStreamCallbacks;
  signal?: AbortSignal;
  abort: () => void;
  now?: () => number;
}

interface ParsedEvent {
  event: string;
  data: string;
}

export async function consumeFollowupSse(
  stream: ReadableStream<Uint8Array>,
  options: FollowupSseOptions,
): Promise<RemoteFollowupResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const now = options.now ?? Date.now;
  let buffer = '';
  let metadataSeen = false;
  let terminalSeen = false;
  let terminalAt: number | undefined;
  let lastValidEventAt = now();
  let pendingDone: RemoteFollowupResult | undefined;
  let pendingError: FollowupErrorPayload | undefined;

  const handleEvent = (event: ParsedEvent) => {
    if (terminalSeen) contractFailure();
    const eventAt = now();
    switch (event.event) {
      case 'metadata': {
        if (metadataSeen) contractFailure();
        const parsed = followupMetadataSchema.safeParse(parseJson(event.data));
        if (
          !parsed.success ||
          parsed.data.profileId !== options.profileId ||
          parsed.data.locale !== options.locale
        ) {
          contractFailure();
        }
        metadataSeen = true;
        lastValidEventAt = eventAt;
        options.callbacks?.onMetadata?.(parsed.data);
        return;
      }
      case 'delta': {
        if (!metadataSeen) contractFailure();
        const parsed = followupDeltaSchema.safeParse(parseJson(event.data));
        if (!parsed.success) contractFailure();
        lastValidEventAt = eventAt;
        if (parsed.data.textDelta) options.callbacks?.onDelta?.(parsed.data.textDelta);
        return;
      }
      case 'done': {
        if (!metadataSeen) contractFailure();
        const parsed = followupDoneSchema.safeParse(parseJson(event.data));
        if (
          !parsed.success ||
          parsed.data.profileId !== options.profileId ||
          parsed.data.locale !== options.locale
        ) {
          contractFailure();
        }
        terminalSeen = true;
        terminalAt = eventAt;
        pendingDone = {
          answerText: parsed.data.answerText,
          profileId: parsed.data.profileId,
          locale: parsed.data.locale,
          modelAlias: parsed.data.modelAlias,
          requestId: parsed.data.requestId,
        };
        options.callbacks?.onTerminal?.();
        return;
      }
      case 'error': {
        if (!metadataSeen) contractFailure();
        const parsed = followupErrorSchema.safeParse(parseJson(event.data));
        if (!parsed.success) contractFailure();
        terminalSeen = true;
        terminalAt = eventAt;
        pendingError = parsed.data;
        options.callbacks?.onTerminal?.();
        return;
      }
      default:
        contractFailure();
    }
  };

  try {
    for (;;) {
      assertNotAborted(options.signal);
      const timeout = nextTimeout({
        now: now(),
        requestStartedAt: options.requestStartedAt,
        lastValidEventAt,
        metadataSeen,
        ...(terminalAt !== undefined ? { terminalAt } : {}),
      });
      const result = await readWithTimeout(reader, timeout.delay, timeout.code);
      buffer += decoder.decode(result.value, { stream: !result.done });
      const blocks = buffer.split(/\r?\n\r?\n/u);
      buffer = blocks.pop() ?? '';
      if (result.done && buffer.trim()) {
        blocks.push(buffer);
        buffer = '';
      }
      for (const block of blocks) {
        const event = parseSseBlock(block);
        if (event) handleEvent(event);
      }

      if (!result.done) continue;
      if (pendingError) throw new SceneStreamError('REMOTE_STREAM_ERROR', pendingError);
      if (!pendingDone) contractFailure();
      return pendingDone;
    }
  } catch (error) {
    if (error instanceof SceneStreamError) {
      options.abort();
      await reader.cancel(error.code).catch(() => undefined);
      throw error;
    }
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      await reader.cancel('aborted').catch(() => undefined);
      throw new SceneStreamError('REQUEST_ABORTED');
    }
    options.abort();
    await reader.cancel('stream failure').catch(() => undefined);
    throw new SceneStreamError('STREAM_CONTRACT_INVALID');
  } finally {
    reader.releaseLock();
  }
}

interface TimeoutState {
  now: number;
  requestStartedAt: number;
  lastValidEventAt: number;
  metadataSeen: boolean;
  terminalAt?: number;
}

function nextTimeout(state: TimeoutState): { delay: number; code: SceneStreamErrorCode } {
  if (state.terminalAt !== undefined) {
    return {
      delay: remaining(state.terminalAt + SCENE_TERMINAL_EOF_TIMEOUT_MS, state.now),
      code: 'STREAM_TERMINAL_EOF_TIMEOUT',
    };
  }
  const total = remaining(state.requestStartedAt + SCENE_TOTAL_TIMEOUT_MS, state.now);
  if (!state.metadataSeen) {
    const first = remaining(state.lastValidEventAt + SCENE_FIRST_EVENT_TIMEOUT_MS, state.now);
    return first <= total
      ? { delay: first, code: 'STREAM_FIRST_EVENT_TIMEOUT' }
      : { delay: total, code: 'STREAM_TOTAL_TIMEOUT' };
  }
  const idle = remaining(state.lastValidEventAt + SCENE_IDLE_TIMEOUT_MS, state.now);
  return idle <= total
    ? { delay: idle, code: 'STREAM_IDLE_TIMEOUT' }
    : { delay: total, code: 'STREAM_TOTAL_TIMEOUT' };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  delay: number,
  code: SceneStreamErrorCode,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SceneStreamError(code)), delay);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseSseBlock(block: string): ParsedEvent | undefined {
  if (!block.trim()) return undefined;
  let event = 'message';
  const data: string[] = [];
  for (const rawLine of block.split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const separator = rawLine.indexOf(':');
    const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
    const rawValue = separator >= 0 ? rawLine.slice(separator + 1) : '';
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    contractFailure();
  }
}

function remaining(deadline: number, now: number): number {
  return Math.max(0, deadline - now);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SceneStreamError('REQUEST_ABORTED');
}

function contractFailure(): never {
  throw new SceneStreamError('STREAM_CONTRACT_INVALID');
}
