import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mediaRecorderFixtureManifest } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';

describe('media recorder prototype fixture manifest', () => {
  it('covers the required fixture inventory with deterministic ordering', () => {
    expect(mediaRecorderFixtureManifest.images.map((fixture) => fixture.id)).toEqual([
      'landscape-jpeg',
      'portrait-jpeg',
      'square-jpeg',
    ]);
    expect(mediaRecorderFixtureManifest.audio.map((fixture) => fixture.id)).toEqual([
      'audio-mpeg-10s',
      'audio-wav-10s',
      'audio-flac-10s',
      'audio-opus-10s',
      'audio-mpeg-30s',
      'audio-wav-30s',
      'audio-flac-30s',
      'audio-opus-30s',
    ]);
    expect(mediaRecorderFixtureManifest.scenarios.map((scenario) => scenario.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('keeps fixture bounds, paths, and checksums explicit', () => {
    for (const image of mediaRecorderFixtureManifest.images) {
      expect(image.mimeType).toBe('image/jpeg');
      expect(image.longEdgePx).toBeLessThanOrEqual(1280);
      expect(image.path).toMatch(/^\/prototypes\/mediarecorder\/fixtures\/.+\.jpg$/u);
      expect(image.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(image.sizeBytes).toBeGreaterThan(0);
    }
    for (const audio of mediaRecorderFixtureManifest.audio) {
      expect(audio.durationMs === 10_000 || audio.durationMs === 30_000).toBe(true);
      expect(audio.path).toMatch(
        /^\/prototypes\/mediarecorder\/fixtures\/audio-(?:mpeg|wav|flac|opus)-(?:10|30)s\./u,
      );
      expect(audio.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(audio.markerWindows.toleranceMs).toBe(250);
    }
  });

  it('matches the checked-in fixture bytes by size and SHA-256', async () => {
    const fixtureRoot = path.resolve(
      process.cwd(),
      'prototype-fixtures',
      'mediarecorder',
      'fixtures',
    );

    for (const fixture of [...mediaRecorderFixtureManifest.images, ...mediaRecorderFixtureManifest.audio]) {
      const bytes = await readFile(path.join(fixtureRoot, fixture.fileName));
      expect(bytes.byteLength).toBe(fixture.sizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
    }
  });
});
