import { describe, expect, it, vi } from 'vitest';
import { RemoteSessionManager } from '@/core/session/remoteSessionManager';

describe('remote session abort', () => {
  it('does not retain a session resolved after abort', async () => {
    const controller = new AbortController();
    const manager = new RemoteSessionManager(async () => {
      controller.abort();
      return {
        sessionToken: 'secret',
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        featureFlags: { sceneDescribe: false, followup: false },
        bootstrapInfo: {
          environment: 'staging', sessionTtlSeconds: 120, sessionSchemaVersion: 2, platform: 'web',
          trust: { kind: 'browser_public_client', status: 'unattested_public_client', enforced: false, note: 'public' },
        },
      };
    });
    await expect(manager.ensure(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(manager.metadata.status).toBe('empty');
    vi.restoreAllMocks();
  });
});
