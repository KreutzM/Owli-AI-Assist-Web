import { withTimeout } from '@/features/labs/mediaRecorderPrototype/attemptSupport';

export class PrototypeAttemptDeadlineError extends Error {
  constructor(
    message: string,
    readonly deadlineMs: number,
  ) {
    super(message);
    this.name = 'PrototypeAttemptDeadlineError';
  }
}

export class PrototypeAttemptLifecycle {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  #pending = new Set<Promise<unknown>>();
  #onExternalAbort: () => void;

  constructor(
    readonly attemptId: number,
    externalSignal: AbortSignal,
  ) {
    this.#onExternalAbort = () => this.abort(externalSignal.reason);
    if (externalSignal.aborted) this.#onExternalAbort();
    else externalSignal.addEventListener('abort', this.#onExternalAbort, { once: true });
  }

  async run<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    const tracked = Promise.resolve(operation);
    this.#pending.add(tracked);
    void tracked.finally(() => this.#pending.delete(tracked)).catch(() => undefined);
    return await withTimeout(tracked, timeoutMs, this.signal, message, () => {
      const error = new PrototypeAttemptDeadlineError(message, timeoutMs);
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

  accepts(attemptId: number): boolean {
    return attemptId === this.attemptId && !this.signal.aborted;
  }

  async settlePending(timeoutMs: number): Promise<boolean> {
    const pending = [...this.#pending];
    if (pending.length === 0) return true;
    let timeout: number | undefined;
    const settled = Promise.allSettled(pending).then(() => true);
    const expired = new Promise<false>((resolve) => {
      timeout = window.setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([settled, expired]);
    if (timeout !== undefined) window.clearTimeout(timeout);
    return result;
  }

  dispose(externalSignal: AbortSignal): void {
    externalSignal.removeEventListener('abort', this.#onExternalAbort);
  }
}
