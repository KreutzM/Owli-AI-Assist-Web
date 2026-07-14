import { describe, expect, it, vi } from 'vitest';
import { RemoteCatalogClient } from '@/core/api/remoteCatalogClient';

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
  schemaVersion: '1',
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
    const client = new RemoteCatalogClient(config);
    await client.initialize();
    const refreshed = await client.refresh();
    expect(profileHeaders[0]?.get('If-None-Match')).toBeNull();
    expect(profileHeaders[1]?.get('If-None-Match')).toBe('"v1"');
    expect(refreshed.profiles).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
