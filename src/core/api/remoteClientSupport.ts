export async function blobToBase64(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal?.throwIfAborted();
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function forwardAbort(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

export function assertNotAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export function createMemoryInstallationId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
