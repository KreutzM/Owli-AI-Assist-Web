import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import type { getMediaRecorderScenarioFixtures } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import type { PrototypeContainerInspection } from '@/features/labs/mediaRecorderPrototype/types';
import { analyzeAudioMarkers } from '@/features/labs/mediaRecorderPrototype/validationAudio';
import {
  collectSampleChecks,
  playForTick,
  seekForFrame,
  throwIfAborted,
  waitForMediaEvent,
} from '@/features/labs/mediaRecorderPrototype/validationMedia';

export async function validateRecording(input: {
  blobUrl: string;
  image: ReturnType<typeof getMediaRecorderScenarioFixtures>['image'];
  audio: ReturnType<typeof getMediaRecorderScenarioFixtures>['audio'];
  containerInspection: PrototypeContainerInspection;
  signal: AbortSignal;
}): Promise<{
  expectedDurationMs: number;
  measuredDurationMs: number;
  durationDriftMs: number;
  width: number;
  height: number;
  aspectRatioDelta: number;
  playbackSupported: boolean;
  seekingSupported: boolean;
  containerInspection: PrototypeContainerInspection;
  audioNonSilent: boolean;
  startMarkerDetected: boolean;
  endMarkerDetected: boolean;
  startMarkerMs?: number;
  endMarkerMs?: number;
  markerAnalysis: Array<{
    timeMs: number;
    rms: number;
    startMarkerDb: number;
    endMarkerDb: number;
    backgroundDb: number;
    startMarkerLeadDb: number;
    endMarkerLeadDb: number;
  }>;
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
}> {
  throwIfAborted(input.signal);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.src = input.blobUrl;
  video.volume = 1;
  video.muted = false;
  video.playsInline = true;
  await waitForMediaEvent(
    video,
    'loadedmetadata',
    PROTOTYPE_LIMITS.metadataDeadlineMs,
    input.signal,
  );
  const width = video.videoWidth;
  const height = video.videoHeight;
  const expectedDurationMs = input.audio.durationMs;
  const sampleChecks = await collectSampleChecks(video, input.image, input.signal);
  const audioEvidence = await analyzeAudioMarkers(video, input.audio, input.signal);
  const measuredDurationMs = Number.isFinite(video.duration)
    ? Math.round(video.duration * 1_000)
    : Math.round(video.currentTime * 1_000);
  const playbackSupported = await playForTick(video, input.signal);
  const seekingSupported = await seekForFrame(
    video,
    Math.max(0.25, Number.isFinite(video.duration) ? video.duration / 2 : 0.25),
    input.signal,
  );
  const aspectRatioDelta = Math.abs(width / height - input.image.width / input.image.height);
  const durationDriftMs = Math.abs(measuredDurationMs - expectedDurationMs);
  return {
    expectedDurationMs,
    measuredDurationMs,
    durationDriftMs,
    width,
    height,
    aspectRatioDelta,
    playbackSupported,
    seekingSupported,
    containerInspection: input.containerInspection,
    audioNonSilent: audioEvidence.audioNonSilent,
    startMarkerDetected: audioEvidence.startMarkerDetected,
    endMarkerDetected: audioEvidence.endMarkerDetected,
    ...(audioEvidence.startMarkerMs !== undefined
      ? { startMarkerMs: audioEvidence.startMarkerMs }
      : {}),
    ...(audioEvidence.endMarkerMs !== undefined ? { endMarkerMs: audioEvidence.endMarkerMs } : {}),
    markerAnalysis: audioEvidence.samples,
    trackEvidence: {
      hasVisualFrames:
        width > 0 && height > 0 && sampleChecks.every((sample) => sample.withinTolerance),
      hasAudibleFrames: audioEvidence.audioNonSilent,
    },
    sampleChecks,
  };
}

export function determineAttemptStatus(
  validation: Awaited<ReturnType<typeof validateRecording>>,
): 'PASS' | 'FAIL' | 'AUDIO_ONLY_FALLBACK' {
  const outputLooksValid =
    validation.trackEvidence.hasVisualFrames &&
    validation.playbackSupported &&
    (!validation.containerInspection.seekingRequired || validation.seekingSupported) &&
    validation.containerInspection.videoTrackCount === 1 &&
    validation.containerInspection.audioTrackCount === 1 &&
    validation.containerInspection.codecsMatchCandidate &&
    validation.audioNonSilent &&
    validation.startMarkerDetected &&
    validation.endMarkerDetected &&
    validation.durationDriftMs <= 250 &&
    validation.aspectRatioDelta <= 0.02;
  if (outputLooksValid) return 'PASS';
  if (!validation.trackEvidence.hasVisualFrames && validation.trackEvidence.hasAudibleFrames) {
    return 'AUDIO_ONLY_FALLBACK';
  }
  return 'FAIL';
}
