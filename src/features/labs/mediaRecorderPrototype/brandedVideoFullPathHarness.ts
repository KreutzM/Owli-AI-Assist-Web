import { loadOwliBrandingLogo } from '@/core/api/loadOwliBrandingLogo';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import {
  inspectWebmContainer,
  type WebmContainerInspection,
} from '@/platform/media/webmContainerInspection';
import { asUnknownBrandedVideoExportError } from '@/shared/media/brandedVideoExportError';

export const BRANDED_VIDEO_FULL_PATH_HARNESS_KEY =
  '__OWLI_BRANDED_VIDEO_FULL_PATH_HARNESS__' as const;

export type BrandedVideoFullPathScenarioId = 'short-1s' | 'long-31s';

export interface BrandedVideoFullPathEvidence {
  status: 'PASS';
  scenarioId: BrandedVideoFullPathScenarioId;
  requestedDurationMs: number;
  decodedSourceDurationMs: number;
  sourceChannels: number;
  sourceSampleRateHz: number;
  renderElapsedMs: number;
  rendererValidationCompleted: true;
  playbackPublished: true;
  downloadPublished: true;
  file: {
    name: string;
    type: string;
    sizeBytes: number;
  };
  containerInspection: WebmContainerInspection;
  fixtureSource: string;
}

interface BrandedVideoFullPathHarnessApi {
  run(
    scenarioId: BrandedVideoFullPathScenarioId,
  ): Promise<BrandedVideoFullPathEvidence | FailureEvidence>;
  dispose(): void;
}

interface FailureEvidence {
  status: 'FAIL';
  scenarioId: BrandedVideoFullPathScenarioId;
  code: string;
}

const SCENARIOS: Record<BrandedVideoFullPathScenarioId, number> = {
  'short-1s': 1_000,
  'long-31s': 31_000,
};
const SAMPLE_RATE_HZ = 48_000;
const CHANNELS = 1;
const ROOT_TEST_ID = 'branded-video-full-path-root';
const EVIDENCE_TEST_ID = 'branded-video-full-path-evidence';
const PLAYBACK_TEST_ID = 'branded-video-full-path-playback';
const DOWNLOAD_TEST_ID = 'branded-video-full-path-download';

export function installBrandedVideoFullPathHarness(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (Reflect.has(window, BRANDED_VIDEO_FULL_PATH_HARNESS_KEY)) return;

  const root = document.createElement('section');
  root.dataset.testid = ROOT_TEST_ID;
  root.setAttribute('aria-label', 'Branded video full-path browser harness');
  root.hidden = true;
  document.body.append(root);

  let activeController: AbortController | undefined;
  let outputUrl: string | undefined;

  const releaseOutput = () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = undefined;
  };

  const dispose = () => {
    activeController?.abort(new DOMException('Harness disposed.', 'AbortError'));
    activeController = undefined;
    releaseOutput();
    root.remove();
    Reflect.deleteProperty(window, BRANDED_VIDEO_FULL_PATH_HARNESS_KEY);
  };

  const run = async (
    scenarioId: BrandedVideoFullPathScenarioId,
  ): Promise<BrandedVideoFullPathEvidence | FailureEvidence> => {
    activeController?.abort(new DOMException('Superseded harness run.', 'AbortError'));
    releaseOutput();
    root.replaceChildren();
    root.hidden = false;

    const controller = new AbortController();
    activeController = controller;
    const requestedDurationMs = SCENARIOS[scenarioId];
    const evidenceNode = document.createElement('pre');
    evidenceNode.dataset.testid = EVIDENCE_TEST_ID;
    evidenceNode.textContent = JSON.stringify({ status: 'RUNNING', scenarioId });
    root.append(evidenceNode);

    try {
      const [imageBlob, logoBlob, audioBlob] = await Promise.all([
        createDeterministicSceneImage(),
        loadOwliBrandingLogo(controller.signal),
        Promise.resolve(createPcm16Wav(requestedDurationMs)),
      ]);
      const decodedSource = await decodeSourceAudio(audioBlob, controller.signal);
      const startedAt = performance.now();
      const file = await renderBrandedVideo({
        imageBlob,
        logoBlob,
        audioBlob,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      const containerInspection = await inspectWebmContainer(file);
      controller.signal.throwIfAborted();

      outputUrl = URL.createObjectURL(file);
      const playback = document.createElement('video');
      playback.controls = true;
      playback.muted = true;
      playback.playsInline = true;
      playback.preload = 'metadata';
      playback.src = outputUrl;
      playback.dataset.testid = PLAYBACK_TEST_ID;

      const download = document.createElement('a');
      download.href = outputUrl;
      download.download = file.name;
      download.textContent = 'Gebrandetes Harness-Video herunterladen';
      download.dataset.testid = DOWNLOAD_TEST_ID;

      const evidence: BrandedVideoFullPathEvidence = {
        status: 'PASS',
        scenarioId,
        requestedDurationMs,
        decodedSourceDurationMs: decodedSource.durationMs,
        sourceChannels: decodedSource.channels,
        sourceSampleRateHz: decodedSource.sampleRateHz,
        renderElapsedMs: Math.round(performance.now() - startedAt),
        rendererValidationCompleted: true,
        playbackPublished: true,
        downloadPublished: true,
        file: {
          name: file.name,
          type: file.type,
          sizeBytes: file.size,
        },
        containerInspection,
        fixtureSource:
          'locally generated opaque PNG plus PCM16 mono WAV and canonical local branding asset; no user, capability, backend, or network media data',
      };
      evidenceNode.textContent = JSON.stringify(evidence, null, 2);
      root.append(playback, download);
      return evidence;
    } catch (error) {
      const diagnostic = asUnknownBrandedVideoExportError(error);
      const evidence: FailureEvidence = {
        status: 'FAIL',
        scenarioId,
        code: diagnostic.code,
      };
      evidenceNode.textContent = JSON.stringify(evidence, null, 2);
      return evidence;
    } finally {
      if (activeController === controller) activeController = undefined;
    }
  };

  const api: BrandedVideoFullPathHarnessApi = { run, dispose };
  Reflect.set(window, BRANDED_VIDEO_FULL_PATH_HARNESS_KEY, api);
  window.addEventListener('pagehide', dispose, { once: true });
}

async function createDeterministicSceneImage(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1_280;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Deterministic scene canvas is unavailable.');

  context.fillStyle = '#101418';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#2f7f91';
  context.fillRect(80, 120, 560, 520);
  context.fillStyle = '#f1c453';
  context.fillRect(160, 720, 400, 280);
  context.fillStyle = '#ffffff';
  context.font = 'bold 44px sans-serif';
  context.textAlign = 'center';
  context.fillText('Deterministic source', canvas.width / 2, 1_100);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Deterministic scene image encoding failed.'));
    }, 'image/png');
  });
}

function createPcm16Wav(durationMs: number): Blob {
  const frameCount = Math.round((durationMs / 1_000) * SAMPLE_RATE_HZ);
  const bytesPerSample = 2;
  const dataBytes = frameCount * CHANNELS * bytesPerSample;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE_HZ, true);
  view.setUint32(28, SAMPLE_RATE_HZ * CHANNELS * bytesPerSample, true);
  view.setUint16(32, CHANNELS * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(Math.sin((frame / SAMPLE_RATE_HZ) * Math.PI * 2 * 440) * 8_192);
    view.setInt16(44 + frame * bytesPerSample, sample, true);
  }
  return new Blob([output], { type: 'audio/wav' });
}

async function decodeSourceAudio(
  audioBlob: Blob,
  signal: AbortSignal,
): Promise<{ durationMs: number; channels: number; sampleRateHz: number }> {
  signal.throwIfAborted();
  const context = new AudioContext({ sampleRate: SAMPLE_RATE_HZ });
  try {
    const buffer = await context.decodeAudioData(await audioBlob.arrayBuffer());
    signal.throwIfAborted();
    return {
      durationMs: buffer.duration * 1_000,
      channels: buffer.numberOfChannels,
      sampleRateHz: buffer.sampleRate,
    };
  } finally {
    await context.close();
  }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
