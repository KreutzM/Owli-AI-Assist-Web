export interface CameraGateway {
  start(video: HTMLVideoElement): Promise<void>;
  capture(): Promise<Blob>;
  stop(): void;
}
