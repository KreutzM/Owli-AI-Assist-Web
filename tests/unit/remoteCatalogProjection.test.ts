import { describe, expect, it, vi } from 'vitest';
import { RemoteAssistClient } from '@/core/api/remoteAssistClient';
import { PROFILE_REGISTRY_SCHEMA_VERSION } from '@/core/api/remoteCatalogContracts';

const config = {
  mode: 'remote' as const,
  target: 'staging' as const,
  apiBaseUrl: 'https://api-staging.owli-ai.com/',
  appVersion: '0.1.0',
  versionCode: 1,
  defaultLocale: 'de-DE',
};

const bootstrap = {
  sessionToken: 'private',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  featureFlags: { sceneDescribe: false, followup: false, audioPostcard: false },
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

describe('RemoteAssistClient catalog projection', () => {
  it('uses config, bootstrap and public profiles in order with dual opt-in', async () => {
    const requests: string[] = [];
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      requests.push(new URL(url).pathname);
      if (url.endsWith('/config')) {
        return Response.json({
          environment: 'staging',
          features: { sceneDescribe: false, followup: false, audioPostcard: false },
          profiles: { backendSupportedProfileIds: ['allowed'] },
        });
      }
      if (url.endsWith('/session/bootstrap')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          platform: 'web',
          installationId: 'installation-test-id',
        });
        return Response.json(bootstrap);
      }
      expect(init?.cache).toBe('no-store');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('Accept')).toBe('application/json');
      return Response.json(
        {
          schemaVersion: PROFILE_REGISTRY_SCHEMA_VERSION,
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
    });

    const readiness = await new RemoteAssistClient(config, {
      installationId: 'installation-test-id',
      fetch: fetchImplementation,
    }).initialize();
    expect(requests).toEqual(['/api/v1/config', '/api/v1/session/bootstrap', '/api/v1/profiles']);
    expect(readiness.catalog.profiles.map((profile) => profile.id)).toEqual(['allowed']);
    expect(readiness.catalog.defaultProfileId).toBeUndefined();
    expect(readiness.sceneDescribeEnabled).toBe(false);
  });
});
