import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import { loadOwliBrandingLogo } from '@/core/api/loadOwliBrandingLogo';
import { StagingBrandedVideoExport } from '@/features/remote/StagingBrandedVideoExport';
import { isStagingBrandedVideoExportAvailable } from '@/features/remote/stagingBrandedVideoAvailability';
import { copyTextToClipboard } from '@/platform/clipboard/browserClipboard';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import { canShareFile, shareFile } from '@/platform/share/browserShare';
import {
  BrandedVideoExportError,
  type BrandedVideoExportErrorCode,
  type BrandedVideoExportPhase,
} from '@/shared/media/brandedVideoExportError';
import { audioPostcardOptions, readyAudioPostcard } from './audioPostcardFixtures';

vi.mock('@/core/api/downloadAudioPostcard', () => ({ downloadAudioPostcard: vi.fn() }));
vi.mock('@/core/api/loadOwliBrandingLogo', () => ({ loadOwliBrandingLogo: vi.fn() }));
vi.mock('@/platform/clipboard/browserClipboard', () => ({ copyTextToClipboard: vi.fn() }));
vi.mock('@/platform/media/browserBrandedVideoRenderer', () => ({ renderBrandedVideo: vi.fn() }));
vi.mock('@/platform/share/browserShare', () => ({
  canShareFile: vi.fn(),
  shareFile: vi.fn(),
}));

const SENSITIVE_ERROR = 'https://api-staging.example/audio/secret?token=abc';
const API_BASE_URL = 'https://api-staging.owli-ai.com/';
const audioBlob = new Blob(['audio'], { type: 'audio/mpeg' });
const logoBlob = new Blob(['logo'], { type: 'image/png' });
const outputFile = new File(['video'], 'owli-audio-postcard.webm', { type: 'video/webm' });
const image = {
  blob: new Blob(['image'], { type: 'image/jpeg' }),
  width: 1280,
  height: 720,
  byteLength: 5,
  previewUrl: 'blob:scene-diagnostic',
};
const options = audioPostcardOptions();

beforeEach(() => {
  vi.mocked(downloadAudioPostcard).mockResolvedValue(audioBlob);
  vi.mocked(loadOwliBrandingLogo).mockResolvedValue(logoBlob);
  vi.mocked(renderBrandedVideo).mockResolvedValue(outputFile);
  vi.mocked(copyTextToClipboard).mockResolvedValue(true);
  vi.mocked(canShareFile).mockReturnValue(false);
  vi.mocked(shareFile).mockResolvedValue(undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagnostic-video');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('safe staging video export diagnostics', () => {
  it('shows VIDEO_CAPABILITY_DOWNLOAD_FAILED for a capability download failure', async () => {
    vi.mocked(downloadAudioPostcard).mockRejectedValue(new Error(SENSITIVE_ERROR));
    renderExport();

    startExport();

    await expectDiagnostic('VIDEO_CAPABILITY_DOWNLOAD_FAILED');
    expect(loadOwliBrandingLogo).toHaveBeenCalledTimes(1);
    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expectNoPublishedOutput();
  });

  it('shows VIDEO_BRANDING_ASSET_LOAD_FAILED for a canonical logo load failure', async () => {
    vi.mocked(loadOwliBrandingLogo).mockRejectedValue(new Error(SENSITIVE_ERROR));
    renderExport();

    startExport();

    await expectDiagnostic('VIDEO_BRANDING_ASSET_LOAD_FAILED');
    expect(renderBrandedVideo).not.toHaveBeenCalled();
    expectNoPublishedOutput();
  });

  it.each<[string, BrandedVideoExportErrorCode, BrandedVideoExportPhase]>([
    ['source audio decoding', 'VIDEO_SOURCE_AUDIO_DECODE_FAILED', 'source_audio_decode'],
    ['recording', 'VIDEO_RECORDING_FAILED', 'recording'],
    ['container validation', 'VIDEO_CONTAINER_VALIDATION_FAILED', 'container_validation'],
    ['duration validation', 'VIDEO_DURATION_VALIDATION_FAILED', 'duration_validation'],
    ['seeking', 'VIDEO_SEEK_VALIDATION_FAILED', 'seek_validation'],
    ['frame validation', 'VIDEO_FRAME_VALIDATION_FAILED', 'frame_validation'],
    ['playback probing', 'VIDEO_PLAYBACK_PROBE_FAILED', 'playback_probe'],
    ['output audio validation', 'VIDEO_OUTPUT_AUDIO_VALIDATION_FAILED', 'output_audio_validation'],
  ])('shows the precise allowlist code for %s', async (_label, code, phase) => {
    vi.mocked(renderBrandedVideo).mockRejectedValue(
      new BrandedVideoExportError(code, phase, new Error(SENSITIVE_ERROR)),
    );
    renderExport();

    startExport();

    await expectDiagnostic(code);
    expectNoPublishedOutput();
  });

  it('falls back to VIDEO_UNKNOWN_EXPORT_FAILURE for an untyped renderer failure', async () => {
    vi.mocked(renderBrandedVideo).mockRejectedValue(new Error(SENSITIVE_ERROR));
    renderExport();

    startExport();

    await expectDiagnostic('VIDEO_UNKNOWN_EXPORT_FAILURE');
    expectNoPublishedOutput();
  });

  it('copies only the fixed allowlist code and never a raw error or cause', async () => {
    vi.mocked(renderBrandedVideo).mockRejectedValue(
      new BrandedVideoExportError(
        'VIDEO_PLAYBACK_PROBE_FAILED',
        'playback_probe',
        new Error(SENSITIVE_ERROR),
      ),
    );
    renderExport();
    startExport();
    await expectDiagnostic('VIDEO_PLAYBACK_PROBE_FAILED');

    fireEvent.click(screen.getByRole('button', { name: 'Fehlercode kopieren' }));

    expect(copyTextToClipboard).toHaveBeenCalledWith('VIDEO_PLAYBACK_PROBE_FAILED');
    expect(copyTextToClipboard).not.toHaveBeenCalledWith(expect.stringContaining(SENSITIVE_ERROR));
    expect(document.body).not.toHaveTextContent(SENSITIVE_ERROR);
    expect(await screen.findByText('Fehlercode wurde kopiert.')).toBeVisible();
  });

  it('keeps the code visible when the Clipboard API is unavailable', async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue(false);
    vi.mocked(renderBrandedVideo).mockRejectedValue(
      new BrandedVideoExportError('VIDEO_FRAME_VALIDATION_FAILED', 'frame_validation'),
    );
    renderExport();
    startExport();
    await expectDiagnostic('VIDEO_FRAME_VALIDATION_FAILED');

    fireEvent.click(screen.getByRole('button', { name: 'Fehlercode kopieren' }));

    expect(await screen.findByText(/bleibt sichtbar/u)).toBeVisible();
    expect(screen.getByText('VIDEO_FRAME_VALIDATION_FAILED')).toBeVisible();
  });

  it('keeps user cancellation as the existing non-technical state', async () => {
    vi.mocked(downloadAudioPostcard).mockReturnValue(new Promise(() => undefined));
    renderExport();
    startExport();

    fireEvent.click(screen.getByRole('button', { name: 'Videoerstellung abbrechen' }));

    expect(screen.getByRole('status')).toHaveTextContent(/wurde abgebrochen/u);
    expect(screen.queryByText('Staging-Diagnose')).toBeNull();
    expect(screen.queryByText(/VIDEO_/u)).toBeNull();
  });

  it('keeps capability expiry as the existing non-technical state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
    const result = readyAudioPostcard({
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
    });
    renderExport({ result });

    await act(async () => vi.advanceTimersByTimeAsync(1_001));

    expect(screen.getByRole('status')).toHaveTextContent(/Audio-Postcard ist abgelaufen/u);
    expect(screen.queryByText('Staging-Diagnose')).toBeNull();
    expect(screen.queryByText(/VIDEO_/u)).toBeNull();
  });

  it('starts a clean retry and removes the old diagnostic state', async () => {
    vi.mocked(renderBrandedVideo)
      .mockRejectedValueOnce(
        new BrandedVideoExportError('VIDEO_CONTAINER_VALIDATION_FAILED', 'container_validation'),
      )
      .mockResolvedValueOnce(outputFile);
    renderExport();
    startExport();
    await expectDiagnostic('VIDEO_CONTAINER_VALIDATION_FAILED');

    fireEvent.click(screen.getByRole('button', { name: 'Video erneut erstellen' }));

    expect(await screen.findByRole('link', { name: 'Video herunterladen' })).toBeVisible();
    expect(screen.queryByText('Staging-Diagnose')).toBeNull();
    expect(renderBrandedVideo).toHaveBeenCalledTimes(2);
  });

  it('discards the old diagnosis when the scene or Audio Postcard identity changes', async () => {
    vi.mocked(renderBrandedVideo).mockRejectedValue(
      new BrandedVideoExportError('VIDEO_SEEK_VALIDATION_FAILED', 'seek_validation'),
    );
    const first = readyAudioPostcard({ requestId: 'request-diagnostic-one' });
    const second = readyAudioPostcard({ requestId: 'request-diagnostic-two' });
    const view = render(keyedExport(first));
    startExport();
    await expectDiagnostic('VIDEO_SEEK_VALIDATION_FAILED');

    view.rerender(keyedExport(second));

    expect(screen.queryByText('Staging-Diagnose')).toBeNull();
    expect(screen.getByRole('button', { name: 'Gebrandetes Video erstellen' })).toBeVisible();
  });

  it('renders no diagnostic surface for disabled, mock, or production gates', () => {
    const { container } = renderExport({ enabled: false });
    expect(container).toBeEmptyDOMElement();
    expect(
      isStagingBrandedVideoExportAvailable({
        buildFlag: undefined,
        apiBaseUrl: undefined,
        image,
        result: readyAudioPostcard(),
        options,
      }),
    ).toBe(false);
    expect(
      isStagingBrandedVideoExportAvailable({
        buildFlag: 'enabled',
        apiBaseUrl: 'https://api.owli-ai.com/',
        image,
        result: readyAudioPostcard(),
        options,
      }),
    ).toBe(false);
    expect(screen.queryByText('Staging-Diagnose')).toBeNull();
  });
});

function renderExport({
  enabled = true,
  result = readyAudioPostcard(),
}: {
  enabled?: boolean;
  result?: ReturnType<typeof readyAudioPostcard>;
} = {}) {
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

async function expectDiagnostic(code: BrandedVideoExportErrorCode): Promise<void> {
  expect(await screen.findByText('Staging-Diagnose')).toBeVisible();
  expect(screen.getByText(code)).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(/Audio-Postcard bleibt verfügbar/u);
  expect(document.body).not.toHaveTextContent(SENSITIVE_ERROR);
}

function expectNoPublishedOutput(): void {
  expect(screen.queryByLabelText(/Video abspielen/u)).toBeNull();
  expect(screen.queryByRole('link', { name: 'Video herunterladen' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Video teilen' })).toBeNull();
}
