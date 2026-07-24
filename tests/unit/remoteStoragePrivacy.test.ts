import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sliceSources = [
  'src/core/api/remoteAssistClient.ts',
  'src/core/api/remoteClientSupport.ts',
  'src/core/api/remoteFollowupContracts.ts',
  'src/core/api/followupSse.ts',
  'src/core/session/remoteSessionManager.ts',
  'src/features/remote/followupState.ts',
  'src/features/remote/useRemoteScene.ts',
  'src/features/remote/RemoteAssist.tsx',
  'src/platform/image/browserSceneImageNormalizer.ts',
  'src/platform/speech/browserSpeech.ts',
];

describe('remote privacy boundary', () => {
  it('does not use persistent browser storage or content logging', async () => {
    const combined = await readSliceSources();
    expect(combined).not.toMatch(
      /localStorage|sessionStorage|indexedDB|caches\.|CacheStorage|console\.|BroadcastChannel/gu,
    );
    expect(combined).not.toMatch(/FileSystem|showSaveFilePicker|showOpenFilePicker/gu);
  });

  it('does not add source filename, prompt, scene, follow-up, or speech telemetry fields', async () => {
    const combined = await readSliceSources();
    expect(combined).not.toMatch(
      /sourceFileName|originalFileName|promptText|imageBytes|analytics|telemetry|errorTelemetry/giu,
    );
  });

  it('keeps sensitive values out of URLs and history APIs', async () => {
    const combined = await readSliceSources();
    expect(combined).not.toMatch(
      /URLSearchParams|history\.|pushState|replaceState|location\.hash/gu,
    );
    expect(combined).not.toMatch(/sceneToken=.*|questionText=.*|answerText=.*/gu);
  });

  it('does not add microphone, recognition, backend TTS, or audio-capture scope', async () => {
    const combined = await readSliceSources();
    expect(combined).not.toMatch(
      /SpeechRecognition|webkitSpeechRecognition|MediaRecorder|getUserMedia\(\{\s*audio|\/tts|speech\/synthesize/gu,
    );
  });
});

async function readSliceSources(): Promise<string> {
  return (await Promise.all(sliceSources.map(async (path) => await readFile(path, 'utf8')))).join(
    '\n',
  );
}
