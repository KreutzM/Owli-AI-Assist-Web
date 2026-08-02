import type { AudioPostcardReadyResult } from '@/core/api/remoteAudioPostcardContracts';

const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

export async function downloadAudioPostcard(
  result: AudioPostcardReadyResult,
  signal: AbortSignal,
): Promise<Blob> {
  const capability = new URL(result.audio.url);
  const response = await fetch(capability, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  if (!response.ok || !response.body) throw new Error('Audio capability fetch failed.');
  if (new URL(response.url).origin !== capability.origin) {
    throw new Error('Audio capability response origin changed.');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0];
  if (contentType !== result.audio.mimeType) throw new Error('Audio MIME changed during download.');
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_AUDIO_BYTES) throw new Error('Audio exceeds the approved input limit.');

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error('Audio exceeds the approved input limit.');
    }
    const copy = new Uint8Array(next.value.byteLength);
    copy.set(next.value);
    chunks.push(copy.buffer);
  }
  throwIfAborted(signal);
  return new Blob(chunks, { type: result.audio.mimeType });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}
