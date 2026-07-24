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
import { consumeSceneSse } from '@/core/api/sceneSse';
import { SCENE_IMAGE_MAX_BYTES } from '@/core/image/sceneImageInspection';
import type { RemoteReadiness, RemoteRuntimeConfig } from '@/core/api/remoteAssistTypes';
import { RemoteHttpError, RemoteSessionManager } from '@/core/session/remoteSessionManager';
import {
  assertEventStreamResponse,
  projectCatalog,
  projectReadiness,
  throwFollowupUnauthorized,
  withResponseTimeout,
  type ProfileCatalogCacheEntry,
  type RemoteAssistClientOptions,
} from '@/core/api/remoteAssistClientSupport';
import {
  mapClientError,
  rateLimitError,
  RemoteClientError,
  statusError,
  type RemoteClientErrorCode,
} from '@/core/api/remoteClientErrors';

export type { RemoteReadiness, RemoteRuntimeConfig } from '@/core/api/remoteAssistTypes';
export { RemoteClientError, type RemoteClientErrorCode } from '@/core/api/remoteClientErrors';

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

      return await consumeSceneSse(response.body, {
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

      return await consumeFollowupSse(response.body, {
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
