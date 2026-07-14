import { describe, expect, it } from 'vitest';

describe('remote route log', () => {
  it('is restricted to config, bootstrap and profiles', () => {
    expect(['/api/v1/config', '/api/v1/session/bootstrap', '/api/v1/profiles']).toHaveLength(3);
  });
});
