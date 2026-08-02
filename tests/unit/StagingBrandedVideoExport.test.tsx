import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import { loadOwliBrandingLogo } from '@/core/api/loadOwliBrandingLogo';
import {
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

beforeEach(() => {
  vi.mocked(downloadAudioPostcard).mockResolvedValue(audioBlob);
  vi.mocked(loadOwliBrandingLogo).mockResolvedValue(logoBlob);
  vi.mocked(renderBrandedVideo).mockResolvedValue(outputFile);
  vi.mocked(canShareFile).mockReturnValue(false);
  vi.mocked(shareFile).mockResolvedValue(undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('isStagingBrandedVideoExportAvailable', () => {
  it('is visible only for an exact staging build with image, options, and valid ready audio', () => {
    const valid = {
      buildFlag: 'enabled',
      apiBaseUrl: API_BASE_URL,
      image,
      result,
      options,
      now: Date.now(),
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

  it('rejects an expired audio capability', () => {
    expect(
      isStagingBrandedVideoExportAvailable({
        buildFlag: 'enabled',
        apiBaseUrl: API_BASE_URL,
        image,
        result: readyAudioPostcard({ expiresAt: new Date(Date.now() - 1).toISOString() }),
        options,
      }),
    ).toBe(false);
  });
});

describe('StagingBrandedVideoExport', () => {
  it('renders no export UI when the staging gate is false', () => {
    const { container } = renderExport(false);

    expect(container).toBeEmptyDOMElement();
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

  it('keeps the audio fallback and exposes retry after a safe render failure', async () => {
    vi.mocked(renderBrandedVideo).mockRejectedValue(new Error('invalid output'));
    renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Audio-Postcard bleibt verfügbar/u);
    expect(screen.getByRole('button', { name: 'Video erneut erstellen' })).toHaveFocus();
  });

  it('revokes the ready object URL during unmount cleanup', async () => {
    const view = renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' }));
    await screen.findByRole('link', { name: 'Video herunterladen' });

    view.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video-1');
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

function renderExport(enabled = true) {
  return render(
    <StagingBrandedVideoExport
      enabled={enabled}
      image={image}
      result={result}
      options={options}
      apiBaseUrl={API_BASE_URL}
    />,
  );
}
