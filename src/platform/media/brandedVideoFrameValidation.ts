import {
  BRANDED_VIDEO_CANVAS,
  type BrandedVideoLayout,
  type FrameRect,
} from '@/platform/media/brandedVideoFrame';

const BACKGROUND_PIXEL = new Uint8ClampedArray([16, 20, 24, 255]);

export function assertDecodedBrandedFrame(
  video: HTMLVideoElement,
  referenceCanvas: HTMLCanvasElement,
  layout: BrandedVideoLayout,
): void {
  const decoded = document.createElement('canvas');
  decoded.width = BRANDED_VIDEO_CANVAS.width;
  decoded.height = BRANDED_VIDEO_CANVAS.height;
  const decodedContext = decoded.getContext('2d', { alpha: false });
  const referenceContext = referenceCanvas.getContext('2d', { alpha: false });
  if (!decodedContext || !referenceContext) {
    throw new Error('Frame validation canvas is unavailable.');
  }
  decodedContext.drawImage(video, 0, 0, decoded.width, decoded.height);

  const sampleRects = [layout.image, layout.band, layout.logo, layout.text];
  let distanceTotal = 0;
  let samples = 0;
  for (const rect of sampleRects) {
    for (const point of sampleRect(rect, 5, 4)) {
      const expected = referenceContext.getImageData(point.x, point.y, 1, 1).data;
      const actual = decodedContext.getImageData(point.x, point.y, 1, 1).data;
      if ((actual[3] ?? 0) !== 255) {
        throw new Error('Recorded output frame is not opaque.');
      }
      distanceTotal += colorDistance(expected, actual);
      samples += 1;
    }
  }
  if (samples === 0 || distanceTotal / samples > 48) {
    throw new Error('Recorded output frame does not match the current branded scene.');
  }

  assertRegionHasColor(decodedContext, layout.logo, 18, 'canonical Owli logo');
  assertRegionHasWhite(decodedContext, layout.text, 'Owli-AI.com');
  const corner = decodedContext.getImageData(2, 2, 1, 1).data;
  if (colorDistance(corner, BACKGROUND_PIXEL) > 18) {
    throw new Error('Recorded output background color is invalid.');
  }
}

function assertRegionHasColor(
  context: CanvasRenderingContext2D,
  rect: FrameRect,
  minimumSamples: number,
  label: string,
): void {
  let colorful = 0;
  for (const point of sampleRect(rect, 9, 7)) {
    const pixel = context.getImageData(point.x, point.y, 1, 1).data;
    const maximum = Math.max(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0);
    const minimum = Math.min(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0);
    if (maximum - minimum >= 35 && maximum >= 70) colorful += 1;
  }
  if (colorful < minimumSamples) {
    throw new Error(`Recorded output is missing the ${label}.`);
  }
}

function assertRegionHasWhite(
  context: CanvasRenderingContext2D,
  rect: FrameRect,
  label: string,
): void {
  let white = 0;
  for (const point of sampleRect(rect, 24, 8)) {
    const pixel = context.getImageData(point.x, point.y, 1, 1).data;
    if ((pixel[0] ?? 0) > 190 && (pixel[1] ?? 0) > 190 && (pixel[2] ?? 0) > 190) {
      white += 1;
    }
  }
  if (white < 4) throw new Error(`Recorded output is missing ${label}.`);
}

function sampleRect(rect: FrameRect, columns: number, rows: number) {
  const points: Array<{ x: number; y: number }> = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      points.push({
        x: Math.min(
          BRANDED_VIDEO_CANVAS.width - 1,
          Math.max(0, Math.round(rect.x + (rect.width * column) / (columns + 1))),
        ),
        y: Math.min(
          BRANDED_VIDEO_CANVAS.height - 1,
          Math.max(0, Math.round(rect.y + (rect.height * row) / (rows + 1))),
        ),
      });
    }
  }
  return points;
}

function colorDistance(left: ArrayLike<number>, right: ArrayLike<number>): number {
  return Math.sqrt(
    ((left[0] ?? 0) - (right[0] ?? 0)) ** 2 +
      ((left[1] ?? 0) - (right[1] ?? 0)) ** 2 +
      ((left[2] ?? 0) - (right[2] ?? 0)) ** 2,
  );
}
