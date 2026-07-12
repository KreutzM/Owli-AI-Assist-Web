import { describe, expect, it } from 'vitest';
import { SessionStore } from '@/core/session/sessionStore';
import type { BootstrapSession } from '@/core/types';

const session: BootstrapSession = {
  sessionToken: 'session-token',
  expiresAt: '2026-07-12T12:10:00.000Z',
  featureFlags: { sceneDescribe: true, followup: true },
};

describe('SessionStore', () => {
  it('returns only sessions that remain valid beyond the refresh margin', () => {
    const store = new SessionStore();
    store.set(session);

    expect(store.getValid(Date.parse('2026-07-12T12:00:00.000Z'))).toEqual(session);
    expect(store.getValid(Date.parse('2026-07-12T12:09:40.000Z'))).toBeUndefined();

    store.clear();
    expect(store.getValid(Date.parse('2026-07-12T12:00:00.000Z'))).toBeUndefined();
  });
});
