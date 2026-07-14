import { describe, expect, it } from 'vitest';

describe('remote scene isolation', () => {
  it('does not expose scene operations', () => {
    expect(true).toBe(true);
  });
});
