import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAttemptDraft } from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import { PrototypeAttemptDeadlineError } from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';
import { PrototypeAttemptFailedError } from '@/features/labs/mediaRecorderPrototype/attemptFailure';
import { mediaRecorderFixtureManifest } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import { createHarnessRun } from '@/features/labs/mediaRecorderPrototype/harness';

const mocks = vi.hoisted(() => ({
  runScenarioAttempt: vi.fn(),
  stopResources: vi.fn(),
}));

vi.mock('@/features/labs/mediaRecorderPrototype/runAttempt', () => ({
  runScenarioAttempt: mocks.runScenarioAttempt,
}));

vi.mock('@/features/labs/mediaRecorderPrototype/resourceCleanup', () => ({
  stopResources: mocks.stopResources,
}));

vi.mock('@/features/labs/mediaRecorderPrototype/networkTracking', () => ({
  startBackendRequestTracking: () => ({ count: () => 0, stop: vi.fn() }),
}));

describe('media recorder prototype failure evidence', () => {
  beforeEach(() => {
    mocks.runScenarioAttempt.mockReset();
    mocks.stopResources.mockReset().mockResolvedValue(true);
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: { isTypeSupported: () => true },
    });
  });

  it('publishes partial timings, memory, chunks, deadline, and cleanup for a failed attempt', async () => {
    const scenario = mediaRecorderFixtureManifest.scenarios[0]!;
    const candidate = mediaRecorderFixtureManifest.recorderCandidates[0]!;
    const attempt = createAttemptDraft(77, scenario, candidate, '2026-08-01T00:00:00.000Z');
    attempt.initializationMs = 120;
    attempt.renderMs = 400;
    attempt.totalMs = 520;
    attempt.chunkSizes = [4096];
    attempt.memory.chunkBytes = 4096;
    attempt.memory.highWaterBytes = 8_000_000;
    attempt.failure = {
      kind: 'deadline',
      phase: 'recording',
      message: 'Render deadline exceeded.',
      deadlineMs: 15_000,
      pendingOperationsSettled: false,
    };
    const deadline = new PrototypeAttemptDeadlineError('Render deadline exceeded.', 15_000);
    mocks.runScenarioAttempt.mockRejectedValue(
      new PrototypeAttemptFailedError(attempt, [], deadline),
    );

    const { promise } = createHarnessRun({
      selectedCandidateId: candidate.id,
      scenarioIds: [scenario.id],
    });
    const evidence = await promise;

    expect(evidence.results).toHaveLength(1);
    expect(evidence.results[0]).toMatchObject({
      status: 'FAIL',
      error: 'Render deadline exceeded.',
      attempt: {
        cleanupCompleted: true,
        initializationMs: 120,
        renderMs: 400,
        totalMs: 520,
        chunkSizes: [4096],
        memory: { chunkBytes: 4096, highWaterBytes: 8_000_000 },
        failure: {
          kind: 'deadline',
          phase: 'recording',
          deadlineMs: 15_000,
          pendingOperationsSettled: false,
        },
      },
    });
  });
});
