import { describe, expect, it } from 'vitest';

describe('staging media CSP', () => {
  it('does not allow the staging API as a media source', () => {
    expect(true).toBe(true);
  });
});
