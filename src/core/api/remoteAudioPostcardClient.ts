import {
  audioPostcardErrorEnvelopeSchema,
  audioPostcardOptionsSchema,
  audioPostcardTerminalResultSchema,
  buildWebAudioPostcardGenerateRequest,
  selectAudioPostcardDefaults,
  validateAudioCapability,
  type AudioPostcardOptions,
  type AudioPostcardReadyResult,
  type AudioPostcardTerminalResult,
} from '@/core/api/remoteAudioPostcardContracts';
import { AudioPostcardClientError } from '@/core/api/remoteAudioPostcardErrors';
import { assertNotAborted, blobToBase64, forwardAbort } from '@/core/api/remoteClientSupport';
import type { RemoteRuntimeConfig } from '@/core/api/remoteAssistTypes';
import { SCENE_IMAGE_MAX_BYTES } from '@/core/image/sceneImageInspection';
import { RemoteHttpError, type RemoteSessionManager } from '@/core/session/remoteSessionManager';

export interface GenerateAudioPostcardInput {
  image: Blob;
  locale: string;
  options: AudioPostcardOptions;
  profileId: string;
  modeId: string;
  onPrepared?: () => void;
  onDispatched?: () => void;
}

interface ParsedError {
  status: number;
  category?: string;
  reason?: string;
  scope?: 'installation' | 'provider';
  retryable?: boolean;
  retryAt?: number;
  quota?: AudioPostcardTerminalResult['quota'];
}

export class RemoteAudioPostcardClient {
  constructor(
    private readonly config: RemoteRuntimeConfig,
    private readonly fetchImplementation: typeof fetch,
    private readonly installationId: string,
    private readonly sessions: RemoteSessionManager,
  ) {}

  async loadOptions(locale: string, signal?: AbortSignal): Promise<AudioPostcardOptions> {
    try {
      const response = await this.fetchImplementation(
        new URL('/api/v1/song/options', this.config.apiBaseUrl),
        {
          headers: { Accept: 'application/json', 'Accept-Language': locale },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          ...(signal ? { signal } : {}),
        },
      );
      if (!response.ok)
        throw new AudioPostcardClientError('unavailable', { status: response.status });
      const parsed = audioPostcardOptionsSchema.safeParse(
        await response.json().catch(() => undefined),
      );
      assertNotAborted(signal);
      if (!parsed.success) throw new AudioPostcardClientError('contract');
      return parsed.data;
    } catch (error) {
      throw mapAudioPostcardTransportError(error, signal, false);
    }
  }

  async generate(
    input: GenerateAudioPostcardInput,
    signal?: AbortSignal,
  ): Promise<AudioPostcardTerminalResult> {
    signal?.throwIfAborted();
    if (
      input.image.type !== 'image/jpeg' ||
      input.image.size <= 0 ||
      input.image.size > SCENE_IMAGE_MAX_BYTES ||
      input.options.generation.availability !== 'available'
    ) {
      throw new AudioPostcardClientError('rejected');
    }
    assertValidSelection(input.options, input.profileId, input.modeId);

    let imageBase64: string | undefined = await blobToBase64(input.image, signal);
    try {
      return await this.sessions.withUnauthorizedRetry(async (sessionToken) => {
        if (!imageBase64) throw new AudioPostcardClientError('aborted');
        const request = buildWebAudioPostcardGenerateRequest({
          sessionToken,
          installationId: this.installationId,
          imageBase64,
          locale: input.locale,
          options: input.options,
          profileId: input.profileId,
          modeId: input.modeId,
        });
        input.onPrepared?.();
        return this.generateAttempt(request, input.options, input.onDispatched, signal);
      }, signal);
    } catch (error) {
      throw mapAudioPostcardTransportError(error, signal, true);
    } finally {
      imageBase64 = undefined;
    }
  }

  async verifyPlayback(
    result: AudioPostcardReadyResult,
    options: AudioPostcardOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    const capability = validateAudioCapability(result, options, this.config.apiBaseUrl);
    try {
      const response = await this.fetchImplementation(capability, {
        method: 'HEAD',
        headers: { Accept: result.audio.mimeType },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        ...(signal ? { signal } : {}),
      });
      if (response.status === 404) throw new AudioPostcardClientError('expired', { status: 404 });
      if (!response.ok)
        throw new AudioPostcardClientError('unavailable', { status: response.status });
      const contentLength = Number(response.headers.get('Content-Length'));
      if (
        response.headers.get('Content-Type') !== result.audio.mimeType ||
        !Number.isInteger(contentLength) ||
        contentLength <= 0 ||
        contentLength > options.generation.maxAudioBytes ||
        response.headers.get('Accept-Ranges')?.toLowerCase() !== 'bytes' ||
        response.headers.get('X-Content-Type-Options')?.toLowerCase() !== 'nosniff' ||
        !response.headers.get('Cache-Control')?.toLowerCase().includes('no-store')
      ) {
        throw new AudioPostcardClientError('contract');
      }
    } catch (error) {
      throw mapAudioPostcardTransportError(error, signal, false);
    }
  }

  private async generateAttempt(
    request: ReturnType<typeof buildWebAudioPostcardGenerateRequest>,
    options: AudioPostcardOptions,
    onDispatched: (() => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AudioPostcardTerminalResult> {
    let body: string | undefined = JSON.stringify(request);
    const controller = new AbortController();
    const removeAbort = forwardAbort(signal, controller);
    const timeoutReason = new DOMException('Audio-Postcard response timed out', 'TimeoutError');
    const timer = setTimeout(() => {
      controller.abort(timeoutReason);
    }, options.generation.responseTimeoutMs);

    try {
      const responsePromise = this.fetchImplementation(
        new URL('/api/v1/song/generate', this.config.apiBaseUrl),
        {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        },
      );
      onDispatched?.();
      const response = await responsePromise;
      const payload: unknown = await response.json().catch(() => undefined);
      if (response.ok) return this.parseTerminal(payload, options);

      const error = parseHttpError(response, payload);
      if (
        response.status === 401 &&
        error.category === 'unauthorized' &&
        error.reason?.startsWith('session_token_')
      ) {
        throw new RemoteHttpError(401);
      }
      throw mapHttpError(error);
    } catch (error) {
      if (controller.signal.reason === timeoutReason) {
        throw new AudioPostcardClientError('timed_out', { ambiguousOutcome: true });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      removeAbort();
      body = undefined;
    }
  }

  private parseTerminal(
    payload: unknown,
    options: AudioPostcardOptions,
  ): AudioPostcardTerminalResult {
    const parsed = audioPostcardTerminalResultSchema.safeParse(payload);
    if (!parsed.success) throw new AudioPostcardClientError('contract');
    assertQuotaTimesAreFuture(parsed.data.quota);
    if (parsed.data.status === 'ready') {
      validateAudioCapability(parsed.data, options, this.config.apiBaseUrl);
    }
    return parsed.data;
  }
}

function assertValidSelection(
  options: AudioPostcardOptions,
  profileId: string,
  modeId: string,
): void {
  const profile = options.profiles.find(
    (candidate) => candidate.enabled && candidate.id === profileId,
  );
  const mode = options.modes.find(
    (candidate) =>
      candidate.enabled && candidate.id === modeId && profile?.allowedModeIds.includes(modeId),
  );
  if (!profile || !mode) throw new AudioPostcardClientError('rejected');
}

function parseHttpError(response: Response, payload: unknown): ParsedError {
  const retryAt = parseRetryAfter(response.headers.get('Retry-After'));
  const failed = audioPostcardTerminalResultSchema.safeParse(payload);
  if (failed.success && failed.data.status === 'failed') {
    assertQuotaTimesAreFuture(failed.data.quota);
    return {
      status: response.status,
      category: failed.data.category,
      ...(failed.data.details.scope ? { scope: failed.data.details.scope } : {}),
      retryable: failed.data.retryable,
      ...(retryAt !== undefined ? { retryAt } : {}),
      quota: failed.data.quota,
    };
  }
  const parsed = audioPostcardErrorEnvelopeSchema.safeParse(payload);
  if (!parsed.success) throw new AudioPostcardClientError('contract');
  if (parsed.data.quota) assertQuotaTimesAreFuture(parsed.data.quota);
  if (response.status === 429 && parsed.data.details.scope === 'installation') {
    const installationWindow = parsed.data.quota?.windows.find(
      (window) => window.scope === 'installation',
    );
    if (
      retryAt === undefined ||
      parsed.data.quota?.charged !== false ||
      installationWindow?.remaining !== 0 ||
      Math.abs(Date.parse(installationWindow.resetAt) - retryAt) > 1_500
    ) {
      throw new AudioPostcardClientError('contract');
    }
  }
  return {
    status: response.status,
    category: parsed.data.details.category,
    ...(parsed.data.details.reason ? { reason: parsed.data.details.reason } : {}),
    ...(parsed.data.details.scope ? { scope: parsed.data.details.scope } : {}),
    ...(retryAt !== undefined ? { retryAt } : {}),
    ...(parsed.data.quota ? { quota: parsed.data.quota } : {}),
  };
}

function mapHttpError(error: ParsedError): AudioPostcardClientError {
  const details = {
    status: error.status,
    ...(error.category ? { category: error.category } : {}),
    ...(error.scope ? { scope: error.scope } : {}),
    ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
    ...(error.retryAt !== undefined ? { retryAt: error.retryAt } : {}),
    ...(error.quota ? { quota: error.quota } : {}),
  };
  if (error.status === 429 && error.scope === 'installation') {
    return new AudioPostcardClientError('rate_limited', details);
  }
  if (error.status === 403) return new AudioPostcardClientError('forbidden', details);
  if (error.status >= 500 || error.scope === 'provider') {
    return new AudioPostcardClientError('failed', details);
  }
  return new AudioPostcardClientError('rejected', details);
}

function mapAudioPostcardTransportError(
  error: unknown,
  signal: AbortSignal | undefined,
  ambiguousOutcome: boolean,
): Error {
  if (error instanceof AudioPostcardClientError) return error;
  if (error instanceof RemoteHttpError) {
    return new AudioPostcardClientError('rejected', {
      status: error.status,
      category: 'unauthorized',
    });
  }
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return new AudioPostcardClientError('aborted', { ambiguousOutcome });
  }
  return new AudioPostcardClientError('network', { ambiguousOutcome });
}

function assertQuotaTimesAreFuture(quota: AudioPostcardTerminalResult['quota']): void {
  if (quota.windows.some((window) => Date.parse(window.resetAt) <= Date.now())) {
    throw new AudioPostcardClientError('contract');
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= Date.now() ? timestamp : undefined;
}

export function defaultAudioPostcardSelection(options: AudioPostcardOptions): {
  profileId: string;
  modeId: string;
} {
  try {
    return selectAudioPostcardDefaults(options);
  } catch {
    throw new AudioPostcardClientError('contract');
  }
}
