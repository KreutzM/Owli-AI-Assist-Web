import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sources = [
  'src/core/api/remoteAudioPostcardContracts.ts',
  'src/core/api/remoteAudioPostcardClient.ts',
  'src/core/api/remoteAudioPostcardErrors.ts',
  'src/features/remote/audioPostcardState.ts',
  'src/features/remote/useAudioPostcard.ts',
  'src/features/remote/RemoteAudioPostcardPanel.tsx',
];

describe('Audio-Postcard privacy boundary', () => {
  it('keeps request, quota, capability, and player state memory-only and unlogged', async () => {
    const source = await combinedSources();
    expect(source).not.toMatch(
      /localStorage|sessionStorage|indexedDB|caches\.|CacheStorage|document\.cookie|BroadcastChannel/gu,
    );
    expect(source).not.toMatch(/console\.|analytics|telemetry|sendBeacon/gu);
    expect(source).not.toMatch(/history\.|pushState|replaceState|location\.hash/gu);
  });

  it('does not expose remote download, share, video, autoplay, or persistent credentials', async () => {
    const source = await combinedSources();
    expect(source).not.toMatch(/\bdownload\b|navigator\.share|shareVideo:\s*true|autoplay/giu);
    expect(source).not.toMatch(/Authorization|X-Request-Id|credentials:\s*['"]include/gu);
    expect(source).toContain("credentials: 'omit'");
    expect(source).toContain("cache: 'no-store'");
  });

  it('keeps the service worker app-shell-only with no runtime API/media cache', async () => {
    const viteConfig = await readFile('vite.config.ts', 'utf8');
    expect(viteConfig).toContain('navigateFallbackDenylist: [/^\\/api\\//]');
    expect(viteConfig).toContain('runtimeCaching: []');
    expect(viteConfig).not.toMatch(/song\/(?:options|generate|audio)/gu);
  });
});

async function combinedSources(): Promise<string> {
  return (await Promise.all(sources.map(async (path) => await readFile(path, 'utf8')))).join('\n');
}
