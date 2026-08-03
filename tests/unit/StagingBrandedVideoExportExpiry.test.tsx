import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import { loadOwliBrandingLogo } from '@/core/api/loadOwliBrandingLogo';
import { StagingBrandedVideoExport } from '@/features/remote/StagingBrandedVideoExport';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import { canShareFile, shareFile } from '@/platform/share/browserShare';
import { audioPostcardOptions, readyAudioPostcard } from './audioPostcardFixtures';

vi.mock('@/core/api/downloadAudioPostcard', () => ({ downloadAudioPostcard: vi.fn() }));
vi.mock('@/core/api/loadOwliBrandingLogo', () => ({ loadOwliBrandingLogo: vi.fn() }));
vi.mock('@/platform/media/browserBrandedVideoRenderer', () => ({ renderBrandedVideo: vi.fn() }));
vi.mock('@/platform/share/browserShare', () => ({
  canShareFile: vi.fn(),
  shareFile: vi.fn(),
}));

const API_BASE_URL = 'https://api-staging.owli-ai.com/';
const CANCELLED_MESSAGE = 'Videoerstellung wurde abgebrochen. Die Audio-Postcard bleibt verfügbar.';
const audioBlob = new Blob(['audio'], { type: 'audio/mpeg' });
const logoBlob = new Blob(['logo'], { type: 'image/png' });
const outputFile = new File(['video'], 'owli-audio-postcard.webm', { type: 'video/webm' });
const options = audioPostcardOptions();
const image = {
  blob: new Blob(['image'], { type: 'image/jpeg' }),
  width: 1280,
  height: 720,
  byteLength: 5,
  previewUrl: 'blob:scene-1',
};
const revokeObjectUrl = vi.fn<(url: string) => void>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-03T08:00:00Z'));
  revokeObjectUrl.mockClear();
  vi.mocked(downloadAudioPostcard).mockResolvedValue(audioBlob);
  vi.mocked(loadOwliBrandingLogo).mockResolvedValue(logoBlob);
  vi.mocked(renderBrandedVideo).mockResolvedValue(outputFile);
  vi.mocked(canShareFile).mockReturnValue(false);
  vi.mocked(shareFile).mockResolvedValue(undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revokeObjectUrl(url));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('staging branded video capability expiry', () => {
  it('aborts expiry-bound audio download before local rendering', async () => {
    const result = expiringResult();
    let downloadSignal: AbortSignal | undefined;
    vi.mocked(downloadAudioPostcard).mockImplementation(({ signal }) => {
      downloadSignal = signal;
      return new Promise<Blob>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Audio capability expired.', 'TimeoutError')),
          { once: true },
        );
      });
    });
    renderExport(result);
    startExport();

    await expireCapability();

    expect(downloadSignal?.aborted).toBe(true);
    expect(downloadAudioPostcard).toHaveBeenCalledTimes(1);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Audio-Postcard ist abgelaufen/u);
  });

  it('starts local rendering when audio finished before expiry', async () => {
    const result = expiringResult();
    const logo = deferred<Blob>();
    let localSignal: AbortSignal | undefined;
    vi.mocked(loadOwliBrandingLogo).mockImplementation((signal) => {
      localSignal = signal;
      return logo.promise;
    });
    renderExport(result);
    startExport();
    await flushWork();

    expect(downloadAudioPostcard).toHaveBeenCalledTimes(1);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Audio ist lokal geprüft/u);

    await expireCapability();

    expect(localSignal?.aborted).toBe(false);
    logo.resolve(logoBlob);
    await flushWork();

    expect(renderBrandedVideo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();
    expect(downloadAudioPostcard).toHaveBeenCalledTimes(1);
  });

  it('keeps an active local renderer alive after expiry', async () => {
    const result = expiringResult();
    const rendered = deferred<File>();
    let rendererSignal: AbortSignal | undefined;
    vi.mocked(renderBrandedVideo).mockImplementation((input) => {
      rendererSignal = input.signal;
      return rendered.promise;
    });
    renderExport(result);
    startExport();
    await flushWork();

    expect(renderBrandedVideo).toHaveBeenCalledTimes(1);
    await expireCapability();

    expect(rendererSignal?.aborted).toBe(false);
    rendered.resolve(outputFile);
    await flushWork();

    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();
    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    expect(downloadAudioPostcard).toHaveBeenCalledTimes(1);
  });

  it('keeps ready output and share available after expiry', async () => {
    const result = expiringResult();
    vi.mocked(canShareFile).mockReturnValue(true);
    renderExport(result);
    startExport();
    await flushWork();

    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();
    await expireCapability();

    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toHaveAttribute(
      'href',
      'blob:video-1',
    );
    expect(screen.getByRole('button', { name: 'Video teilen' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Video (erneut )?erstellen/u })).toBeNull();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it('aborts both controllers when the request identity changes', () => {
    const firstResult = expiringResult({ requestId: 'request-first' });
    const secondResult = expiringResult({ requestId: 'request-second' });
    let downloadSignal: AbortSignal | undefined;
    let localSignal: AbortSignal | undefined;
    vi.mocked(downloadAudioPostcard).mockImplementation(({ signal }) => {
      downloadSignal = signal;
      return new Promise(() => undefined);
    });
    vi.mocked(loadOwliBrandingLogo).mockImplementation((signal) => {
      localSignal = signal;
      return new Promise(() => undefined);
    });
    const view = renderKeyedExport(firstResult);
    startExport();

    view.rerender(keyedExport(secondResult));

    expect(downloadSignal?.aborted).toBe(true);
    expect(localSignal?.aborted).toBe(true);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
  });

  it('keeps user cancellation stable during an expiry race', async () => {
    const result = expiringResult();
    const audio = deferred<Blob>();
    vi.mocked(downloadAudioPostcard).mockImplementation(() => audio.promise);
    renderExport(result);
    startExport();
    fireEvent.click(screen.getByRole('button', { name: 'Videoerstellung abbrechen' }));

    await expireCapability();
    audio.resolve(audioBlob);
    await flushWork();

    expect(screen.getByRole('status')).toHaveTextContent(CANCELLED_MESSAGE);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Video herunterladen' })).toBeNull();
  });
});

function expiringResult(overrides = {}) {
  return readyAudioPostcard({
    expiresAt: new Date(Date.now() + 1_000).toISOString(),
    ...overrides,
  });
}

function renderExport(result: ReturnType<typeof readyAudioPostcard>) {
  return render(
    <StagingBrandedVideoExport
      enabled
      image={image}
      result={result}
      options={options}
      apiBaseUrl={API_BASE_URL}
    />,
  );
}

function renderKeyedExport(result: ReturnType<typeof readyAudioPostcard>) {
  return render(keyedExport(result));
}

function keyedExport(result: ReturnType<typeof readyAudioPostcard>) {
  return (
    <StagingBrandedVideoExport
      key={`${image.previewUrl}:${result.requestId}`}
      enabled
      image={image}
      result={result}
      options={options}
      apiBaseUrl={API_BASE_URL}
    />
  );
}

function startExport(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
}

async function expireCapability(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(1_001));
}

async function flushWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
