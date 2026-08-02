import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';

export class BoundedRecorderChunks {
  readonly chunkSizes: number[] = [];
  #chunks: Blob[] = [];
  #totalBytes = 0;

  constructor(private readonly reservedAppBytes: number) {
    if (
      !Number.isSafeInteger(reservedAppBytes) ||
      reservedAppBytes < 0 ||
      reservedAppBytes > MEDIA_RECORDER_LIMITS.maxAppOwnedMediaBytes
    ) {
      throw new Error('App-owned media bytes exceed the Candidate A limit.');
    }
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  add(chunk: Blob): void {
    if (chunk.size === 0) return;
    if (chunk.size > MEDIA_RECORDER_LIMITS.maxChunkBytes) {
      throw new Error(`Recorder chunk ${chunk.size} exceeds the Candidate A per-chunk limit.`);
    }
    const projected = this.#totalBytes + chunk.size;
    if (projected > MEDIA_RECORDER_LIMITS.hardOutputBytes) {
      throw new Error('Delivered recorder chunks exceed the Candidate A hard output limit.');
    }
    if (this.reservedAppBytes + projected > MEDIA_RECORDER_LIMITS.maxAppOwnedMediaBytes) {
      throw new Error('App-owned media bytes exceed the Candidate A aggregate limit.');
    }
    this.#chunks.push(chunk);
    this.chunkSizes.push(chunk.size);
    this.#totalBytes = projected;
  }

  finalize(mimeType: string): Blob {
    if (this.#totalBytes <= 0) throw new Error('Recorder produced no output bytes.');
    const blob = new Blob(this.#chunks, { type: mimeType });
    if (blob.size !== this.#totalBytes) {
      throw new Error('Final recorder size changed unexpectedly.');
    }
    if (blob.size > MEDIA_RECORDER_LIMITS.targetOutputBytes) {
      throw new Error('Final recorder output exceeds the Candidate A target output limit.');
    }
    return blob;
  }

  clear(): void {
    this.#chunks.length = 0;
    this.chunkSizes.length = 0;
    this.#totalBytes = 0;
  }
}
