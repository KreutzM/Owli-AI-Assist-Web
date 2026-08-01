import { describe, expect, it, vi } from 'vitest';
import {
  PrototypeAttemptDeadlineError,
  PrototypeAttemptLifecycle,
} from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';

describe('media recorder prototype attempt lifecycle', () => {
  it('invalidates the attempt and releases the harness after a bounded quarantine', async () => {
    vi.useFakeTimers();
    let resolveOperation: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      resolveOperation = resolve;
    });
    const lifecycle = new PrototypeAttemptLifecycle(42, new AbortController().signal);

    try {
      const run = lifecycle.run(operation, 100, 'Decode deadline exceeded.');
      const deadline = expect(run).rejects.toBeInstanceOf(PrototypeAttemptDeadlineError);
      await vi.advanceTimersByTimeAsync(100);
      await deadline;
      expect(lifecycle.signal.aborted).toBe(true);

      const pending = lifecycle.settlePending(50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBe(false);
      expect(lifecycle.accepts(42)).toBe(false);

      resolveOperation?.();
      await expect(lifecycle.settlePending(50)).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
