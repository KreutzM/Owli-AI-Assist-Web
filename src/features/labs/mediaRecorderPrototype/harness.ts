import { mediaRecorderFixtureManifest } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import { runScenarioAttempt } from '@/features/labs/mediaRecorderPrototype/runAttempt';
import type {
  PrototypeCapabilityProbe,
  PrototypeMeasurementEvidence,
  PrototypeRecorderCandidate,
} from '@/features/labs/mediaRecorderPrototype/types';

export interface PrototypeHarnessRunOptions {
  selectedCandidateId?: string;
  scenarioIds?: string[];
  onProgress?: (evidence: PrototypeMeasurementEvidence) => void;
  onAttemptStart?: (attemptId: number) => void;
}

export interface PrototypeHarnessController {
  cancel(): void;
  readonly attemptId: number;
}

export function probeRecorderCandidates(): PrototypeCapabilityProbe[] {
  return mediaRecorderFixtureManifest.recorderCandidates.map((candidate) => ({
    candidate,
    supported:
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported(candidate.mimeType),
  }));
}

export function createInitialEvidence(enabled: boolean): PrototypeMeasurementEvidence {
  return {
    generatedAt: new Date().toISOString(),
    routePath: mediaRecorderFixtureManifest.routePath,
    prototypeConfigEnabled: enabled,
    probes: probeRecorderCandidates(),
    results: [],
    normalFlowUnchanged: true,
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

export function createHarnessRun(
  options: PrototypeHarnessRunOptions = {},
): {
  promise: Promise<PrototypeMeasurementEvidence>;
  controller: PrototypeHarnessController;
} {
  let aborted = false;
  let activeRecorder: MediaRecorder | undefined;
  let activeStream: MediaStream | undefined;
  let activeCanvasStream: MediaStream | undefined;
  let activeAudioContext: AudioContext | undefined;
  let activeDestination: MediaStreamAudioDestinationNode | undefined;
  let activeSource: AudioBufferSourceNode | undefined;
  let activeBlobUrl: string | undefined;
  let activeImageUrl: string | undefined;
  let attemptId = 0;

  const controller: PrototypeHarnessController = {
    cancel() {
      aborted = true;
      cleanup();
    },
    get attemptId() {
      return attemptId;
    },
  };
  const isCancelled = () => aborted;

  const promise = (async () => {
    const evidence = createInitialEvidence(true);
    options.onProgress?.(structuredClone(evidence));
    const candidate = pickPreferredCandidate(evidence.probes, options.selectedCandidateId);
    if (candidate) evidence.preferredCandidateId = candidate.id;
    if (!candidate) {
      evidence.results = mediaRecorderFixtureManifest.scenarios.map((scenario) => ({
        scenarioId: scenario.id,
        scenarioOrder: scenario.order,
        imageId: scenario.imageId,
        audioId: scenario.audioId,
        candidateId: options.selectedCandidateId ?? 'none',
        requestedMimeType: options.selectedCandidateId ?? 'none',
        status: 'UNSUPPORTED',
        error: 'No runtime-supported MediaRecorder MIME candidate is available.',
      }));
      return evidence;
    }

    const scenarioIds = options.scenarioIds;
    const scenarios = Array.isArray(scenarioIds) && scenarioIds.length > 0
      ? mediaRecorderFixtureManifest.scenarios.filter((scenario) => scenarioIds.includes(scenario.id))
      : mediaRecorderFixtureManifest.scenarios;

    for (const scenario of scenarios) {
      if (isCancelled()) break;
      attemptId += 1;
      options.onAttemptStart?.(attemptId);
      const startedAt = performance.now();
      try {
        const attempt = await runScenarioAttempt({
          attemptId,
          scenario,
          candidate,
          isCancelled,
          setRecorder: (value) => {
            activeRecorder = value;
          },
          setStream: (value) => {
            activeStream = value;
          },
          setCanvasStream: (value) => {
            activeCanvasStream = value;
          },
          setAudioContext: (value) => {
            activeAudioContext = value;
          },
          setDestination: (value) => {
            activeDestination = value;
          },
          setSource: (value) => {
            activeSource = value;
          },
          setBlobUrl: (value) => {
            activeBlobUrl = value;
          },
          setImageUrl: (value) => {
            activeImageUrl = value;
          },
        });
        if (isCancelled()) break;
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
      } catch (error) {
        if (isCancelled()) break;
        evidence.results.push({
          scenarioId: scenario.id,
          scenarioOrder: scenario.order,
          imageId: scenario.imageId,
          audioId: scenario.audioId,
          candidateId: candidate.id,
          requestedMimeType: candidate.mimeType,
          status: 'FAIL',
          error: error instanceof Error ? error.message : 'Unknown MediaRecorder prototype error.',
        });
      } finally {
        cleanup();
        evidence.generatedAt = new Date().toISOString();
        options.onProgress?.(structuredClone(evidence));
      }
      if (performance.now() - startedAt > 120_000) {
        evidence.notes.push(`Scenario ${scenario.id} exceeded the local 120s wall-clock envelope.`);
      }
    }
    return evidence;
  })();

  return { promise, controller };

  function cleanup() {
    activeRecorder?.stream.getTracks().forEach((track) => track.stop());
    activeRecorder = undefined;
    activeSource?.stop();
    activeSource?.disconnect();
    activeSource = undefined;
    activeDestination?.disconnect();
    activeDestination = undefined;
    activeStream?.getTracks().forEach((track) => track.stop());
    activeStream = undefined;
    activeCanvasStream?.getTracks().forEach((track) => track.stop());
    activeCanvasStream = undefined;
    if (activeAudioContext && activeAudioContext.state !== 'closed') {
      void activeAudioContext.close();
    }
    activeAudioContext = undefined;
    if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = undefined;
    if (activeImageUrl) URL.revokeObjectURL(activeImageUrl);
    activeImageUrl = undefined;
  }
}
