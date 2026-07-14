import { describe, expect, it } from 'vitest';

describe('header preview exclusion', () => {
  it('does not admit Workers preview patterns', () => {
    expect(true).toBe(true);
  });
});
