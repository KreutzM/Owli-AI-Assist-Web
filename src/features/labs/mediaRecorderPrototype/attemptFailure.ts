import { PrototypeAttemptDeadlineError } from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';
import { PrototypeAdmissionError } from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import type {
  PrototypeAttemptEvidence,
  PrototypeAttemptPhase,
  PrototypeVerifiedFixtureEvidence,
} from '@/features/labs/mediaRecorderPrototype/types';

export class PrototypeAttemptFailedError extends Error {
  constructor(
    readonly attempt: PrototypeAttemptEvidence,
    readonly verifiedFixtures: PrototypeVerifiedFixtureEvidence[],
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : 'Unknown MediaRecorder prototype error.');
    this.name = 'PrototypeAttemptFailedError';
  }
}

export function createAttemptFailedError(input: {
  attempt: PrototypeAttemptEvidence;
  cause: unknown;
  phase: PrototypeAttemptPhase;
  initializationStart: number;
  memoryHighWaterBytes: number;
  cancelled: boolean;
  verifiedFixtures: PrototypeVerifiedFixtureEvidence[];
}): PrototypeAttemptFailedError {
  const totalMs = Math.round(performance.now() - input.initializationStart);
  updatePartialTimings(input.attempt, input.phase, totalMs);
  input.attempt.cancelled = input.cancelled;
  input.attempt.status = 'FAIL';
  input.attempt.finishedAt = new Date().toISOString();
  input.attempt.totalMs = totalMs;
  input.attempt.memory.highWaterBytes = input.memoryHighWaterBytes;
  input.attempt.failure = {
    kind: input.cancelled
      ? 'cancelled'
      : input.cause instanceof PrototypeAttemptDeadlineError
        ? 'deadline'
        : input.cause instanceof PrototypeAdmissionError
          ? 'admission'
          : 'runtime',
    phase: input.phase,
    message:
      input.cause instanceof Error ? input.cause.message : 'Unknown MediaRecorder prototype error.',
    ...(input.cause instanceof PrototypeAttemptDeadlineError
      ? { deadlineMs: input.cause.deadlineMs }
      : {}),
  };
  input.attempt.notes = [
    input.cancelled
      ? 'Attempt was cancelled before safe completion.'
      : `Attempt failed during ${input.phase}.`,
  ];
  return new PrototypeAttemptFailedError(input.attempt, input.verifiedFixtures, input.cause);
}

function updatePartialTimings(
  attempt: PrototypeAttemptEvidence,
  phase: PrototypeAttemptPhase,
  totalMs: number,
): void {
  if (
    phase === 'admission' ||
    phase === 'fixture-load' ||
    phase === 'image-decode' ||
    phase === 'audio-context' ||
    phase === 'audio-decode' ||
    phase === 'fixture-preflight'
  ) {
    attempt.initializationMs = totalMs;
  } else if (phase === 'recording') {
    attempt.renderMs = Math.max(attempt.renderMs, totalMs - attempt.initializationMs);
  } else if (phase === 'validation') {
    attempt.validationMs = Math.max(
      attempt.validationMs,
      totalMs - attempt.initializationMs - attempt.renderMs - attempt.finalizationMs,
    );
  }
}
