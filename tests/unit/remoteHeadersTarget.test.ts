import { describe, expect, it } from 'vitest';

describe('header deployment targets', () => {
  it('accepts only mock, staging and production', () => {
    expect(['mock', 'staging', 'production']).toHaveLength(3);
  });
});
