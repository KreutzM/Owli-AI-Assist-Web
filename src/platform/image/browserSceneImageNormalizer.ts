import {
  inspectSceneSource,
  SCENE_IMAGE_MAX_BYTES,
  SceneImageError,
  type ExifOrientation,
  type SceneSourceInspection,
} from '@/core/image/sceneImageInspection';
import {
  BrowserOrientationDecoder,
  type DecodedSceneSurface,
} from '@/platform/image/browserOrientation';
import { snapshotSceneSource } from '@/platform/image/browserSourceSnapshot';

export interface NormalizedSceneImage {
  blob: Blob;
  width: number;
  height: number;
  byteLength: number;
  previewUrl: string;
}

export const SCENE_ENCODING_ATTEMPTS = [
  { maxSide: 1280, quality: 0.82 },
  { maxSide: 1280, quality: 0.72 },
  { maxSide: 1024, quality: 0.72 },
  { maxSide: 1024, quality: 0.62 },
  { maxSide: 768, quality: 0.62 },
] as const;

export class BrowserSceneImageNormalizer {
  constructor(private readonly decoder = new BrowserOrientationDecoder()) {}

  async normalize(source: Blob, signal?: AbortSignal): Promise<NormalizedSceneImage> {
    assertNotAborted(signal);
    const ownedSource = await snapshotSceneSource(source);
    assertNotAborted(signal);
    const inspection = await inspectSceneSource(ownedSource, source.type);
    assertNotAborted(signal);

    let surface: DecodedSceneSurface | undefined;
    const canvas = document.createElement('canvas');
    let previewUrl: string | undefined;
    try {
      const decoded = await this.decoder.decode(ownedSource, inspection.orientation);
      surface = decoded.surface;
      assertDecodedDimensions(surface, inspection, decoded.effectiveOrientation);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new SceneImageError('DECODE_FAILED');

      for (const attempt of SCENE_ENCODING_ATTEMPTS) {
        assertNotAborted(signal);
        const dimensions = fitOrientedDimensions(
          surface.width,
          surface.height,
          decoded.effectiveOrientation,
          attempt.maxSide,
        );
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, dimensions.width, dimensions.height);
        applyOrientationTransform(
          context,
          decoded.effectiveOrientation,
          surface.width,
          surface.height,
          dimensions.width,
          dimensions.height,
        );
        surface.draw(context);
        const output = await encodeJpeg(canvas, attempt.quality);
        if (output.size > SCENE_IMAGE_MAX_BYTES) continue;

        surface.close();
        surface = undefined;
        releaseCanvas(canvas);
        previewUrl = URL.createObjectURL(output);
        return {
          blob: output,
          width: dimensions.width,
          height: dimensions.height,
          byteLength: output.size,
          previewUrl,
        };
      }
      throw new SceneImageError('IMAGE_TOO_LARGE');
    } catch (error) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (signal?.aborted) throw new SceneImageError('REQUEST_ABORTED');
      if (error instanceof SceneImageError) throw error;
      throw new SceneImageError('DECODE_FAILED');
    } finally {
      surface?.close();
      releaseCanvas(canvas);
    }
  }
}

export function revokeNormalizedSceneImage(image?: NormalizedSceneImage): void {
  if (image) URL.revokeObjectURL(image.previewUrl);
}

export function fitOrientedDimensions(
  sourceWidth: number,
  sourceHeight: number,
  orientation: ExifOrientation,
  maxSide: number,
): { width: number; height: number } {
  const swapped = orientation >= 5;
  const orientedWidth = swapped ? sourceHeight : sourceWidth;
  const orientedHeight = swapped ? sourceWidth : sourceHeight;
  const scale = Math.min(1, maxSide / Math.max(orientedWidth, orientedHeight));
  return {
    width: Math.max(1, Math.round(orientedWidth * scale)),
    height: Math.max(1, Math.round(orientedHeight * scale)),
  };
}

export function applyOrientationTransform(
  context: CanvasRenderingContext2D,
  orientation: ExifOrientation,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): void {
  const horizontal = orientation >= 5 ? outputWidth / sourceHeight : outputWidth / sourceWidth;
  const vertical = orientation >= 5 ? outputHeight / sourceWidth : outputHeight / sourceHeight;
  switch (orientation) {
    case 1:
      context.setTransform(horizontal, 0, 0, vertical, 0, 0);
      break;
    case 2:
      context.setTransform(-horizontal, 0, 0, vertical, outputWidth, 0);
      break;
    case 3:
      context.setTransform(-horizontal, 0, 0, -vertical, outputWidth, outputHeight);
      break;
    case 4:
      context.setTransform(horizontal, 0, 0, -vertical, 0, outputHeight);
      break;
    case 5:
      context.setTransform(0, vertical, horizontal, 0, 0, 0);
      break;
    case 6:
      context.setTransform(0, vertical, -horizontal, 0, outputWidth, 0);
      break;
    case 7:
      context.setTransform(0, -vertical, -horizontal, 0, outputWidth, outputHeight);
      break;
    case 8:
      context.setTransform(0, -vertical, horizontal, 0, 0, outputHeight);
      break;
  }
}

function assertDecodedDimensions(
  surface: DecodedSceneSurface,
  inspection: SceneSourceInspection,
  effectiveOrientation: ExifOrientation,
): void {
  const decoderMayHaveOriented = effectiveOrientation === 1 && inspection.orientation >= 5;
  const expectedWidth = decoderMayHaveOriented ? inspection.height : inspection.width;
  const expectedHeight = decoderMayHaveOriented ? inspection.width : inspection.height;
  if (surface.width !== expectedWidth || surface.height !== expectedHeight) {
    throw new SceneImageError('DECODE_FAILED');
  }
}

async function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== 'image/jpeg') {
          reject(new SceneImageError('ENCODE_FAILED'));
        } else {
          resolve(blob);
        }
      },
      'image/jpeg',
      quality,
    );
  });
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SceneImageError('REQUEST_ABORTED');
}
