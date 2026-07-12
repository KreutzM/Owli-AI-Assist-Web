import { describe, expect, it, vi } from 'vitest';
import { getOrCreateInstallationId } from '@/core/identity/installationId';

describe('getOrCreateInstallationId', () => {
  it('persists and reuses a random installation id', () => {
    const storage = new MapStorage();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

    expect(getOrCreateInstallationId(storage)).toBe('11111111-1111-4111-8111-111111111111');
    expect(getOrCreateInstallationId(storage)).toBe('11111111-1111-4111-8111-111111111111');
  });
});

class MapStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
