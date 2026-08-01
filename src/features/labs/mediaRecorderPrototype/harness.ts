import {
  PROTOTYPE_ROUTE_PATH,
  RECORDER_CANDIDATE_ORDER,
} from '@/features/labs/mediaRecorderPrototype/constants';
import { mediaRecorderFixtureManifest } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import { startBackendRequestTracking } from '@/features/labs/mediaRecorderPrototype/networkTracking';
import { stopResources } from '@/features/labs/mediaRecorderPrototype/resourceCleanup';
import {
  PrototypeAttemptCancelledError,
  runScenarioAttempt,
  type PrototypeAttemptResources,
} from '@/features/labs/mediaRecorderPrototype/runAttempt';
import { PrototypeAttemptDeadlineError } from '@/features/labs/mediaRecorderPrototype/attemptLifecycle';
import type {
  PrototypeCapabilityProbe,
  PrototypeMeasurementEvidence,
  PrototypeRecorderCandidate,
} from '@/features/labs/mediaRecorderPrototype/types';

let nextRunId = 1;
let nextAttemptId = 1;

export interface PrototypeHarnessRunOptions {
  selectedCandidateId?: string;
  scenarioIds?: string[];
  onProgress?: (evidence: PrototypeMeasurementEvidence) => void;
  onAttemptStart?: (attemptId: number) => void;
  onAttemptRecordingStart?: (attemptId: number) => void;
}

export interface PrototypeHarnessController {
  cancel(): void;
  readonly attemptId: number;
  readonly runId: number;
}

export function probeRecorderCandidates(): PrototypeCapabilityProbe[] {
  return mediaRecorderFixtureManifest.recorderCandidates
    .slice()
    .sort((left, right) => orderIndex(left.id) - orderIndex(right.id))
    .map((candidate) => ({
      candidate,
      supported:
        typeof MediaRecorder !== 'undefined' &&
        typeof MediaRecorder.isTypeSupported === 'function' &&
        MediaRecorder.isTypeSupported(candidate.mimeType),
    }));
}

export function createInitialEvidence(enabled: boolean): PrototypeMeasurementEvidence {
  const runId = nextRunId;
  return {
    generatedAt: new Date().toISOString(),
    routePath: PROTOTYPE_ROUTE_PATH,
    prototypeConfigEnabled: enabled,
    build: {
      gitSha: import.meta.env.VITE_OWLI_GIT_SHA ?? 'unknown',
      buildTarget: import.meta.env.VITE_OWLI_BUILD_TARGET ?? 'unknown',
      gitDirty: import.meta.env.VITE_OWLI_GIT_DIRTY === 'true',
      sourceDigest: import.meta.env.VITE_OWLI_SOURCE_DIGEST ?? 'unknown',
    },
    environment: readEnvironmentEvidence(),
    run: {
      runId,
      startedAt: new Date().toISOString(),
      scenarioCount: 0,
      seriesIndex: 1,
      seriesLength: 1,
      backendRequestsObserved: 0,
    },
    fixtures: [],
    probes: probeRecorderCandidates(),
    results: [],
    normalFlowUnchanged: enabled && window.location.pathname === PROTOTYPE_ROUTE_PATH,
    notes: [
      'Requested chunk cadence uses MediaRecorder.start(1000) and does not assert guaranteed delivery frequency.',
      'Measurements remain local to this prototype harness and are not sent to analytics or backend services.',
      'Browser-internal MediaRecorder buffering cannot be hard-bounded by application code.',
    ],
  };
}

export function pickPreferredCandidate(
  probes: PrototypeCapabilityProbe[],
  selectedCandidateId?: string,
): PrototypeRecorderCandidate | undefined {
  if (selectedCandidateId) {
    return probes.find((probe) => probe.candidate.id === selectedCandidateId && probe.supported)
      ?.candidate;
  }
  return probes.find((probe) => probe.supported)?.candidate;
}

export function createHarnessRun(options: PrototypeHarnessRunOptions = {}): {
  promise: Promise<PrototypeMeasurementEvidence>;
  controller: PrototypeHarnessController;
} {
  const runId = nextRunId++;
  const abortController = new AbortController();
  let activeResources: PrototypeAttemptResources = {};
  let activeAttemptId = 0;
  let cancelRequestedAt: number | undefined;

  const controller: PrototypeHarnessController = {
    cancel() {
      if (!cancelRequestedAt) cancelRequestedAt = performance.now();
      abortController.abort(new DOMException('Prototype attempt cancelled.', 'AbortError'));
      void stopResources(activeResources);
    },
    get attemptId() {
      return activeAttemptId;
    },
    get runId() {
      return runId;
    },
  };

  const promise = (async () => {
    const evidence = createInitialEvidence(true);
    evidence.run.runId = runId;
    evidence.run.startedAt = new Date().toISOString();
    const backendRequestTracker = startBackendRequestTracking();
    options.onProgress?.(structuredClone(evidence));
    try {
      const candidate = pickPreferredCandidate(evidence.probes, options.selectedCandidateId);
      const scenarioIds = options.scenarioIds;
      const scenarios =
        Array.isArray(scenarioIds) && scenarioIds.length > 0
          ? mediaRecorderFixtureManifest.scenarios.filter((scenario) =>
              scenarioIds.includes(scenario.id),
            )
          : mediaRecorderFixtureManifest.scenarios;
      evidence.run.scenarioCount = scenarios.length;
      if (!candidate) {
        evidence.results = scenarios.map((scenario) => ({
          scenarioId: scenario.id,
          scenarioOrder: scenario.order,
          imageId: scenario.imageId,
          audioId: scenario.audioId,
          candidateId: options.selectedCandidateId ?? 'none',
          requestedMimeType: options.selectedCandidateId ?? 'none',
          status: 'UNSUPPORTED',
          error: 'No runtime-supported MediaRecorder MIME candidate is available.',
        }));
        evidence.run.completedAt = new Date().toISOString();
        return evidence;
      }

      for (const scenario of scenarios) {
        if (abortController.signal.aborted) break;
        activeAttemptId = nextAttemptId++;
        options.onAttemptStart?.(activeAttemptId);
        try {
          const { attempt, verifiedFixtures } = await runScenarioAttempt({
            attemptId: activeAttemptId,
            scenario,
            candidate,
            signal: abortController.signal,
            onResourceUpdate(resources) {
              activeResources = resources;
            },
            onRecordingStart() {
              options.onAttemptRecordingStart?.(activeAttemptId);
            },
          });
          attempt.cleanupCompleted = await stopResources(activeResources);
          if (!attempt.cleanupCompleted) {
            attempt.status = 'FAIL';
            attempt.notes.push(
              'Cleanup could not verify that every renderer resource was released.',
            );
          }
          if (cancelRequestedAt !== undefined) {
            attempt.cancelled = true;
            attempt.cancelVisibleWithinMs = Math.round(performance.now() - cancelRequestedAt);
          }
          evidence.fixtures = mergeVerifiedFixtures(evidence.fixtures, verifiedFixtures);
          evidence.results.push({
            scenarioId: scenario.id,
            scenarioOrder: scenario.order,
            imageId: scenario.imageId,
            audioId: scenario.audioId,
            candidateId: candidate.id,
            requestedMimeType: candidate.mimeType,
            status: attempt.status,
            attempt,
          });
          if (attempt.status === 'PASS') {
            evidence.preferredCandidateId = candidate.id;
          }
        } catch (error) {
          const cleanupCompleted = await stopResources(activeResources);
          if (error instanceof PrototypeAttemptCancelledError) {
            const attempt = {
              ...error.attempt,
              cleanupCompleted,
              ...(cancelRequestedAt !== undefined
                ? { cancelVisibleWithinMs: Math.round(performance.now() - cancelRequestedAt) }
                : {}),
            };
            evidence.results.push({
              scenarioId: scenario.id,
              scenarioOrder: scenario.order,
              imageId: scenario.imageId,
              audioId: scenario.audioId,
              candidateId: candidate.id,
              requestedMimeType: candidate.mimeType,
              status: 'FAIL',
              attempt,
              error: 'Attempt cancelled.',
            });
            break;
          }
          evidence.results.push({
            scenarioId: scenario.id,
            scenarioOrder: scenario.order,
            imageId: scenario.imageId,
            audioId: scenario.audioId,
            candidateId: candidate.id,
            requestedMimeType: candidate.mimeType,
            status: 'FAIL',
            error:
              error instanceof Error ? error.message : 'Unknown MediaRecorder prototype error.',
          });
          if (error instanceof PrototypeAttemptDeadlineError) break;
        } finally {
          activeResources = {};
          evidence.generatedAt = new Date().toISOString();
          evidence.run.backendRequestsObserved = backendRequestTracker.count();
          options.onProgress?.(structuredClone(evidence));
        }
      }

      evidence.run.completedAt = new Date().toISOString();
      evidence.run.backendRequestsObserved = backendRequestTracker.count();
      evidence.normalFlowUnchanged =
        evidence.prototypeConfigEnabled &&
        evidence.routePath === PROTOTYPE_ROUTE_PATH &&
        evidence.run.backendRequestsObserved === 0;
      return evidence;
    } finally {
      backendRequestTracker.stop();
    }
  })();

  return { promise, controller };
}

function orderIndex(candidateId: string): number {
  const index = RECORDER_CANDIDATE_ORDER.indexOf(
    candidateId as (typeof RECORDER_CANDIDATE_ORDER)[number],
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function mergeVerifiedFixtures(
  existing: PrototypeMeasurementEvidence['fixtures'],
  incoming: PrototypeMeasurementEvidence['fixtures'],
) {
  const merged = new Map(existing.map((fixture) => [fixture.fixtureId, fixture] as const));
  for (const fixture of incoming) merged.set(fixture.fixtureId, fixture);
  return [...merged.values()];
}

function readEnvironmentEvidence(): PrototypeMeasurementEvidence['environment'] {
  const userAgent = navigator.userAgent;
  return {
    userAgent,
    platform: navigator.platform,
    browserName: detectBrowserName(userAgent),
    browserVersion: detectBrowserVersion(userAgent),
    os: detectOs(userAgent),
    displayMode: detectDisplayMode(),
    assistiveTechnology: 'unknown',
  };
}

function detectDisplayMode(): PrototypeMeasurementEvidence['environment']['displayMode'] {
  if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
  if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
  if (window.matchMedia('(display-mode: browser)').matches) return 'browser';
  return 'unknown';
}

function detectBrowserName(userAgent: string): string {
  if (/Edg\//u.test(userAgent)) return 'Edge';
  if (/Chrome\//u.test(userAgent)) return 'Chrome';
  if (/Firefox\//u.test(userAgent)) return 'Firefox';
  if (/Safari\//u.test(userAgent) && !/Chrome\//u.test(userAgent)) return 'Safari';
  return 'Unknown';
}

function detectBrowserVersion(userAgent: string): string {
  const match =
    userAgent.match(/Edg\/([\d.]+)/u) ??
    userAgent.match(/Chrome\/([\d.]+)/u) ??
    userAgent.match(/Firefox\/([\d.]+)/u) ??
    userAgent.match(/Version\/([\d.]+)/u);
  return match?.[1] ?? 'unknown';
}

function detectOs(userAgent: string): string {
  if (/Windows/u.test(userAgent)) return 'Windows';
  if (/Android/u.test(userAgent)) return 'Android';
  if (/iPhone|iPad|iPod/u.test(userAgent)) return 'iOS';
  if (/Mac OS X/u.test(userAgent)) return 'macOS';
  if (/Linux/u.test(userAgent)) return 'Linux';
  return 'Unknown';
}
