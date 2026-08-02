import {
  validateAudioCapability,
  type AudioPostcardOptions,
  type AudioPostcardReadyResult,
} from '@/core/api/remoteAudioPostcardContracts';

export interface DownloadAudioPostcardInput {
  result: AudioPostcardReadyResult;
  options: AudioPostcardOptions;
  apiBaseUrl: string;
  signal: AbortSignal;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

export async function downloadAudioPostcard({
  result,
  options,
  apiBaseUrl,
  signal,
  fetchImplementation = globalThis.fetch.bind(globalThis),
  now = Date.now,
}: DownloadAudioPostcardInput): Promise<Blob> {
  signal.throwIfAborted();
  const capability = validateAudioCapability(result, options, apiBaseUrl, now());
  const expiresAt = Date.parse(result.expiresAt);
  const maxBytes = options.generation.maxAudioBytes;
  if (now() >= expiresAt) throw new Error('Audio capability expired before download.');

  const response = await fetchImplementation(capability, {
    method: 'GET',
    headers: { Accept: result.audio.mimeType },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  if (!response.ok || !response.body) throw new Error('Audio capability fetch failed.');

  assertResponseUrl(response.url, capability);
  if (response.headers.get('Content-Type') !== result.audio.mimeType) {
    throw new Error('Audio MIME changed during download.');
  }
  if (!response.headers.get('Cache-Control')?.toLowerCase().includes('no-store')) {
    throw new Error('Audio response must be no-store.');
  }
  if (response.headers.get('X-Content-Type-Options')?.toLowerCase() !== 'nosniff') {
    throw new Error('Audio response must use nosniff.');
  }
  if (response.headers.get('Accept-Ranges')?.toLowerCase() !== 'bytes') {
    throw new Error('Audio response must support byte ranges.');
  }

  const declaredLength = parseRequiredContentLength(response.headers.get('Content-Length'));
  if (declaredLength > maxBytes) throw new Error('Audio exceeds the approved input limit.');

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      if (now() >= expiresAt) throw new Error('Audio capability expired during download.');
      const next = await reader.read();
      signal.throwIfAborted();
      if (now() >= expiresAt) throw new Error('Audio capability expired during download.');
      if (next.done) break;
      if (next.value.byteLength > maxBytes) {
        throw new Error('Audio chunk exceeds the approved input limit.');
      }
      size += next.value.byteLength;
      if (size > maxBytes || size > declaredLength) {
        throw new Error('Audio exceeds the approved input limit.');
      }
      const copy = new Uint8Array(next.value.byteLength);
      copy.set(next.value);
      chunks.push(copy.buffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    chunks.length = 0;
    throw error;
  }

  if (size !== declaredLength) {
    throw new Error('Audio response length does not match its contract.');
  }
  return new Blob(chunks, { type: result.audio.mimeType });
}

function assertResponseUrl(responseUrl: string, capability: URL): void {
  if (!responseUrl) throw new Error('Audio capability response URL is missing.');
  const finalUrl = new URL(responseUrl);
  if (
    finalUrl.protocol !== 'https:' ||
    finalUrl.origin !== capability.origin ||
    finalUrl.pathname !== capability.pathname ||
    finalUrl.search !== capability.search ||
    finalUrl.username ||
    finalUrl.password ||
    finalUrl.hash
  ) {
    throw new Error('Audio capability response URL changed.');
  }
}

function parseRequiredContentLength(value: string | null): number {
  if (value === null || !/^[1-9]\d*$/u.test(value)) {
    throw new Error('Audio response has an invalid Content-Length.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('Audio response has an invalid Content-Length.');
  }
  return parsed;
}
