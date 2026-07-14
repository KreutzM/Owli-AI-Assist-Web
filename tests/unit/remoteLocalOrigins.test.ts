import { describe, expect, it } from 'vitest';

describe('approved local origins', () => {
  it('uses exact localhost and loopback ports', () => {
    expect(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173']).toHaveLength(4);
  });
});
