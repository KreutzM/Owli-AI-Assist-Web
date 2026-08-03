import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';
import { BrandedVideoExportError } from '@/shared/media/brandedVideoExportError';

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
      throw byteLimitError();
    }
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  add(chunk: Blob): void {
    if (chunk.size === 0) return;
    if (chunk.size > MEDIA_RECORDER_LIMITS.maxChunkBytes) throw byteLimitError();
    const projected = this.#totalBytes + chunk.size;
    if (
      projected > MEDIA_RECORDER_LIMITS.hardOutputBytes ||
      this.reservedAppBytes + projected > MEDIA_RECORDER_LIMITS.maxAppOwnedMediaBytes
    ) {
      throw byteLimitError();
    }
    this.#chunks.push(chunk);
    this.chunkSizes.push(chunk.size);
    this.#totalBytes = projected;
  }

  finalize(mimeType: string): Blob {
    if (this.#totalBytes <= 0) throw finalizationError();
    const blob = new Blob(this.#chunks, { type: mimeType });
    if (blob.size !== this.#totalBytes) throw finalizationError();
    if (blob.size > MEDIA_RECORDER_LIMITS.targetOutputBytes) throw byteLimitError();
    return blob;
  }

  clear(): void {
    this.#chunks.length = 0;
    this.chunkSizes.length = 0;
    this.#totalBytes = 0;
  }
}

function byteLimitError(): BrandedVideoExportError {
  return new BrandedVideoExportError('VIDEO_BYTE_LIMIT_EXCEEDED', 'byte_limit');
}

function finalizationError(): BrandedVideoExportError {
  return new BrandedVideoExportError(
    'VIDEO_RECORDER_FINALIZATION_FAILED',
    'recorder_finalization',
  );
}
