import {
  SOURCE_MAX_PIXELS,
  SOURCE_MAX_SIDE_PX,
  SceneImageError,
} from '@/core/image/sceneImageInspection';

export type CameraErrorCode =
  | 'CAMERA_UNSUPPORTED'
  | 'CAMERA_DENIED'
  | 'CAMERA_MISSING'
  | 'CAMERA_BUSY'
  | 'CAMERA_FAILED'
  | 'CAMERA_NOT_READY';

export class CameraError extends Error {
  constructor(readonly code: CameraErrorCode) {
    super(code);
    this.name = 'CameraError';
  }
}

export class RemoteCamera {
  #stream: MediaStream | undefined;
  #video: HTMLVideoElement | undefined;
  #generation = 0;

  get active(): boolean {
    return this.#stream !== undefined;
  }

  async start(video: HTMLVideoElement): Promise<void> {
    const generation = ++this.#generation;
    this.#releaseCurrent();
    const mediaDevices = Reflect.get(navigator, 'mediaDevices') as MediaDevices | undefined;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      throw new CameraError('CAMERA_UNSUPPORTED');
    }

    let stream: MediaStream | undefined;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      if (generation !== this.#generation) {
        stopStream(stream);
        return;
      }

      this.#stream = stream;
      this.#video = video;
      video.srcObject = stream;
      await video.play();
      if (generation !== this.#generation) this.#releaseOwned(stream, video);
    } catch (error) {
      if (stream && this.#stream !== stream) stopStream(stream);
      if (generation !== this.#generation) return;
      this.#releaseCurrent();
      throw classifyCameraError(error);
    }
  }

  async capture(): Promise<Blob> {
    const video = this.#video;
    if (!video || video.videoWidth < 2 || video.videoHeight < 2) {
      this.stop();
      throw new CameraError('CAMERA_NOT_READY');
    }
    if (video.videoWidth > SOURCE_MAX_SIDE_PX || video.videoHeight > SOURCE_MAX_SIDE_PX) {
      this.stop();
      throw new SceneImageError('DIMENSIONS_TOO_LARGE');
    }
    if (video.videoWidth * video.videoHeight > SOURCE_MAX_PIXELS) {
      this.stop();
      throw new SceneImageError('PIXEL_LIMIT_EXCEEDED');
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    try {
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new CameraError('CAMERA_FAILED');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new CameraError('CAMERA_FAILED'))),
          'image/jpeg',
          0.95,
        );
      });
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      this.stop();
    }
  }

  stop(): void {
    this.#generation += 1;
    this.#releaseCurrent();
  }

  #releaseOwned(stream: MediaStream, video: HTMLVideoElement): void {
    stopStream(stream);
    video.pause();
    if (video.srcObject === stream) video.srcObject = null;
    if (this.#stream === stream) this.#stream = undefined;
    if (this.#video === video) this.#video = undefined;
  }

  #releaseCurrent(): void {
    if (this.#stream) stopStream(this.#stream);
    if (this.#video) {
      this.#video.pause();
      this.#video.srcObject = null;
    }
    this.#stream = undefined;
    this.#video = undefined;
  }
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

function classifyCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new CameraError('CAMERA_DENIED');
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return new CameraError('CAMERA_MISSING');
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return new CameraError('CAMERA_BUSY');
    }
  }
  return new CameraError('CAMERA_FAILED');
}
