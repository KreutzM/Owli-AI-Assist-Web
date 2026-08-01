import { withTimeout } from '@/features/labs/mediaRecorderPrototype/attemptSupport';

export class PrototypeAttemptDeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrototypeAttemptDeadlineError';
  }
}

export class PrototypeAttemptLifecycle {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  #pending = new Set<Promise<unknown>>();
  #onExternalAbort: () => void;

  constructor(externalSignal: AbortSignal) {
    this.#onExternalAbort = () => this.abort(externalSignal.reason);
    if (externalSignal.aborted) this.#onExternalAbort();
    else externalSignal.addEventListener('abort', this.#onExternalAbort, { once: true });
  }

  async run<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    const tracked = Promise.resolve(operation);
    this.#pending.add(tracked);
    void tracked.finally(() => this.#pending.delete(tracked)).catch(() => undefined);
    return await withTimeout(tracked, timeoutMs, this.signal, message, () => {
      const error = new PrototypeAttemptDeadlineError(message);
      this.abort(error);
      return error;
    });
  }

  abort(reason: unknown): void {
    if (!this.signal.aborted) {
      this.controller.abort(
        reason instanceof Error
          ? reason
          : new DOMException('Prototype attempt aborted.', 'AbortError'),
      );
    }
  }

  async settlePending(): Promise<void> {
    await Promise.allSettled([...this.#pending]);
  }

  dispose(externalSignal: AbortSignal): void {
    externalSignal.removeEventListener('abort', this.#onExternalAbort);
  }
}
