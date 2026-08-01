import { describe, expect, it } from 'vitest';
import { assertOutputContainer } from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import type { PrototypeRecorderCandidate } from '@/features/labs/mediaRecorderPrototype/types';

const webmCandidate: PrototypeRecorderCandidate = {
  id: 'webm-vp8-opus',
  mimeType: 'video/webm;codecs=vp8,opus',
  fileExtension: 'webm',
};

const mp4Candidate: PrototypeRecorderCandidate = {
  id: 'mp4-h264-aac',
  mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  fileExtension: 'mp4',
};

describe('media recorder prototype container inspection', () => {
  it('requires one VP8 video track and one Opus audio track in WebM output', async () => {
    const inspection = await assertOutputContainer(
      new Blob([asBlobPart(webmWithTracks('V_VP8', 'A_OPUS'))], { type: webmCandidate.mimeType }),
      webmCandidate.mimeType,
      webmCandidate,
    );

    expect(inspection).toMatchObject({
      container: 'webm',
      videoTrackCount: 1,
      audioTrackCount: 1,
      videoCodecs: ['V_VP8'],
      audioCodecs: ['A_OPUS'],
      codecsMatchCandidate: true,
    });
  });

  it('rejects a WebM container without the required audio track', async () => {
    await expect(
      assertOutputContainer(
        new Blob([asBlobPart(webmWithTracks('V_VP8'))], { type: webmCandidate.mimeType }),
        webmCandidate.mimeType,
        webmCandidate,
      ),
    ).rejects.toThrow('exactly one audio and one video track');
  });

  it('requires AVC and AAC tracks in MP4 output', async () => {
    const inspection = await assertOutputContainer(
      new Blob([asBlobPart(mp4WithTracks('avc1', 'mp4a'))], { type: mp4Candidate.mimeType }),
      mp4Candidate.mimeType,
      mp4Candidate,
    );

    expect(inspection).toMatchObject({
      container: 'mp4',
      videoCodecs: ['avc1'],
      audioCodecs: ['mp4a'],
      codecsMatchCandidate: true,
    });
  });
});

function webmWithTracks(videoCodec: string, audioCodec?: string): Uint8Array {
  const entries = [webmTrack(1, videoCodec)];
  if (audioCodec) entries.push(webmTrack(2, audioCodec));
  return new Uint8Array([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x80,
    0x16,
    0x54,
    0xae,
    0x6b,
    0x80 | entries.flat().length,
    ...entries.flat(),
  ]);
}

function webmTrack(type: number, codec: string): number[] {
  const value = [...new TextEncoder().encode(codec)];
  const body = [0x83, 0x81, type, 0x86, 0x80 | value.length, ...value];
  return [0xae, 0x80 | body.length, ...body];
}

function mp4WithTracks(videoCodec: string, audioCodec: string): Uint8Array {
  return concat(
    box('ftyp'),
    box(
      'moov',
      box('trak', mp4Track('vide', videoCodec)),
      box('trak', mp4Track('soun', audioCodec)),
    ),
  );
}

function mp4Track(kind: string, codec: string): Uint8Array {
  return concat(
    box('hdlr', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, ...fourCc(kind)])),
    box(
      'stbl',
      box('stsd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 8, ...fourCc(codec)])),
    ),
  );
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(...parts);
  const size = body.length + 8;
  return new Uint8Array([
    size >>> 24,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...fourCc(type),
    ...body,
  ]);
}

function fourCc(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function asBlobPart(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
