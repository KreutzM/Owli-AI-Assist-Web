import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';

const WEBM_EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3] as const;
const WEBM_TRACKS_ID = 0x1654ae6b;
const WEBM_TRACK_ENTRY_ID = 0xae;
const WEBM_TRACK_TYPE_ID = 0x83;
const WEBM_CODEC_ID = 0x86;

export interface WebmContainerInspection {
  container: 'webm';
  videoTrackCount: number;
  audioTrackCount: number;
  videoCodecs: string[];
  audioCodecs: string[];
}

export async function inspectWebmContainer(blob: Blob): Promise<WebmContainerInspection> {
  if (blob.size <= 0) throw new Error('WebM output is empty.');
  const slice = blob.slice(
    0,
    Math.min(blob.size, MEDIA_RECORDER_LIMITS.maxContainerInspectionBytes),
  );
  return inspectWebmBytes(new Uint8Array(await slice.arrayBuffer()));
}

export function inspectWebmBytes(bytes: Uint8Array): WebmContainerInspection {
  if (!WEBM_EBML_HEADER.every((value, index) => bytes[index] === value)) {
    throw new Error('WebM output is missing the EBML container signature.');
  }
  const tracksElement = findEbmlElement(bytes, WEBM_TRACKS_ID, 0, bytes.length);
  if (!tracksElement) throw new Error('WebM output has no Tracks element.');

  const videoCodecs: string[] = [];
  const audioCodecs: string[] = [];
  let cursor = tracksElement.dataStart;
  while (cursor < tracksElement.dataEnd) {
    const entry = readEbmlElement(bytes, cursor, tracksElement.dataEnd);
    if (!entry) break;
    if (entry.id === WEBM_TRACK_ENTRY_ID) {
      const trackType = readEbmlUnsigned(
        bytes,
        findEbmlElement(bytes, WEBM_TRACK_TYPE_ID, entry.dataStart, entry.dataEnd),
      );
      const codec = readEbmlString(
        bytes,
        findEbmlElement(bytes, WEBM_CODEC_ID, entry.dataStart, entry.dataEnd),
      );
      if (trackType === 1 && codec) videoCodecs.push(codec);
      if (trackType === 2 && codec) audioCodecs.push(codec);
    }
    cursor = entry.dataEnd;
  }

  return {
    container: 'webm',
    videoTrackCount: videoCodecs.length,
    audioTrackCount: audioCodecs.length,
    videoCodecs,
    audioCodecs,
  };
}

export function assertExpectedWebmTracks(inspection: WebmContainerInspection): void {
  if (inspection.videoTrackCount !== 1 || inspection.audioTrackCount !== 1) {
    throw new Error(
      `Expected exactly one audio and one video track; received ${inspection.audioTrackCount} audio and ${inspection.videoTrackCount} video tracks.`,
    );
  }
  const videoCodec = inspection.videoCodecs[0]?.toLowerCase();
  const audioCodec = inspection.audioCodecs[0]?.toLowerCase();
  if (!['v_vp8', 'v_vp9'].includes(videoCodec ?? '') || audioCodec !== 'a_opus') {
    throw new Error('WebM output tracks do not use an approved video/Opus combination.');
  }
}

interface EbmlElement {
  id: number;
  dataStart: number;
  dataEnd: number;
}

function readEbmlElement(
  bytes: Uint8Array,
  offset: number,
  limit: number,
): EbmlElement | undefined {
  const id = readEbmlVint(bytes, offset, limit, false);
  if (!id) return undefined;
  const size = readEbmlVint(bytes, id.next, limit, true);
  if (!size || size.value < 0) return undefined;
  const dataStart = size.next;
  const dataEnd = Math.min(dataStart + size.value, limit);
  return { id: id.value, dataStart, dataEnd };
}

function findEbmlElement(
  bytes: Uint8Array,
  targetId: number,
  start: number,
  end: number,
): EbmlElement | undefined {
  let cursor = start;
  while (cursor < end) {
    const element = readEbmlElement(bytes, cursor, end);
    if (!element) return undefined;
    if (element.id === targetId) return element;
    const nested = findEbmlElement(bytes, targetId, element.dataStart, element.dataEnd);
    if (nested) return nested;
    cursor = element.dataEnd;
  }
  return undefined;
}

function readEbmlVint(
  bytes: Uint8Array,
  offset: number,
  limit: number,
  stripLength: boolean,
): { value: number; next: number } | undefined {
  const first = bytes[offset];
  if (first === undefined) return undefined;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || offset + length > limit) return undefined;
  let value = stripLength ? first & (mask - 1) : first;
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + (bytes[offset + index] ?? 0);
  }
  return { value, next: offset + length };
}

function readEbmlUnsigned(bytes: Uint8Array, element: EbmlElement | undefined): number | undefined {
  if (!element) return undefined;
  let value = 0;
  for (let index = element.dataStart; index < element.dataEnd; index += 1) {
    value = value * 256 + (bytes[index] ?? 0);
  }
  return value;
}

function readEbmlString(bytes: Uint8Array, element: EbmlElement | undefined): string | undefined {
  if (!element) return undefined;
  return new TextDecoder().decode(bytes.slice(element.dataStart, element.dataEnd));
}
