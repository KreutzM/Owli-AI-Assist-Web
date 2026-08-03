import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import { loadOwliBrandingLogo } from '@/core/api/loadOwliBrandingLogo';
import {
  canStartStagingBrandedVideoExport,
  isStagingBrandedVideoExportAvailable,
  StagingBrandedVideoExport,
} from '@/features/remote/StagingBrandedVideoExport';
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

const audioBlob = new Blob(['audio'], { type: 'audio/mpeg' });
const logoBlob = new Blob(['logo'], { type: 'image/png' });
const outputFile = new File(['video'], 'owli-audio-postcard.webm', { type: 'video/webm' });
const image = {
  blob: new Blob(['image'], { type: 'image/jpeg' }),
  width: 1280,
  height: 720,
  byteLength: 5,
  previewUrl: 'blob:scene-1',
};
const result = readyAudioPostcard();
const options = audioPostcardOptions();
const API_BASE_URL = 'https://api-staging.owli-ai.com/';
const revokeObjectUrlCall = vi.fn<(url: string) => void>();

beforeEach(() => {
  revokeObjectUrlCall.mockClear();
  vi.mocked(downloadAudioPostcard).mockResolvedValue(audioBlob);
  vi.mocked(loadOwliBrandingLogo).mockResolvedValue(logoBlob);
  vi.mocked(renderBrandedVideo).mockResolvedValue(outputFile);
  vi.mocked(canShareFile).mockReturnValue(false);
  vi.mocked(shareFile).mockResolvedValue(undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revokeObjectUrlCall(url));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('staging branded video availability', () => {
  it('mounts only for the exact structural staging inputs, including an expired ready result', () => {
    const structurallyValid = {
      buildFlag: 'enabled',
      apiBaseUrl: API_BASE_URL,
      image,
      result: readyAudioPostcard({ expiresAt: new Date(Date.now() - 1).toISOString() }),
      options,
    };

    expect(isStagingBrandedVideoExportAvailable(structurallyValid)).toBe(true);
    expect(
      isStagingBrandedVideoExportAvailable({ ...structurallyValid, buildFlag: undefined }),
    ).toBe(false);
    expect(
      isStagingBrandedVideoExportAvailable({
        ...structurallyValid,
        apiBaseUrl: 'https://api.owli-ai.com/',
      }),
    ).toBe(false);
    expect(
      isStagingBrandedVideoExportAvailable({ ...structurallyValid, image: undefined }),
    ).toBe(false);
    expect(
      isStagingBrandedVideoExportAvailable({ ...structurallyValid, result: undefined }),
    ).toBe(false);
    expect(
      isStagingBrandedVideoExportAvailable({ ...structurallyValid, options: undefined }),
    ).toBe(false);
  });

  it('allows a new GET only while the complete capability contract is still valid', () => {
    const now = Date.now();
    const validResult = readyAudioPostcard({
      expiresAt: new Date(now + 1_000).toISOString(),
    });

    expect(
      canStartStagingBrandedVideoExport({
        result: validResult,
        options,
        apiBaseUrl: API_BASE_URL,
        now,
      }),
    ).toBe(true);
    expect(
      canStartStagingBrandedVideoExport({
        result: validResult,
        options,
        apiBaseUrl: API_BASE_URL,
        now: now + 1_001,
      }),
    ).toBe(false);
  });
});

describe('StagingBrandedVideoExport', () => {
  it('renders no export UI when the structural staging gate is false', () => {
    const { container } = renderExport(false);

    expect(container).toBeEmptyDOMElement();
  });

  it('aborts an unfinished capability download at expiry without starting the renderer', async () => {
    useFixedClock();
    const expiringResult = resultExpiringIn(1_000);
    let downloadSignal: AbortSignal | undefined;
    vi.mocked(downloadAudioPostcard).mockImplementation(({ signal }) => {
      downloadSignal = signal;
      return new Promise<Blob>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    render(
      <>
        <p>Audio-Postcard bleibt verfügbar.</p>
        <StagingBrandedVideoExport
          enabled
          image={image}
          result={expiringResult}
          options={options}
          apiBaseUrl={API_BASE_URL}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));

    await act(async () => vi.advanceTimersByTimeAsync(1_001));

    expect(downloadSignal?.aborted).toBe(true);
    expect(downloadAudioPostcard).toHaveBeenCalledTimes(1);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Audio-Postcard ist abgelaufen/u);
    expect(screen.getByText('Audio-Postcard bleibt verfügbar.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Video (erneut )?erstellen/u })).toBeNull();
  });

  it('starts local work after expiry when audio finished before the logo was ready', async () => {
    useFixedClock();
    const expiringResult = resultExpiringIn(1_000);
    const logo = deferred<Blob>();
    const rendered = deferred<File>();
    let localSignal: AbortSignal | undefined;
    let rendererSignal: AbortSignal | undefined;
    vi.mocked(loadOwliBrandingLogo).mockImplementation((signal) => {
      localSignal = signal;
      return logo.promise;
    });
    vi.mocked(renderBrandedVideo).mockImplementation((input) => {
      rendererSignal = input.signal;
      return rendered.promise;
    });
    renderExport(true, expiringResult);
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    await flushAsyncWork();

    expect(downloadAudioPostcard).toHaveBeenCalledTimes(1);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Audio ist lokal geprüft/u);

    await act(async () => vi.advanceTimersByTimeAsync(1_001));

    expect(localSignal?.aborted).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent(/Audio ist lokal geprüft/u);

    logo.resolve(logoBlob);
    await flushAsyncWork();

    expect(renderBrandedVideo).toHaveBeenCalledTimes(1);
    expect(rendererSignal?.aborted).toBe(false);

    rendered.resolve(outputFile);
    await flushAsyncWork();

    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();
    expect(downloadAudioPostcard).toHaveBeenCalledTimes(1);
  });

  it('keeps an already-local renderer alive across capability expiry and publishes ready output', async () => {
    useFixedClock();
    const expiringResult = resultExpiringIn(1_000);
    const rendered = deferred<File>();
    let rendererSignal: AbortSignal | undefined;
    vi.mocked(renderBrandedVideo).mockImplementation((input) => {
      rendererSignal = input.signal;
      return rendered.promise;
    });
    renderExport(true, expiringResult);
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    await flushAsyncWork();

    expect(renderBrandedVideo).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(1_001));

    expect(rendererSignal?.aborted).toBe(false);
    expect(downloadAudioPostcard).toHaveBeenCalledTimes(1);

    rendered.resolve(outputFile);
    await flushAsyncWork();

    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toHaveAttribute(
      'download',
      'owli-audio-postcard.webm',
    );
    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    expect(screen.queryByRole('button', { name: /Video (erneut )?erstellen/u })).toBeNull();
  });

  it('keeps ready playback, download, share, and object URL after capability expiry', async () => {
    useFixedClock();
    vi.mocked(canShareFile).mockReturnValue(true);
    const expiringResult = resultExpiringIn(1_000);
    renderExport(true, expiringResult);
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    await flushAsyncWork();

    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(1_001));

    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toHaveAttribute(
      'href',
      'blob:video-1',
    );
    expect(screen.getByRole('button', { name: 'Video teilen' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Video (erneut )?erstellen/u })).toBeNull();
    expect(revokeObjectUrlCall).not.toHaveBeenCalled();
  });

  it('does not offer or perform a new export for an already-expired capability', () => {
    useFixedClock();
    const expiredResult = readyAudioPostcard({
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });
    renderExport(true, expiredResult);

    expect(screen.getByRole('status')).toHaveTextContent(/Audio-Postcard ist abgelaufen/u);
    expect(screen.queryByRole('button', { name: /Video (erneut )?erstellen/u })).toBeNull();
    expect(downloadAudioPostcard).not.toHaveBeenCalled();
    expect(renderBrandedVideo).not.toHaveBeenCalled();
  });

  it('loads the existing audio and canonical logo before rendering a checked local video', async () => {
    renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));

    expect(await screen.findByRole('link', { name: 'Video herunterladen' })).toHaveAttribute(
      'download',
      'owli-audio-postcard.webm',
    );
    expect(downloadAudioPostcard).toHaveBeenCalledWith(
      expect.objectContaining({ result, options, apiBaseUrl: API_BASE_URL }),
    );
    expect(loadOwliBrandingLogo).toHaveBeenCalledTimes(1);
    expect(renderBrandedVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        imageBlob: image.blob,
        logoBlob,
        audioBlob,
        expectedDurationMs: result.audio.durationMs,
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/geprüft und bereit/u);
    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toHaveFocus();
  });

  it('announces user cancellation within the existing audio-only fallback', async () => {
    vi.mocked(downloadAudioPostcard).mockReturnValue(new Promise(() => undefined));
    render(
      <>
        <p>Audio-Postcard bleibt verfügbar.</p>
        <StagingBrandedVideoExport
          enabled
          image={image}
          result={result}
          options={options}
          apiBaseUrl={API_BASE_URL}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    const cancel = await screen.findByRole('button', { name: 'Videoerstellung abbrechen' });

    fireEvent.click(cancel);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Videoerstellung wurde abgebrochen. Die Audio-Postcard bleibt verfügbar.',
    );
    expect(screen.getByText('Audio-Postcard bleibt verfügbar.')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Video erneut erstellen' })).toHaveFocus(),
    );
  });

  it('keeps user cancellation visible when expiry races with the aborted attempt', async () => {
    useFixedClock();
    const expiringResult = resultExpiringIn(1_000);
    const audio = deferred<Blob>();
    let downloadSignal: AbortSignal | undefined;
    vi.mocked(downloadAudioPostcard).mockImplementation(({ signal }) => {
      downloadSignal = signal;
      return audio.promise;
    });
    renderExport(true, expiringResult);
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Videoerstellung abbrechen' }));

    await act(async () => vi.advanceTimersByTimeAsync(1_001));
    audio.resolve(audioBlob);
    await flushAsyncWork();

    expect(downloadSignal?.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent(CANCELLED_MESSAGE_FOR_TEST);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Video herunterladen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Video (erneut )?erstellen/u })).toBeNull();
  });

  it('keeps the audio fallback and exposes retry after a safe render failure', async () => {
    vi.mocked(renderBrandedVideo).mockRejectedValue(new Error('invalid output'));
    renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Audio-Postcard bleibt verfügbar/u);
    expect(screen.getByRole('button', { name: 'Video erneut erstellen' })).toHaveFocus();
  });

  it('aborts active download and local work when the keyed request identity changes', async () => {
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
    const firstResult = readyAudioPostcard({ requestId: 'request-first' });
    const secondResult = readyAudioPostcard({ requestId: 'request-second' });
    const view = render(
      <StagingBrandedVideoExport
        key={`${image.previewUrl}:${firstResult.requestId}`}
        enabled
        image={image}
        result={firstResult}
        options={options}
        apiBaseUrl={API_BASE_URL}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));

    view.rerender(
      <StagingBrandedVideoExport
        key={`${image.previewUrl}:${secondResult.requestId}`}
        enabled
        image={image}
        result={secondResult}
        options={options}
        apiBaseUrl={API_BASE_URL}
      />,
    );

    expect(downloadSignal?.aborted).toBe(true);
    expect(localSignal?.aborted).toBe(true);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
  });

  it('revokes ready output when the keyed scene image changes', async () => {
    const view = render(
      <StagingBrandedVideoExport
        key={`${image.previewUrl}:${result.requestId}`}
        enabled
        image={image}
        result={result}
        options={options}
        apiBaseUrl={API_BASE_URL}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    await screen.findByRole('link', { name: 'Video herunterladen' });
    const replacementImage = { ...image, previewUrl: 'blob:scene-2' };

    view.rerender(
      <StagingBrandedVideoExport
        key={`${replacementImage.previewUrl}:${result.requestId}`}
        enabled
        image={replacementImage}
        result={result}
        options={options}
        apiBaseUrl={API_BASE_URL}
      />,
    );

    expect(revokeObjectUrlCall).toHaveBeenCalledWith('blob:video-1');
  });

  it('revokes the ready object URL during unmount cleanup', async () => {
    const view = renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    await screen.findByRole('link', { name: 'Video herunterladen' });

    view.unmount();

    expect(revokeObjectUrlCall).toHaveBeenCalledWith('blob:video-1');
  });

  it('keeps playback and download ready after a user cancels sharing', async () => {
    vi.mocked(canShareFile).mockReturnValue(true);
    vi.mocked(shareFile).mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    const share = await screen.findByRole('button', { name: 'Video teilen' });

    fireEvent.click(share);

    expect(await screen.findByRole('status')).toHaveTextContent(/Teilen wurde abgebrochen/u);
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();
    expect(screen.getByLabelText(/Video abspielen/u)).toBeVisible();
    expect(share).toHaveFocus();
  });

  it('reports a technical share failure without discarding the ready file', async () => {
    vi.mocked(canShareFile).mockReturnValue(true);
    vi.mocked(shareFile).mockRejectedValue(new Error('share failed'));
    renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    const share = await screen.findByRole('button', { name: 'Video teilen' });

    fireEvent.click(share);

    expect(await screen.findByRole('status')).toHaveTextContent(/konnte nicht geteilt/u);
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();
  });

  it('announces download without changing the ready output', async () => {
    renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    const download = await screen.findByRole('link', { name: 'Video herunterladen' });

    fireEvent.click(download);

    expect(screen.getByRole('status')).toHaveTextContent(/Download wurde gestartet/u);
    expect(download).toHaveAttribute('href', 'blob:video-1');
  });
});

const CANCELLED_MESSAGE_FOR_TEST =
  'Videoerstellung wurde abgebrochen. Die Audio-Postcard bleibt verfügbar.';

function renderExport(enabled = true, exportResult = result) {
  return render(
    <StagingBrandedVideoExport
      enabled={enabled}
      image={image}
      result={exportResult}
      options={options}
      apiBaseUrl={API_BASE_URL}
    />,
  );
}

function useFixedClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-03T08:00:00Z'));
}

function resultExpiringIn(milliseconds: number) {
  return readyAudioPostcard({
    expiresAt: new Date(Date.now() + milliseconds).toISOString(),
  });
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
