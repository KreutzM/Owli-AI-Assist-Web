import { access } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { assertBrandedVideoDecodedAudio } from '@/platform/media/brandedVideoSourceAdmission';
import {
  BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS,
  MEDIA_RECORDER_LIMITS,
} from '@/platform/media/mediaRecorderLimits';
import type { BrandedVideoExportError } from '@/shared/media/brandedVideoExportError';

const WAV_FIXTURES = [
  { name: 'exact-30-seconds', durationMs: 30_000, expectedCode: undefined },
  { name: 'shorter-by-249-ms', durationMs: 29_751, expectedCode: undefined },
  { name: 'shorter-by-251-ms', durationMs: 29_749, expectedCode: undefined },
  {
    name: 'decoded-duration-at-codec-padding-boundary',
    durationMs: MEDIA_RECORDER_LIMITS.maxDurationMs + BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS,
    expectedCode: undefined,
  },
  {
    name: 'decoded-duration-over-codec-padding-boundary',
    durationMs: MEDIA_RECORDER_LIMITS.maxDurationMs + BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS + 1,
    expectedCode: 'VIDEO_SOURCE_DURATION_LIMIT_EXCEEDED',
  },
] as const;

// Independent MPEG-1 Layer III mono frame generated from a synthetic 440-Hz tone with
// the bit reservoir disabled. Repeating 1,150 frames yields 30.040816 s without
// ID3/Xing/LAME gapless metadata and keeps the fixture local, deterministic, and tiny.
const MP3_FRAME_BASE64 =
  '//sQxAADxQQfGA37IkCiA+LBr2hIMNDjDh0x04M+gzCvG+NQzhw06xtDCeBtNcwCBm6odX5rBsmloc/X9CghjRpqlx5e5iDDOG5TnUbfgzxiFhEnwqGwdGpZmozGQIMvpAcP/V9CYgg=';
const MP3_FRAME_COUNT = 1_150;
const MP3_FIXTURE_NAME = '30-second-mp3-without-gapless-metadata';

describe('real Chrome decoded-audio admission harness', () => {
  it('admits bounded compressed-audio padding without comparing backend duration metadata', async () => {
    const executablePath = await resolveChromeExecutable();
    const browser = await chromium.launch(
      executablePath ? { executablePath, headless: true } : { channel: 'chrome', headless: true },
    );
    try {
      const page = await browser.newPage();
      const decoded = await page.evaluate(
        async ({ fixtures, mp3FrameBase64, mp3FrameCount, mp3FixtureName }) => {
          const context = new AudioContext({ sampleRate: 48_000 });
          try {
            const sources = [
              ...fixtures.map((fixture) => ({
                name: fixture.name,
                expectedCode: fixture.expectedCode,
                bytes: createWav(fixture.durationMs, 48_000, 2),
              })),
              {
                name: mp3FixtureName,
                expectedCode: undefined,
                bytes: repeatMp3Frame(mp3FrameBase64, mp3FrameCount),
              },
            ];
            return await Promise.all(
              sources.map(async (source) => {
                const buffer = await context.decodeAudioData(source.bytes);
                const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => {
                  const data = buffer.getChannelData(channel);
                  const stride = Math.max(1, Math.floor(data.length / 20_000));
                  const values: number[] = [];
                  for (let index = 0; index < data.length; index += stride) {
                    values.push(data[index] ?? 0);
                  }
                  return { length: data.length, stride, values };
                });
                return {
                  name: source.name,
                  expectedCode: source.expectedCode,
                  duration: buffer.duration,
                  length: buffer.length,
                  numberOfChannels: buffer.numberOfChannels,
                  sampleRate: buffer.sampleRate,
                  channels,
                };
              }),
            );
          } finally {
            await context.close();
          }

          function createWav(durationMs: number, sampleRate: number, channels: number): ArrayBuffer {
            const frames = Math.round((durationMs / 1_000) * sampleRate);
            const bytesPerSample = 2;
            const dataBytes = frames * channels * bytesPerSample;
            const output = new ArrayBuffer(44 + dataBytes);
            const view = new DataView(output);
            writeAscii(view, 0, 'RIFF');
            view.setUint32(4, 36 + dataBytes, true);
            writeAscii(view, 8, 'WAVE');
            writeAscii(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, channels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * channels * bytesPerSample, true);
            view.setUint16(32, channels * bytesPerSample, true);
            view.setUint16(34, bytesPerSample * 8, true);
            writeAscii(view, 36, 'data');
            view.setUint32(40, dataBytes, true);
            for (let frame = 0; frame < frames; frame += 1) {
              const sample = Math.round(Math.sin((frame / sampleRate) * Math.PI * 2 * 440) * 8_192);
              for (let channel = 0; channel < channels; channel += 1) {
                const offset = 44 + (frame * channels + channel) * bytesPerSample;
                view.setInt16(offset, sample, true);
              }
            }
            return output;
          }

          function repeatMp3Frame(frameBase64: string, count: number): ArrayBuffer {
            const binary = atob(frameBase64);
            const frame = Uint8Array.from(binary, (value) => value.charCodeAt(0));
            const output = new Uint8Array(frame.length * count);
            for (let index = 0; index < count; index += 1) {
              output.set(frame, index * frame.length);
            }
            return output.buffer;
          }

          function writeAscii(view: DataView, offset: number, value: string): void {
            for (let index = 0; index < value.length; index += 1) {
              view.setUint8(offset + index, value.charCodeAt(index));
            }
          }
        },
        {
          fixtures: WAV_FIXTURES,
          mp3FrameBase64: MP3_FRAME_BASE64,
          mp3FrameCount: MP3_FRAME_COUNT,
          mp3FixtureName: MP3_FIXTURE_NAME,
        },
      );

      const outcomes = decoded.map((item) => {
        let code: string | undefined;
        try {
          assertBrandedVideoDecodedAudio(toAudioBuffer(item));
        } catch (error) {
          code = (error as BrandedVideoExportError).code;
        }
        return {
          name: item.name,
          expectedCode: item.expectedCode,
          duration: item.duration,
          length: item.length,
          numberOfChannels: item.numberOfChannels,
          sampleRate: item.sampleRate,
          code,
        };
      });

      for (const outcome of outcomes) {
        expect(outcome.code).toBe(outcome.expectedCode);
      }
      for (const fixture of WAV_FIXTURES) {
        const outcome = outcomes.find((candidate) => candidate.name === fixture.name);
        expect(outcome).toMatchObject({ numberOfChannels: 2, sampleRate: 48_000 });
      }
      const mp3Outcome = outcomes.find((candidate) => candidate.name === MP3_FIXTURE_NAME);
      expect(mp3Outcome).toMatchObject({ numberOfChannels: 1, sampleRate: 44_100, code: undefined });
      expect((mp3Outcome?.duration ?? 0) * 1_000).toBeGreaterThan(
        MEDIA_RECORDER_LIMITS.maxDurationMs,
      );
      expect(Math.round((mp3Outcome?.duration ?? 0) * 1_000)).toBeLessThanOrEqual(
        MEDIA_RECORDER_LIMITS.maxDurationMs + BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS,
      );

      console.warn(
        `BRANDED_VIDEO_ADMISSION_CHROME_REPORT ${JSON.stringify({
          browserVersion: browser.version(),
          fixtureSource:
            'locally generated PCM16 WAV plus repeated independent synthetic MP3 frame; no user, capability, backend, or network data',
          durationSource: 'AudioBuffer.duration',
          maxDecodedSourcePaddingMs: BRANDED_VIDEO_SOURCE_CODEC_PADDING_MS,
          outcomes,
        })}`,
      );
    } finally {
      await browser.close();
    }
  }, 120_000);
});

function toAudioBuffer(value: {
  duration: number;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  channels: { length: number; stride: number; values: number[] }[];
}): AudioBuffer {
  const channelData = value.channels.map(({ length, stride, values }) => {
    const sparse = new Float32Array(length);
    for (let sample = 0, index = 0; index < length; sample += 1, index += stride) {
      sparse[index] = values[sample] ?? 0;
    }
    return sparse;
  });
  return {
    duration: value.duration,
    length: value.length,
    numberOfChannels: value.numberOfChannels,
    sampleRate: value.sampleRate,
    getChannelData: (channel) => channelData[channel] ?? new Float32Array(),
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  };
}

async function resolveChromeExecutable(): Promise<string | undefined> {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const candidates = [
    configured,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next local Chrome or Chromium candidate.
    }
  }
  return undefined;
}
