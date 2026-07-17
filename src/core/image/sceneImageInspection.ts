export const SOURCE_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const SOURCE_MAX_SIDE_PX = 8192;
export const SOURCE_MAX_PIXELS = 16_000_000;
export const SCENE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export type SceneImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type SceneImageErrorCode =
  | 'SOURCE_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE'
  | 'MIME_MISMATCH'
  | 'MALFORMED_IMAGE'
  | 'DIMENSIONS_TOO_SMALL'
  | 'DIMENSIONS_TOO_LARGE'
  | 'PIXEL_LIMIT_EXCEEDED'
  | 'IMAGE_TOO_LARGE'
  | 'DECODE_FAILED'
  | 'ENCODE_FAILED'
  | 'REQUEST_ABORTED';

export class SceneImageError extends Error {
  constructor(readonly code: SceneImageErrorCode) {
    super(code);
    this.name = 'SceneImageError';
  }
}

export interface SceneSourceInspection {
  mimeType: SceneImageMimeType;
  width: number;
  height: number;
  orientation: ExifOrientation;
  byteLength: number;
}

export async function inspectSceneSource(
  source: Blob,
  reportedType = source.type,
): Promise<SceneSourceInspection> {
  if (source.size > SOURCE_FILE_MAX_BYTES) throw new SceneImageError('SOURCE_TOO_LARGE');
  const bytes = new Uint8Array(await source.arrayBuffer());
  const mimeType = sniffMimeType(bytes);
  if (!mimeType) throw new SceneImageError('UNSUPPORTED_IMAGE');
  if (reportedType && reportedType !== mimeType) throw new SceneImageError('MIME_MISMATCH');

  const parsed =
    mimeType === 'image/jpeg'
      ? inspectJpeg(bytes)
      : mimeType === 'image/png'
        ? inspectPng(bytes)
        : inspectWebp(bytes);
  validateBounds(parsed.width, parsed.height);
  return { ...parsed, mimeType, byteLength: bytes.byteLength };
}

export function sniffMimeType(bytes: Uint8Array): SceneImageMimeType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

function inspectJpeg(bytes: Uint8Array): Omit<SceneSourceInspection, 'mimeType' | 'byteLength'> {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) malformed();
  let offset = 2;
  let width: number | undefined;
  let height: number | undefined;
  let orientation: ExifOrientation = 1;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) malformed();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) malformed();
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = readU16(bytes, offset, false);
    if (length < 2 || offset + length > bytes.length) malformed();
    const payloadOffset = offset + 2;
    const payloadLength = length - 2;

    if (isSofMarker(marker)) {
      if (payloadLength < 5) malformed();
      height = readU16(bytes, payloadOffset + 1, false);
      width = readU16(bytes, payloadOffset + 3, false);
    } else if (
      marker === 0xe1 &&
      payloadLength >= 8 &&
      ascii(bytes, payloadOffset, 6) === 'Exif\0\0'
    ) {
      orientation = parseTiffOrientation(bytes, payloadOffset + 6, payloadLength - 6);
    }
    offset += length;
  }

  if (width === undefined || height === undefined) malformed();
  return { width, height, orientation };
}

function inspectPng(bytes: Uint8Array): Omit<SceneSourceInspection, 'mimeType' | 'byteLength'> {
  if (bytes.length < 33) malformed();
  const ihdrLength = readU32(bytes, 8, false);
  if (ihdrLength !== 13 || ascii(bytes, 12, 4) !== 'IHDR') malformed();
  const width = readU32(bytes, 16, false);
  const height = readU32(bytes, 20, false);
  let orientation: ExifOrientation = 1;
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset, false);
    const type = ascii(bytes, offset + 4, 4);
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (end + 4 > bytes.length) malformed();
    if (type === 'eXIf') orientation = parseTiffOrientation(bytes, dataOffset, length);
    offset = end + 4;
    if (type === 'IEND') break;
  }
  return { width, height, orientation };
}

function inspectWebp(bytes: Uint8Array): Omit<SceneSourceInspection, 'mimeType' | 'byteLength'> {
  if (bytes.length < 20) malformed();
  let width: number | undefined;
  let height: number | undefined;
  let orientation: ExifOrientation = 1;
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = readU32(bytes, offset + 4, true);
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (end > bytes.length) malformed();

    if (type === 'VP8X') {
      if (length < 10) malformed();
      width = 1 + readU24(bytes, dataOffset + 4);
      height = 1 + readU24(bytes, dataOffset + 7);
    } else if (type === 'VP8 ') {
      if (length < 10 || ascii(bytes, dataOffset + 3, 3) !== '\u009d\u0001*') malformed();
      width = readU16(bytes, dataOffset + 6, true) & 0x3fff;
      height = readU16(bytes, dataOffset + 8, true) & 0x3fff;
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[dataOffset] !== 0x2f) malformed();
      const bits = readU32(bytes, dataOffset + 1, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === 'EXIF') {
      const prefix = ascii(bytes, dataOffset, Math.min(6, length));
      const tiffOffset = prefix === 'Exif\0\0' ? dataOffset + 6 : dataOffset;
      const tiffLength = prefix === 'Exif\0\0' ? length - 6 : length;
      orientation = parseTiffOrientation(bytes, tiffOffset, tiffLength);
    }
    offset = end + (length % 2);
  }

  if (width === undefined || height === undefined) malformed();
  return { width, height, orientation };
}

function parseTiffOrientation(
  bytes: Uint8Array,
  start: number,
  length: number,
): ExifOrientation {
  if (length < 8 || start + length > bytes.length) return 1;
  const order = ascii(bytes, start, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return 1;
  if (readU16(bytes, start + 2, little) !== 42) return 1;
  const ifdOffset = readU32(bytes, start + 4, little);
  const directory = start + ifdOffset;
  if (directory + 2 > start + length) return 1;
  const count = readU16(bytes, directory, little);

  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > start + length) return 1;
    if (readU16(bytes, entry, little) !== 0x0112) continue;
    const type = readU16(bytes, entry + 2, little);
    const values = readU32(bytes, entry + 4, little);
    if (type !== 3 || values !== 1) return 1;
    const value = readU16(bytes, entry + 8, little);
    return value >= 1 && value <= 8 ? (value as ExifOrientation) : 1;
  }
  return 1;
}

function validateBounds(width: number, height: number): void {
  if (width < 2 || height < 2) throw new SceneImageError('DIMENSIONS_TOO_SMALL');
  if (width > SOURCE_MAX_SIDE_PX || height > SOURCE_MAX_SIDE_PX) {
    throw new SceneImageError('DIMENSIONS_TOO_LARGE');
  }
  if (width * height > SOURCE_MAX_PIXELS) throw new SceneImageError('PIXEL_LIMIT_EXCEEDED');
}

function isSofMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function readU16(bytes: Uint8Array, offset: number, little: boolean): number {
  if (offset + 2 > bytes.length) malformed();
  return little
    ? (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
    : ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU24(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.length) malformed();
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readU32(bytes: Uint8Array, offset: number, little: boolean): number {
  if (offset + 4 > bytes.length) malformed();
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getUint32(0, little);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) malformed();
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return result;
}

function malformed(): never {
  throw new SceneImageError('MALFORMED_IMAGE');
}
