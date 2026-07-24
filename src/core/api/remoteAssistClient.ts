import {
  remoteProfilesResponseSchema,
  remotePublicConfigSchema,
  webBootstrapResponseV2Schema,
  type RemoteProfileCatalog,
  type RemoteProfilesResponse,
  type RemotePublicConfig,
  type WebBootstrapResponseV2,
} from '@/core/api/remoteCatalogContracts';
import {
  assertNotAborted,
  blobToBase64,
  createMemoryInstallationId,
  forwardAbort,
} from '@/core/api/remoteClientSupport';
import { consumeFollowupSse } from '@/core/api/followupSse';
import {
  buildWebSceneFollowupRequest,
  FOLLOWUP_QUESTION_MAX_LENGTH,
  remoteErrorEnvelopeSchema,
  type FollowupStreamCallbacks,
  type RemoteFollowupInput,
  type RemoteFollowupResult,
} from '@/core/api/remoteFollowupContracts';
import {
  webSceneDescribeRequestSchema,
  type NormalizedSceneInput,
  type RemoteSceneResult,
  type SceneStreamCallbacks,
} from '@/core/api/remoteSceneContracts';
import { consumeSceneSse, SCENE_RESPONSE_TIMEOUT_MS, SceneStreamError } from '@/core/api/sceneSse';
import type { RuntimeConfig } from '@/core/config/runtimeConfig';
import { SCENE_IMAGE_MAX_BYTES } from '@/core/image/sceneImageInspection';
import { RemoteHttpError, RemoteSessionManager } from '@/core/session/remoteSessionManager';

export type RemoteRuntimeConfig = Extract<RuntimeConfig, { mode: 'remote' }>;

export type RemoteClientErrorCode =
  | 'NETWORK_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'SCENE_CONTEXT_INVALID'
  | 'SCENE_CONTEXT_EXPIRED'
  | 'REQUEST_REJECTED'
  | 'REMOTE_CONTRACT_INVALID'
  | 'PROFILE_CACHE_INVALID'
  | 'REQUEST_ABORTED';

export class RemoteClientError extends Error {
  constructor(
    readonly code: RemoteClientErrorCode,
    readonly retryAt?: number,
    readonly status?: number,
  ) {
    super(code);
    this.name = 'RemoteClientError';
  }
}

export interface RemoteReadiness {
  catalog: RemoteProfileCatalog;
  sceneDescribeEnabled: boolean;
  followupEnabled: boolean;
}

interface ProfileCatalogCacheEntry {
  etag: string;
  response: RemoteProfilesResponse;
}

interface RemoteAssistClientOptions {
  installationId?: string;
  fetch?: typeof fetch;
}

export class RemoteAssistClient {
  readonly #sessions: RemoteSessionManager;
  readonly #installationId: string;
  readonly #fetchImplementation: typeof fetch;
  #cache?: ProfileCatalogCacheEntry;

  constructor(
    private readonly config: RemoteRuntimeConfig,
    options: RemoteAssistClientOptions = {},
  ) {
    this.#installationId = options.installationId ?? createMemoryInstallationId();
    if (!this.#installationId.trim()) throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    this.#fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#sessions = new RemoteSessionManager((signal) => this.#bootstrap(signal));
  }

  async initialize(signal?: AbortSignal): Promise<RemoteReadiness> {
    const publicConfig = await this.#loadConfig(signal);
    const bootstrap = await this.#sessions.ensure(signal);
    const catalog = await this.#loadProfiles(publicConfig, signal);
    return projectReadiness(publicConfig, bootstrap, catalog);
  }

  async refreshCatalog(signal?: AbortSignal): Promise<RemoteReadiness> {
    return this.initialize(signal);
  }

  async describeScene(
    input: NormalizedSceneInput,
    callbacks: SceneStreamCallbacks = {},
    signal?: AbortSignal,
  ): Promise<RemoteSceneResult> {
    signal?.throwIfAborted();
    if (input.image.type !== 'image/jpeg' || input.image.size > SCENE_IMAGE_MAX_BYTES) {
      throw new RemoteClientError('REQUEST_REJECTED');
    }

    let imageBase64: string | undefined = await blobToBase64(input.image, signal);
    try {
      return await this.#sessions.withUnauthorizedRetry((sessionToken) => {
        if (!imageBase64) throw new RemoteClientError('REQUEST_ABORTED');
        return this.#describeAttempt(
          {
            sessionToken,
            installationId: this.#installationId,
            imageBase64,
            imageMimeType: 'image/jpeg',
            sceneMode: 'describe',
            stream: true,
            profileId: input.profileId,
            locale: input.locale,
          },
          callbacks,
          signal,
        );
      }, signal);
    } catch (error) {
      throw mapClientError(error, signal);
    } finally {
      imageBase64 = undefined;
    }
  }

  async followupScene(
    input: RemoteFollowupInput,
    callbacks: FollowupStreamCallbacks = {},
    signal?: AbortSignal,
  ): Promise<RemoteFollowupResult> {
    signal?.throwIfAborted();
    const normalizedQuestion = input.questionText.trim();
    if (
      input.image.type !== 'image/jpeg' ||
      input.image.size > SCENE_IMAGE_MAX_BYTES ||
      !input.sceneToken.trim() ||
      !input.profileId.trim() ||
      !input.locale.trim() ||
      !normalizedQuestion ||
      normalizedQuestion.length > FOLLOWUP_QUESTION_MAX_LENGTH
    ) {
      throw new RemoteClientError('REQUEST_REJECTED');
    }

    const normalizedInput: RemoteFollowupInput = {
      ...input,
      questionText: normalizedQuestion,
    };
    let imageBase64: string | undefined = await blobToBase64(input.image, signal);
    try {
      return await this.#sessions.withUnauthorizedRetry((sessionToken) => {
        if (!imageBase64) throw new RemoteClientError('REQUEST_ABORTED');
        let request: ReturnType<typeof buildWebSceneFollowupRequest>;
        try {
          request = buildWebSceneFollowupRequest({
            sessionToken,
            installationId: this.#installationId,
            imageBase64,
            input: normalizedInput,
          });
        } catch {
          throw new RemoteClientError('REQUEST_REJECTED');
        }
        return this.#followupAttempt(request, callbacks, signal);
      }, signal);
    } catch (error) {
      throw mapClientError(error, signal);
    } finally {
      imageBase64 = undefined;
    }
  }

  async #describeAttempt(
    request: unknown,
    callbacks: SceneStreamCallbacks,
    signal?: AbortSignal,
  ): Promise<RemoteSceneResult> {
    const parsed = webSceneDescribeRequestSchema.safeParse(request);
    if (!parsed.success) throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    let body: string | undefined = JSON.stringify(parsed.data);
    const controller = new AbortController();
    const removeAbort = forwardAbort(signal, controller);
    const requestStartedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const responsePromise = this.#fetchImplementation(
        new URL('/api/v1/scene/describe', this.config.apiBaseUrl),
        {
          method: 'POST',
          headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          body,
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      const response = await withResponseTimeout(responsePromise, controller, (value) => {
        timer = value;
      });
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;

      if (response.status === 401) throw new RemoteHttpError(401);
      if (response.status === 403) throw new RemoteHttpError(403);
      if (response.status === 429) throw rateLimitError(response);
      if (!response.ok) throw statusError(response.status);
      assertEventStreamResponse(response);

      return await consumeSceneSse(response.body!, {
        profileId: parsed.data.profileId,
        locale: parsed.data.locale,
        requestStartedAt,
        callbacks,
        ...(signal ? { signal } : {}),
        abort: () => controller.abort(),
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      removeAbort();
      body = undefined;
    }
  }

  async #followupAttempt(
    request: ReturnType<typeof buildWebSceneFollowupRequest>,
    callbacks: FollowupStreamCallbacks,
    signal?: AbortSignal,
  ): Promise<RemoteFollowupResult> {
    let body: string | undefined = JSON.stringify(request);
    const controller = new AbortController();
    const removeAbort = forwardAbort(signal, controller);
    const requestStartedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const responsePromise = this.#fetchImplementation(
        new URL('/api/v1/scene/followup', this.config.apiBaseUrl),
        {
          method: 'POST',
          headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          body,
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      const response = await withResponseTimeout(responsePromise, controller, (value) => {
        timer = value;
      });
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;

      if (response.status === 401) await throwFollowupUnauthorized(response);
      if (response.status === 403) throw new RemoteHttpError(403);
      if (response.status === 429) throw rateLimitError(response);
      if (!response.ok) throw statusError(response.status);
      assertEventStreamResponse(response);

      return await consumeFollowupSse(response.body!, {
        profileId: request.profileId,
        locale: request.locale,
        requestStartedAt,
        callbacks,
        ...(signal ? { signal } : {}),
        abort: () => controller.abort(),
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      removeAbort();
      body = undefined;
    }
  }

  async #loadConfig(signal?: AbortSignal): Promise<RemotePublicConfig> {
    const response = await this.#fetchJson('/api/v1/config', {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    const parsed = remotePublicConfigSchema.safeParse(await response.json().catch(() => undefined));
    assertNotAborted(signal);
    if (!parsed.success) throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    const expected = this.config.target === 'staging' ? 'staging' : 'prod';
    if (parsed.data.environment !== expected) {
      throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    }
    return parsed.data;
  }

  async #bootstrap(signal?: AbortSignal): Promise<WebBootstrapResponseV2> {
    const response = await this.#fetchJson('/api/v1/session/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        appVersion: this.config.appVersion,
        versionCode: this.config.versionCode,
        platform: 'web',
        locale: this.config.defaultLocale,
        installationId: this.#installationId,
      }),
      ...(signal ? { signal } : {}),
    });
    const parsed = webBootstrapResponseV2Schema.safeParse(
      await response.json().catch(() => undefined),
    );
    assertNotAborted(signal);
    if (!parsed.success) throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    const expected = this.config.target === 'staging' ? 'staging' : 'prod';
    if (parsed.data.bootstrapInfo.environment !== expected) {
      throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    }
    return parsed.data;
  }

  async #loadProfiles(
    publicConfig: RemotePublicConfig,
    signal: AbortSignal | undefined,
    cacheless304Recovery = false,
  ): Promise<RemoteProfileCatalog> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.#cache && !cacheless304Recovery) headers['If-None-Match'] = this.#cache.etag;
    const response = await this.#fetchJson(
      '/api/v1/profiles',
      { headers, cache: 'no-store', ...(signal ? { signal } : {}) },
      true,
    );
    assertNotAborted(signal);
    if (response.status === 304) {
      if (this.#cache && !cacheless304Recovery) {
        return projectCatalog(this.#cache.response, publicConfig);
      }
      if (!cacheless304Recovery) return this.#loadProfiles(publicConfig, signal, true);
      throw new RemoteClientError('PROFILE_CACHE_INVALID');
    }
    const parsed = remoteProfilesResponseSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!parsed.success) throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    const etag = response.headers.get('ETag');
    if (!etag) throw new RemoteClientError('PROFILE_CACHE_INVALID');
    this.#cache = { etag, response: parsed.data };
    return projectCatalog(parsed.data, publicConfig);
  }

  async #fetchJson(path: string, init: RequestInit, allow304 = false): Promise<Response> {
    try {
      const response = await this.#fetchImplementation(new URL(path, this.config.apiBaseUrl), init);
      if ((allow304 && response.status === 304) || response.ok) return response;
      if (response.status === 429) throw rateLimitError(response);
      if (response.status === 401 || response.status === 403) {
        throw new RemoteHttpError(response.status);
      }
      throw statusError(response.status);
    } catch (error) {
      if (error instanceof RemoteClientError || error instanceof RemoteHttpError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new RemoteClientError('REQUEST_ABORTED');
      }
      throw new RemoteClientError('NETWORK_UNAVAILABLE');
    }
  }
}

function projectReadiness(
  config: RemotePublicConfig,
  bootstrap: WebBootstrapResponseV2,
  catalog: RemoteProfileCatalog,
): RemoteReadiness {
  return {
    catalog,
    sceneDescribeEnabled:
      config.features.sceneDescribe === true &&
      bootstrap.featureFlags.sceneDescribe === true &&
      catalog.profiles.some((profile) => profile.supportsStreaming),
    followupEnabled:
      config.features.followup === true &&
      bootstrap.featureFlags.followup === true &&
      catalog.profiles.some(
        (profile) => profile.supportsStreaming && profile.supportsFollowup,
      ),
  };
}

function projectCatalog(
  response: RemoteProfilesResponse,
  config: RemotePublicConfig,
): RemoteProfileCatalog {
  const allowed = new Set(config.profiles.backendSupportedProfileIds);
  const profiles = response.profiles
    .filter(
      (profile) =>
        (profile.availability === 'backend' || profile.availability === 'both') &&
        profile.transports.backend?.available === true &&
        allowed.has(profile.id),
    )
    .map((profile) => ({
      id: profile.id,
      label: profile.label,
      description: profile.description,
      supportsStreaming: profile.transports.backend!.supportsStreaming,
      supportsFollowup: profile.transports.backend!.supportsFollowup,
    }));
  const defaultProfileId = profiles.some((profile) => profile.id === response.defaultProfileId)
    ? response.defaultProfileId
    : undefined;
  return { profiles, ...(defaultProfileId ? { defaultProfileId } : {}) };
}

async function withResponseTimeout(
  responsePromise: Promise<Response>,
  controller: AbortController,
  setTimer: (timer: ReturnType<typeof setTimeout>) => void,
): Promise<Response> {
  return Promise.race([
    responsePromise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new SceneStreamError('STREAM_RESPONSE_TIMEOUT'));
      }, SCENE_RESPONSE_TIMEOUT_MS);
      setTimer(timer);
    }),
  ]);
}

function assertEventStreamResponse(response: Response): asserts response is Response & {
  body: ReadableStream<Uint8Array>;
} {
  if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream')) {
    throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
  }
  if (!response.body) throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
}

async function throwFollowupUnauthorized(response: Response): Promise<never> {
  const parsed = remoteErrorEnvelopeSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  if (!parsed.success) throw new RemoteClientError('UNAUTHORIZED', undefined, 401);
  const tokenType = parsed.data.details?.tokenType;
  const reason = parsed.data.details?.reason;
  if (tokenType === 'session' && reason?.startsWith('session_token_')) {
    throw new RemoteHttpError(401);
  }
  if (tokenType === 'scene' && reason?.startsWith('scene_token_')) {
    throw new RemoteClientError(
      reason === 'scene_token_expired' ? 'SCENE_CONTEXT_EXPIRED' : 'SCENE_CONTEXT_INVALID',
      undefined,
      401,
    );
  }
  throw new RemoteClientError('UNAUTHORIZED', undefined, 401);
}

function statusError(status: number): RemoteClientError {
  if (status >= 500) return new RemoteClientError('SERVICE_UNAVAILABLE', undefined, status);
  return new RemoteClientError('REQUEST_REJECTED', undefined, status);
}

function rateLimitError(response: Response): RemoteClientError {
  return new RemoteClientError(
    'RATE_LIMITED',
    parseRetryAfter(response.headers.get('Retry-After')),
    429,
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) && date >= Date.now() ? date : undefined;
}

function mapClientError(error: unknown, signal?: AbortSignal): Error {
  if (error instanceof RemoteHttpError) {
    return error.status === 403
      ? new RemoteClientError('FORBIDDEN', undefined, 403)
      : new RemoteClientError('UNAUTHORIZED', undefined, 401);
  }
  if (error instanceof RemoteClientError || error instanceof SceneStreamError) return error;
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return new RemoteClientError('REQUEST_ABORTED');
  }
  return new RemoteClientError('NETWORK_UNAVAILABLE');
}
