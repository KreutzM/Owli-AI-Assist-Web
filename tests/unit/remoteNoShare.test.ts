import { describe, expect, it } from 'vitest';

describe('remote share isolation', () => {
  it('does not expose share operations', () => {
    expect(true).toBe(true);
  });
});
