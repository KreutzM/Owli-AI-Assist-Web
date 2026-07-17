import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('remote capability isolation', () => {
  it('keeps later product capabilities out of the remote scene surface', async () => {
    const sources = await Promise.all([
      readFile('src/features/remote/RemoteAssist.tsx', 'utf8'),
      readFile('src/features/remote/useRemoteScene.ts', 'utf8'),
      readFile('src/app/App.tsx', 'utf8'),
    ]);
    const remoteSource = sources.slice(0, 2).join('\n');
    expect(remoteSource).not.toMatch(
      /features\/(?:followup|song|postcard)|askFollowup|generateAudioPostcard|share|speechSynthesis|playAudio|playVideo/iu,
    );
    expect(sources[2]).toContain("runtime.mode === 'mock'");
    expect(sources[2]).toContain('<AudioPostcardPanel');
    expect(sources[2]).toContain('<RemoteAssist');
  });

  it('keeps the shared client route allowlist exact', async () => {
    const source = await readFile('src/core/api/remoteAssistClient.ts', 'utf8');
    const routes = [...source.matchAll(/'\/(api\/v1\/[^']+)'/gu)].map(
      (match) => `/${match[1]}`,
    );
    expect(new Set(routes)).toEqual(
      new Set([
        '/api/v1/config',
        '/api/v1/session/bootstrap',
        '/api/v1/profiles',
        '/api/v1/scene/describe',
      ]),
    );
    expect(source).not.toContain('Authorization');
    expect(source).not.toContain('X-Request-Id');
  });

  it('keeps fetch and camera access in their approved layers', async () => {
    const client = await readFile('src/core/api/remoteAssistClient.ts', 'utf8');
    const camera = await readFile('src/platform/camera/remoteCamera.ts', 'utf8');
    const feature = await readFile('src/features/remote/useRemoteScene.ts', 'utf8');
    expect(client).toMatch(/#fetchImplementation/u);
    expect(camera).toContain("Reflect.get(navigator, 'mediaDevices')");
    expect(feature).not.toMatch(/\bfetch\s*\(|navigator\.mediaDevices/gu);
  });
});
