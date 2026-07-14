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
      note: 'public browser client',
    },
  },
};

describe('RemoteCatalogClient', () => {
  it('uses config, bootstrap and profiles in order with dual opt-in', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        requests.push(new URL(url).pathname);
        if (url.endsWith('/config')) {
          return Response.json({
            environment: 'staging',
            features: { sceneDescribe: false, followup: false },
            profiles: { backendSupportedProfileIds: ['allowed'] },
          });
        }
        if (url.endsWith('/session/bootstrap')) return Response.json(bootstrap);
        expect(init?.cache).toBe('no-store');
        return Response.json(
          {
            schemaVersion: '1',
            defaultProfileId: 'blocked',
            profiles: [
              {
                id: 'allowed',
                label: 'Allowed',
                description: 'Allowed profile',
                availability: 'backend',
                transports: {
                  backend: { available: true, supportsStreaming: true, supportsFollowup: false },
                },
              },
              {
                id: 'blocked',
                label: 'Blocked',
                description: 'Blocked profile',
                availability: 'backend',
                transports: {
                  backend: { available: false, supportsStreaming: true, supportsFollowup: false },
                },
              },
            ],
          },
          { headers: { ETag: '"catalog-1"' } },
        );
      }),
    );

    const catalog = await new RemoteCatalogClient(config).initialize();
    expect(requests).toEqual(['/api/v1/config', '/api/v1/session/bootstrap', '/api/v1/profiles']);
    expect(catalog.profiles.map((profile) => profile.id)).toEqual(['allowed']);
    expect(catalog.defaultProfileId).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
