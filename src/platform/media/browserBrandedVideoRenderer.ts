const WIDTH = 540;
const HEIGHT = 960;
const MIME_CANDIDATES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
] as const;

export interface BrandedVideoLayout {
  image: { x: number; y: number; width: number; height: number };
  band: { x: number; y: number; width: number; height: number };
}

export function computeBrandedVideoLayout(
  sourceWidth: number,
  sourceHeight: number,
): BrandedVideoLayout {
  const scale = WIDTH / 1080;
  const outer = 64 * scale;
  const top = 64 * scale;
  const gap = 48 * scale;
  const bandHeight = 224 * scale;
  const bottom = 72 * scale;
  const imageBottom = HEIGHT - bottom - bandHeight - gap;
  const box = {
    x: outer,
    y: top,
    width: WIDTH - outer * 2,
    height: imageBottom - top,
  };
  const imageScale = Math.min(box.width / sourceWidth, box.height / sourceHeight, 1);
  const width = sourceWidth * imageScale;
  const height = sourceHeight * imageScale;
  return {
    image: {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    },
    band: {
      x: outer,
      y: HEIGHT - bottom - bandHeight,
      width: WIDTH - outer * 2,
      height: bandHeight,
    },
  };
}

export async function renderBrandedVideo(values: {
  imageBlob: Blob;
  audioBlob: Blob;
  expectedDurationMs: number;
  signal: AbortSignal;
}): Promise<File> {
  throwIfAborted(values.signal);
  const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new Error('No approved MediaRecorder video container is supported.');

  const [bitmap, audioBuffer] = await Promise.all([
    createImageBitmap(values.imageBlob),
    decodeAudio(values.audioBlob),
  ]);
  throwIfAborted(values.signal);
  const durationDriftMs = Math.abs(audioBuffer.duration * 1_000 - values.expectedDurationMs);
  if (durationDriftMs > 1_000) {
    bitmap.close();
    throw new Error('Decoded audio duration differs from the Audio-Postcard contract.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    bitmap.close();
    throw new Error('2D canvas unavailable.');
  }
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
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
  });
  const output: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) output.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = () => reject(new Error('MediaRecorder failed.'));
  });
  const abort = () => {
    try {
      source.stop();
    } catch {
      // Source may already have ended.
    }
    if (recorder.state !== 'inactive') recorder.stop();
  };
  values.signal.addEventListener('abort', abort, { once: true });
  try {
    recorder.start(250);
    source.start();
    source.stop(audioBuffer.duration);
    source.onended = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    await stopped;
    throwIfAborted(values.signal);
  } finally {
    values.signal.removeEventListener('abort', abort);
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    await audioContext.close();
  }

  const blob = new Blob(output, { type: recorder.mimeType });
  if (!blob.type.startsWith('video/webm')) throw new Error('Unexpected output container.');
  return new File([blob], 'owli-audio-postcard.webm', { type: blob.type });
}

function drawFrame(context: CanvasRenderingContext2D, bitmap: ImageBitmap): void {
  const layout = computeBrandedVideoLayout(bitmap.width, bitmap.height);
  context.fillStyle = '#101418';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.save();
  roundedRect(
    context,
    layout.image.x,
    layout.image.y,
    layout.image.width,
    layout.image.height,
    16,
  );
  context.clip();
  context.drawImage(
    bitmap,
    layout.image.x,
    layout.image.y,
    layout.image.width,
    layout.image.height,
  );
  context.restore();
  context.fillStyle = 'rgba(28, 35, 43, 0.9)';
  roundedRect(
    context,
    layout.band.x,
    layout.band.y,
    layout.band.width,
    layout.band.height,
    18,
  );
  context.fill();
  drawOwliMark(context, layout.band.x + 20, layout.band.y + 24, 82, 64);
  context.fillStyle = '#ffffff';
  context.font = '700 29px system-ui, sans-serif';
  context.textBaseline = 'middle';
  context.fillText('Owli-AI.com', layout.band.x + 118, layout.band.y + layout.band.height / 2);
}

function drawOwliMark(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const radius = Math.min(width, height) / 2;
  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.fillStyle = '#7c3aed';
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f59e0b';
  context.beginPath();
  context.moveTo(-radius * 0.75, -radius * 0.45);
  context.lineTo(-radius * 0.25, -radius * 1.05);
  context.lineTo(-radius * 0.05, -radius * 0.35);
  context.moveTo(radius * 0.75, -radius * 0.45);
  context.lineTo(radius * 0.25, -radius * 1.05);
  context.lineTo(radius * 0.05, -radius * 0.35);
  context.fill();
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(-radius * 0.35, -radius * 0.05, radius * 0.28, 0, Math.PI * 2);
  context.arc(radius * 0.35, -radius * 0.05, radius * 0.28, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#101418';
  context.beginPath();
  context.arc(-radius * 0.35, -radius * 0.05, radius * 0.11, 0, Math.PI * 2);
  context.arc(radius * 0.35, -radius * 0.05, radius * 0.11, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#22c55e';
  context.beginPath();
  context.moveTo(0, radius * 0.05);
  context.lineTo(-radius * 0.14, radius * 0.3);
  context.lineTo(radius * 0.14, radius * 0.3);
  context.closePath();
  context.fill();
  context.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
}

async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}
