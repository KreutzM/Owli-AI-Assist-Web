import { describe, expect, it } from 'vitest';
import {
  BrandedVideoExportError,
  asUnknownBrandedVideoExportError,
  runWithBrandedVideoExportError,
  withBrandedVideoExportError,
} from '@/shared/media/brandedVideoExportError';

const specific = new BrandedVideoExportError(
  'VIDEO_SOURCE_AUDIO_DURATION_MISMATCH',
  'source_admission',
);

describe('branded video error preservation', () => {
  it('preserves a typed error through the async wrapper', async () => {
    await expect(
      withBrandedVideoExportError('VIDEO_SOURCE_ADMISSION_FAILED', 'source_admission', async () => {
        throw specific;
      }),
    ).rejects.toBe(specific);
  });

  it('preserves a typed error through the synchronous wrapper', () => {
    try {
      runWithBrandedVideoExportError('VIDEO_SOURCE_ADMISSION_FAILED', 'source_admission', () => {
        throw specific;
      });
      throw new Error('Expected the specific error');
    } catch (error) {
      expect(error).toBe(specific);
    }
  });

  it('preserves a typed error through unknown-error normalization', () => {
    expect(asUnknownBrandedVideoExportError(specific)).toBe(specific);
  });
});
