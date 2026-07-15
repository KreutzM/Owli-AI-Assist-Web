import { describe, expect, it, vi } from 'vitest';
import { RemoteCatalogClient } from '@/core/api/remoteCatalogClient';
import { PROFILE_REGISTRY_SCHEMA_VERSION } from '@/core/api/remoteCatalogContracts';

const config = {
  mode: 'remote' as const,
  target: 'staging' as const,
  apiBaseUrl: 'https://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/',
  appVersion: '0.1.0',
  versionCode: 1,
  defaultLocale: 'de-DE',
};

const publicConfig = {
  environment: 'staging',
  features: { sceneDescribe: false, followup: false },
  profiles: { backendSupportedProfileIds: ['basic'] },
};
const bootstrap = {
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
};
const profiles = {
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
};

function client() {
  return new RemoteCatalogClient(config, { installationId: 'installation-test-id' });
}

describe('manual profile ETag cache', () => {
  it('sends the memory ETag on refresh and reuses visible 304', async () => {
    const profileHeaders: Headers[] = [];
    let profileCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/config')) return Response.json(publicConfig);
        if (path.endsWith('/bootstrap')) return Response.json(bootstrap);
        profileHeaders.push(new Headers(init?.headers));
        profileCalls += 1;
        return profileCalls === 1
          ? Response.json(profiles, { headers: { ETag: '"v1"' } })
          : new Response(null, { status: 304 });
      }),
    );
    const catalogClient = client();
    await catalogClient.initialize();
    const refreshed = await catalogClient.refresh();
    expect(profileHeaders[0]?.get('Authorization')).toBeNull();
    expect(profileHeaders[0]?.get('If-None-Match')).toBeNull();
    expect(profileHeaders[1]?.get('If-None-Match')).toBe('"v1"');
    expect(refreshed.profiles).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('performs one cacheless recovery after an unusable 304', async () => {
    const profileHeaders: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/config')) return Response.json(publicConfig);
        if (path.endsWith('/bootstrap')) return Response.json(bootstrap);
        profileHeaders.push(new Headers(init?.headers));
        return profileHeaders.length === 1
          ? new Response(null, { status: 304 })
          : Response.json(profiles, { headers: { ETag: '"v1"' } });
      }),
    );
    await expect(client().initialize()).resolves.toMatchObject({ defaultProfileId: 'basic' });
    expect(profileHeaders).toHaveLength(2);
    expect(profileHeaders.every((headers) => headers.get('If-None-Match') === null)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('does not persist an ETag across a new client instance', async () => {
    const profileHeaders: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/config')) return Response.json(publicConfig);
        if (path.endsWith('/bootstrap')) return Response.json(bootstrap);
        profileHeaders.push(new Headers(init?.headers));
        return Response.json(profiles, { headers: { ETag: '"v1"' } });
      }),
    );
    await client().initialize();
    await client().initialize();
    expect(profileHeaders).toHaveLength(2);
    expect(profileHeaders.every((headers) => headers.get('If-None-Match') === null)).toBe(true);
    vi.unstubAllGlobals();
  });
});
