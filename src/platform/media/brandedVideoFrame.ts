export const BRANDED_VIDEO_CANVAS = { width: 540, height: 960 } as const;
export const BRANDED_VIDEO_BRAND_TEXT = 'Owli-AI.com' as const;
export const BRANDED_VIDEO_COLORS = {
  background: '#101418',
  band: 'rgba(28, 35, 43, 0.902)',
  text: '#ffffff',
  imageStroke: 'rgba(255, 255, 255, 0.2)',
} as const;

const ANDROID_REFERENCE_WIDTH = 1080;
const SCALE = BRANDED_VIDEO_CANVAS.width / ANDROID_REFERENCE_WIDTH;
const MAX_TEXT_SHRINK_STEPS = 8;

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrandedVideoLayout {
  canvas: FrameRect;
  imageArea: FrameRect;
  image: FrameRect;
  band: FrameRect;
  logoArea: FrameRect;
  logo: FrameRect;
  text: FrameRect;
  imageRadius: number;
  bandRadius: number;
  nominalTextSize: number;
  minimumTextSize: number;
}

export function computeBrandedVideoLayout(
  sourceWidth: number,
  sourceHeight: number,
  logoWidth: number,
  logoHeight: number,
): BrandedVideoLayout {
  assertPositiveSize(sourceWidth, sourceHeight, 'scene image');
  assertPositiveSize(logoWidth, logoHeight, 'Owli logo');

  const horizontalPadding = scaled(64);
  const topPadding = scaled(64);
  const contentToBrandingGap = scaled(48);
  const brandingBandHeight = scaled(224);
  const brandingBottomPadding = scaled(72);
  const brandingInnerPadding = scaled(40);
  const logoBoxWidth = scaled(164);
  const logoBoxHeight = scaled(128);
  const brandingGap = scaled(32);
  const band: FrameRect = {
    x: horizontalPadding,
    y: BRANDED_VIDEO_CANVAS.height - brandingBottomPadding - brandingBandHeight,
    width: BRANDED_VIDEO_CANVAS.width - horizontalPadding * 2,
    height: brandingBandHeight,
  };
  const imageArea: FrameRect = {
    x: horizontalPadding,
    y: topPadding,
    width: BRANDED_VIDEO_CANVAS.width - horizontalPadding * 2,
    height: band.y - contentToBrandingGap - topPadding,
  };
  const logoArea: FrameRect = {
    x: band.x + brandingInnerPadding,
    y: band.y + (band.height - logoBoxHeight) / 2,
    width: logoBoxWidth,
    height: logoBoxHeight,
  };
  return {
    canvas: { x: 0, y: 0, ...BRANDED_VIDEO_CANVAS },
    imageArea,
    image: fitCenterInside(sourceWidth, sourceHeight, imageArea, false),
    band,
    logoArea,
    logo: fitCenterInside(logoWidth, logoHeight, logoArea, true),
    text: {
      x: logoArea.x + logoArea.width + brandingGap,
      y: band.y + brandingInnerPadding,
      width:
        band.x +
        band.width -
        brandingInnerPadding -
        (logoArea.x + logoArea.width + brandingGap),
      height: band.height - brandingInnerPadding * 2,
    },
    imageRadius: scaled(32),
    bandRadius: scaled(36),
    nominalTextSize: 58 * SCALE,
    minimumTextSize: 36 * SCALE,
  };
}

export function drawBrandedVideoFrame(
  context: CanvasRenderingContext2D,
  scene: CanvasImageSource & { width: number; height: number },
  logo: CanvasImageSource & { width: number; height: number },
): BrandedVideoLayout {
  const layout = computeBrandedVideoLayout(
    scene.width,
    scene.height,
    logo.width,
    logo.height,
  );
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = BRANDED_VIDEO_COLORS.background;
  context.fillRect(0, 0, BRANDED_VIDEO_CANVAS.width, BRANDED_VIDEO_CANVAS.height);

  context.drawImage(
    scene,
    layout.image.x,
    layout.image.y,
    layout.image.width,
    layout.image.height,
  );
  context.strokeStyle = BRANDED_VIDEO_COLORS.imageStroke;
  context.lineWidth = Math.max(2, 2 * SCALE);
  roundedRect(context, layout.image, layout.imageRadius);
  context.stroke();

  context.fillStyle = BRANDED_VIDEO_COLORS.band;
  roundedRect(context, layout.band, layout.bandRadius);
  context.fill();
  context.drawImage(
    logo,
    layout.logo.x,
    layout.logo.y,
    layout.logo.width,
    layout.logo.height,
  );

  context.fillStyle = BRANDED_VIDEO_COLORS.text;
  context.textBaseline = 'middle';
  context.font = `700 ${fitBrandTextSize(context, layout)}px system-ui, sans-serif`;
  context.fillText(
    BRANDED_VIDEO_BRAND_TEXT,
    layout.text.x,
    layout.text.y + layout.text.height / 2,
  );
  context.restore();
  return layout;
}

export function fitBrandTextSize(
  context: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  layout: BrandedVideoLayout,
): number {
  let size = layout.nominalTextSize;
  for (let step = 0; step < MAX_TEXT_SHRINK_STEPS; step += 1) {
    context.font = `700 ${size}px system-ui, sans-serif`;
    if (context.measureText(BRANDED_VIDEO_BRAND_TEXT).width <= layout.text.width) {
      return size;
    }
    size = Math.max(layout.minimumTextSize, size * 0.92);
  }
  context.font = `700 ${size}px system-ui, sans-serif`;
  if (context.measureText(BRANDED_VIDEO_BRAND_TEXT).width > layout.text.width) {
    throw new Error('Owli branding text does not fit its approved area.');
  }
  return size;
}

export function fitCenterInside(
  sourceWidth: number,
  sourceHeight: number,
  area: FrameRect,
  allowUpscale: boolean,
): FrameRect {
  assertPositiveSize(sourceWidth, sourceHeight, 'source');
  const scale = Math.min(
    area.width / sourceWidth,
    area.height / sourceHeight,
    allowUpscale ? Number.POSITIVE_INFINITY : 1,
  );
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function roundedRect(
  context: CanvasRenderingContext2D,
  rect: FrameRect,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    Math.min(radius, rect.width / 2),
  );
}

function scaled(value: number): number {
  return Math.max(1, Math.round(value * SCALE));
}

function assertPositiveSize(width: number, height: number, label: string): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} dimensions must be positive.`);
  }
}
