import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteAudioPostcardPanel } from '@/features/remote/RemoteAudioPostcardPanel';
import type { AudioPostcardState } from '@/features/remote/audioPostcardState';
import type { useAudioPostcard } from '@/features/remote/useAudioPostcard';
import {
  audioPostcardOptions,
  audioPostcardQuota,
  readyAudioPostcard,
} from './audioPostcardFixtures';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RemoteAudioPostcardPanel', () => {
  it('renders an accessible native player without autoplay, share, or download', () => {
    renderPanel({
      status: 'ready',
      result: readyAudioPostcard(),
      quota: audioPostcardQuota(),
      playerState: 'metadata_ready',
    });

    const player = document.querySelector('audio') as HTMLAudioElement;
    expect(player.tagName).toBe('AUDIO');
    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('preload', 'metadata');
    expect(player).toHaveAttribute('crossorigin', 'anonymous');
    expect(player).not.toHaveAttribute('autoplay');
    expect(screen.getByText(/Beschriebene Szene:/).closest('p')).toHaveTextContent(
      'Eine helle Straße',
    );
    expect(screen.getByText(/Musikalische Umsetzung:/).closest('p')).toHaveTextContent(
      'Helle Streicher',
    );
    expect(
      screen.queryByRole('button', { name: /teilen|herunterladen/iu }),
    ).not.toBeInTheDocument();
  });

  it('displays only supplied fixed-window quota facts', () => {
    renderPanel({
      status: 'failed',
      quota: audioPostcardQuota(),
      errorCategory: 'provider_timeout',
    });
    expect(screen.getByText(/4 von 5 Versuchen im gelieferten festen Fenster/)).toBeInTheDocument();
    expect(screen.getByText(/als gezählt/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/täglich|monatlich|heute/iu);
  });

  it('warns that explicit retry after timeout can count again', () => {
    const generate = vi.fn();
    renderPanel(
      {
        status: 'timed_out',
        ambiguousOutcome: true,
      },
      { generate },
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Ergebnis.*unbekannt/);
    fireEvent.click(screen.getByRole('button', { name: 'Neuen Versuch starten' }));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not offer generation retry for a non-retryable failure', () => {
    renderPanel({
      status: 'failed',
      errorCategory: 'content_not_allowed',
      retryable: false,
    });
    expect(screen.queryByRole('button', { name: 'Neuen Versuch starten' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neues Bild verwenden' })).toBeVisible();
  });

  it('retains text alternatives after playback expiry and offers a new image', () => {
    const onNewImage = vi.fn();
    renderPanel(
      {
        status: 'expired',
        result: readyAudioPostcard(),
        quota: audioPostcardQuota(),
        playerState: 'error',
      },
      {},
      onNewImage,
    );
    expect(screen.queryByRole('audio')).not.toBeInTheDocument();
    expect(screen.getByText(/Beschriebene Szene:/).closest('p')).toHaveTextContent(
      'Eine helle Straße',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Neues Bild verwenden' }));
    expect(onNewImage).toHaveBeenCalledTimes(1);
  });
});

function renderPanel(
  stateOverrides: Partial<AudioPostcardState>,
  workflowOverrides: Partial<ReturnType<typeof useAudioPostcard>> = {},
  onNewImage = vi.fn(),
) {
  const state: AudioPostcardState = {
    status: 'idle',
    imageKey: 'blob:scene-1',
    options: audioPostcardOptions(),
    selectedProfileId: 'warm_audio_postcard',
    selectedModeId: 'lyria_sung_hook',
    requestRun: 1,
    ambiguousOutcome: false,
    playerState: 'empty',
    ...stateOverrides,
  };
  const workflow = {
    state,
    selectProfile: vi.fn(),
    generate: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    expire: vi.fn(),
    setPlayerState: vi.fn(),
    ...workflowOverrides,
  };
  return render(
    <RemoteAudioPostcardPanel
      workflow={workflow}
      conflictingRequest={false}
      onNewImage={onNewImage}
    />,
  );
}
