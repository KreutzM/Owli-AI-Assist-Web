import { describe, expect, it, vi } from 'vitest';
import { RemoteHttpError, RemoteSessionManager } from '@/core/session/remoteSessionManager';
import type { WebBootstrapResponseV2 } from '@/core/api/remoteCatalogContracts';

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
  it('surfaces a second 401 without another bootstrap', async () => {
    const bootstrap = vi.fn(async () => session());
    const operation = vi.fn(async () => {
      throw new RemoteHttpError(401);
    });
    const manager = new RemoteSessionManager(bootstrap);
    await expect(manager.withUnauthorizedRetry(operation)).rejects.toMatchObject({ status: 401 });
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
