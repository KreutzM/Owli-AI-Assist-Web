import type { WebBootstrapResponseV2 } from '@/core/api/remoteCatalogContracts';

const EXPIRY_SKEW_MS = 30_000;

export class RemoteSessionManager {
  #session?: WebBootstrapResponseV2;
  #inFlight?: Promise<WebBootstrapResponseV2>;

  constructor(
    private readonly bootstrap: (signal?: AbortSignal) => Promise<WebBootstrapResponseV2>,
  ) {}

  get metadata(): { status: 'empty' | 'ready'; expiresAt?: number } {
    const session = this.#getValid();
    return session
      ? { status: 'ready', expiresAt: Date.parse(session.expiresAt) }
      : { status: 'empty' };
  }

  async ensure(signal?: AbortSignal): Promise<WebBootstrapResponseV2> {
    const current = this.#getValid();
    if (current) return current;
    if (this.#inFlight) return this.#inFlight;

    const operation = this.bootstrap(signal).then((session) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      this.#session = session;
      return session;
    });
    this.#inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.#inFlight === operation) this.#inFlight = undefined;
    }
  }

  clear(): void {
    this.#session = undefined;
  }

  invalidate(): void {
    this.clear();
  }

  async withUnauthorizedRetry<T>(
    operation: (sessionToken: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const first = await this.ensure(signal);
    try {
      return await operation(first.sessionToken);
    } catch (error) {
      if (!(error instanceof RemoteHttpError) || error.status !== 401) throw error;
      this.invalidate();
      const second = await this.ensure(signal);
      return operation(second.sessionToken);
    }
  }

  #getValid(): WebBootstrapResponseV2 | undefined {
    if (!this.#session) return undefined;
    if (Date.parse(this.#session.expiresAt) - EXPIRY_SKEW_MS <= Date.now()) {
      this.#session = undefined;
      return undefined;
    }
    return this.#session;
  }
}

export class RemoteHttpError extends Error {
  constructor(readonly status: number) {
    super(`Remote request failed with HTTP ${status}`);
    this.name = 'RemoteHttpError';
  }
}
