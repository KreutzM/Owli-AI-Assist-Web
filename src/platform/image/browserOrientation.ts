import type { ExifOrientation } from '@/core/image/sceneImageInspection';

const ORIENTATION_PROBE_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4H8Q/8h/Uv+vmX/0M0UUV/ptkP/Ipwn/XuH/pKPAzr/kZ4r/r5P8A9KZ//9k=';

export interface DecodedSceneSurface {
  width: number;
  height: number;
  draw(context: CanvasRenderingContext2D): void;
  close(): void;
}

interface LoadedHtmlImage {
  image: HTMLImageElement;
  objectUrl: string;
}

export class BrowserOrientationDecoder {
  #bitmapSupportsRawOrientation: Promise<boolean> | undefined;
  #imageAutoOrients: Promise<boolean> | undefined;

  async decode(
    blob: Blob,
    orientation: ExifOrientation,
  ): Promise<{
    surface: DecodedSceneSurface;
    effectiveOrientation: ExifOrientation;
  }> {
    if (typeof createImageBitmap === 'function' && (await this.#probeBitmap())) {
      try {
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
        return {
          surface: bitmapSurface(bitmap),
          effectiveOrientation: orientation,
        };
      } catch {
        // Fall through to the WebKit-compatible HTML image path.
      }
    }

    const autoOrients = await this.#probeHtmlImage();
    const loaded = await loadImage(blob);
    return {
      surface: imageSurface(loaded),
      effectiveOrientation: autoOrients ? 1 : orientation,
    };
  }

  async #probeBitmap(): Promise<boolean> {
    this.#bitmapSupportsRawOrientation ??= (async () => {
      try {
        const bitmap = await createImageBitmap(probeBlob(), { imageOrientation: 'none' });
        try {
          return bitmap.width === 2 && bitmap.height === 1;
        } finally {
          bitmap.close();
        }
      } catch {
        return false;
      }
    })();
    return this.#bitmapSupportsRawOrientation;
  }

  async #probeHtmlImage(): Promise<boolean> {
    this.#imageAutoOrients ??= (async () => {
      try {
        const loaded = await loadImage(probeBlob());
        try {
          return loaded.image.naturalWidth === 1 && loaded.image.naturalHeight === 2;
        } finally {
          closeHtmlImage(loaded);
        }
      } catch {
        return false;
      }
    })();
    return this.#imageAutoOrients;
  }
}

function bitmapSurface(bitmap: ImageBitmap): DecodedSceneSurface {
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw: (context) => context.drawImage(bitmap, 0, 0),
    close: () => bitmap.close(),
  };
}

function imageSurface(loaded: LoadedHtmlImage): DecodedSceneSurface {
  return {
    width: loaded.image.naturalWidth,
    height: loaded.image.naturalHeight,
    draw: (context) => context.drawImage(loaded.image, 0, 0),
    close: () => closeHtmlImage(loaded),
  };
}

async function loadImage(blob: Blob): Promise<LoadedHtmlImage> {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image decode failed'));
      image.src = objectUrl;
    });
    return { image, objectUrl };
  } catch (error) {
    image.src = '';
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function closeHtmlImage(loaded: LoadedHtmlImage): void {
  loaded.image.src = '';
  URL.revokeObjectURL(loaded.objectUrl);
}

function probeBlob(): Blob {
  const binary = atob(ORIENTATION_PROBE_JPEG);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: 'image/jpeg' });
}
