import { SOURCE_FILE_MAX_BYTES, SceneImageError } from '@/core/image/sceneImageInspection';

/**
 * Copies picker-backed Files while the original change event still owns a readable handle.
 * Safari can invalidate that handle across asynchronous work even while the File object remains.
 */
export function snapshotSceneSource(source: Blob): Promise<Blob> {
  if (source.size > SOURCE_FILE_MAX_BYTES) {
    return Promise.reject(new SceneImageError('SOURCE_TOO_LARGE'));
  }
  if (typeof File === 'undefined' || !(source instanceof File)) {
    return Promise.resolve(source);
  }

  return new Promise<Blob>((resolve, reject) => {
    const reader = new FileReader();
    const fail = () => reject(new SceneImageError('SOURCE_READ_FAILED'));
    reader.onerror = fail;
    reader.onabort = fail;
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        fail();
        return;
      }
      resolve(new Blob([reader.result], { type: source.type }));
    };
    // readAsArrayBuffer is intentionally invoked synchronously in the caller's change-event turn.
    reader.readAsArrayBuffer(source);
  });
}
