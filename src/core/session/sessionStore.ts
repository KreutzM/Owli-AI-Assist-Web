import type { BootstrapSession } from '@/core/types';

export class SessionStore {
  #session: BootstrapSession | undefined;

  getValid(now = Date.now()): BootstrapSession | undefined {
    if (!this.#session) return undefined;
    const expiresAt = Date.parse(this.#session.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now + 30_000 ? this.#session : undefined;
  }

  set(session: BootstrapSession): void {
    this.#session = session;
  }

  clear(): void {
    this.#session = undefined;
  }
}
