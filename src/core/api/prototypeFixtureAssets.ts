interface FixtureDescriptor {
  id: string;
  fileName: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
}

export async function loadPrototypeFixturePair(
  image: FixtureDescriptor,
  audio: FixtureDescriptor,
  signal: AbortSignal,
): Promise<{
  imageBlob: Blob;
  audioBuffer: ArrayBuffer;
  verifiedFixtures: Array<{
    fixtureId: string;
    kind: 'image' | 'audio';
    fileName: string;
    sha256: string;
    sizeBytes: number;
    verified: boolean;
  }>;
}> {
  const [imageBytes, audioBytes] = await Promise.all([
    fetchFixtureBytes(image.path, signal),
    fetchFixtureBytes(audio.path, signal),
  ]);
  throwIfAborted(signal);
  verifyFixtureBytes(imageBytes, image.fileName, image.sha256, image.sizeBytes);
  verifyFixtureBytes(audioBytes, audio.fileName, audio.sha256, audio.sizeBytes);
  await Promise.all([
    verifyFixtureDigest(imageBytes, image.fileName, image.sha256),
    verifyFixtureDigest(audioBytes, audio.fileName, audio.sha256),
  ]);
  return {
    imageBlob: new Blob([imageBytes], { type: image.mimeType }),
    audioBuffer: audioBytes,
    verifiedFixtures: [
      {
        fixtureId: image.id,
        kind: 'image',
        fileName: image.fileName,
        sha256: image.sha256,
        sizeBytes: image.sizeBytes,
        verified: true,
      },
      {
        fixtureId: audio.id,
        kind: 'audio',
        fileName: audio.fileName,
        sha256: audio.sha256,
        sizeBytes: audio.sizeBytes,
        verified: true,
      },
    ],
  };
}

async function fetchFixtureBytes(path: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(path, { signal, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load fixture ${path}.`);
  }
  return await response.arrayBuffer();
}

function verifyFixtureBytes(
  bytes: ArrayBuffer,
  fileName: string,
  expectedSha256: string,
  expectedSize: number,
) {
  if (bytes.byteLength !== expectedSize) {
    throw new Error(`Fixture size mismatch for ${fileName}.`);
  }
}

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyFixtureDigest(
  bytes: ArrayBuffer,
  fileName: string,
  expectedSha256: string,
): Promise<void> {
  const actual = await sha256Hex(bytes);
  if (actual !== expectedSha256) {
    throw new Error(`Fixture checksum mismatch for ${fileName}.`);
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Prototype attempt was aborted.', 'AbortError');
  }
}
