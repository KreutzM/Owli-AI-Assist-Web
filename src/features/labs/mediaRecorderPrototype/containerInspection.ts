import type {
  PrototypeContainerInspection,
  PrototypeRecorderCandidate,
} from '@/features/labs/mediaRecorderPrototype/types';

const WEBM_EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3];
const WEBM_TRACKS_ID = 0x1654ae6b;
const WEBM_TRACK_ENTRY_ID = 0xae;
const WEBM_TRACK_TYPE_ID = 0x83;
const WEBM_CODEC_ID = 0x86;

export async function inspectRecordedContainer(
  blob: Blob,
  mimeType: string,
  candidate: PrototypeRecorderCandidate,
): Promise<PrototypeContainerInspection> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const container = expectedContainer(candidate.fileExtension, mimeType);
  const inspection = container === 'webm' ? inspectWebm(bytes) : inspectMp4(bytes);

  if (inspection.videoTrackCount !== 1 || inspection.audioTrackCount !== 1) {
    throw new Error(
      `Expected exactly one audio and one video track; received ${inspection.audioTrackCount} audio and ${inspection.videoTrackCount} video tracks.`,
    );
  }
  return inspection;
}

function expectedContainer(suffix: string, mimeType: string): 'webm' | 'mp4' {
  if (suffix === 'webm' && mimeType.startsWith('video/webm')) return 'webm';
  if (suffix === 'mp4' && mimeType.startsWith('video/mp4')) return 'mp4';
  throw new Error('Recorded output MIME does not match the selected container.');
}

function inspectWebm(bytes: Uint8Array): PrototypeContainerInspection {
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
    seekingRequired: true,
    videoTrackCount: videoCodecs.length,
    audioTrackCount: audioCodecs.length,
    videoCodecs,
    audioCodecs,
    codecsMatchCandidate: false,
  };
}

function inspectMp4(bytes: Uint8Array): PrototypeContainerInspection {
  if (!isMp4(bytes)) throw new Error('MP4 output is missing the ftyp container signature.');
  const moov = findMp4Box(bytes, 'moov', 0, bytes.length);
  if (!moov) throw new Error('MP4 output has no moov box.');
  const tracks = findAllMp4Boxes(bytes, 'trak', moov.dataStart, moov.dataEnd);
  const videoCodecs: string[] = [];
  const audioCodecs: string[] = [];
  for (const track of tracks) {
    const handler = findMp4BoxRecursive(bytes, 'hdlr', track.dataStart, track.dataEnd);
    const stsd = findMp4BoxRecursive(bytes, 'stsd', track.dataStart, track.dataEnd);
    if (!handler || !stsd) continue;
    const kind = fourCc(bytes, handler.dataStart + 8);
    const codec = firstStsdCodec(bytes, stsd);
    if (kind === 'vide' && codec) videoCodecs.push(codec);
    if (kind === 'soun' && codec) audioCodecs.push(codec);
  }
  return {
    container: 'mp4',
    seekingRequired: true,
    videoTrackCount: videoCodecs.length,
    audioTrackCount: audioCodecs.length,
    videoCodecs,
    audioCodecs,
    codecsMatchCandidate: false,
  };
}

export function matchRecordedCodecs(
  inspection: PrototypeContainerInspection,
  candidate: PrototypeRecorderCandidate,
): PrototypeContainerInspection {
  const video = inspection.videoCodecs.map((codec) => codec.toLowerCase());
  const audio = inspection.audioCodecs.map((codec) => codec.toLowerCase());
  const codecsMatchCandidate =
    (candidate.id === 'mp4-h264-aac' && video[0] === 'avc1' && audio[0] === 'mp4a') ||
    (candidate.id === 'webm-vp8-opus' && video[0] === 'v_vp8' && audio[0] === 'a_opus') ||
    (candidate.id === 'webm-vp9-opus' && video[0] === 'v_vp9' && audio[0] === 'a_opus') ||
    (candidate.id === 'webm-default' &&
      ['v_vp8', 'v_vp9'].includes(video[0] ?? '') &&
      audio[0] === 'a_opus');
  return { ...inspection, codecsMatchCandidate };
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

function readEbmlVint(bytes: Uint8Array, offset: number, limit: number, stripLength: boolean) {
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
  for (let index = 1; index < length; index += 1)
    value = value * 256 + (bytes[offset + index] ?? 0);
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

interface EbmlElement {
  id: number;
  dataStart: number;
  dataEnd: number;
}

interface Mp4Box {
  type: string;
  dataStart: number;
  dataEnd: number;
}

function isMp4(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && fourCc(bytes, 4) === 'ftyp';
}

function findMp4Box(
  bytes: Uint8Array,
  type: string,
  start: number,
  end: number,
): Mp4Box | undefined {
  return findAllMp4Boxes(bytes, type, start, end)[0];
}

function findAllMp4Boxes(bytes: Uint8Array, type: string, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let cursor = start;
  while (cursor + 8 <= end) {
    const size = readUint32(bytes, cursor);
    const boxEnd = size === 0 ? end : cursor + size;
    if (size < 8 || boxEnd > end) break;
    const box = { type: fourCc(bytes, cursor + 4), dataStart: cursor + 8, dataEnd: boxEnd };
    if (!type || box.type === type) boxes.push(box);
    cursor = boxEnd;
  }
  return boxes;
}

function findMp4BoxRecursive(
  bytes: Uint8Array,
  type: string,
  start: number,
  end: number,
): Mp4Box | undefined {
  for (const box of findAllMp4Boxes(bytes, '', start, end)) {
    if (box.type === type) return box;
    const nested = findMp4BoxRecursive(bytes, type, box.dataStart, box.dataEnd);
    if (nested) return nested;
  }
  return undefined;
}

function firstStsdCodec(bytes: Uint8Array, stsd: Mp4Box): string | undefined {
  const entryStart = stsd.dataStart + 8;
  return entryStart + 8 <= stsd.dataEnd ? fourCc(bytes, entryStart + 4) : undefined;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 2 ** 24 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + 4));
}
