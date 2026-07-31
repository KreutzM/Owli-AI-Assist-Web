export type PrototypeAttemptStatus = 'PASS' | 'FAIL' | 'UNSUPPORTED' | 'AUDIO_ONLY_FALLBACK';

export interface PrototypeRecorderCandidate {
  id: string;
  mimeType: string;
  fileExtension: string;
}

export interface PrototypeImageFixture {
  id: string;
  fileName: string;
  path: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  longEdgePx: number;
  orientation: 'landscape' | 'portrait' | 'square';
  sizeBytes: number;
  sha256: string;
  samplePoints: Array<{
    id: string;
    x: number;
    y: number;
    rgb: [number, number, number];
  }>;
}

export interface PrototypeAudioFixture {
  id: string;
  fileName: string;
  path: string;
  mimeType: 'audio/mpeg' | 'audio/wav' | 'audio/flac' | 'audio/opus';
  durationMs: number;
  sampleRateHz: number;
  channels: number;
  sizeBytes: number;
  sha256: string;
  markerWindows: {
    startMs: number;
    endMs: number;
    toleranceMs: number;
  };
}

export interface PrototypeScenario {
  id: string;
  order: number;
  imageId: string;
  audioId: string;
}

export interface PrototypeFixtureManifest {
  schemaVersion: 1;
  generatedAt: string;
  routePath: '/lab/mediarecorder-prototype';
  fixtureRoot: string;
  recorderCandidates: PrototypeRecorderCandidate[];
  images: PrototypeImageFixture[];
  audio: PrototypeAudioFixture[];
  scenarios: PrototypeScenario[];
}

export interface PrototypeCapabilityProbe {
  candidate: PrototypeRecorderCandidate;
  supported: boolean;
}

export interface PrototypeMemoryEvidence {
  highWaterBytes: number;
  finalBytes: number;
  estimatedDecodedPcmBytes: number;
  inputBytes: number;
  chunkBytes: number;
  canvasBytes: number;
}

export interface PrototypeValidationEvidence {
  expectedDurationMs: number;
  measuredDurationMs: number;
  durationDriftMs: number;
  width: number;
  height: number;
  aspectRatioDelta: number;
  playbackSupported: boolean;
  seekingSupported: boolean;
  audioNonSilent: boolean;
  startMarkerDetected: boolean;
  endMarkerDetected: boolean;
  startMarkerMs?: number;
  endMarkerMs?: number;
  trackEvidence: {
    hasVisualFrames: boolean;
    hasAudibleFrames: boolean;
  };
  sampleChecks: Array<{
    id: string;
    expected: [number, number, number];
    actual: [number, number, number];
    distance: number;
    withinTolerance: boolean;
  }>;
}

export interface PrototypeAttemptEvidence {
  attemptId: number;
  scenarioId: string;
  scenarioOrder: number;
  imageId: string;
  audioId: string;
  candidateId: string;
  requestedMimeType: string;
  outputMimeType: string;
  outputFileName: string;
  outputBytes: number;
  status: PrototypeAttemptStatus;
  startedAt: string;
  finishedAt: string;
  cancelled: boolean;
  cancelVisibleWithinMs?: number;
  initializationMs: number;
  renderMs: number;
  finalizationMs: number;
  totalMs: number;
  chunkIntervalsMs: number[];
  chunkSizes: number[];
  requestedChunkCadenceMs: number;
  validation: PrototypeValidationEvidence;
  memory: PrototypeMemoryEvidence;
  playbackCapability: {
    download: boolean;
    fileShare: boolean;
  };
  notes: string[];
}

export interface PrototypeScenarioResult {
  scenarioId: string;
  scenarioOrder: number;
  imageId: string;
  audioId: string;
  candidateId: string;
  requestedMimeType: string;
  status: PrototypeAttemptStatus;
  attempt?: PrototypeAttemptEvidence;
  error?: string;
}

export interface PrototypeMeasurementEvidence {
  generatedAt: string;
  routePath: string;
  prototypeConfigEnabled: boolean;
  preferredCandidateId?: string;
  probes: PrototypeCapabilityProbe[];
  results: PrototypeScenarioResult[];
  normalFlowUnchanged: boolean;
  notes: string[];
}
