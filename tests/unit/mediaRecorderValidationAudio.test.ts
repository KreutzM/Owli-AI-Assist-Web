import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeFixtureAudioBuffer,
  detectMarkerSamples,
  type MarkerSnapshot,
} from '@/features/labs/mediaRecorderPrototype/validationAudio';
import { mediaRecorderFixtureManifest } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';

function markerSample(
  timeMs: number,
  overrides: Partial<MarkerSnapshot> = {},
): MarkerSnapshot {
  return {
    timeMs,
    rms: 0.01,
    startMarkerDb: -70,
    endMarkerDb: -70,
    backgroundDb: -72,
    startMarkerLeadDb: 0,
    endMarkerLeadDb: 0,
    ...overrides,
  };
}

describe('media recorder prototype audio marker detection', () => {
  it('accepts a marker only when the target band leads the background floor', () => {
    const samples = [
      markerSample(340, { rms: 0.05, startMarkerLeadDb: 12 }),
      markerSample(9200, { rms: 0.05, endMarkerLeadDb: 10 }),
    ];

    expect(detectMarkerSamples(samples, 350, 25, 'startMarkerLeadDb')).toBe(340);
    expect(detectMarkerSamples(samples, 9200, 25, 'endMarkerLeadDb')).toBe(9200);
  });

  it('rejects plain RMS activity without a frequency-specific lead', () => {
    const samples = [
      markerSample(350, { rms: 0.08, startMarkerLeadDb: 2 }),
      markerSample(9200, { rms: 0.08, endMarkerLeadDb: 1.5 }),
    ];

    expect(detectMarkerSamples(samples, 350, 25, 'startMarkerLeadDb')).toBeUndefined();
    expect(detectMarkerSamples(samples, 9200, 25, 'endMarkerLeadDb')).toBeUndefined();
  });

  it('detects the start and end markers in the real 10-second WAV fixture', async () => {
    const fixture = mediaRecorderFixtureManifest.audio.find((audio) => audio.id === 'audio-wav-10s');
    if (!fixture) throw new Error('Missing audio-wav-10s fixture.');
    const buffer = await readFile(
      path.resolve('prototype-fixtures', 'mediarecorder', 'fixtures', fixture.fileName),
    );
    const audioBuffer = parseStereoPcmWav(buffer);
    const analysis = analyzeFixtureAudioBuffer(audioBuffer, fixture);

    expect(analysis.audioNonSilent).toBe(true);
    expect(analysis.startMarkerDetected).toBe(true);
    expect(analysis.endMarkerDetected).toBe(true);
    expect(analysis.startMarkerMs).toBeGreaterThanOrEqual(200);
    expect(analysis.endMarkerMs).toBeGreaterThanOrEqual(9_000);
  });
});

function parseStereoPcmWav(buffer: Buffer): AudioBuffer {
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  if (channels !== 2 || bitsPerSample !== 16) {
    throw new Error('Expected a 16-bit stereo PCM WAV fixture.');
  }
  const dataOffset = buffer.indexOf('data');
  if (dataOffset < 0) throw new Error('WAV data chunk missing.');
  const dataSize = buffer.readUInt32LE(dataOffset + 4);
  const sampleCount = dataSize / (channels * 2);
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  let cursor = dataOffset + 8;
  for (let index = 0; index < sampleCount; index += 1) {
    left[index] = buffer.readInt16LE(cursor) / 32768;
    right[index] = buffer.readInt16LE(cursor + 2) / 32768;
    cursor += 4;
  }
  return {
    sampleRate,
    length: sampleCount,
    duration: sampleCount / sampleRate,
    numberOfChannels: channels,
    getChannelData(channel: number) {
      return channel === 0 ? left : right;
    },
  } as AudioBuffer;
}
