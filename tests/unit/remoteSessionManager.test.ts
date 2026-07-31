import { describe, expect, it, vi } from 'vitest';
import { RemoteHttpError, RemoteSessionManager } from '@/core/session/remoteSessionManager';
import type { WebBootstrapResponseV2 } from '@/core/api/remoteCatalogContracts';

function session(token = 'private-token'): WebBootstrapResponseV2 {
  return {
    sessionToken: token,
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
}

describe('RemoteSessionManager', () => {
  it('shares one bootstrap between concurrent callers', async () => {
    const bootstrap = vi.fn(async () => session());
    const manager = new RemoteSessionManager(bootstrap);
    const [first, second] = await Promise.all([manager.ensure(), manager.ensure()]);
    expect(first).toBe(second);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('retries initial bootstrap exactly once after 401', async () => {
    const bootstrap = vi
      .fn<() => Promise<WebBootstrapResponseV2>>()
      .mockRejectedValueOnce(new RemoteHttpError(401))
      .mockResolvedValueOnce(session('second'));
    const manager = new RemoteSessionManager(bootstrap);
    await expect(manager.ensure()).resolves.toMatchObject({ sessionToken: 'second' });
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('lets a second bootstrap 401 escape', async () => {
    const bootstrap = vi.fn(async () => {
      throw new RemoteHttpError(401);
    });
    const manager = new RemoteSessionManager(bootstrap);
    await expect(manager.ensure()).rejects.toMatchObject({ status: 401 });
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('retries an authenticated operation exactly once after 401', async () => {
    const bootstrap = vi.fn(async () => session(String(bootstrap.mock.calls.length)));
    const manager = new RemoteSessionManager(bootstrap);
    const operation = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(new RemoteHttpError(401))
      .mockResolvedValueOnce('ok');
    await expect(manager.withUnauthorizedRetry(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('lets a second authenticated operation 401 escape', async () => {
    const bootstrap = vi.fn(async () => session(String(bootstrap.mock.calls.length)));
    const manager = new RemoteSessionManager(bootstrap);
    const operation = vi.fn(async () => {
      throw new RemoteHttpError(401);
    });
    await expect(manager.withUnauthorizedRetry(operation)).rejects.toMatchObject({ status: 401 });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('does not bootstrap again after 403', async () => {
    const bootstrap = vi.fn(async () => session());
    const manager = new RemoteSessionManager(bootstrap);
    await expect(
      manager.withUnauthorizedRetry(async () => {
        throw new RemoteHttpError(403);
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });
});
