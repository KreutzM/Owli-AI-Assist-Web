import { useEffect, useRef, useState } from 'react';
import type { AudioPostcardReadyResult } from '@/core/api/remoteAudioPostcardContracts';
import type { NormalizedSceneImage } from '@/platform/image/browserSceneImageNormalizer';

const WIDTH = 540;
const HEIGHT = 960;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const MIME_CANDIDATES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
] as const;

type ExportState =
  | { status: 'idle'; message: string }
  | { status: 'rendering'; message: string }
  | { status: 'ready'; message: string; file: File; url: string }
  | { status: 'error'; message: string };

export function StagingBrandedVideoExport({
  enabled,
  image,
  result,
}: {
  enabled: boolean;
  image: NormalizedSceneImage;
  result: AudioPostcardReadyResult;
}) {
  const [state, setState] = useState<ExportState>({ status: 'idle', message: '' });
  const controllerRef = useRef<AbortController>();
  const attemptRef = useRef(0);
  const actionRef = useRef<HTMLButtonElement>(null);

  const release = () => {
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    setState((current) => {
      if (current.status === 'ready') URL.revokeObjectURL(current.url);
      return { status: 'idle', message: '' };
    });
  };

  useEffect(() => release, []);
  useEffect(() => {
    release();
  }, [image.previewUrl, result.audio.url]);

  if (!enabled) return null;

  const createVideo = async () => {
    release();
    const attempt = ++attemptRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'rendering', message: 'Gebrandetes Staging-Video wird erstellt …' });
    try {
      const file = await renderBrandedVideo(image.blob, result, controller.signal);
      if (attempt !== attemptRef.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(file);
      setState({ status: 'ready', message: 'Gebrandetes Video ist bereit.', file, url });
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      setState({
        status: 'error',
        message:
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Videoerstellung wurde abgebrochen. Die Audio-Postcard bleibt verfügbar.'
            : 'Das Video konnte nicht erstellt werden. Die Audio-Postcard bleibt verfügbar.',
      });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = undefined;
      actionRef.current?.focus();
    }
  };

  const shareVideo = async () => {
    if (state.status !== 'ready' || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({
        files: [state.file],
        title: 'Owli-AI Audio-Postcard',
        text: 'Mit Owli-AI Assist erstellt',
      });
      setState({ ...state, message: 'Teilen-Dialog wurde geöffnet.' });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setState({ ...state, message: 'Video konnte nicht geteilt werden.' });
      }
    } finally {
      actionRef.current?.focus();
    }
  };

  const canShare =
    state.status === 'ready' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [state.file] });

  return (
    <section className="audio-postcard-video-export" aria-labelledby="video-export-title">
      <p className="eyebrow">Nur Staging · experimenteller Export</p>
      <h4 id="video-export-title">Gebrandetes Audio-Postcard-Video</h4>
      <p>Das Video wird ausschließlich lokal im Browser aus dem aktuellen Bild und Audio erstellt.</p>
      <div className="scene-actions audio-postcard-actions">
        <button
          ref={actionRef}
          className="button button--secondary"
          type="button"
          disabled={state.status === 'rendering'}
          onClick={() => void createVideo()}
        >
          {state.status === 'rendering' ? 'Video wird erstellt …' : 'Gebrandetes Video erstellen'}
        </button>
        {state.status === 'rendering' && (
          <button className="button button--secondary" type="button" onClick={release}>
            Videoerstellung abbrechen
          </button>
        )}
      </div>
      <p className="live-status" role={state.status === 'error' ? 'alert' : 'status'}>
        {state.message}
      </p>
      {state.status === 'ready' && (
        <div className="audio-postcard-result">
          {/* Generated music has adjacent textual alternatives rather than a timed caption track. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video controls playsInline preload="metadata" src={state.url}>
            Dein Browser unterstützt die Video-Wiedergabe nicht.
          </video>
          <div className="scene-actions audio-postcard-actions">
            <a className="button button--secondary" href={state.url} download={state.file.name}>
              Video herunterladen
            </a>
            {canShare && (
              <button className="button button--secondary" type="button" onClick={() => void shareVideo()}>
                Video teilen
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function computeBrandedLayout(sourceWidth: number, sourceHeight: number) {
  const scale = WIDTH / 1080;
  const outer = 64 * scale;
  const top = 64 * scale;
  const gap = 48 * scale;
  const bandHeight = 224 * scale;
  const bottom = 72 * scale;
  const imageBottom = HEIGHT - bottom - bandHeight - gap;
  const box = { x: outer, y: top, width: WIDTH - outer * 2, height: imageBottom - top };
  const imageScale = Math.min(box.width / sourceWidth, box.height / sourceHeight, 1);
  const width = sourceWidth * imageScale;
  const height = sourceHeight * imageScale;
  return {
    image: { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height },
    band: { x: outer, y: HEIGHT - bottom - bandHeight, width: WIDTH - outer * 2, height: bandHeight },
  };
}

async function renderBrandedVideo(imageBlob: Blob, result: AudioPostcardReadyResult, signal: AbortSignal) {
  throwIfAborted(signal);
  const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new Error('No approved MediaRecorder video container is supported.');
  const audioResponse = await fetch(result.audio.url, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  if (!audioResponse.ok || !audioResponse.body) throw new Error('Audio capability fetch failed.');
  const contentType = audioResponse.headers.get('content-type')?.split(';', 1)[0];
  if (contentType !== result.audio.mimeType) throw new Error('Audio MIME changed during download.');
  const reader = audioResponse.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error('Audio exceeds the approved input limit.');
    }
    chunks.push(next.value);
  }
  throwIfAborted(signal);
  const audioBlob = new Blob(chunks, { type: result.audio.mimeType });
  const [bitmap, audioBuffer] = await Promise.all([
    createImageBitmap(imageBlob),
    decodeAudio(audioBlob),
  ]);
  throwIfAborted(signal);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('2D canvas unavailable.');
  drawFrame(context, bitmap);
  bitmap.close();

  const audioContext = new AudioContext({ sampleRate: audioBuffer.sampleRate });
  await audioContext.resume();
  const destination = audioContext.createMediaStreamDestination();
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(destination);
  const stream = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const output: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) output.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('MediaRecorder failed.'));
  });
  const abort = () => {
    source.stop();
    if (recorder.state !== 'inactive') recorder.stop();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    recorder.start(250);
    source.start();
    source.stop(audioBuffer.duration);
    source.onended = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    await stopped;
    throwIfAborted(signal);
  } finally {
    signal.removeEventListener('abort', abort);
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    await audioContext.close();
  }
  const blob = new Blob(output, { type: recorder.mimeType || mimeType });
  const suffix = blob.type.startsWith('video/webm') ? 'webm' : 'bin';
  if (suffix === 'bin') throw new Error('Unexpected output container.');
  return new File([blob], `owli-audio-postcard.${suffix}`, { type: blob.type });
}

function drawFrame(context: CanvasRenderingContext2D, bitmap: ImageBitmap) {
  const layout = computeBrandedLayout(bitmap.width, bitmap.height);
  context.fillStyle = '#101418';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.save();
  roundedRect(context, layout.image.x, layout.image.y, layout.image.width, layout.image.height, 16);
  context.clip();
  context.drawImage(bitmap, layout.image.x, layout.image.y, layout.image.width, layout.image.height);
  context.restore();
  context.fillStyle = 'rgba(28, 35, 43, 0.9)';
  roundedRect(context, layout.band.x, layout.band.y, layout.band.width, layout.band.height, 18);
  context.fill();
  drawOwliMark(context, layout.band.x + 20, layout.band.y + 24, 82, 64);
  context.fillStyle = '#ffffff';
  context.font = '700 29px system-ui, sans-serif';
  context.textBaseline = 'middle';
  context.fillText('Owli-AI.com', layout.band.x + 118, layout.band.y + layout.band.height / 2);
}

function drawOwliMark(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const r = Math.min(width, height) / 2;
  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.fillStyle = '#7c3aed';
  context.beginPath();
  context.arc(0, 0, r, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f59e0b';
  context.beginPath();
  context.moveTo(-r * 0.75, -r * 0.45);
  context.lineTo(-r * 0.25, -r * 1.05);
  context.lineTo(-r * 0.05, -r * 0.35);
  context.moveTo(r * 0.75, -r * 0.45);
  context.lineTo(r * 0.25, -r * 1.05);
  context.lineTo(r * 0.05, -r * 0.35);
  context.fill();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(-r * 0.35, -r * 0.05, r * 0.28, 0, Math.PI * 2);
  context.arc(r * 0.35, -r * 0.05, r * 0.28, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#101418';
  context.beginPath();
  context.arc(-r * 0.35, -r * 0.05, r * 0.11, 0, Math.PI * 2);
  context.arc(r * 0.35, -r * 0.05, r * 0.11, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#22c55e';
  context.beginPath();
  context.moveTo(0, r * 0.05);
  context.lineTo(-r * 0.14, r * 0.3);
  context.lineTo(r * 0.14, r * 0.3);
  context.closePath();
  context.fill();
  context.restore();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
}

async function decodeAudio(blob: Blob) {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}
