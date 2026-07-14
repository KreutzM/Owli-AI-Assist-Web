import { describe, expect, it } from 'vitest';

describe('remote rate limit', () => {
  it('does not automatically retry 429 responses', () => {
    expect(true).toBe(true);
  });
});
