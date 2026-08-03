import { describe, expect, it } from 'vitest';
import { BoundedRecorderChunks } from '@/platform/media/boundedRecorderChunks';
import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';

describe('BoundedRecorderChunks', () => {
  it('collects chunks and creates a matching WebM blob', () => {
    const collector = new BoundedRecorderChunks(1_024);
    collector.add(new Blob([new Uint8Array([1, 2])]));
    collector.add(new Blob([new Uint8Array([3, 4, 5])]));

    const output = collector.finalize('video/webm;codecs=vp8,opus');

    expect(collector.chunkSizes).toEqual([2, 3]);
    expect(collector.totalBytes).toBe(5);
    expect(output.size).toBe(5);
    expect(output.type).toBe('video/webm;codecs=vp8,opus');
  });

  it('rejects an unexpected single chunk above the Candidate A envelope', () => {
    const collector = new BoundedRecorderChunks(0);
    const oversized = new Blob([new Uint8Array(MEDIA_RECORDER_LIMITS.maxChunkBytes + 1)]);

    expect(() => collector.add(oversized)).toThrow(/per-chunk limit/u);
    expect(collector.totalBytes).toBe(0);
  });

  it('rejects cumulative chunks above the hard output limit', () => {
    const collector = new BoundedRecorderChunks(0);
    const chunk = new Blob([new Uint8Array(MEDIA_RECORDER_LIMITS.maxChunkBytes)]);

    for (let count = 0; count < 4; count += 1) {
      collector.add(chunk);
    }
    expect(() => collector.add(new Blob([new Uint8Array([1])]))).toThrow(/hard output/u);
  });

  it('rejects a final output above the target envelope', () => {
    const collector = new BoundedRecorderChunks(0);
    const chunk = new Blob([new Uint8Array(MEDIA_RECORDER_LIMITS.maxChunkBytes)]);
    collector.add(chunk);
    collector.add(chunk);
    collector.add(new Blob([new Uint8Array([1])]));

    expect(() => collector.finalize('video/webm')).toThrow(/target output/u);
  });

  it('enforces the conservative aggregate app-owned byte budget', () => {
    expect(
      () => new BoundedRecorderChunks(MEDIA_RECORDER_LIMITS.maxAppOwnedMediaBytes + 1),
    ).toThrow(/App-owned media bytes/u);

    const collector = new BoundedRecorderChunks(MEDIA_RECORDER_LIMITS.maxAppOwnedMediaBytes - 10);
    expect(() => collector.add(new Blob([new Uint8Array(11)]))).toThrow(/aggregate limit/u);
  });

  it('clears all app-owned chunk references after cleanup', () => {
    const collector = new BoundedRecorderChunks(0);
    collector.add(new Blob([new Uint8Array([1, 2, 3])]));

    collector.clear();

    expect(collector.totalBytes).toBe(0);
    expect(collector.chunkSizes).toEqual([]);
    expect(() => collector.finalize('video/webm')).toThrow(/no output bytes/u);
  });
});
