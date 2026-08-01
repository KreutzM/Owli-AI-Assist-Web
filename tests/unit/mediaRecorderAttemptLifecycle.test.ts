import { describe, expect, it, vi } from 'vitest';
import {
  PrototypeAttemptDeadlineError,
  PrototypeAttemptLifecycle,
} from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';

describe('media recorder prototype attempt lifecycle', () => {
  it('invalidates the attempt on deadline and waits for the underlying operation to settle', async () => {
    vi.useFakeTimers();
    let resolveOperation: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      resolveOperation = resolve;
    });
    const lifecycle = new PrototypeAttemptLifecycle(new AbortController().signal);

    try {
      const run = lifecycle.run(operation, 100, 'Decode deadline exceeded.');
      const deadline = expect(run).rejects.toBeInstanceOf(PrototypeAttemptDeadlineError);
      await vi.advanceTimersByTimeAsync(100);
      await deadline;
      expect(lifecycle.signal.aborted).toBe(true);

      let settled = false;
      const pending = lifecycle.settlePending().then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      resolveOperation?.();
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
