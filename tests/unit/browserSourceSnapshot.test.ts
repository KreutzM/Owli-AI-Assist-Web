import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneImageError } from '@/core/image/sceneImageInspection';
import { snapshotSceneSource } from '@/platform/image/browserSourceSnapshot';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('snapshotSceneSource', () => {
  it('passes ordinary in-memory blobs through without copying', async () => {
    const source = new Blob(['camera'], { type: 'image/jpeg' });
    await expect(snapshotSceneSource(source)).resolves.toBe(source);
  });

  it('starts FileReader synchronously and returns an independent blob', async () => {
    const readAsArrayBuffer = vi.fn();

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      readAsArrayBuffer(file: Blob) {
        readAsArrayBuffer(file);
        expect(file).toBe(source);
        this.result = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
        queueMicrotask(() =>
          this.onload?.call(
            this as unknown as FileReader,
            new ProgressEvent('load') as ProgressEvent<FileReader>,
          ),
        );
      }
    }

    vi.stubGlobal('FileReader', MockFileReader);
    const source = new File(['picker'], 'scene.jpg', { type: 'image/jpeg' });
    const snapshotPromise = snapshotSceneSource(source);

    expect(readAsArrayBuffer).toHaveBeenCalledTimes(1);
    const snapshot = await snapshotPromise;
    expect(snapshot).not.toBe(source);
    expect(snapshot.type).toBe('image/jpeg');
    expect(Array.from(new Uint8Array(await snapshot.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff]);
  });

  it('maps FileReader failures to a recoverable source-read error', async () => {
    class FailingFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = new DOMException('unreadable', 'NotReadableError');
      onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      readAsArrayBuffer() {
        queueMicrotask(() =>
          this.onerror?.call(
            this as unknown as FileReader,
            new ProgressEvent('error') as ProgressEvent<FileReader>,
          ),
        );
      }
    }

    vi.stubGlobal('FileReader', FailingFileReader);
    await expect(
      snapshotSceneSource(new File(['picker'], 'scene.jpg', { type: 'image/jpeg' })),
    ).rejects.toEqual(new SceneImageError('SOURCE_READ_FAILED'));
  });
});
