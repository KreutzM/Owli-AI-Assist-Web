import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RemoteClientError,
  type RemoteAssistClient,
  type RemoteReadiness,
} from '@/core/api/remoteAssistClient';
import type {
  NormalizedSceneInput,
  RemoteSceneResult,
  SceneStreamCallbacks,
} from '@/core/api/remoteSceneContracts';
import { RemoteAssist } from '@/features/remote/RemoteAssist';
import type { RemoteCamera } from '@/platform/camera/remoteCamera';
import type { BrowserSceneImageNormalizer } from '@/platform/image/browserSceneImageNormalizer';

const readiness: RemoteReadiness = {
  sceneDescribeEnabled: true,
  catalog: {
    defaultProfileId: 'brief',
    profiles: [
      {
        id: 'brief',
        label: 'Kurz',
        description: 'Kurze Beschreibung',
        supportsStreaming: true,
        supportsFollowup: false,
      },
    ],
  },
};

beforeEach(() => {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RemoteAssist', () => {
  it('gates capture controls until all readiness signals pass', async () => {
    const disabled = { ...readiness, sceneDescribeEnabled: false };
    renderRemote({ initialize: vi.fn(async () => disabled) });
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Rückkamera öffnen' })).toBeDisabled();
    expect(screen.getByLabelText('Oder ein Bild auswählen')).toBeDisabled();
  });

  it('keeps visible deltas quiet and completes only after clean EOF resolution', async () => {
    let resolveStream: ((value: RemoteSceneResult) => void) | undefined;
    const describeScene = vi.fn(
      async (_input: NormalizedSceneInput, callbacks: SceneStreamCallbacks) => {
        callbacks.onMetadata?.({
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          profileId: 'brief',
          locale: 'de-DE',
        });
        callbacks.onDelta?.('Eine helle Straße.');
        callbacks.onTerminal?.();
        return await new Promise<RemoteSceneResult>((resolve) => {
          resolveStream = resolve;
        });
      },
    );
    renderRemote({ describeScene });

    const fileInput = await screen.findByLabelText('Oder ein Bild auswählen');
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1])], 'scene.png', { type: 'image/png' })] },
    });
    await screen.findByRole('button', { name: 'Szene beschreiben' });
    expect(fileInput).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Szene beschreiben' }));
    await screen.findByText('Die Antwort wird sicher abgeschlossen …');
    const visibleResult = screen.getByRole('heading', {
      name: 'Laufende Beschreibung',
    }).parentElement;
    expect(visibleResult).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('heading', { name: 'Szenenbeschreibung' })).not.toBeInTheDocument();

    resolveStream?.(sceneResult());
    const completedHeading = await screen.findByRole('heading', {
      name: 'Szenenbeschreibung',
    });
    const completedResult = completedHeading.closest('section');
    if (!completedResult) throw new Error('Missing completed scene result');
    expect(within(completedResult).getByText('Eine helle Straße.')).toBeInTheDocument();
    expect(describeScene).toHaveBeenCalledTimes(1);
  });

  it('cancels neutrally, aborts the attempt, and keeps explicit retry available', async () => {
    const describeScene = vi.fn(
      async (
        _input: NormalizedSceneInput,
        callbacks: SceneStreamCallbacks,
        signal?: AbortSignal,
      ) => {
        callbacks.onMetadata?.({
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          profileId: 'brief',
          locale: 'de-DE',
        });
        return await new Promise<RemoteSceneResult>((_, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      },
    );
    renderRemote({ describeScene });
    const fileInput = await screen.findByLabelText('Oder ein Bild auswählen');
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1])], 'scene.webp', { type: 'image/webp' })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Szene beschreiben' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));

    const retry = await screen.findByRole('button', { name: 'Erneut senden' });
    expect(screen.getByRole('status')).toHaveTextContent('Der Vorgang wurde abgebrochen.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(retry).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rückkamera öffnen' })).toHaveFocus();
  });

  it('retains the normalized image and unlocks explicit retry after Retry-After', async () => {
    let firstImage: Blob | undefined;
    const describeScene = vi
      .fn()
      .mockImplementationOnce(async (input: NormalizedSceneInput) => {
        firstImage = input.image;
        throw new RemoteClientError('RATE_LIMITED', Date.now() + 50, 429);
      })
      .mockImplementationOnce(async (input: NormalizedSceneInput) => {
        expect(input.image).toBe(firstImage);
        return sceneResult();
      });
    renderRemote({ describeScene });

    fireEvent.change(await screen.findByLabelText('Oder ein Bild auswählen'), {
      target: { files: [new File([new Uint8Array([1])], 'scene.png', { type: 'image/png' })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Szene beschreiben' }));

    const retry = await screen.findByRole('button', {
      name: 'Erneut versuchen, sobald freigegeben',
    });
    expect(retry).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Erneut möglich');
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 1_000 });
    fireEvent.click(retry);

    await screen.findByRole('heading', { name: 'Szenenbeschreibung' });
    expect(describeScene).toHaveBeenCalledTimes(2);
  });
});

function renderRemote(overrides: Partial<RemoteAssistClient> = {}) {
  const client = {
    initialize: vi.fn(async () => readiness),
    refreshCatalog: vi.fn(async () => readiness),
    describeScene: vi.fn(async () => sceneResult()),
    ...overrides,
  } as unknown as RemoteAssistClient;
  const camera = {
    active: false,
    start: vi.fn(async () => undefined),
    capture: vi.fn(async () => new Blob([], { type: 'image/jpeg' })),
    stop: vi.fn(),
  } as unknown as RemoteCamera;
  const normalizedBlob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
  const normalizer = {
    normalize: vi.fn(async () => ({
      blob: normalizedBlob,
      width: 640,
      height: 480,
      byteLength: 1,
      previewUrl: 'blob:normalized-scene',
    })),
  } as unknown as BrowserSceneImageNormalizer;
  return render(
    <RemoteAssist client={client} camera={camera} normalizer={normalizer} locale="de-DE" />,
  );
}

function sceneResult(): RemoteSceneResult {
  return {
    answerText: 'Eine helle Straße.',
    sceneToken: 'scene-token',
    sceneTokenExpiresAt: '2026-07-17T12:00:00.000Z',
    profileId: 'brief',
    locale: 'de-DE',
    modelAlias: 'scene-describe-v1',
    requestId: 'request-1',
  };
}
