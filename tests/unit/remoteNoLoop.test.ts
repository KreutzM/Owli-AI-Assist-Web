import { describe, expect, it, vi } from 'vitest';
import { RemoteCatalogClient } from '@/core/api/remoteCatalogClient';
import {
  PROFILE_REGISTRY_SCHEMA_VERSION,
  type WebBootstrapResponseV2,
} from '@/core/api/remoteCatalogContracts';
import { RemoteHttpError, RemoteSessionManager } from '@/core/session/remoteSessionManager';

const session = (): WebBootstrapResponseV2 => ({
  sessionToken: 'private',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  featureFlags: { sceneDescribe: false, followup: false },
  bootstrapInfo: {
    environment: 'staging',
    sessionTtlSeconds: 120,
    sessionSchemaVersion: 2,
    platform: 'web',
    trust: {
      kind: 'browser_public_client',
      status: 'unattested_public_client',
      enforced: false,
      note: 'public',
    },
  },
});

describe('401 retry loop bound', () => {
  it('surfaces a second authenticated-operation 401 without another bootstrap', async () => {
    const bootstrap = vi.fn(async () => session());
    const operation = vi.fn(async () => {
      throw new RemoteHttpError(401);
    });
    const manager = new RemoteSessionManager(bootstrap);
    await expect(manager.withUnauthorizedRetry(operation)).rejects.toMatchObject({ status: 401 });
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('retries a bootstrap 401 once during real catalog initialization', async () => {
    let bootstrapCalls = 0;
    let profileCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/config')) {
          return Response.json({
            environment: 'staging',
            features: { sceneDescribe: false, followup: false },
            profiles: { backendSupportedProfileIds: ['basic'] },
          });
        }
        if (path.endsWith('/bootstrap')) {
          bootstrapCalls += 1;
          return bootstrapCalls === 1
            ? new Response(null, { status: 401 })
            : Response.json(session());
        }
        profileCalls += 1;
        return Response.json(
          {
            schemaVersion: PROFILE_REGISTRY_SCHEMA_VERSION,
            defaultProfileId: 'basic',
            profiles: [
              {
                id: 'basic',
                label: 'Basic',
                description: 'Profile',
                availability: 'backend',
                transports: {
                  backend: { available: true, supportsStreaming: false, supportsFollowup: false },
                },
              },
            ],
          },
          { headers: { ETag: '"v1"' } },
        );
      }),
    );

    const client = new RemoteCatalogClient(
      {
        mode: 'remote',
        target: 'staging',
        apiBaseUrl: 'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/',
        appVersion: '0.1.0',
        versionCode: 1,
        defaultLocale: 'de-DE',
      },
      { installationId: 'installation-test-id' },
    );
    await expect(client.initialize()).resolves.toMatchObject({ defaultProfileId: 'basic' });
    expect(bootstrapCalls).toBe(2);
    expect(profileCalls).toBe(1);
    vi.unstubAllGlobals();
  });
});
