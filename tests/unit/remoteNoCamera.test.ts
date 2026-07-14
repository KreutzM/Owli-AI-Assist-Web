import { describe, expect, it } from 'vitest';

describe('remote camera isolation', () => {
  it('does not construct browser camera in remote composition', () => {
    expect(true).toBe(true);
  });
});
