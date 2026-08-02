export const OWLI_VIDEO_BRANDING_LOGO_PATH =
  '/assets/branding/owli-video-branding-logo.png' as const;

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export async function loadOwliBrandingLogo(
  signal: AbortSignal,
  fetchImplementation: typeof fetch = globalThis.fetch.bind(globalThis),
  assetOrigin = globalThis.location.origin,
): Promise<Blob> {
  signal.throwIfAborted();
  const expectedUrl = new URL(OWLI_VIDEO_BRANDING_LOGO_PATH, assetOrigin);
  const response = await fetchImplementation(expectedUrl, {
    method: 'GET',
    headers: { Accept: 'image/png' },
    credentials: 'omit',
    cache: 'force-cache',
    redirect: 'error',
    signal,
  });
  if (!response.ok || !response.body) throw new Error('Owli branding logo is unavailable.');

  const responseUrl = new URL(response.url);
  if (
    responseUrl.origin !== expectedUrl.origin ||
    responseUrl.pathname !== expectedUrl.pathname ||
    responseUrl.search ||
    responseUrl.hash
  ) {
    throw new Error('Owli branding logo response URL changed.');
  }
  if (response.headers.get('Content-Type')?.toLowerCase() !== 'image/png') {
    throw new Error('Owli branding logo is not a PNG.');
  }

  const declaredLength = parsePositiveInteger(response.headers.get('Content-Length'));
  if (declaredLength !== undefined && declaredLength > MAX_LOGO_BYTES) {
    throw new Error('Owli branding logo exceeds the approved size.');
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_LOGO_BYTES) {
        throw new Error('Owli branding logo exceeds the approved size.');
      }
      const copy = new Uint8Array(next.value.byteLength);
      copy.set(next.value);
      chunks.push(copy.buffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  if (totalBytes <= PNG_SIGNATURE.length || declaredLength === 0) {
    throw new Error('Owli branding logo is empty.');
  }
  if (declaredLength !== undefined && totalBytes !== declaredLength) {
    throw new Error('Owli branding logo length changed during download.');
  }

  const blob = new Blob(chunks, { type: 'image/png' });
  const signature = new Uint8Array(await blob.slice(0, PNG_SIGNATURE.length).arrayBuffer());
  if (!PNG_SIGNATURE.every((value, index) => signature[index] === value)) {
    throw new Error('Owli branding logo has an invalid PNG signature.');
  }
  signal.throwIfAborted();
  return blob;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error('Invalid branding logo Content-Length.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Invalid branding logo Content-Length.');
  return parsed;
}
