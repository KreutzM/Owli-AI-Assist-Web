import { describe, expect, it } from 'vitest';
import { MemoryTracker } from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';

describe('media recorder prototype memory tracker', () => {
  it('rejects an auxiliary allocation before it can exceed the app-owned budget', () => {
    const memory = new MemoryTracker();
    memory.setWithinLimit(
      'retained-media',
      PROTOTYPE_LIMITS.maxAppOwnedMediaBytes - 1024,
      'initial allocation failed',
    );

    expect(() => memory.reserve('container-inspection', 2048, 'inspection exceeds budget')).toThrow(
      'inspection exceeds budget',
    );
    expect(memory.currentTotal).toBe(PROTOTYPE_LIMITS.maxAppOwnedMediaBytes - 1024);
  });

  it('atomically transfers retained chunks into the final-output reservation', () => {
    const memory = new MemoryTracker();
    memory.setWithinLimit('retained-media', 40 * 1024 * 1024, 'retained media failed');
    memory.setWithinLimit('chunkBytes', 24 * 1024 * 1024, 'chunk allocation failed');

    memory.transfer('chunkBytes', 'finalBytes', 24 * 1024 * 1024, 'final output failed');
    expect(memory.currentTotal).toBe(PROTOTYPE_LIMITS.maxAppOwnedMediaBytes);
    expect(() =>
      memory.transfer('chunkBytes', 'finalBytes', 25 * 1024 * 1024, 'final output failed'),
    ).toThrow('final output failed');
    expect(memory.currentTotal).toBe(PROTOTYPE_LIMITS.maxAppOwnedMediaBytes);
  });
});
