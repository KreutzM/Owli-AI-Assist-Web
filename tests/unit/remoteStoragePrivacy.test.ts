import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('remote privacy boundary', () => {
  it('does not use persistent browser storage or content logging', async () => {
    const sources = await Promise.all([
      readFile('src/core/api/remoteAssistClient.ts', 'utf8'),
      readFile('src/core/api/remoteClientSupport.ts', 'utf8'),
      readFile('src/core/session/remoteSessionManager.ts', 'utf8'),
      readFile('src/features/remote/useRemoteScene.ts', 'utf8'),
      readFile('src/platform/image/browserSceneImageNormalizer.ts', 'utf8'),
    ]);
    const combined = sources.join('\n');
    expect(combined).not.toMatch(
      /localStorage|sessionStorage|indexedDB|caches\.|CacheStorage|console\.|BroadcastChannel/gu,
    );
    expect(combined).not.toMatch(/FileSystem|showSaveFilePicker|showOpenFilePicker/gu);
  });

  it('does not add source filename, prompt, or content telemetry fields', async () => {
    const sources = await Promise.all([
      readFile('src/core/api/remoteAssistClient.ts', 'utf8'),
      readFile('src/platform/image/browserSceneImageNormalizer.ts', 'utf8'),
      readFile('src/features/remote/useRemoteScene.ts', 'utf8'),
    ]);
    expect(sources.join('\n')).not.toMatch(
      /sourceFileName|originalFileName|promptText|imageBytes|analytics|telemetry/giu,
    );
  });
});
