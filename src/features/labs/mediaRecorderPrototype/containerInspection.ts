import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import type {
  PrototypeContainerInspection,
  PrototypeRecorderCandidate,
} from '@/features/labs/mediaRecorderPrototype/types';
import { inspectWebmBytes } from '@/platform/media/webmContainerInspection';

export async function inspectRecordedContainer(
  blob: Blob,
  mimeType: string,
  candidate: PrototypeRecorderCandidate,
  reserveInspectionBytes: (bytes: number) => () => void = () => () => undefined,
): Promise<PrototypeContainerInspection> {
  const container = expectedContainer(candidate.fileExtension, mimeType);
  const inspection =
    container === 'webm'
      ? await inspectWebmBlob(blob, reserveInspectionBytes)
      : await inspectMp4Blob(blob, reserveInspectionBytes);

  if (inspection.videoTrackCount !== 1 || inspection.audioTrackCount !== 1) {
    throw new Error(
      `Expected exactly one audio and one video track; received ${inspection.audioTrackCount} audio and ${inspection.videoTrackCount} video tracks.`,
    );
  }
  return inspection;
}

async function inspectWebmBlob(
  blob: Blob,
  reserveInspectionBytes: (bytes: number) => () => void,
): Promise<PrototypeContainerInspection> {
  return await withBlobSlice(
    blob,
    0,
    Math.min(blob.size, PROTOTYPE_LIMITS.maxContainerInspectionBytes),
    reserveInspectionBytes,
    (bytes) => ({
      ...inspectWebmBytes(bytes),
      seekingRequired: true,
      codecsMatchCandidate: false,
    }),
  );
}

async function inspectMp4Blob(
  blob: Blob,
  reserveInspectionBytes: (bytes: number) => () => void,
): Promise<PrototypeContainerInspection> {
  const sliceBytes = Math.min(
    blob.size,
    Math.floor(PROTOTYPE_LIMITS.maxContainerInspectionBytes / 2),
  );
  const headResult = await withBlobSlice(blob, 0, sliceBytes, reserveInspectionBytes, (bytes) => {
    if (!isMp4(bytes)) throw new Error('MP4 output is missing the ftyp container signature.');
    return inspectMp4Metadata(bytes);
  });
  if (headResult) return headResult;
  if (sliceBytes === blob.size) throw new Error('MP4 output has no moov box.');

  const tailResult = await withBlobSlice(
    blob,
    blob.size - sliceBytes,
    blob.size,
    reserveInspectionBytes,
    inspectMp4MetadataAnywhere,
  );
  if (!tailResult) {
    throw new Error(
      `MP4 moov metadata exceeds the bounded ${PROTOTYPE_LIMITS.maxContainerInspectionBytes} byte inspection window.`,
    );
  }
  return tailResult;
}

async function withBlobSlice<T>(
  blob: Blob,
  start: number,
  end: number,
  reserveInspectionBytes: (bytes: number) => () => void,
  inspect: (bytes: Uint8Array) => T,
): Promise<T> {
  const slice = blob.slice(start, end);
  const release = reserveInspectionBytes(slice.size);
  try {
    return inspect(new Uint8Array(await slice.arrayBuffer()));
  } finally {
    release();
  }
}

function expectedContainer(suffix: string, mimeType: string): 'webm' | 'mp4' {
  if (suffix === 'webm' && mimeType.startsWith('video/webm')) return 'webm';
  if (suffix === 'mp4' && mimeType.startsWith('video/mp4')) return 'mp4';
  throw new Error('Recorded output MIME does not match the selected container.');
}

function inspectMp4Metadata(bytes: Uint8Array): PrototypeContainerInspection | undefined {
  const moov = findMp4Box(bytes, 'moov', 0, bytes.length);
  return moov ? inspectMp4Moov(bytes, moov) : undefined;
}

function inspectMp4MetadataAnywhere(bytes: Uint8Array): PrototypeContainerInspection | undefined {
  for (let offset = 4; offset + 4 <= bytes.length; offset += 1) {
    if (fourCc(bytes, offset) !== 'moov') continue;
    const size = readUint32(bytes, offset - 4);
    const boxStart = offset - 4;
    if (size >= 8 && boxStart + size <= bytes.length) {
      return inspectMp4Moov(bytes, {
        type: 'moov',
        dataStart: boxStart + 8,
        dataEnd: boxStart + size,
      });
    }
  }
  return undefined;
}

function inspectMp4Moov(bytes: Uint8Array, moov: Mp4Box): PrototypeContainerInspection {
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
