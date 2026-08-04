import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import { loadOwliBrandingLogo } from '@/core/api/loadOwliBrandingLogo';
import { StagingBrandedVideoExport } from '@/features/remote/StagingBrandedVideoExport';
import { isStagingBrandedVideoExportAvailable } from '@/features/remote/stagingBrandedVideoAvailability';
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
const outputFile = new File(['video-one'], 'owli-audio-postcard.webm', {
  type: 'video/webm',
});
const replacementFile = new File(['video-two'], 'owli-audio-postcard.webm', {
  type: 'video/webm',
});
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
const createObjectUrlCall = vi.fn<(object: Blob | MediaSource) => string>();
const revokeObjectUrlCall = vi.fn<(url: string) => void>();

beforeEach(() => {
  setDocumentVisibility('visible', false);
  createObjectUrlCall.mockReset().mockReturnValue('blob:video-1');
  revokeObjectUrlCall.mockClear();
  vi.mocked(downloadAudioPostcard).mockReset().mockResolvedValue(audioBlob);
  vi.mocked(loadOwliBrandingLogo).mockReset().mockResolvedValue(logoBlob);
  vi.mocked(renderBrandedVideo).mockReset().mockResolvedValue(outputFile);
  vi.mocked(canShareFile).mockReset().mockReturnValue(false);
  vi.mocked(shareFile).mockReset().mockResolvedValue(undefined);
  vi.spyOn(URL, 'createObjectURL').mockImplementation((object) => createObjectUrlCall(object));
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revokeObjectUrlCall(url));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  setDocumentVisibility('visible', false);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isStagingBrandedVideoExportAvailable', () => {
  it('is visible only for exact structural staging inputs', () => {
    const valid = {
      buildFlag: 'enabled',
      apiBaseUrl: API_BASE_URL,
      image,
      result,
      options,
    };

    expect(isStagingBrandedVideoExportAvailable(valid)).toBe(true);
    expect(isStagingBrandedVideoExportAvailable({ ...valid, buildFlag: undefined })).toBe(false);
    expect(
      isStagingBrandedVideoExportAvailable({ ...valid, apiBaseUrl: 'https://api.owli-ai.com/' }),
    ).toBe(false);
    expect(isStagingBrandedVideoExportAvailable({ ...valid, image: undefined })).toBe(false);
    expect(isStagingBrandedVideoExportAvailable({ ...valid, result: undefined })).toBe(false);
    expect(isStagingBrandedVideoExportAvailable({ ...valid, options: undefined })).toBe(false);
  });

  it('keeps an expired ready result structurally mounted', () => {
    expect(
      isStagingBrandedVideoExportAvailable({
        buildFlag: 'enabled',
        apiBaseUrl: API_BASE_URL,
        image,
        result: readyAudioPostcard({ expiresAt: new Date(Date.now() - 1).toISOString() }),
        options,
      }),
    ).toBe(true);
  });

  it('keeps the backend share-video generation contract disabled', () => {
    expect(options.generation.shareVideoAvailable).toBe(false);
  });
});

describe('StagingBrandedVideoExport', () => {
  it('renders no export UI when the staging gate is false', () => {
    const { container } = renderExport(false);

    expect(container).toBeEmptyDOMElement();
  });

  it('prevents a new export after the audio capability expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    const expiringResult = readyAudioPostcard({
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
    });
    render(
      <StagingBrandedVideoExport
        enabled
        image={image}
        result={expiringResult}
        options={options}
        apiBaseUrl={API_BASE_URL}
      />,
    );
    expect(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' })).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(1_001));

    expect(screen.queryByRole('button', { name: 'Gebrandetes Video erstellen' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/Audio-Postcard ist abgelaufen/u);
    expect(downloadAudioPostcard).not.toHaveBeenCalled();
  });

  it('does not pass backend duration metadata into the local renderer', async () => {
    const metadataMismatchResult = readyAudioPostcard({
      audio: { ...result.audio, durationMs: 1 },
    });
    renderExport(true, metadataMismatchResult);
    startExport();

    const download = await screen.findByRole('link', { name: 'Video herunterladen' });
    expect(download).toHaveAttribute('download', 'owli-audio-postcard.webm');
    expect(downloadAudioPostcard).toHaveBeenCalledWith(
      expect.objectContaining({
        result: metadataMismatchResult,
        options,
        apiBaseUrl: API_BASE_URL,
      }),
    );
    expect(loadOwliBrandingLogo).toHaveBeenCalledTimes(1);
    const rendererInput = vi.mocked(renderBrandedVideo).mock.calls[0]?.[0];
    expect(rendererInput).toEqual(
      expect.objectContaining({
        imageBlob: image.blob,
        logoBlob,
        audioBlob,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(rendererInput).not.toHaveProperty('expectedDurationMs');
    expect(rendererInput).not.toHaveProperty('shareVideo');
    expect(screen.getByRole('status')).toHaveTextContent(/geprüft und bereit/u);
    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    await waitFor(() => expect(download).toHaveFocus());
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
    startExport();
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

  it('keeps the audio fallback and exposes retry after a safe render failure', async () => {
    vi.mocked(renderBrandedVideo).mockRejectedValue(new Error('invalid output'));
    renderExport();
    startExport();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Audio-Postcard bleibt verfügbar/u);
    expect(screen.getByRole('button', { name: 'Video erneut erstellen' })).toHaveFocus();
  });

  it('aborts an active capability download when the document becomes hidden', async () => {
    let downloadSignal: AbortSignal | undefined;
    vi.mocked(downloadAudioPostcard).mockImplementation(({ signal }) => {
      downloadSignal = signal;
      return pendingUntilAbort(signal);
    });
    renderExport();
    startExport();
    await waitFor(() => expect(downloadSignal).toBeDefined());

    setDocumentVisibility('hidden');

    expect(downloadSignal?.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent(/Videoerstellung wurde abgebrochen/u);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
  });

  it('aborts an active renderer when the document becomes hidden', async () => {
    const rendered = deferred<File>();
    let rendererSignal: AbortSignal | undefined;
    vi.mocked(renderBrandedVideo).mockImplementation((input) => {
      rendererSignal = input.signal;
      return rendered.promise;
    });
    renderExport();
    startExport();
    await waitFor(() => expect(renderBrandedVideo).toHaveBeenCalledTimes(1));

    setDocumentVisibility('hidden');

    expect(rendererSignal?.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent(/Videoerstellung wurde abgebrochen/u);
    rendered.resolve(outputFile);
    await flushWork();
  });

  it('does not publish a late capability completion after hidden cleanup', async () => {
    const audio = deferred<Blob>();
    vi.mocked(downloadAudioPostcard).mockReturnValue(audio.promise);
    renderExport();
    startExport();

    setDocumentVisibility('hidden');
    audio.resolve(audioBlob);
    await flushWork();

    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Video herunterladen' })).toBeNull();
    expect(createObjectUrlCall).not.toHaveBeenCalled();
  });

  it('allows a successful same-tab retry after hidden aborts an active attempt', async () => {
    const firstAudio = deferred<Blob>();
    vi.mocked(downloadAudioPostcard).mockImplementationOnce(() => firstAudio.promise);
    renderExport();
    startExport();

    setDocumentVisibility('hidden');
    setDocumentVisibility('visible');
    fireEvent.click(screen.getByRole('button', { name: 'Video erneut erstellen' }));

    expect(await screen.findByRole('link', { name: 'Video herunterladen' })).toHaveAttribute(
      'href',
      'blob:video-1',
    );
    firstAudio.resolve(audioBlob);
    await flushWork();
    expect(renderBrandedVideo).toHaveBeenCalledTimes(1);
  });

  it('keeps the exact ready File when the document is temporarily hidden', async () => {
    vi.mocked(canShareFile).mockReturnValue(true);
    await renderReady();

    setDocumentVisibility('hidden');
    setDocumentVisibility('visible');
    fireEvent.click(screen.getByRole('button', { name: 'Video teilen' }));

    await waitFor(() =>
      expect(shareFile).toHaveBeenCalledWith(outputFile, expect.any(String), expect.any(String)),
    );
  });

  it('keeps the exact ready object URL across hidden and visible transitions', async () => {
    await renderReady();

    setDocumentVisibility('hidden');
    setDocumentVisibility('visible');

    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toHaveAttribute(
      'href',
      'blob:video-1',
    );
    expect(revokeObjectUrlCall).not.toHaveBeenCalled();
  });

  it('keeps playback, download, and share after returning to visible', async () => {
    vi.mocked(canShareFile).mockReturnValue(true);
    await renderReady();

    setDocumentVisibility('hidden');
    setDocumentVisibility('visible');

    expect(screen.getByLabelText(/Video abspielen/u)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Video teilen' })).toBeVisible();
  });

  it('does not discard a ready output on temporary pagehide', async () => {
    vi.mocked(canShareFile).mockReturnValue(true);
    await renderReady();

    fireEvent(window, new Event('pagehide'));

    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Video teilen' })).toBeVisible();
    expect(revokeObjectUrlCall).not.toHaveBeenCalled();
  });

  it('revokes the ready object URL exactly once during unmount cleanup', async () => {
    const view = renderExport();
    startExport();
    await screen.findByRole('link', { name: 'Video herunterladen' });

    view.unmount();

    expect(revokeObjectUrlCall).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlCall).toHaveBeenCalledWith('blob:video-1');
  });

  it('revokes a superseded URL exactly once and retains the replacement output', async () => {
    createObjectUrlCall.mockReturnValueOnce('blob:video-1').mockReturnValueOnce('blob:video-2');
    vi.mocked(renderBrandedVideo)
      .mockResolvedValueOnce(outputFile)
      .mockResolvedValueOnce(replacementFile);
    const view = renderExport();
    startExport();
    await screen.findByRole('link', { name: 'Video herunterladen' });

    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    const replacementDownload = await screen.findByRole('link', { name: 'Video herunterladen' });

    expect(revokeObjectUrlCall.mock.calls.filter(([url]) => url === 'blob:video-1')).toHaveLength(
      1,
    );
    expect(replacementDownload).toHaveAttribute('href', 'blob:video-2');
    expect(revokeObjectUrlCall).not.toHaveBeenCalledWith('blob:video-2');

    view.unmount();
    expect(revokeObjectUrlCall.mock.calls.filter(([url]) => url === 'blob:video-2')).toHaveLength(
      1,
    );
  });

  it('keeps a retry output after cleanup of an older aborted renderer settles', async () => {
    const firstRender = deferred<File>();
    vi.mocked(renderBrandedVideo)
      .mockImplementationOnce(() => firstRender.promise)
      .mockResolvedValueOnce(replacementFile);
    renderExport();
    startExport();
    await waitFor(() => expect(renderBrandedVideo).toHaveBeenCalledTimes(1));

    setDocumentVisibility('hidden');
    setDocumentVisibility('visible');
    fireEvent.click(screen.getByRole('button', { name: 'Video erneut erstellen' }));
    const download = await screen.findByRole('link', { name: 'Video herunterladen' });

    firstRender.resolve(outputFile);
    await flushWork();

    expect(download).toHaveAttribute('href', 'blob:video-1');
    expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', 'blob:video-1');
    expect(createObjectUrlCall).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlCall).not.toHaveBeenCalled();
  });

  it('publishes the share pending status before the native promise settles', async () => {
    const sharing = deferred<void>();
    vi.mocked(canShareFile).mockReturnValue(true);
    vi.mocked(shareFile).mockReturnValue(sharing.promise);
    await renderReady();
    const share = screen.getByRole('button', { name: 'Video teilen' });

    fireEvent.click(share);

    expect(screen.getByRole('status')).toHaveTextContent('Teilen wird geöffnet …');
    expect(share).toBeDisabled();
    expect(screen.getByLabelText(/Video abspielen/u)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Video herunterladen' })).toBeVisible();

    sharing.resolve(undefined);
    await flushWork();
  });

  it('prevents duplicate concurrent native share calls', async () => {
    const sharing = deferred<void>();
    vi.mocked(canShareFile).mockReturnValue(true);
    vi.mocked(shareFile).mockReturnValue(sharing.promise);
    await renderReady();
    const share = screen.getByRole('button', { name: 'Video teilen' });

    fireEvent.click(share);
    fireEvent.click(share);

    expect(shareFile).toHaveBeenCalledTimes(1);
    expect(share).toBeDisabled();
    sharing.resolve(undefined);
    await flushWork();
  });

  it('preserves ready output and restores share focus after successful sharing', async () => {
    vi.mocked(canShareFile).mockReturnValue(true);
    await renderReady();
    const share = screen.getByRole('button', { name: 'Video teilen' });

    fireEvent.click(share);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Video wurde zum Teilen übergeben.'),
    );
    assertReadyOutput('blob:video-1');
    await waitFor(() => expect(share).toHaveFocus());
  });

  it('preserves ready output and restores share focus after AbortError', async () => {
    vi.mocked(canShareFile).mockReturnValue(true);
    vi.mocked(shareFile).mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    await renderReady();
    const share = screen.getByRole('button', { name: 'Video teilen' });

    fireEvent.click(share);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Teilen wurde abgebrochen. Video, Wiedergabe und Download bleiben verfügbar.',
      ),
    );
    assertReadyOutput('blob:video-1');
    await waitFor(() => expect(share).toHaveFocus());
  });

  it('preserves ready output and restores share focus after a technical share failure', async () => {
    vi.mocked(canShareFile).mockReturnValue(true);
    vi.mocked(shareFile).mockRejectedValue(new Error('share failed'));
    await renderReady();
    const share = screen.getByRole('button', { name: 'Video teilen' });

    fireEvent.click(share);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Video konnte nicht geteilt werden. Wiedergabe und Download bleiben verfügbar.',
      ),
    );
    assertReadyOutput('blob:video-1');
    await waitFor(() => expect(share).toHaveFocus());
  });

  it('does not let stale share settlement overwrite a replacement output', async () => {
    const firstShare = deferred<void>();
    vi.mocked(canShareFile).mockReturnValue(true);
    vi.mocked(shareFile)
      .mockImplementationOnce(() => firstShare.promise)
      .mockResolvedValueOnce(undefined);
    createObjectUrlCall.mockReturnValueOnce('blob:video-1').mockReturnValueOnce('blob:video-2');
    vi.mocked(renderBrandedVideo)
      .mockResolvedValueOnce(outputFile)
      .mockResolvedValueOnce(replacementFile);
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: 'Video teilen' }));

    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Video herunterladen' })).toHaveAttribute(
        'href',
        'blob:video-2',
      ),
    );

    firstShare.resolve(undefined);
    await flushWork();

    expect(screen.getByRole('status')).toHaveTextContent(
      'Gebrandetes Video ist geprüft und bereit.',
    );
    assertReadyOutput('blob:video-2');
    const replacementShare = screen.getByRole('button', { name: 'Video teilen' });
    await waitFor(() => expect(replacementShare).toBeEnabled());
    fireEvent.click(replacementShare);
    await waitFor(() =>
      expect(shareFile).toHaveBeenLastCalledWith(
        replacementFile,
        expect.any(String),
        expect.any(String),
      ),
    );
  });

  it('does not update state or restore focus after unmount during pending share', async () => {
    const sharing = deferred<void>();
    vi.mocked(canShareFile).mockReturnValue(true);
    vi.mocked(shareFile).mockReturnValue(sharing.promise);
    const view = renderExport();
    startExport();
    const share = await screen.findByRole('button', { name: 'Video teilen' });
    const focusSpy = vi.spyOn(share, 'focus');
    fireEvent.click(share);
    focusSpy.mockClear();

    view.unmount();
    sharing.resolve(undefined);
    await flushWork();

    expect(focusSpy).not.toHaveBeenCalled();
    expect(revokeObjectUrlCall).toHaveBeenCalledTimes(1);
  });

  it('announces download without changing the ready output', async () => {
    await renderReady();
    const download = screen.getByRole('link', { name: 'Video herunterladen' });

    fireEvent.click(download);

    expect(screen.getByRole('status')).toHaveTextContent(/Download wurde gestartet/u);
    expect(download).toHaveAttribute('href', 'blob:video-1');
  });
});

function renderExport(
  enabled = true,
  exportResult: ReturnType<typeof readyAudioPostcard> = result,
) {
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

function startExport(): void {
  fireEvent.click(
    screen.getByRole('button', {
      name: /^(?:Gebrandetes Video erstellen|Video erneut erstellen)$/u,
    }),
  );
}

async function renderReady(): Promise<void> {
  renderExport();
  startExport();
  await screen.findByRole('link', { name: 'Video herunterladen' });
}

function assertReadyOutput(url: string): void {
  expect(screen.getByLabelText(/Video abspielen/u)).toHaveAttribute('src', url);
  expect(screen.getByRole('link', { name: 'Video herunterladen' })).toHaveAttribute('href', url);
  expect(screen.getByRole('button', { name: 'Video teilen' })).toBeVisible();
  expect(revokeObjectUrlCall).not.toHaveBeenCalledWith(url);
}

function setDocumentVisibility(value: DocumentVisibilityState, dispatch = true): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
  if (dispatch) fireEvent(document, new Event('visibilitychange'));
}

function pendingUntilAbort(signal: AbortSignal): Promise<Blob> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () =>
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('Aborted', 'AbortError'),
        ),
      { once: true },
    );
  });
}

async function flushWork(): Promise<void> {
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
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
