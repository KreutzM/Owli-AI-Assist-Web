import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraError, RemoteCamera } from '@/platform/camera/remoteCamera';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RemoteCamera', () => {
  it('requests the rear camera without microphone and releases every track', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(
      async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream,
    );
    stubMediaDevices(getUserMedia);
    const video = document.createElement('video');
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    const camera = new RemoteCamera();

    await camera.start(video);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.srcObject).not.toBeNull();

    camera.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(camera.active).toBe(false);
  });

  it('stops a stream that resolves after the camera attempt was cancelled', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    let resolveStream: ((value: MediaStream) => void) | undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    stubMediaDevices(getUserMedia);
    const video = document.createElement('video');
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    const camera = new RemoteCamera();

    const start = camera.start(video);
    camera.stop();
    resolveStream?.(stream);
    await start;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
    expect(video.srcObject).not.toBe(stream);
    expect(camera.active).toBe(false);
  });

  it.each([
    ['NotAllowedError', 'CAMERA_DENIED'],
    ['SecurityError', 'CAMERA_DENIED'],
    ['NotFoundError', 'CAMERA_MISSING'],
    ['NotReadableError', 'CAMERA_BUSY'],
  ])('classifies %s as %s', async (name, code) => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException('camera failure', name);
    });
    stubMediaDevices(getUserMedia);
    const camera = new RemoteCamera();
    await expect(camera.start(document.createElement('video'))).rejects.toMatchObject({ code });
  });

  it('classifies missing mediaDevices as unsupported', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
    await expect(new RemoteCamera().start(document.createElement('video'))).rejects.toEqual(
      new CameraError('CAMERA_UNSUPPORTED'),
    );
  });

  it('stops the stream immediately after frame capture', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(
      async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream,
    );
    stubMediaDevices(getUserMedia);
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ fillStyle: '', fillRect: vi.fn(), drawImage })),
      toBlob: vi.fn((callback: BlobCallback) => {
        callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
      }),
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);

    const camera = new RemoteCamera();
    await camera.start(video);
    await expect(camera.capture()).resolves.toMatchObject({ type: 'image/jpeg' });
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });
});

function stubMediaDevices(getUserMedia: MediaDevices['getUserMedia']): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}
