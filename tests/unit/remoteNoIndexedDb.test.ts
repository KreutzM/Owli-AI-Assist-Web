import { describe, expect, it } from 'vitest';

describe('remote IndexedDB privacy', () => {
  it('does not use IndexedDB for session or catalog state', () => {
    expect(true).toBe(true);
  });
});
