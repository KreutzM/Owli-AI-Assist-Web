import type { CameraGateway } from '@/platform/camera/types';

export class BrowserCamera implements CameraGateway {
  #stream: MediaStream | undefined;
  #video: HTMLVideoElement | undefined;

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    const mediaDevices = Reflect.get(navigator, 'mediaDevices') as MediaDevices | undefined;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      throw new Error('Dieser Browser unterstützt keinen Kamerazugriff.');
    }
    this.#stream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    this.#video = video;
    video.srcObject = this.#stream;
    await video.play();
  }

  async capture(): Promise<Blob> {
    const video = this.#video;
    if (!video || !video.videoWidth || !video.videoHeight) {
      throw new Error('Die Kamera ist noch nicht bereit.');
    }
    const { width, height } = fitWithin(video.videoWidth, video.videoHeight, 1280);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Bildaufnahme konnte nicht vorbereitet werden.');
    context.drawImage(video, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Bildaufnahme ist fehlgeschlagen.'))),
        'image/jpeg',
        0.82,
      );
    });
  }

  stop(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    if (this.#video) this.#video.srcObject = null;
    this.#stream = undefined;
    this.#video = undefined;
  }
}

function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
