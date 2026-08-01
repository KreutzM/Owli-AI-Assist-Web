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
});
