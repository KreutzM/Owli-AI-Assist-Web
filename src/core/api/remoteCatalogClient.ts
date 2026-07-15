import {
  remoteProfilesResponseSchema,
  remotePublicConfigSchema,
  webBootstrapResponseV2Schema,
  type RemoteProfileCatalog,
  type RemoteProfilesResponse,
  type RemotePublicConfig,
} from '@/core/api/remoteCatalogContracts';
import type { RuntimeConfig } from '@/core/config/runtimeConfig';
import { RemoteHttpError, RemoteSessionManager } from '@/core/session/remoteSessionManager';

export type RemoteRuntimeConfig = Extract<RuntimeConfig, { mode: 'remote' }>;

export type RemoteClientErrorCode =
  | 'NETWORK_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'BOOTSTRAP_REJECTED'
  | 'REMOTE_CONTRACT_INVALID'
  | 'PROFILE_CACHE_INVALID'
  | 'REQUEST_ABORTED';

export class RemoteClientError extends Error {
  constructor(
    readonly code: RemoteClientErrorCode,
    readonly retryAt?: number,
  ) {
    super(code);
    this.name = 'RemoteClientError';
  }
}

interface ProfileCatalogCacheEntry {
  etag: string;
  response: RemoteProfilesResponse;
}

interface RemoteCatalogClientOptions {
  installationId?: string;
}

export class RemoteCatalogClient {
  readonly #sessions: RemoteSessionManager;
  readonly #installationId: string;
  #cache?: ProfileCatalogCacheEntry;

  constructor(
    private readonly config: RemoteRuntimeConfig,
    options: RemoteCatalogClientOptions = {},
  ) {
    this.#installationId = options.installationId ?? createMemoryInstallationId();
    if (!this.#installationId.trim()) {
      throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    }
    this.#sessions = new RemoteSessionManager((signal) => this.#bootstrap(signal));
  }

  async initialize(signal?: AbortSignal): Promise<RemoteProfileCatalog> {
    const publicConfig = await this.#loadConfig(signal);
    await this.#sessions.ensure(signal);
    return this.#loadProfiles(publicConfig, signal);
  }

  async refresh(signal?: AbortSignal): Promise<RemoteProfileCatalog> {
    const publicConfig = await this.#loadConfig(signal);
    await this.#sessions.ensure(signal);
    return this.#loadProfiles(publicConfig, signal);
  }

  async #loadConfig(signal?: AbortSignal): Promise<RemotePublicConfig> {
    const response = await this.#fetch('/api/v1/config', {
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

  async #bootstrap(signal?: AbortSignal) {
    const response = await this.#fetch('/api/v1/session/bootstrap', {
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

    const response = await this.#fetch(
      '/api/v1/profiles',
      {
        headers,
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
      true,
    );
    assertNotAborted(signal);

    if (response.status === 304) {
      if (this.#cache && !cacheless304Recovery) {
        return projectCatalog(this.#cache.response, publicConfig);
      }
      if (!cacheless304Recovery) {
        return this.#loadProfiles(publicConfig, signal, true);
      }
      throw new RemoteClientError('PROFILE_CACHE_INVALID');
    }
    if (!response.ok) throw new RemoteHttpError(response.status);

    const parsed = remoteProfilesResponseSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    assertNotAborted(signal);
    if (!parsed.success) throw new RemoteClientError('REMOTE_CONTRACT_INVALID');
    const etag = response.headers.get('ETag');
    if (!etag) throw new RemoteClientError('PROFILE_CACHE_INVALID');
    this.#cache = { etag, response: parsed.data };
    return projectCatalog(parsed.data, publicConfig);
  }

  async #fetch(path: string, init: RequestInit, allow304 = false): Promise<Response> {
    try {
      const response = await fetch(new URL(path, this.config.apiBaseUrl), init);
      if (allow304 && response.status === 304) return response;
      if (response.ok) return response;
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        throw new RemoteClientError(
          'RATE_LIMITED',
          Number.isFinite(retryAfter) ? Date.now() + retryAfter * 1000 : undefined,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new RemoteHttpError(response.status);
      }
      if (response.status >= 500) throw new RemoteClientError('SERVICE_UNAVAILABLE');
      throw new RemoteClientError('BOOTSTRAP_REJECTED');
    } catch (error) {
      if (error instanceof RemoteClientError || error instanceof RemoteHttpError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new RemoteClientError('REQUEST_ABORTED');
      }
      throw new RemoteClientError('NETWORK_UNAVAILABLE');
    }
  }
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

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RemoteClientError('REQUEST_ABORTED');
}

function createMemoryInstallationId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
